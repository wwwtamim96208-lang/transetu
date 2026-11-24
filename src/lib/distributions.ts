import { Prisma, type Distribution } from '@prisma/client';
import { prisma } from './db';
import { HttpError } from './http';
import { audit } from './audit';
import type { SessionUser } from './auth';
import { verifyCardCode } from './domain/token';
import {
  canTransition, consumesStock, countsAsReceived, isConfirmExpired, CLOCK_SKEW_MS, CONFIRM_WINDOW_MS, MAX_CODE_ATTEMPTS, type DistStatus,
} from './domain/distribution';
import type { PushInput, SyncItemInput, LedgerQuery } from './validation';
import type { SyncResult } from './offline/types';

type Tx = Prisma.TransactionClient;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- stock helpers

/** Atomically take qty from an ACTIVE allotment. False if not enough / closed. */
async function consume(tx: Tx, allotmentId: string, qty: number): Promise<boolean> {
  const r = await tx.allotment.updateMany({
    where: { id: allotmentId, status: 'ACTIVE', remaining: { gte: qty } },
    data: { remaining: { decrement: qty } },
  });
  return r.count === 1;
}

/** Give qty back: to the allotment if still active, otherwise to the org's stock. */
async function restore(tx: Tx, allotmentId: string | null, qty: number) {
  if (!allotmentId) return;
  const a = await tx.allotment.findUnique({ where: { id: allotmentId } });
  if (!a) return;
  if (a.status === 'ACTIVE') await tx.allotment.update({ where: { id: a.id }, data: { remaining: { increment: qty } } });
  else await tx.stock.update({ where: { id: a.stockId }, data: { quantity: { increment: qty } } });
}

/** Serialise all writes for one household (repeat detection must see the other volunteer's row). */
async function lockHousehold(tx: Tx, householdId: string) {
  await tx.$queryRaw`SELECT id FROM "Household" WHERE id = ${householdId}::uuid FOR UPDATE`;
}

// ---------------------------------------------------------------- expiry

/**
 * Handed over but never confirmed within the window -> EXPIRED.
 * The goods are gone (stock stays consumed); the delivery is flagged as unverified.
 */
export async function expireStale(now = new Date()) {
  const stale = await prisma.distribution.findMany({
    where: { status: 'AWAITING_CONFIRMATION', occurredAt: { lt: new Date(now.getTime() - CONFIRM_WINDOW_MS) } },
    select: { id: true, householdId: true, volunteerId: true },
    take: 200,
  });
  for (const d of stale) {
    await prisma.$transaction(async (tx) => {
      // Conditional update: if two requests race, only one flags it.
      const r = await tx.distribution.updateMany({
        where: { id: d.id, status: 'AWAITING_CONFIRMATION' },
        data: { status: 'EXPIRED', version: { increment: 1 } },
      });
      if (r.count !== 1) return;
      await tx.reviewItem.create({
        data: { type: 'SYNC_CONFLICT', householdId: d.householdId, distributionId: d.id, details: { flags: ['UNCONFIRMED_EXPIRED'] }, createdById: d.volunteerId },
      });
      await audit(tx, { action: 'DISTRIBUTION_EXPIRED', entityType: 'Distribution', entityId: d.id });
    });
  }
  return stale.length;
}

// ---------------------------------------------------------------- repeat detection

async function findRepeats(tx: Tx, d: { id: string; householdId: string; categoryId: string; occurredAt: Date }) {
  const cat = await tx.reliefCategory.findUniqueOrThrow({ where: { id: d.categoryId } });
  const span = cat.cooldownDays * DAY_MS;
  return tx.distribution.findMany({
    where: {
      id: { not: d.id },
      householdId: d.householdId,
      categoryId: d.categoryId,
      status: { in: ['AWAITING_CONFIRMATION', 'DELIVERED'] },
      occurredAt: { gte: new Date(d.occurredAt.getTime() - span), lte: new Date(d.occurredAt.getTime() + span) },
    },
    select: { id: true, occurredAt: true, quantity: true, createdOffline: true, org: { select: { nameBn: true } }, volunteer: { select: { name: true } } },
    orderBy: { occurredAt: 'asc' },
  });
}

async function flagReview(
  tx: Tx, user: SessionUser, type: 'REPEAT_RELIEF' | 'SYNC_CONFLICT', d: { id: string; householdId: string }, details: Record<string, unknown>,
) {
  await tx.reviewItem.create({
    data: { type, householdId: d.householdId, distributionId: d.id, details: details as Prisma.InputJsonValue, createdById: user.id },
  });
}

// ---------------------------------------------------------------- sync (push)

