// Repeat-relief rule: giving the same category to the same household inside
// the category's cooldown window raises a warning that needs an override.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CooldownInput {
  cooldownDays: number;
  /** Most recent DELIVERED (confirmed) distribution of this category. */
  lastDeliveredAt: Date | null;
  now?: Date;
}

export interface CooldownResult {
  withinCooldown: boolean;
  daysSince: number | null;
  nextEligibleAt: Date | null;
}

export function checkCooldown({ cooldownDays, lastDeliveredAt, now = new Date() }: CooldownInput): CooldownResult {
  if (!lastDeliveredAt) return { withinCooldown: false, daysSince: null, nextEligibleAt: null };
  const elapsed = now.getTime() - lastDeliveredAt.getTime();
  const nextEligibleAt = new Date(lastDeliveredAt.getTime() + cooldownDays * DAY_MS);
  return {
    withinCooldown: elapsed < cooldownDays * DAY_MS,
    daysSince: Math.floor(Math.max(0, elapsed) / DAY_MS),
    nextEligibleAt,
  };
}
