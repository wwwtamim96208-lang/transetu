// Explainable priority score. Every point added comes with a reason so the
// UI can show *why* a family is ranked where it is (needed for A02).

export type DamageLevel = 'NONE' | 'PARTIAL' | 'SEVERE' | 'TOTAL';

export interface PriorityMember {
  age: number;
  disability: boolean;
  chronicIllness: boolean;
  pregnant: boolean;
}

export interface PriorityInput {
  memberCount: number;
  femaleHeaded: boolean;
  damageLevel: DamageLevel;
  members: PriorityMember[];
  /** Days since last *confirmed* delivery of this category; null = never received. */
  daysSinceLastRelief: number | null;
}

export interface PriorityReason {
  code: string;
  label: string;
  points: number;
}

export interface PriorityResult {
  score: number;
  reasons: PriorityReason[];
}

/** Weights are deliberately simple and documented so judges/admins can audit them. */
export const PRIORITY_WEIGHTS = {
  perMember: 2, maxMembers: 10,
  elderly: 10, elderlyCap: 20, // age >= 60
  disability: 12, disabilityCap: 24,
  chronicIllness: 8, chronicCap: 16,
  childUnder5: 6, childCap: 18,
  pregnant: 10, pregnantCap: 20,
  femaleHeaded: 10,
  damage: { NONE: 0, PARTIAL: 8, SEVERE: 15, TOTAL: 25 } as Record<DamageLevel, number>,
  neverReceived: 25,
  perDayWaiting: 1, maxWaitingPoints: 20,
};

export function priorityScore(input: PriorityInput): PriorityResult {
  const W = PRIORITY_WEIGHTS;
  const reasons: PriorityReason[] = [];
  const add = (code: string, label: string, points: number) => {
    if (points > 0) reasons.push({ code, label, points });
  };

  const members = Math.min(input.memberCount, W.maxMembers);
  add('MEMBERS', `${input.memberCount} জন সদস্য`, members * W.perMember);

  const count = (f: (m: PriorityMember) => boolean) => input.members.filter(f).length;
  const elderly = count((m) => m.age >= 60);
  const disabled = count((m) => m.disability);
  const chronic = count((m) => m.chronicIllness);
  const under5 = count((m) => m.age < 5);
  const pregnant = count((m) => m.pregnant);

  add('ELDERLY', `${elderly} জন বয়স্ক (৬০+)`, Math.min(elderly * W.elderly, W.elderlyCap));
  add('DISABILITY', `${disabled} জন প্রতিবন্ধী`, Math.min(disabled * W.disability, W.disabilityCap));
  add('CHRONIC', `${chronic} জন দীর্ঘমেয়াদি অসুস্থ`, Math.min(chronic * W.chronicIllness, W.chronicCap));
  add('UNDER5', `${under5} জন ৫ বছরের কম শিশু`, Math.min(under5 * W.childUnder5, W.childCap));
  add('PREGNANT', `${pregnant} জন গর্ভবতী`, Math.min(pregnant * W.pregnant, W.pregnantCap));
  if (input.femaleHeaded) add('FEMALE_HEADED', 'নারী-প্রধান পরিবার', W.femaleHeaded);
  add('DAMAGE', `ক্ষতির মাত্রা: ${input.damageLevel}`, W.damage[input.damageLevel]);

  if (input.daysSinceLastRelief === null) {
    add('NEVER_RECEIVED', 'এখনো এই ত্রাণ পায়নি', W.neverReceived);
  } else {
    const p = Math.min(Math.max(0, Math.floor(input.daysSinceLastRelief)) * W.perDayWaiting, W.maxWaitingPoints);
    add('WAITING', `শেষ ত্রাণের পর ${input.daysSinceLastRelief} দিন`, p);
  }

  const score = reasons.reduce((s, r) => s + r.points, 0);
  return { score, reasons: reasons.sort((a, b) => b.points - a.points) };
}
