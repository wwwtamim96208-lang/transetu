import { prisma } from './db';
import { HttpError } from './http';
import { audit } from './audit';
import type { SessionUser } from './auth';

function assertManager(user: SessionUser) {
  if (user.role === 'VOLUNTEER') throw new HttpError(403, 'FORBIDDEN', 'স্টক ব্যবস্থাপনার অনুমতি আপনার নেই।');
}

export async function stockOverview(user: SessionUser) {
  assertManager(user);
  const orgFilter = user.role === 'ADMIN' ? {} : { orgId: user.orgId };
  const [stocks, allotments, volunteers, categories, upazilas, orgs] = await Promise.all([
    prisma.stock.findMany({
      where: orgFilter,
      include: { category: true, area: true, org: { select: { nameBn: true } } },
      orderBy: [{ area: { name: 'asc' } }, { category: { code: 'asc' } }],
    }),
    prisma.allotment.findMany({
      where: { stock: orgFilter },
      include: {
        volunteer: { select: { name: true, area: { select: { nameBn: true } } } },
        stock: { include: { category: true, area: { select: { nameBn: true } } } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    }),
    prisma.user.findMany({
      where: { role: 'VOLUNTEER', isActive: true, ...(user.role === 'ADMIN' ? {} : { orgId: user.orgId }) },
      select: { id: true, name: true, orgId: true, area: { select: { nameBn: true, parentId: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.reliefCategory.findMany({ orderBy: { code: 'asc' } }),
    prisma.area.findMany({ where: { level: 'UPAZILA' }, orderBy: { name: 'asc' } }),
    user.role === 'ADMIN' ? prisma.organization.findMany({ orderBy: { name: 'asc' } }) : Promise.resolve([]),
  ]);
  return { stocks, allotments, volunteers, categories, upazilas, orgs };
}

/** New supply arrives: add to (or create) the org's stock for an upazila. */
export async function receiveStock(user: SessionUser, input: { categoryId: string; areaId: string; quantity: number; orgId?: string }) {
  assertManager(user);
  const orgId = user.role === 'ADMIN' && input.orgId ? input.orgId : user.orgId;
  const area = await prisma.area.findUnique({ where: { id: input.areaId } });
  if (!area || area.level !== 'UPAZILA') throw new HttpError(400, 'VALIDATION_ERROR', 'কিছু তথ্য সঠিক নয়।', { areaId: ['উপজেলা নির্বাচন করুন'] });
  return prisma.$transaction(async (tx) => {
    const s = await tx.stock.upsert({
      where: { orgId_categoryId_areaId: { orgId, categoryId: input.categoryId, areaId: input.areaId } },
      create: { orgId, categoryId: input.categoryId, areaId: input.areaId, quantity: input.quantity },
      update: { quantity: { increment: input.quantity } },
    });
    await audit(tx, { userId: user.id, action: 'STOCK_RECEIVE', entityType: 'Stock', entityId: s.id, after: { added: input.quantity, quantity: s.quantity } });
    return s;
  });
}

/**
 * Hand part of a stock to a volunteer for a field trip. The decrement is a
 * conditional update, so two coordinators allotting the last units at the
 * same moment cannot drive stock below zero.
 */
export async function createAllotment(user: SessionUser, input: { stockId: string; volunteerId: string; quantity: number }) {
  assertManager(user);
  const stock = await prisma.stock.findUnique({ where: { id: input.stockId }, include: { area: true } });
  if (!stock || (user.role !== 'ADMIN' && stock.orgId !== user.orgId)) throw new HttpError(404, 'NOT_FOUND', 'স্টক পাওয়া যায়নি।');
  const vol = await prisma.user.findUnique({ where: { id: input.volunteerId }, include: { area: true } });
  if (!vol || vol.role !== 'VOLUNTEER' || !vol.isActive || vol.orgId !== stock.orgId) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'কিছু তথ্য সঠিক নয়।', { volunteerId: ['এই সংস্থার সক্রিয় স্বেচ্ছাসেবী নির্বাচন করুন'] });
  }
  if (vol.area?.parentId !== stock.areaId) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'কিছু তথ্য সঠিক নয়।', { volunteerId: ['স্বেচ্ছাসেবীর ইউনিয়ন এই স্টকের উপজেলায় নয়'] });
  }

  return prisma.$transaction(async (tx) => {
    const r = await tx.stock.updateMany({ where: { id: stock.id, quantity: { gte: input.quantity } }, data: { quantity: { decrement: input.quantity } } });
    if (r.count === 0) {
      const now = await tx.stock.findUniqueOrThrow({ where: { id: stock.id } });
      throw new HttpError(409, 'INSUFFICIENT_STOCK', `স্টকে যথেষ্ট নেই। বর্তমানে আছে ${now.quantity}।`);
    }
    const a = await tx.allotment.create({ data: { stockId: stock.id, volunteerId: vol.id, quantity: input.quantity, remaining: input.quantity } });
    await audit(tx, { userId: user.id, action: 'ALLOTMENT_CREATE', entityType: 'Allotment', entityId: a.id, after: { volunteerId: vol.id, quantity: input.quantity } });
    return a;
  });
}

/** Volunteer returns from the field: unused goods go back to stock. */
export async function closeAllotment(user: SessionUser, id: string) {
  assertManager(user);
  return prisma.$transaction(async (tx) => {
    const a = await tx.allotment.findUnique({ where: { id }, include: { stock: true } });
    if (!a || (user.role !== 'ADMIN' && a.stock.orgId !== user.orgId)) throw new HttpError(404, 'NOT_FOUND', 'বরাদ্দ পাওয়া যায়নি।');
    // Close first (conditional): after this, device syncs can no longer consume from it.
    const r = await tx.allotment.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'CLOSED' } });
    if (r.count === 0) throw new HttpError(409, 'ALREADY_CLOSED', 'বরাদ্দটি আগেই বন্ধ করা হয়েছে।');
    const fresh = await tx.allotment.findUniqueOrThrow({ where: { id } });
    if (fresh.remaining > 0) {
      await tx.stock.update({ where: { id: a.stockId }, data: { quantity: { increment: fresh.remaining } } });
      await tx.allotment.update({ where: { id }, data: { remaining: 0 } });
    }
    await audit(tx, { userId: user.id, action: 'ALLOTMENT_CLOSE', entityType: 'Allotment', entityId: id, after: { returned: fresh.remaining } });
    return { returned: fresh.remaining };
  });
}
