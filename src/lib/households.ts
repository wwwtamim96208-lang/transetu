import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { env } from './env';
import { HttpError } from './http';
import { audit } from './audit';
import type { SessionUser } from './auth';
import { canDeleteHousehold, canEditHousehold, canUseWard, canViewHousehold, householdScope } from './permissions';
import { maskPhone, nameKey, normalizeNid, normalizePhone, toAsciiDigits } from './domain/normalize';
import { findDuplicates, DUP_REASON_BN, type DupMatch } from './domain/duplicate';
import { generateCardCode, hashCardCode, hashNid } from './domain/token';
import type { HouseholdCreateInput, HouseholdUpdateInput, ListQuery } from './validation';

const detailInclude = {
  members: true,
  ward: { include: { parent: { include: { parent: true } } } },
  createdByOrg: { select: { nameBn: true } },
} satisfies Prisma.HouseholdInclude;

type HouseholdWithRelations = Prisma.HouseholdGetPayload<{ include: typeof detailInclude }>;

/** Public shape: never exposes nidHash or tokenHash. */
export function toDTO(h: HouseholdWithRelations) {
  const union = h.ward.parent;
  const upazila = union?.parent;
  return {
    id: h.id,
    headName: h.headName,
    phone: h.phone,
    nidMasked: h.nidLast4 ? `******${h.nidLast4}` : null,
    hasNid: !!h.nidLast4,
    wardId: h.wardId,
    wardName: h.ward.nameBn,
    unionName: union?.nameBn ?? null,
    upazilaName: upazila?.nameBn ?? null,
    address: h.address,
    memberCount: h.memberCount,
    femaleHeaded: h.femaleHeaded,
    damageLevel: h.damageLevel,
    members: h.members.map((m) => ({
      id: m.id, name: m.name, age: m.age, gender: m.gender,
      disability: m.disability, chronicIllness: m.chronicIllness, pregnant: m.pregnant,
    })),
    vulnerableCount: h.members.filter((m) => m.age >= 60 || m.age < 5 || m.disability || m.chronicIllness || m.pregnant).length,
    orgName: h.createdByOrg.nameBn,
    createdById: h.createdById,
    createdByOrgId: h.createdByOrgId,
    version: h.version,
    createdAt: h.createdAt.toISOString(),
    updatedAt: h.updatedAt.toISOString(),
  };
}
export type HouseholdDTO = ReturnType<typeof toDTO>;

// ---------------------------------------------------------------- list

const SORTS: Record<ListQuery['sort'], (o: 'asc' | 'desc') => Prisma.HouseholdOrderByWithRelationInput> = {
  createdAt: (o) => ({ createdAt: o }),
  headName: (o) => ({ headName: o }),
  memberCount: (o) => ({ memberCount: o }),
};

