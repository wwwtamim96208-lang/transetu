import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveRemaining, rankHouseholds, receivedHistory, packExpired } from '../src/lib/offline/derive';
import type { FieldPack, OutboxItem } from '../src/lib/offline/types';

const FOOD = 'c-food';
const pack: FieldPack = {
  version: 1,
  downloadedAt: '2026-11-24T06:00:00.000Z',
  validUntil: '2026-11-27T06:00:00.000Z',
  user: { id: 'u1', name: 'Sakib', orgName: 'আলো' },
  unionName: 'তাহিরপুর সদর',
  categories: [{ id: FOOD, code: 'FOOD', nameBn: 'খাদ্য', unit: 'packet', needBasis: 'PER_HOUSEHOLD', needPerDay: 1 / 7, cooldownDays: 7 }],
  allotments: [{ id: 'a1', categoryId: FOOD, quantity: 30, remaining: 20 }],
  households: [
    { id: 'h1', headName: 'রহিমা', phoneMasked: null, wardName: 'w1', memberCount: 4, femaleHeaded: true, damageLevel: 'TOTAL', tokenHash: 'x', members: [{ age: 70, disability: true, chronicIllness: false, pregnant: false }] },
    { id: 'h2', headName: 'করিম', phoneMasked: null, wardName: 'w1', memberCount: 3, femaleHeaded: false, damageLevel: 'NONE', tokenHash: 'x', members: [] },
    { id: 'h3', headName: 'সালমা', phoneMasked: null, wardName: 'w1', memberCount: 6, femaleHeaded: true, damageLevel: 'SEVERE', tokenHash: 'x', members: [] },
  ],
  deliveries: [{ id: 'd-server', householdId: 'h3', categoryId: FOOD, occurredAt: '2026-11-22T06:00:00.000Z', status: 'DELIVERED', orgName: 'সেতু' }],
};

const item = (over: Partial<OutboxItem>): OutboxItem => ({
  id: 'o1', volunteerId: 'u1', householdId: 'h1', categoryId: FOOD, allotmentId: 'a1', quantity: 2, status: 'DELIVERED',
  occurredAt: '2026-11-24T07:00:00.000Z', confirmAttempts: 0, createdOffline: true, syncState: 'pending', updatedAt: '', ...over,
});

test('remaining subtracts only handovers not yet reflected in the snapshot', () => {
  const outbox = [
    item({ id: 'o1', quantity: 2 }), // pending -> subtract
    item({ id: 'o2', quantity: 3, status: 'AWAITING_CONFIRMATION' }), // pending handover -> subtract
    item({ id: 'o3', quantity: 5, status: 'FAILED' }), // not given -> ignore
    item({ id: 'o4', quantity: 4, syncState: 'synced', syncedAt: '2026-11-24T05:00:00.000Z' }), // synced before download -> already in snapshot
    item({ id: 'o5', quantity: 1, syncState: 'synced', syncedAt: '2026-11-24T08:00:00.000Z' }), // synced after download -> subtract
    item({ id: 'o6', quantity: 1, syncState: 'rejected' }), // rejected but physically given -> subtract
  ];
  assert.equal(effectiveRemaining(pack, outbox).a1, 20 - 2 - 3 - 1 - 1);
});

test('history merges server and local without duplicates', () => {
  const outbox = [item({ id: 'd-server', householdId: 'h3' }), item({ id: 'o9' }), item({ id: 'o10', status: 'FAILED' })];
  const h = receivedHistory(pack, outbox);
  assert.deepEqual(h.map((x) => x.id).sort(), ['d-server', 'o9']);
});

test('ranking: in-cooldown households sink, vulnerable ones rise', () => {
  const now = new Date('2026-11-24T12:00:00.000Z');
  const r = rankHouseholds(pack, [], FOOD, now);
  assert.deepEqual(r.map((x) => x.household.id), ['h1', 'h2', 'h3']); // h3 got food 2 days ago
  assert.equal(r[2].cooldown.withinCooldown, true);
  assert.equal(r[2].last?.orgName, 'সেতু');

  // After this device gives h1 food offline, h1 is now in cooldown too.
  const r2 = rankHouseholds(pack, [item({ householdId: 'h1' })], FOOD, now);
  assert.equal(r2.find((x) => x.household.id === 'h1')!.cooldown.withinCooldown, true);
  assert.equal(r2[0].household.id, 'h2');
});

test('pack validity window', () => {
  assert.ok(!packExpired(pack, new Date('2026-11-26T00:00:00Z')));
  assert.ok(packExpired(pack, new Date('2026-11-28T00:00:00Z')));
});
