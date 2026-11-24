// A02 - Allocation planner: who gets limited stock first, and why.
//
// Deterministic, explainable, and honest about constraints it cannot satisfy.
// Pure function: the same input always gives the same plan (unit-tested).
import { priorityScore, type DamageLevel, type PriorityMember, type PriorityReason } from './priority';
import { checkCooldown } from './cooldown';
import { suggestedQuantity, type CategoryNeed } from './distribution';
import { bnNum } from './format';

const DAY_MS = 24 * 60 * 60 * 1000;

export type MustFlag = 'DISABILITY' | 'ELDERLY' | 'UNDER5' | 'PREGNANT' | 'CHRONIC';
export const MUST_BN: Record<MustFlag, string> = {
  DISABILITY: 'প্রতিবন্ধী সদস্য আছে',
  ELDERLY: 'বয়স্ক (৬০+) সদস্য আছে',
  UNDER5: '৫ বছরের কম শিশু আছে',
  PREGNANT: 'গর্ভবতী সদস্য আছে',
  CHRONIC: 'দীর্ঘমেয়াদি অসুস্থ সদস্য আছে',
};

export interface PlanHousehold {
  id: string;
  headName: string;
  areaName: string;
  memberCount: number;
  femaleHeaded: boolean;
  damageLevel: DamageLevel;
  members: PriorityMember[];
  /** Last time this household received this category (confirmed or handed over). */
  lastReceivedAt: Date | null;
}

export interface PlanOptions {
  stock: number;
  /** Leave out households still inside the category's cooldown window. */
  skipCooldown: boolean;
  /** Households with any of these must be served first. */
  mustInclude: MustFlag[];
  /** Upper limit per household (null = suggested need). */
  perHouseholdCap: number | null;
  /** When stock is short, give everyone a reduced share instead of full shares to fewer families. */
  allowPartial: boolean;
  /** At most this many households (e.g. one boat trip). null = no limit. */
  maxHouseholds: number | null;
}

export interface PlanLine {
  householdId: string;
  headName: string;
  areaName: string;
  need: number;
  qty: number;
  score: number;
  reasons: PriorityReason[];
  mustIncluded: boolean;
}

export type UncoveredReason = 'STOCK_EXHAUSTED' | 'IN_COOLDOWN' | 'HOUSEHOLD_LIMIT';
export interface Uncovered {
  householdId: string;
  headName: string;
  areaName: string;
  need: number;
  score: number;
  mustIncluded: boolean;
  reason: UncoveredReason;
}

export type ConflictCode = 'NO_STOCK' | 'NO_ELIGIBLE' | 'MUST_EXCEEDS_STOCK' | 'MUST_EXCEEDS_LIMIT' | 'MUST_IN_COOLDOWN' | 'SHORTAGE' | 'INVALID_INPUT';

export interface Conflict {
  code: ConflictCode;
  /** blocking = the request as stated cannot be met; warning = plan is fine but partial. */
  severity: 'blocking' | 'warning';
  message: string;
}

export interface PlanResult {
  feasible: boolean;
  lines: PlanLine[];
  uncovered: Uncovered[];
  conflicts: Conflict[];
  summary: {
    stock: number;
    households: number;
    eligible: number;
    totalNeed: number;
    allocated: number;
    leftover: number;
    covered: number;
    fullyCovered: number;
    excludedCooldown: number;
    mustCount: number;
    mustNeed: number;
  };
}

export const UNCOVERED_BN: Record<UncoveredReason, string> = {
  STOCK_EXHAUSTED: 'স্টক শেষ',
  IN_COOLDOWN: 'সম্প্রতি পেয়েছে',
  HOUSEHOLD_LIMIT: 'পরিবারের সীমা পার',
};

function hasFlag(h: PlanHousehold, f: MustFlag): boolean {
  switch (f) {
    case 'DISABILITY': return h.members.some((m) => m.disability);
    case 'ELDERLY': return h.members.some((m) => m.age >= 60);
    case 'UNDER5': return h.members.some((m) => m.age < 5);
    case 'PREGNANT': return h.members.some((m) => m.pregnant);
    case 'CHRONIC': return h.members.some((m) => m.chronicIllness);
  }
}