export async function listHouseholds(user: SessionUser, q: ListQuery) {
  const AND: Prisma.HouseholdWhereInput[] = [householdScope(user)];

  if (q.q) {
    const text = q.q.trim();
    const digits = toAsciiDigits(text).replace(/\D/g, '');
    const OR: Prisma.HouseholdWhereInput[] = [{ headName: { contains: text, mode: 'insensitive' } }];
    if (digits.length >= 3) OR.push({ phone: { contains: normalizePhone(digits) ?? digits } });
    if (digits.length === 4) OR.push({ nidLast4: digits });
    AND.push({ OR });
  }
  if (q.wardId) AND.push({ wardId: q.wardId });
  else if (q.unionId) AND.push({ ward: { parentId: q.unionId } });
  else if (q.upazilaId) AND.push({ ward: { parent: { parentId: q.upazilaId } } });
  if (q.damage) AND.push({ damageLevel: q.damage });
  if (q.vulnerable) {
    AND.push({
      OR: [
        { femaleHeaded: true },
        { members: { some: { OR: [{ age: { gte: 60 } }, { age: { lt: 5 } }, { disability: true }, { chronicIllness: true }, { pregnant: true }] } } },
      ],
    });
  }

  const where: Prisma.HouseholdWhereInput = { AND };
  const [total, rows] = await prisma.$transaction([
    prisma.household.count({ where }),
    prisma.household.findMany({
      where,
      include: detailInclude,
      orderBy: [SORTS[q.sort](q.order), { id: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(total / q.pageSize)), items: rows.map(toDTO) };
}

// ---------------------------------------------------------------- read

async function loadForUser(user: SessionUser, id: string) {
  const h = await prisma.household.findFirst({ where: { id, deletedAt: null }, include: detailInclude });
  // Same 404 whether it does not exist or is out of scope: no existence leak.
  if (!h || !canViewHousehold(user, h)) throw new HttpError(404, 'NOT_FOUND', 'পরিবারটি পাওয়া যায়নি।');
  return h;
}

export async function getHousehold(user: SessionUser, id: string) {
  const h = await loadForUser(user, id);
  return { ...toDTO(h), canEdit: canEditHousehold(user, h), canDelete: canDeleteHousehold(user) };
}

// ---------------------------------------------------------------- duplicates

interface Identity {
  headNameKey: string;
  phone: string | null;
  nidHash: string | null;
  nidLast4: string | null;
}

/** Normalise and validate identifying fields. Invalid phone/NID -> 400 with field errors. */
function normaliseIdentity(input: { headName: string; phone?: string; nid?: string }): Identity {
  const errors: Record<string, string[]> = {};
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone) errors.phone = ['সঠিক মোবাইল নম্বর দিন (যেমন 01712345678)'];
  const nid = input.nid ? normalizeNid(input.nid) : null;
  if (input.nid && !nid) errors.nid = ['NID ১০, ১৩ বা ১৭ অঙ্কের হতে হবে'];
  if (Object.keys(errors).length) throw new HttpError(400, 'VALIDATION_ERROR', 'কিছু তথ্য সঠিক নয়।', errors);
  return {
    headNameKey: nameKey(input.headName),
    phone,
    nidHash: nid ? hashNid(env.nidSecret, nid) : null,
    nidLast4: nid ? nid.slice(-4) : null,
  };
}

export type DupMatchView = DupMatch & {
  headName: string;
  areaName: string;
  phoneMasked: string | null;
  reasonText: string[];
  deleted: boolean;
  visible: boolean;
  /** Real id, kept server-side for review items. Stripped by publicMatches(). */
  realId: string;
};

/** Remove server-only fields before sending matches to the client. */
export function publicMatches(ms: DupMatchView[]) {
  return ms.map(({ realId: _r, ...rest }) => rest);
}

async function findMatches(user: SessionUser, id: Identity, wardId: string, excludeId?: string): Promise<DupMatchView[]> {
  const OR: Prisma.HouseholdWhereInput[] = [{ wardId, deletedAt: null }];
  if (id.phone) OR.push({ phone: id.phone, deletedAt: null });
  if (id.nidHash) OR.push({ nidHash: id.nidHash }); // includes soft-deleted: NID stays unique
  const candidates = await prisma.household.findMany({
    where: { OR },
    select: {
      id: true, headName: true, headNameKey: true, phone: true, nidHash: true, wardId: true, deletedAt: true,
      ward: { select: { nameBn: true, parentId: true, parent: { select: { nameBn: true } } } },
    },
    take: 1000,
  });
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return findDuplicates({ ...id, wardId, excludeId }, candidates).map((m) => {
    const c = byId.get(m.householdId)!;
    const visible = canViewHousehold(user, c);
    return {
      ...m,
      // Out-of-scope matches are reported without their id so they cannot be opened.
      householdId: visible ? m.householdId : '',
      headName: c.headName,
      areaName: `${c.ward.parent?.nameBn ?? ''}, ${c.ward.nameBn}`,
      phoneMasked: maskPhone(c.phone),
      reasonText: m.reasons.map((r) => DUP_REASON_BN[r]),
      deleted: !!c.deletedAt,
      visible,
      realId: m.householdId,
    };
  });
}

export async function checkDuplicates(
  user: SessionUser,
  input: { headName: string; phone?: string; nid?: string; wardId: string; excludeId?: string },
) {
  let identity: Identity;
  try {
    identity = normaliseIdentity(input);
  } catch {
    // Live check while typing: ignore half-typed phone/NID instead of failing.
    identity = {
      headNameKey: nameKey(input.headName),
      phone: normalizePhone(input.phone),
      nidHash: normalizeNid(input.nid) ? hashNid(env.nidSecret, normalizeNid(input.nid)!) : null,
      nidLast4: null,
    };
  }
  if (!identity.headNameKey && !identity.phone && !identity.nidHash) return [];
  return publicMatches(await findMatches(user, identity, input.wardId, input.excludeId));
}

function enforceDuplicatePolicy(matches: DupMatchView[], input: { confirmDuplicate?: boolean; duplicateReason?: string }) {
  const blocked = matches.filter((m) => m.level === 'BLOCK');
  if (blocked.length) {
    const msg = blocked.some((m) => m.deleted)
      ? 'এই NID দিয়ে নিবন্ধিত একটি পরিবার মুছে ফেলা হয়েছিল। পুনরুদ্ধারের জন্য প্রশাসকের সাথে যোগাযোগ করুন।'
      : 'এই NID দিয়ে আগেই একটি পরিবার নিবন্ধিত আছে।';
    throw new HttpError(409, 'DUPLICATE_BLOCKED', msg, { matches: publicMatches(blocked) });
  }
  const flagged = matches.filter((m) => m.level === 'FLAG');
  if (flagged.length && !input.confirmDuplicate) {
    throw new HttpError(409, 'DUPLICATE_WARNING', 'একই ফোন নম্বরে আরেকটি পরিবার আছে। নিশ্চিত হলে কারণ লিখে আবার জমা দিন।', { matches: publicMatches(matches) });
  }
  if (flagged.length && (input.duplicateReason ?? '').length < 10) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'কিছু তথ্য সঠিক নয়।', {
      duplicateReason: ['কেন এটি আলাদা পরিবার, কমপক্ষে ১০ অক্ষরে লিখুন'],
    });
  }
}

async function createReviewItems(
  tx: Prisma.TransactionClient,
  user: SessionUser,
  householdId: string,
  matches: DupMatchView[],
  reason?: string,
) {
  const items = matches.filter((m) => m.level !== 'BLOCK');
  if (!items.length) return;
  // Review items always link the real record, even if hidden from this user.
  const data = items.map((m) => ({
    type: 'DUPLICATE_HOUSEHOLD' as const,
    householdId,
    relatedHouseholdId: m.realId,
    details: { level: m.level, reasons: m.reasons, relatedName: m.headName, userReason: reason ?? null },
    createdById: user.id,
  }));
  await tx.reviewItem.createMany({ data });
}

// ---------------------------------------------------------------- create

export async function createHousehold(user: SessionUser, input: HouseholdCreateInput) {
  const ward = await prisma.area.findUnique({ where: { id: input.wardId } });
  if (!ward || ward.level !== 'WARD') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'কিছু তথ্য সঠিক নয়।', { wardId: ['সঠিক ওয়ার্ড নির্বাচন করুন'] });
  }
  if (!canUseWard(user, ward)) throw new HttpError(403, 'FORBIDDEN', 'আপনি শুধু নিজের ইউনিয়নের পরিবার নিবন্ধন করতে পারেন।');

  // Idempotency: the form sends a client-generated id. A retried / double-clicked
  // submit returns the record already created instead of creating a second one.
  if (input.id) {
    const existing = await prisma.household.findUnique({ where: { id: input.id }, include: detailInclude });
    if (existing) return idempotentReplay(user, existing);
  }

  const identity = normaliseIdentity(input);
  const matches = await findMatches(user, identity, input.wardId);
  enforceDuplicatePolicy(matches, input);

  const id = input.id ?? randomUUID();
  const cardCode = generateCardCode(env.cardSecret, id);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const h = await tx.household.create({
        data: {
          id,
          headName: input.headName,
          headNameKey: identity.headNameKey,
          phone: identity.phone,
          nidHash: identity.nidHash,
          nidLast4: identity.nidLast4,
          wardId: input.wardId,
          address: input.address,
          memberCount: input.memberCount,
          femaleHeaded: input.femaleHeaded,
          damageLevel: input.damageLevel,
          tokenHash: hashCardCode(cardCode, id),
          createdById: user.id,
          createdByOrgId: user.orgId,
          members: { create: input.members },
        },
        include: detailInclude,
      });
      await createReviewItems(tx, user, id, matches, input.duplicateReason);
      await audit(tx, {
        userId: user.id, action: 'HOUSEHOLD_CREATE', entityType: 'Household', entityId: id,
        after: { headName: h.headName, wardId: h.wardId, memberCount: h.memberCount, duplicateWarnings: matches.length },
      });
      return h;
    });
    return { household: toDTO(created), cardCode, warnings: publicMatches(matches), idempotent: false };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = String(e.meta?.target ?? '');
      // Two identical submits racing: the other one won, return it.
      if (input.id && !target.includes('nidHash')) {
        const existing = await prisma.household.findUnique({ where: { id: input.id }, include: detailInclude });
        if (existing) return idempotentReplay(user, existing);
      }
      // Two different submits with the same NID racing: DB unique index decided.
      throw new HttpError(409, 'DUPLICATE_BLOCKED', 'এই NID দিয়ে এইমাত্র আরেকটি পরিবার নিবন্ধিত হয়েছে।');
    }
    throw e;
  }
}

