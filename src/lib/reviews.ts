import { prisma } from './db';
import { HttpError } from './http';
import { audit } from './audit';
import type { SessionUser } from './auth';

export async function listReviews(user: SessionUser, status: 'OPEN' | 'RESOLVED' | 'DISMISSED' = 'OPEN') {
  if (user.role === 'VOLUNTEER') throw new HttpError(403, 'FORBIDDEN', 'যাচাই তালিকা দেখার অনুমতি আপনার নেই।');
  return prisma.reviewItem.findMany({
    where: { status },
    include: {
      household: { select: { id: true, headName: true, ward: { select: { nameBn: true } } } },
      relatedHousehold: { select: { id: true, headName: true, ward: { select: { nameBn: true } } } },
      distribution: {
        select: {
          id: true, quantity: true, status: true, occurredAt: true, createdOffline: true, overrideReason: true,
          category: { select: { nameBn: true, unit: true } }, org: { select: { nameBn: true } }, volunteer: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

export async function countOpenReviews() {
  return prisma.reviewItem.count({ where: { status: 'OPEN' } });
}

export async function resolveReview(user: SessionUser, id: string, input: { status: 'RESOLVED' | 'DISMISSED'; resolution: string }) {
  if (user.role === 'VOLUNTEER') throw new HttpError(403, 'FORBIDDEN', 'এই কাজের অনুমতি আপনার নেই।');
  return prisma.$transaction(async (tx) => {
    // Conditional update: two coordinators cannot both resolve the same item.
    const r = await tx.reviewItem.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: input.status, resolution: input.resolution, resolvedById: user.id, resolvedAt: new Date() },
    });
    if (r.count === 0) throw new HttpError(409, 'ALREADY_RESOLVED', 'অন্য কেউ ইতিমধ্যে এটির সিদ্ধান্ত দিয়েছেন।');
    await audit(tx, { userId: user.id, action: 'REVIEW_' + input.status, entityType: 'ReviewItem', entityId: id, after: input });
    return { ok: true };
  });
}

export { FLAG_BN } from './domain/flags';