export function planAllocation(households: PlanHousehold[], category: CategoryNeed, opts: PlanOptions, now = new Date()): PlanResult {
  const conflicts: Conflict[] = [];
  const stock = Math.max(0, Math.floor(opts.stock));
  const cap = opts.perHouseholdCap && opts.perHouseholdCap > 0 ? Math.floor(opts.perHouseholdCap) : null;
  const limit = opts.maxHouseholds && opts.maxHouseholds > 0 ? Math.floor(opts.maxHouseholds) : null;
  if (opts.stock < 0 || (opts.perHouseholdCap !== null && opts.perHouseholdCap <= 0) || (opts.maxHouseholds !== null && opts.maxHouseholds <= 0)) {
    conflicts.push({ code: 'INVALID_INPUT', severity: 'blocking', message: 'স্টক, পরিবারপ্রতি সীমা ও পরিবারের সংখ্যা ধনাত্মক হতে হবে।' });
  }

  // 1. Score every household for this category.
  const scored = households.map((h) => {
    const cooldown = checkCooldown({ cooldownDays: category.cooldownDays, lastDeliveredAt: h.lastReceivedAt, now });
    const priority = priorityScore({
      memberCount: h.memberCount, femaleHeaded: h.femaleHeaded, damageLevel: h.damageLevel, members: h.members,
      daysSinceLastRelief: h.lastReceivedAt ? Math.floor((now.getTime() - h.lastReceivedAt.getTime()) / DAY_MS) : null,
    });
    const fullNeed = suggestedQuantity(category, h.memberCount);
    const need = cap ? Math.min(fullNeed, cap) : fullNeed;
    const must = opts.mustInclude.some((f) => hasFlag(h, f));
    return { h, need, score: priority.score, reasons: priority.reasons, must, inCooldown: cooldown.withinCooldown };
  });

  const uncovered: Uncovered[] = [];
  const toUncovered = (s: (typeof scored)[number], reason: UncoveredReason): Uncovered => ({
    householdId: s.h.id, headName: s.h.headName, areaName: s.h.areaName, need: s.need, score: s.score, mustIncluded: s.must, reason,
  });

  // 2. Cooldown filter. Rule when it clashes with "must include": cooldown wins
  //    (the family was just served; serving it again would deny someone unserved).
  const excluded = opts.skipCooldown ? scored.filter((s) => s.inCooldown) : [];
  const mustInCooldown = excluded.filter((s) => s.must).length;
  if (mustInCooldown) {
    conflicts.push({
      code: 'MUST_IN_COOLDOWN', severity: 'warning',
      message: `অবশ্যই-অন্তর্ভুক্ত ${bnNum(mustInCooldown)}টি পরিবার সম্প্রতি এই ত্রাণ পেয়েছে, তাই বাদ রাখা হলো (সম্প্রতি পাওয়া পরিবার বাদ নিয়মটি অগ্রাধিকার পায়)।`,
    });
  }
  for (const s of excluded) uncovered.push(toUncovered(s, 'IN_COOLDOWN'));

  // 3. Order: must-include first, then by score; ties broken by name, then id (deterministic).
  const eligible = scored
    .filter((s) => !(opts.skipCooldown && s.inCooldown))
    .sort((a, b) => Number(b.must) - Number(a.must) || b.score - a.score || a.h.headName.localeCompare(b.h.headName) || a.h.id.localeCompare(b.h.id));

  const mustList = eligible.filter((s) => s.must);
  const mustNeed = mustList.reduce((t, s) => t + s.need, 0);
  const totalNeed = eligible.reduce((t, s) => t + s.need, 0);

  if (!eligible.length) {
    conflicts.push({ code: 'NO_ELIGIBLE', severity: 'blocking', message: 'এই এলাকায় বিতরণযোগ্য কোনো পরিবার নেই (সবাই সম্প্রতি পেয়েছে বা কেউ নিবন্ধিত নয়)।' });
  }
  if (stock === 0 && eligible.length) {
    conflicts.push({ code: 'NO_STOCK', severity: 'blocking', message: 'স্টক শূন্য। কোনো পরিবারকে বরাদ্দ দেওয়া সম্ভব নয়।' });
  }
  if (mustList.length && mustNeed > stock && stock > 0) {
    conflicts.push({
      code: 'MUST_EXCEEDS_STOCK', severity: 'blocking',
      message: `অবশ্যই-অন্তর্ভুক্ত ${bnNum(mustList.length)}টি পরিবারের চাহিদা ${bnNum(mustNeed)}, কিন্তু স্টক মাত্র ${bnNum(stock)}। সবাইকে পূর্ণ পরিমাণ দেওয়া সম্ভব নয়: অগ্রাধিকার অনুযায়ী যতজনকে সম্ভব দেওয়া হলো${opts.allowPartial ? ' (আংশিক পরিমাণে)' : ''}।`,
    });
  }
  if (limit !== null && mustList.length > limit) {
    conflicts.push({
      code: 'MUST_EXCEEDS_LIMIT', severity: 'blocking',
      message: `অবশ্যই-অন্তর্ভুক্ত পরিবার ${bnNum(mustList.length)}টি, কিন্তু সীমা ${bnNum(limit)}টি পরিবার। সর্বোচ্চ অগ্রাধিকারের ${bnNum(limit)}টি নেওয়া হলো।`,
    });
  }

  // 4. Household limit.
  const inScope = limit !== null ? eligible.slice(0, limit) : eligible;
  for (const s of limit !== null ? eligible.slice(limit) : []) uncovered.push(toUncovered(s, 'HOUSEHOLD_LIMIT'));
  const scopeNeed = inScope.reduce((t, s) => t + s.need, 0);
  if (scopeNeed > stock && stock > 0 && !conflicts.some((c) => c.code === 'MUST_EXCEEDS_STOCK')) {
    conflicts.push({
      code: 'SHORTAGE', severity: 'warning',
      message: `চাহিদা ${bnNum(scopeNeed)}, স্টক ${bnNum(stock)}। ঘাটতি ${bnNum(scopeNeed - stock)}। ${opts.allowPartial ? 'সবাইকে আনুপাতিক কম পরিমাণ দেওয়া হলো।' : 'অগ্রাধিকার অনুযায়ী পূর্ণ পরিমাণে যতজনকে সম্ভব দেওয়া হলো।'}`,
    });
  }

  // 5. Allocate.
  const qty = new Map<string, number>();
  let remaining = stock;
  if (opts.allowPartial && scopeNeed > stock) {
    // Proportional share (at least 1 unit, in priority order), then top up by priority.
    const ratio = stock / Math.max(1, scopeNeed);
    for (const s of inScope) {
      if (remaining <= 0) break;
      const q = Math.min(remaining, Math.max(1, Math.floor(s.need * ratio)));
      qty.set(s.h.id, q);
      remaining -= q;
    }
    for (const s of inScope) {
      if (remaining <= 0) break;
      const cur = qty.get(s.h.id);
      if (cur === undefined) continue;
      const add = Math.min(remaining, s.need - cur);
      if (add > 0) {
        qty.set(s.h.id, cur + add);
        remaining -= add;
      }
    }
  } else {
    // Full shares in priority order. A larger need that no longer fits is skipped,
    // and leftover still goes to the next family whose full need fits.
    for (const s of inScope) {
      if (s.need <= remaining) {
        qty.set(s.h.id, s.need);
        remaining -= s.need;
      }
    }
  }

  const lines: PlanLine[] = [];
  for (const s of inScope) {
    const q = qty.get(s.h.id);
    if (q && q > 0) {
      lines.push({ householdId: s.h.id, headName: s.h.headName, areaName: s.h.areaName, need: s.need, qty: q, score: s.score, reasons: s.reasons, mustIncluded: s.must });
    } else {
      uncovered.push(toUncovered(s, 'STOCK_EXHAUSTED'));
    }
  }

  const allocated = lines.reduce((t, l) => t + l.qty, 0);
  return {
    feasible: !conflicts.some((c) => c.severity === 'blocking'),
    lines,
    uncovered: uncovered.sort((a, b) => Number(b.mustIncluded) - Number(a.mustIncluded) || b.score - a.score),
    conflicts,
    summary: {
      stock, households: households.length, eligible: eligible.length, totalNeed, allocated, leftover: stock - allocated,
      covered: lines.length, fullyCovered: lines.filter((l) => l.qty >= l.need).length,
      excludedCooldown: excluded.length, mustCount: mustList.length, mustNeed,
    },
  };
}