function idempotentReplay(user: SessionUser, existing: HouseholdWithRelations) {
  if (existing.createdById !== user.id || existing.deletedAt) {
    throw new HttpError(409, 'ID_CONFLICT', 'এই আইডি দিয়ে আগেই অন্য একটি রেকর্ড আছে।');
  }
  // Card code can be re-derived; showing it again to the creator is safe.
  return { household: toDTO(existing), cardCode: generateCardCode(env.cardSecret, existing.id), warnings: [], idempotent: true };
}

// ---------------------------------------------------------------- update

export async function updateHousehold(user: SessionUser, id: string, input: HouseholdUpdateInput) {
  const existing = await loadForUser(user, id);
  if (!canEditHousehold(user, existing)) throw new HttpError(403, 'FORBIDDEN', 'এই পরিবারের তথ্য বদলানোর অনুমতি আপনার নেই।');

  if (input.version !== existing.version) {
    throw new HttpError(409, 'VERSION_CONFLICT', 'আপনি দেখার পর অন্য কেউ এই তথ্য বদলেছে। পেজ রিফ্রেশ করে নতুন তথ্য দেখে আবার চেষ্টা করুন।', {
      current: toDTO(existing),
    });
  }

  if (input.wardId !== existing.wardId) {
    const ward = await prisma.area.findUnique({ where: { id: input.wardId } });
    if (!ward || ward.level !== 'WARD') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'কিছু তথ্য সঠিক নয়।', { wardId: ['সঠিক ওয়ার্ড নির্বাচন করুন'] });
    }
    if (!canUseWard(user, ward)) throw new HttpError(403, 'FORBIDDEN', 'আপনি শুধু নিজের ইউনিয়নের ওয়ার্ড বেছে নিতে পারেন।');
  }

  const identity = normaliseIdentity(input);
  // An empty NID field on edit keeps the stored NID (we cannot show it back to the user).
  const nidHash = identity.nidHash ?? existing.nidHash;
  const nidLast4 = identity.nidLast4 ?? existing.nidLast4;
  const identityChanged =
    identity.headNameKey !== existing.headNameKey || identity.phone !== existing.phone ||
    nidHash !== existing.nidHash || input.wardId !== existing.wardId;

  let matches: DupMatchView[] = [];
  if (identityChanged) {
    matches = await findMatches(user, { ...identity, nidHash, nidLast4 }, input.wardId, id);
    enforceDuplicatePolicy(matches, input);
  }

  const before = toDTO(existing);
  const updated = await prisma.$transaction(async (tx) => {
    // Conditional update = optimistic lock. Concurrent editors cannot both win.
    const res = await tx.household.updateMany({
      where: { id, version: input.version, deletedAt: null },
      data: {
        headName: input.headName, headNameKey: identity.headNameKey, phone: identity.phone,
        nidHash, nidLast4, wardId: input.wardId, address: input.address ?? null,
        memberCount: input.memberCount, femaleHeaded: input.femaleHeaded, damageLevel: input.damageLevel,
        version: { increment: 1 },
      },
    });
    if (res.count === 0) {
      throw new HttpError(409, 'VERSION_CONFLICT', 'আপনি দেখার পর অন্য কেউ এই তথ্য বদলেছে। পেজ রিফ্রেশ করে আবার চেষ্টা করুন।');
    }
    await tx.member.deleteMany({ where: { householdId: id } });
    if (input.members.length) await tx.member.createMany({ data: input.members.map((m) => ({ ...m, householdId: id })) });
    await createReviewItems(tx, user, id, matches, input.duplicateReason);
    const h = await tx.household.findUniqueOrThrow({ where: { id }, include: detailInclude });
    await audit(tx, { userId: user.id, action: 'HOUSEHOLD_UPDATE', entityType: 'Household', entityId: id, before, after: toDTO(h) });
    return h;
  });
  return { household: toDTO(updated), warnings: publicMatches(matches) };
}