/**
 * Accepts distributions recorded on a device (offline or online). Rules:
 *  - Idempotent: the device-generated UUID is the primary key. Re-sending is safe.
 *  - Each item has its own transaction: one bad item never blocks the others.
 *  - Goods already handed over are never "rejected" for business conflicts.
 *    They are recorded and FLAGGED for review (repeat relief, allotment exceeded).
 *  - Only records that are not legitimately this volunteer's are rejected.
 *  - The server re-verifies card codes; the device's verification is not trusted.
 */
export async function pushSync(user: SessionUser, input: PushInput) {
  if (user.role !== 'VOLUNTEER') throw new HttpError(403, 'FORBIDDEN', 'শুধু স্বেচ্ছাসেবীরা মাঠ থেকে বিতরণ sync করতে পারেন।');
  await expireStale();
  const results: SyncResult[] = [];
  for (const item of input.items) results.push(await syncOne(user, input.deviceId, item));
  return { results, serverTime: new Date().toISOString() };
}

async function syncOne(user: SessionUser, deviceId: string, item: SyncItemInput): Promise<SyncResult> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lockHousehold(tx, item.householdId);
        const existing = await tx.distribution.findUnique({ where: { id: item.id } });
        return existing ? applyUpdate(tx, user, existing, item) : createFromDevice(tx, user, deviceId, item);
      },
      { timeout: 15000 },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // The same item arrived twice at the same moment; the other request stored it.
      const d = await prisma.distribution.findUnique({ where: { id: item.id } });
      if (d) return { id: item.id, result: 'duplicate', status: d.status, flags: [] };
    }
    console.error('sync item failed', item.id, e);
    return { id: item.id, result: 'rejected', flags: [], error: 'সার্ভারে সমস্যা, আবার sync হবে।', retryable: true };
  }
}

const reject = (id: string, error: string): SyncResult => ({ id, result: 'rejected', flags: [], error });

async function createFromDevice(tx: Tx, user: SessionUser, deviceId: string, item: SyncItemInput): Promise<SyncResult> {
  const household = await tx.household.findFirst({ where: { id: item.householdId, deletedAt: null }, include: { ward: true } });
  if (!household || household.ward.parentId !== user.areaId) return reject(item.id, 'পরিবারটি আপনার এলাকার নয় বা মুছে ফেলা হয়েছে।');
  const allotment = await tx.allotment.findUnique({ where: { id: item.allotmentId }, include: { stock: true } });
  if (!allotment || allotment.volunteerId !== user.id) return reject(item.id, 'এই বরাদ্দ আপনার নয়।');
  if (allotment.stock.categoryId !== item.categoryId) return reject(item.id, 'বরাদ্দের ক্যাটাগরি মিলছে না।');

  const now = new Date();
  const flags: string[] = [];
  let occurredAt = new Date(item.occurredAt);
  if (occurredAt.getTime() > now.getTime() + CLOCK_SKEW_MS) {
    flags.push('CLOCK_AHEAD');
    occurredAt = now;
  }

  let status: DistStatus = item.status;
  if (status === 'DELIVERED' && !(item.confirmCode && verifyCardCode(item.confirmCode, household.id, household.tokenHash))) {
    status = 'AWAITING_CONFIRMATION'; // goods were handed over; confirmation is not proven
    flags.push('CODE_REJECTED_BY_SERVER');
  }
  if (status === 'AWAITING_CONFIRMATION' && isConfirmExpired(occurredAt, now)) status = 'EXPIRED';

  if (status === 'EXPIRED') flags.push('UNCONFIRMED_EXPIRED');

  let stockConsumed = false;
  if (consumesStock(status)) {
    stockConsumed = await consume(tx, allotment.id, item.quantity);
    if (!stockConsumed) flags.push(allotment.status === 'ACTIVE' ? 'ALLOTMENT_EXCEEDED' : 'ALLOTMENT_CLOSED');
  }

  const d = await tx.distribution.create({
    data: {
      id: item.id,
      householdId: household.id,
      categoryId: item.categoryId,
      quantity: item.quantity,
      orgId: user.orgId,
      volunteerId: user.id,
      allotmentId: allotment.id,
      status,
      confirmMethod: status === 'DELIVERED' ? 'TOKEN_CARD' : null,
      confirmAttempts: item.confirmAttempts,
      confirmedAt: status === 'DELIVERED' ? occurredAt : null,
      overrideReason: item.overrideReason,
      note: item.note,
      occurredAt,
      createdOffline: item.createdOffline,
      clientDeviceId: deviceId,
      syncedAt: now,
      stockConsumed,
    },
  });

  if (countsAsReceived(status)) {
    const repeats = await findRepeats(tx, d);
    if (repeats.length) {
      flags.push(item.overrideReason ? 'REPEAT_OVERRIDDEN' : 'REPEAT_RELIEF');
      await flagReview(tx, user, 'REPEAT_RELIEF', d, {
        overrideReason: item.overrideReason ?? null,
        createdOffline: item.createdOffline,
        others: repeats.map((r) => ({
          id: r.id, occurredAt: r.occurredAt.toISOString(), quantity: r.quantity,
          org: r.org.nameBn, volunteer: r.volunteer.name, offline: r.createdOffline,
        })),
      });
    }
  }
  const conflictFlags = flags.filter((f) => !f.startsWith('REPEAT_'));
  if (conflictFlags.length) await flagReview(tx, user, 'SYNC_CONFLICT', d, { flags: conflictFlags });

  await audit(tx, {
    userId: user.id, action: 'DISTRIBUTION_SYNC_CREATE', entityType: 'Distribution', entityId: d.id,
    after: { status, quantity: d.quantity, householdId: d.householdId, offline: d.createdOffline, flags },
  });
  return { id: d.id, result: 'created', status, flags };
}

