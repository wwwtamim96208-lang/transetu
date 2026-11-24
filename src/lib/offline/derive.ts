// Pure derivations of device state = server pack (snapshot) + local outbox.
// No mutation of the pack: everything is recomputed, so it can never drift.
import type { FieldPack, OutboxItem, PackHousehold } from './types';
import { priorityScore, type PriorityResult } from '../domain/priority';
import { checkCooldown, type CooldownResult } from '../domain/cooldown';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Is this outbox item's effect NOT yet reflected in the pack snapshot? */
function notInSnapshot(pack: FieldPack, i: OutboxItem): boolean {
  if (i.syncState !== 'synced' || !i.syncedAt) return true;
  return new Date(i.syncedAt).getTime() > new Date(pack.downloadedAt).getTime();
}

const handedOver = (i: OutboxItem) => i.status === 'AWAITING_CONFIRMATION' || i.status === 'DELIVERED';

/** Allotment remaining on this device = server remaining - local handovers not yet in the snapshot. */
export function effectiveRemaining(pack: FieldPack, outbox: OutboxItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of pack.allotments) out[a.id] = a.remaining;
  for (const i of outbox) {
    if (handedOver(i) && notInSnapshot(pack, i) && i.allotmentId in out) out[i.allotmentId] -= i.quantity;
  }
  return out;
}

export interface Received {
  id: string;
  householdId: string;
  categoryId: string;
  occurredAt: string;
  orgName: string;
  local: boolean;
}

/** Everything this device knows a household received: server history + own outbox (deduplicated). */
export function receivedHistory(pack: FieldPack, outbox: OutboxItem[]): Received[] {
  const seen = new Set<string>();
  const list: Received[] = [];
  for (const d of pack.deliveries) {
    seen.add(d.id);
    list.push({ id: d.id, householdId: d.householdId, categoryId: d.categoryId, occurredAt: d.occurredAt, orgName: d.orgName, local: false });
  }
  for (const i of outbox) {
    if (seen.has(i.id) || !handedOver(i)) continue;
    list.push({ id: i.id, householdId: i.householdId, categoryId: i.categoryId, occurredAt: i.occurredAt, orgName: pack.user.orgName, local: true });
  }
  return list;
}

export function lastReceived(history: Received[], householdId: string, categoryId: string): Received | null {
  let best: Received | null = null;
  for (const r of history) {
    if (r.householdId !== householdId || r.categoryId !== categoryId) continue;
    if (!best || r.occurredAt > best.occurredAt) best = r;
  }
  return best;
}

export interface Ranked {
  household: PackHousehold;
  priority: PriorityResult;
  cooldown: CooldownResult;
  last: Received | null;
}

/** Households ranked by priority for one category (most in need first). */
export function rankHouseholds(pack: FieldPack, outbox: OutboxItem[], categoryId: string, now = new Date()): Ranked[] {
  const cat = pack.categories.find((c) => c.id === categoryId);
  if (!cat) return [];
  const history = receivedHistory(pack, outbox);
  return pack.households
    .map((h) => {
      const last = lastReceived(history, h.id, categoryId);
      const lastAt = last ? new Date(last.occurredAt) : null;
      const cooldown = checkCooldown({ cooldownDays: cat.cooldownDays, lastDeliveredAt: lastAt, now });
      const priority = priorityScore({
        memberCount: h.memberCount,
        femaleHeaded: h.femaleHeaded,
        damageLevel: h.damageLevel,
        members: h.members,
        daysSinceLastRelief: lastAt ? Math.floor((now.getTime() - lastAt.getTime()) / DAY_MS) : null,
      });
      return { household: h, priority, cooldown, last };
    })
    .sort((a, b) => Number(a.cooldown.withinCooldown) - Number(b.cooldown.withinCooldown) || b.priority.score - a.priority.score);
}

export function packExpired(pack: FieldPack, now = new Date()): boolean {
  return now.getTime() > new Date(pack.validUntil).getTime();
}
