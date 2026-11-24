import { prisma } from './db';
import { HttpError } from './http';
import { audit } from './audit';
import type { SessionUser } from './auth';
import { planAllocation, type PlanHousehold, type MustFlag } from './domain/allocate';
import { categoryGap, unreachedIds } from './domain/gap';
import { priorityScore } from './domain/priority';
import { createAllotment } from './stock';

function assertManager(user: SessionUser) {
  if (user.role === 'VOLUNTEER') throw new HttpError(403, 'FORBIDDEN', 'এই পাতা সমন্বয়কারী ও প্রশাসকের জন্য।');
}

/** Options for the planner form. */
export async function planContext(user: SessionUser) {
  assertManager(user);
  const orgFilter = user.role === 'ADMIN' ? {} : { orgId: user.orgId };
  const [categories, areas, stocks, volunteers] = await Promise.all([
    prisma.reliefCategory.findMany({ orderBy: { code: 'asc' } }),
    prisma.area.findMany({ where: { level: { in: ['UPAZILA', 'UNION'] } }, orderBy: { name: 'asc' } }),
    prisma.stock.findMany({ where: orgFilter, include: { org: { select: { nameBn: true } } } }),
    prisma.user.findMany({
      where: { role: 'VOLUNTEER', isActive: true, ...orgFilter },
      select: { id: true, name: true, orgId: true, areaId: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return { categories, areas, stocks, volunteers };
}

export interface PlanRequest {
  categoryId: string;
  unionId: string;
  stockId: string;
  useQuantity: number | null;
  skipCooldown: boolean;
  mustInclude: MustFlag[];
  perHouseholdCap: number | null;
  allowPartial: boolean;
  maxHouseholds: number | null;
}

/** Build an explainable allocation plan for one union from one stock. Read-only. */
export async function runPlan(user: SessionUser, req: PlanRequest) {
  assertManager(user);
  const [category, union, stock] = await Promise.all([
    prisma.reliefCategory.findUnique({ where: { id: req.categoryId } }),
    prisma.area.findUnique({ where: { id: req.unionId } }),
    prisma.stock.findUnique({ where: { id: req.stockId } }),
  ]);
  const errors: Record<string, string[]> = {};
  if (!category) errors.categoryId = ['ত্রাণের ধরন নির্বাচন করুন'];
  if (!union || union.level !== 'UNION') errors.unionId = ['ইউনিয়ন নির্বাচন করুন'];
  if (!stock || (user.role !== 'ADMIN' && stock.orgId !== user.orgId)) errors.stockId = ['আপনার সংস্থার মজুদ নির্বাচন করুন'];
  else if (category && stock.categoryId !== category.id) errors.stockId = ['মজুদের ত্রাণের ধরন মিলছে না'];
  else if (union && stock.areaId !== union.parentId) errors.stockId = ['মজুদটি এই ইউনিয়নের উপজেলার নয়'];
  if (Object.keys(errors).length) throw new HttpError(400, 'VALIDATION_ERROR', 'কিছু তথ্য সঠিক নয়।', errors);

  const households = await prisma.household.findMany({
    where: { deletedAt: null, ward: { parentId: union!.id } },
    select: {
      id: true, headName: true, memberCount: true, femaleHeaded: true, damageLevel: true,
      ward: { select: { nameBn: true } },
      members: { select: { age: true, disability: true, chronicIllness: true, pregnant: true } },
    },
  });
  // Latest receipt of this category per household (handed over counts: goods were given).
  const last = await prisma.distribution.groupBy({
    by: ['householdId'],
    where: { categoryId: category!.id, status: { in: ['AWAITING_CONFIRMATION', 'DELIVERED'] }, householdId: { in: households.map((h) => h.id) } },
    _max: { occurredAt: true },
  });
  const lastBy = new Map(last.map((l) => [l.householdId, l._max.occurredAt]));

  const planHouseholds: PlanHousehold[] = households.map((h) => ({
    id: h.id, headName: h.headName, areaName: h.ward.nameBn, memberCount: h.memberCount,
    femaleHeaded: h.femaleHeaded, damageLevel: h.damageLevel, members: h.members, lastReceivedAt: lastBy.get(h.id) ?? null,
  }));

  const available = stock!.quantity;
  const useQty = req.useQuantity !== null ? Math.min(req.useQuantity, available) : available;
  const result = planAllocation(planHouseholds, category!, {
    stock: useQty, skipCooldown: req.skipCooldown, mustInclude: req.mustInclude,
    perHouseholdCap: req.perHouseholdCap, allowPartial: req.allowPartial, maxHouseholds: req.maxHouseholds,
  });
  return { result, category: { id: category!.id, nameBn: category!.nameBn, unit: category!.unit }, union: { id: union!.id, nameBn: union!.nameBn }, stock: { id: stock!.id, available } };
}

/**
 * Hand the planned total to a volunteer as an allotment. The plan itself
 * (household -> quantity) is kept in the audit log so it can be traced later;
 * the volunteer's phone ranks families with the same priority rules.
 */
export async function applyPlan(user: SessionUser, input: { stockId: string; volunteerId: string; lines: { householdId: string; qty: number }[]; categoryId: string; unionId: string }) {
  assertManager(user);
  const total = input.lines.reduce((t, l) => t + l.qty, 0);
  if (total < 1) throw new HttpError(400, 'EMPTY_PLAN', 'পরিকল্পনায় বরাদ্দের কিছু নেই।');
  const vol = await prisma.user.findUnique({ where: { id: input.volunteerId } });
  if (!vol || vol.areaId !== input.unionId) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'কিছু তথ্য সঠিক নয়।', { volunteerId: ['এই ইউনিয়নের স্বেচ্ছাসেবী নির্বাচন করুন'] });
  }
  const allotment = await createAllotment(user, { stockId: input.stockId, volunteerId: input.volunteerId, quantity: total });
  await audit(prisma, {
    userId: user.id, action: 'PLAN_APPLIED', entityType: 'Allotment', entityId: allotment.id,
    after: { categoryId: input.categoryId, unionId: input.unionId, volunteerId: input.volunteerId, total, lines: input.lines },
  });
  return { allotmentId: allotment.id, total };
}

// ---------------------------------------------------------------- dashboard

export async function dashboard(user: SessionUser, scope: { upazilaId?: string; unionId?: string }) {
  assertManager(user);
  const wardFilter = scope.unionId
    ? { parentId: scope.unionId }
    : scope.upazilaId
      ? { parent: { parentId: scope.upazilaId } }
      : {};
  const maxWindow = 31;
  const since = new Date(Date.now() - maxWindow * 24 * 60 * 60 * 1000);

  const [categories, households, recent, everDelivered, stocks, allotments, unions] = await Promise.all([
    prisma.reliefCategory.findMany({ orderBy: { code: 'asc' } }),
    prisma.household.findMany({
      where: { deletedAt: null, ward: wardFilter },
      select: {
        id: true, headName: true, memberCount: true, femaleHeaded: true, damageLevel: true, phone: true,
        ward: { select: { nameBn: true, parentId: true } },
        members: { select: { age: true, disability: true, chronicIllness: true, pregnant: true } },
      },
    }),
    prisma.distribution.findMany({
      where: { occurredAt: { gte: since }, status: { in: ['DELIVERED', 'AWAITING_CONFIRMATION'] }, household: { deletedAt: null, ward: wardFilter } },
      select: { householdId: true, categoryId: true, quantity: true, occurredAt: true, status: true },
    }),
    prisma.distribution.findMany({
      where: { status: 'DELIVERED', household: { deletedAt: null, ward: wardFilter } },
      select: { householdId: true },
      distinct: ['householdId'],
    }),
    prisma.stock.findMany({ where: scope.upazilaId ? { areaId: scope.upazilaId } : {}, select: { categoryId: true, quantity: true, areaId: true } }),
    prisma.allotment.findMany({ where: { status: 'ACTIVE', ...(scope.upazilaId ? { stock: { areaId: scope.upazilaId } } : {}) }, select: { remaining: true, stock: { select: { categoryId: true } } } }),
    prisma.area.findMany({ where: { level: 'UNION', ...(scope.upazilaId ? { parentId: scope.upazilaId } : {}), ...(scope.unionId ? { id: scope.unionId } : {}) }, orderBy: { name: 'asc' } }),
  ]);

  const overall = categories.map((c) => ({ category: c, gap: categoryGap(households, c, recent) }));

  const stockBy = new Map<string, number>();
  for (const s of stocks) stockBy.set(s.categoryId, (stockBy.get(s.categoryId) ?? 0) + s.quantity);
  for (const a of allotments) stockBy.set(a.stock.categoryId, (stockBy.get(a.stock.categoryId) ?? 0) + a.remaining);

  const got = new Set(everDelivered.map((d) => d.householdId));
  const byUnion = unions.map((u) => {
    const hs = households.filter((h) => h.ward.parentId === u.id);
    return {
      union: u,
      households: hs.length,
      unreached: hs.filter((h) => !got.has(h.id)).length,
      gaps: categories.map((c) => categoryGap(hs, c, recent)),
    };
  });

  const unreachedSet = new Set(unreachedIds(households, everDelivered.map((d) => d.householdId)));
  const unreached = households
    .filter((h) => unreachedSet.has(h.id))
    .map((h) => {
      const p = priorityScore({ memberCount: h.memberCount, femaleHeaded: h.femaleHeaded, damageLevel: h.damageLevel, members: h.members, daysSinceLastRelief: null });
      return { id: h.id, headName: h.headName, wardName: h.ward.nameBn, hasPhone: !!h.phone, score: p.score, reasons: p.reasons.filter((r) => r.code !== 'NEVER_RECEIVED').slice(0, 3) };
    })
    .sort((a, b) => b.score - a.score);

  return {
    totals: { households: households.length, reached: households.length - unreached.length, unreached: unreached.length },
    overall: overall.map((o) => ({ ...o, stockAvailable: stockBy.get(o.category.id) ?? 0 })),
    byUnion,
    unreached: unreached.slice(0, 60),
    categories,
  };
}
