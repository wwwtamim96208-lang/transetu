import { prisma } from './db';
import { HttpError } from './http';
import type { SessionUser } from './auth';
import { maskPhone } from './domain/normalize';
import { PACK_VALID_MS } from './domain/distribution';
import { expireStale } from './distributions';
import type { FieldPack } from './offline/types';

const HISTORY_DAYS = 30;

/**
 * Everything a volunteer needs to work offline in their union for a shift:
 * households (with the card-code HASH, never the code), categories, their
 * active allotments and recent deliveries for cooldown checks.
 * Scoped to the volunteer's own union (resource isolation).
 */
export async function buildPack(user: SessionUser): Promise<FieldPack> {
  if (user.role !== 'VOLUNTEER') throw new HttpError(403, 'FORBIDDEN', 'মাঠের মোড শুধু স্বেচ্ছাসেবীদের জন্য।');
  const areaId = user.areaId;
  if (!areaId) throw new HttpError(403, 'NO_AREA', 'আপনাকে কোনো ইউনিয়নে নিয়োগ দেওয়া হয়নি।');
  await expireStale();

  const now = new Date();
  const since = new Date(now.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const [union, households, categories, allotments, deliveries] = await Promise.all([
    prisma.area.findUniqueOrThrow({ where: { id: areaId } }),
    prisma.household.findMany({
      where: { deletedAt: null, ward: { parentId: areaId } },
      select: {
        id: true, headName: true, phone: true, memberCount: true, femaleHeaded: true, damageLevel: true, tokenHash: true,
        ward: { select: { nameBn: true } },
        members: { select: { age: true, disability: true, chronicIllness: true, pregnant: true } },
      },
      orderBy: { headName: 'asc' },
    }),
    prisma.reliefCategory.findMany({ orderBy: { code: 'asc' } }),
    prisma.allotment.findMany({ where: { volunteerId: user.id, status: 'ACTIVE' }, include: { stock: { select: { categoryId: true } } } }),
    prisma.distribution.findMany({
      where: { household: { ward: { parentId: areaId } }, status: { in: ['AWAITING_CONFIRMATION', 'DELIVERED'] }, occurredAt: { gte: since } },
      select: { id: true, householdId: true, categoryId: true, occurredAt: true, status: true, org: { select: { nameBn: true } } },
    }),
  ]);

  return {
    version: 1,
    downloadedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + PACK_VALID_MS).toISOString(),
    user: { id: user.id, name: user.name, orgName: user.orgName },
    unionName: union.nameBn,
    households: households.map((h) => ({
      id: h.id, headName: h.headName, phoneMasked: maskPhone(h.phone), wardName: h.ward.nameBn,
      memberCount: h.memberCount, femaleHeaded: h.femaleHeaded, damageLevel: h.damageLevel, tokenHash: h.tokenHash, members: h.members,
    })),
    categories: categories.map((c) => ({
      id: c.id, code: c.code, nameBn: c.nameBn, unit: c.unit, needBasis: c.needBasis, needPerDay: c.needPerDay, cooldownDays: c.cooldownDays,
    })),
    allotments: allotments.map((a) => ({ id: a.id, categoryId: a.stock.categoryId, quantity: a.quantity, remaining: a.remaining })),
    deliveries: deliveries.map((d) => ({
      id: d.id, householdId: d.householdId, categoryId: d.categoryId, occurredAt: d.occurredAt.toISOString(),
      status: d.status as 'AWAITING_CONFIRMATION' | 'DELIVERED', orgName: d.org.nameBn,
    })),
  };
}
