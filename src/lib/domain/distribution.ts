// Distribution state machine and related pure rules (shared by server & device).
//
//   PLANNED ─▶ DISPATCHED ─▶ AWAITING_CONFIRMATION ─▶ DELIVERED
//      │            │               │      │
//      └──▶ FAILED ◀┘               │      └─▶ EXPIRED ─▶ DELIVERED (late, valid code)
//                    ◀──────────────┘
// A distribution only counts as DELIVERED after the family's card code is verified.

export type DistStatus = 'PLANNED' | 'DISPATCHED' | 'AWAITING_CONFIRMATION' | 'DELIVERED' | 'FAILED' | 'EXPIRED';

const ALLOWED: Record<DistStatus, DistStatus[]> = {
  PLANNED: ['DISPATCHED', 'FAILED'],
  DISPATCHED: ['AWAITING_CONFIRMATION', 'DELIVERED', 'FAILED'],
  AWAITING_CONFIRMATION: ['DELIVERED', 'FAILED', 'EXPIRED'],
  EXPIRED: ['DELIVERED'],
  DELIVERED: [],
  FAILED: [],
};

export function canTransition(from: DistStatus, to: DistStatus): boolean {
  return ALLOWED[from].includes(to);
}

/**
 * Statuses for which the goods have physically left the volunteer's hands.
 * EXPIRED = handed over but never confirmed: the goods are gone, the delivery is unverified.
 * Only FAILED (volunteer reports "not given") returns stock.
 */
export function consumesStock(s: DistStatus): boolean {
  return s === 'AWAITING_CONFIRMATION' || s === 'DELIVERED' || s === 'EXPIRED';
}

/** Statuses that count as "this family received it" for repeat-relief checks. */
export function countsAsReceived(s: DistStatus): boolean {
  return s === 'AWAITING_CONFIRMATION' || s === 'DELIVERED';
}

/** A handed-over but unconfirmed distribution expires after this window. */
export const CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Field pack must be refreshed after this long (offline session limit). */
export const PACK_VALID_MS = 72 * 60 * 60 * 1000;
/** Max wrong code attempts before a distribution is marked FAILED. */
export const MAX_CODE_ATTEMPTS = 5;
/** Device clocks more than this far ahead are distrusted. */
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

export function isConfirmExpired(occurredAt: Date, now = new Date()): boolean {
  return now.getTime() - occurredAt.getTime() > CONFIRM_WINDOW_MS;
}

export interface CategoryNeed {
  needBasis: 'PER_PERSON' | 'PER_HOUSEHOLD';
  needPerDay: number;
  cooldownDays: number;
}

/** Quantity that covers one cooldown period for this household. */
export function suggestedQuantity(cat: CategoryNeed, memberCount: number): number {
  const people = cat.needBasis === 'PER_PERSON' ? Math.max(1, memberCount) : 1;
  return Math.max(1, Math.ceil(cat.needPerDay * cat.cooldownDays * people - 1e-9));
}

export const STATUS_BN: Record<DistStatus, string> = {
  PLANNED: 'পরিকল্পিত',
  DISPATCHED: 'পাঠানো হয়েছে',
  AWAITING_CONFIRMATION: 'নিশ্চিতকরণের অপেক্ষায়',
  DELIVERED: 'বিতরণ নিশ্চিত',
  FAILED: 'ব্যর্থ',
  EXPIRED: 'মেয়াদোত্তীর্ণ',
};
