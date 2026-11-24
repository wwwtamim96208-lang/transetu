// Gap analysis per relief category: need vs delivered vs remaining, and who is unreached.
//
// Need is measured for ONE cooldown cycle of the category: every registered household
// needs its suggested quantity once per cycle (e.g. 1 food pack / 7 days, 3 L water per
// person per day for 3 days). Delivered = confirmed quantity inside that same window.
import { suggestedQuantity, type CategoryNeed } from './distribution';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface GapHousehold {
  id: string;
  memberCount: number;
}

export interface GapDelivery {
  householdId: string;
  categoryId: string;
  quantity: number;
  occurredAt: Date;
  status: string;
}

export interface CategoryGap {
  categoryId: string;
  windowDays: number;
  need: number;
  delivered: number;
  gap: number;
  /** Households that got this category (confirmed) inside the window. */
  covered: number;
  households: number;
  coveragePct: number;
  /** Handed over but not yet confirmed inside the window. */
  pending: number;
}

export function categoryGap(
  households: GapHousehold[],
  category: CategoryNeed & { id: string },
  deliveries: GapDelivery[],
  now = new Date(),
): CategoryGap {
  const since = now.getTime() - category.cooldownDays * DAY_MS;
  const ids = new Set(households.map((h) => h.id));
  const need = households.reduce((t, h) => t + suggestedQuantity(category, h.memberCount), 0);
  let delivered = 0;
  let pending = 0;
  const covered = new Set<string>();
  for (const d of deliveries) {
    if (d.categoryId !== category.id || !ids.has(d.householdId) || d.occurredAt.getTime() < since) continue;
    if (d.status === 'DELIVERED') {
      delivered += d.quantity;
      covered.add(d.householdId);
    } else if (d.status === 'AWAITING_CONFIRMATION') {
      pending += d.quantity;
    }
  }
  return {
    categoryId: category.id,
    windowDays: category.cooldownDays,
    need,
    delivered,
    gap: Math.max(0, need - delivered),
    covered: covered.size,
    households: households.length,
    coveragePct: households.length ? Math.round((covered.size / households.length) * 100) : 0,
    pending,
  };
}

/** Households with no CONFIRMED delivery of any kind, ever. */
export function unreachedIds(households: { id: string }[], everDeliveredIds: Iterable<string>): string[] {
  const got = new Set(everDeliveredIds);
  return households.filter((h) => !got.has(h.id)).map((h) => h.id);
}