async function applyUpdate(tx: Tx, user: SessionUser, existing: Distribution, item: SyncItemInput): Promise<SyncResult> {
  if (existing.volunteerId !== user.id) return reject(item.id, 'এই বিতরণ অন্য স্বেচ্ছাসেবীর।');
  if (existing.status === item.status) return { id: item.id, result: 'duplicate', status: existing.status, flags: [] };
  if (!canTransition(existing.status as DistStatus, item.status)) {
    return { id: item.id, result: 'unchanged', status: existing.status, flags: ['TRANSITION_NOT_ALLOWED'] };
  }

  const flags: string[] = [];
  if (item.status === 'DELIVERED') {
    const h = await tx.household.findUniqueOrThrow({ where: { id: existing.householdId } });
    if (!item.confirmCode || !verifyCardCode(item.confirmCode, h.id, h.tokenHash)) {
      await flagReview(tx, user, 'SYNC_CONFLICT', existing, { flags: ['CODE_REJECTED_BY_SERVER'] });
      return { id: item.id, result: 'unchanged', status: existing.status, flags: ['CODE_REJECTED_BY_SERVER'] };
    }
    let stockConsumed = existing.stockConsumed;
    if (!stockConsumed && existing.allotmentId) {
      stockConsumed = await consume(tx, existing.allotmentId, existing.quantity);
      if (!stockConsumed) flags.push('ALLOTMENT_EXCEEDED');
    }
    await tx.distribution.update({
      where: { id: existing.id },
      data: {
        status: 'DELIVERED', confirmMethod: 'TOKEN_CARD', confirmedAt: new Date(), stockConsumed,
        confirmAttempts: Math.max(existing.confirmAttempts, item.confirmAttempts), syncedAt: new Date(), version: { increment: 1 },
      },
    });
    if (flags.length) await flagReview(tx, user, 'SYNC_CONFLICT', existing, { flags });
  } else if (item.status === 'FAILED') {
    if (existing.stockConsumed) await restore(tx, existing.allotmentId, existing.quantity);
    await tx.distribution.update({
      where: { id: existing.id },
      data: { status: 'FAILED', stockConsumed: false, note: item.note ?? existing.note, syncedAt: new Date(), version: { increment: 1 } },
    });
  } else {
    return { id: item.id, result: 'unchanged', status: existing.status, flags: ['TRANSITION_NOT_ALLOWED'] };
  }

  await audit(tx, {
    userId: user.id, action: 'DISTRIBUTION_SYNC_UPDATE', entityType: 'Distribution', entityId: existing.id,
    before: { status: existing.status }, after: { status: item.status, flags },
  });
  return { id: item.id, result: 'updated', status: item.status, flags };
}

// ---------------------------------------------------------------- confirm online