// ---------------------------------------------------------------- delete

export async function deleteHousehold(user: SessionUser, id: string, reason: string) {
  if (!canDeleteHousehold(user)) throw new HttpError(403, 'FORBIDDEN', 'শুধু প্রশাসক পরিবার মুছতে পারেন।');
  if (reason.trim().length < 5) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'কিছু তথ্য সঠিক নয়।', { reason: ['মুছে ফেলার কারণ লিখুন (কমপক্ষে ৫ অক্ষর)'] });
  }
  const existing = await loadForUser(user, id);
  await prisma.$transaction(async (tx) => {
    // Soft delete: the ledger keeps history; deliveries already made stay traceable.
    const res = await tx.household.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), deletedReason: reason.trim() } });
    if (res.count === 0) throw new HttpError(404, 'NOT_FOUND', 'পরিবারটি আগেই মুছে ফেলা হয়েছে।');
    await audit(tx, { userId: user.id, action: 'HOUSEHOLD_DELETE', entityType: 'Household', entityId: id, before: toDTO(existing), after: { reason } });
  });
}

// ---------------------------------------------------------------- areas

export async function listAreas() {
  return prisma.area.findMany({ orderBy: [{ level: 'asc' }, { name: 'asc' }], select: { id: true, name: true, nameBn: true, level: true, parentId: true } });
}
export type AreaDTO = Awaited<ReturnType<typeof listAreas>>[number];