/** Confirm an AWAITING/EXPIRED distribution later (e.g. family brings card to the office). */
export async function confirmOnline(user: SessionUser, id: string, code: string) {
  await expireStale();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Distribution" WHERE id = ${id}::uuid FOR UPDATE`;
    const d = await tx.distribution.findUnique({ where: { id }, include: { household: true } });
    if (!d) throw new HttpError(404, 'NOT_FOUND', 'বিতরণটি পাওয়া যায়নি।');
    const allowed = user.role === 'ADMIN' || d.volunteerId === user.id || (user.role === 'COORDINATOR' && d.orgId === user.orgId);
    if (!allowed) throw new HttpError(404, 'NOT_FOUND', 'বিতরণটি পাওয়া যায়নি।');
    if (d.status === 'DELIVERED') return { status: 'DELIVERED', alreadyDone: true };
    if (!canTransition(d.status as DistStatus, 'DELIVERED')) {
      throw new HttpError(409, 'INVALID_STATE', 'এই বিতরণ আর নিশ্চিত করা যাবে না।');
    }
    if (d.confirmAttempts >= MAX_CODE_ATTEMPTS) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'অনেকবার ভুল কোড দেওয়া হয়েছে।');

    if (!verifyCardCode(code, d.householdId, d.household.tokenHash)) {
      const attempts = d.confirmAttempts + 1;
      const fail = attempts >= MAX_CODE_ATTEMPTS;
      // Goods were already handed over, so stock is NOT returned; the case goes to review.
      await tx.distribution.update({
        where: { id }, data: { confirmAttempts: attempts, ...(fail ? { status: 'FAILED', note: 'ভুল কোডের সীমা পার' } : {}), version: { increment: 1 } },
      });
      if (fail) await flagReview(tx, user, 'SYNC_CONFLICT', d, { flags: ['TOO_MANY_WRONG_CODES'] });
      await audit(tx, { userId: user.id, action: fail ? 'DISTRIBUTION_FAILED_CODE' : 'CONFIRM_WRONG_CODE', entityType: 'Distribution', entityId: id });
      // Commit the attempt counter, then report the error (returning, not throwing, keeps the update).
      return { status: fail ? 'FAILED' : d.status, wrongCode: true, attemptsLeft: MAX_CODE_ATTEMPTS - attempts };
    }

    let stockConsumed = d.stockConsumed;
    const flags: string[] = [];
    if (!stockConsumed && d.allotmentId) {
      stockConsumed = await consume(tx, d.allotmentId, d.quantity);
      if (!stockConsumed) flags.push('ALLOTMENT_EXCEEDED');
    }
    await tx.distribution.update({
      where: { id },
      data: { status: 'DELIVERED', confirmMethod: 'TOKEN_CARD', confirmedAt: new Date(), stockConsumed, version: { increment: 1 } },
    });
    if (flags.length) await flagReview(tx, user, 'SYNC_CONFLICT', d, { flags });
    await audit(tx, { userId: user.id, action: 'DISTRIBUTION_CONFIRM', entityType: 'Distribution', entityId: id, before: { status: d.status }, after: { status: 'DELIVERED' } });
    return { status: 'DELIVERED' };
  });
}

// ---------------------------------------------------------------- ledger

const PAGE = 25;

export async function listLedger(user: SessionUser, q: LedgerQuery) {
  await expireStale();
  const AND: Prisma.DistributionWhereInput[] = [];
  if (user.role === 'VOLUNTEER') AND.push({ volunteerId: user.id });
  if (q.status) AND.push({ status: q.status });
  if (q.categoryId) AND.push({ categoryId: q.categoryId });
  if (q.orgId) AND.push({ orgId: q.orgId });
  if (q.upazilaId) AND.push({ household: { ward: { parent: { parentId: q.upazilaId } } } });
  if (q.q) AND.push({ household: { headName: { contains: q.q, mode: 'insensitive' } } });
  const where: Prisma.DistributionWhereInput = { AND };

  const [total, rows, byStatus, delivered] = await Promise.all([
    prisma.distribution.count({ where }),
    prisma.distribution.findMany({
      where,
      include: {
        household: { select: { id: true, headName: true, ward: { select: { nameBn: true, parent: { select: { nameBn: true } } } } } },
        category: { select: { nameBn: true, unit: true } },
        org: { select: { nameBn: true } },
        volunteer: { select: { name: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
      skip: (q.page - 1) * PAGE,
      take: PAGE,
    }),
    prisma.distribution.groupBy({ by: ['status'], where, orderBy: { status: 'asc' }, _count: { _all: true } }),
    prisma.distribution.groupBy({ by: ['categoryId'], where: { AND: [...AND, { status: 'DELIVERED' }] }, orderBy: { categoryId: 'asc' }, _sum: { quantity: true }, _count: { _all: true } }),
  ]);
  return { total, page: q.page, pages: Math.max(1, Math.ceil(total / PAGE)), rows, byStatus, delivered };
}

export async function householdHistory(householdId: string) {
  return prisma.distribution.findMany({
    where: { householdId },
    include: { category: { select: { nameBn: true, unit: true } }, org: { select: { nameBn: true } }, volunteer: { select: { name: true } } },
    orderBy: { occurredAt: 'desc' },
    take: 30,
  });
}
