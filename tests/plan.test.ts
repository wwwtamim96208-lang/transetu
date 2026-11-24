import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAllocation, type PlanHousehold, type PlanOptions } from '../src/lib/domain/allocate';
import { categoryGap, unreachedIds } from '../src/lib/domain/gap';
import { bnDigits, fmtDateTime } from '../src/lib/domain/format';
import { priorityScore } from '../src/lib/domain/priority';

const NOW = new Date('2026-11-25T06:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const FOOD = { id: 'food', needBasis: 'PER_HOUSEHOLD' as const, needPerDay: 1 / 7, cooldownDays: 7 };
const WATER = { id: 'water', needBasis: 'PER_PERSON' as const, needPerDay: 3, cooldownDays: 3 };

const hh = (id: string, over: Partial<PlanHousehold> = {}): PlanHousehold => ({
  id, headName: id, areaName: 'w1', memberCount: 4, femaleHeaded: false, damageLevel: 'PARTIAL', members: [], lastReceivedAt: null, ...over,
});
const opts = (over: Partial<PlanOptions> = {}): PlanOptions => ({
  stock: 10, skipCooldown: true, mustInclude: [], perHouseholdCap: null, allowPartial: false, maxHouseholds: null, ...over,
});

const disabled = [{ age: 30, disability: true, chronicIllness: false, pregnant: false }];
const elderly = [{ age: 75, disability: false, chronicIllness: false, pregnant: false }];

test('enough stock: everyone eligible covered, ordered by priority, feasible', () => {
  const r = planAllocation([hh('a'), hh('b', { damageLevel: 'TOTAL' }), hh('c', { members: elderly })], FOOD, opts(), NOW);
  assert.equal(r.feasible, true);
  assert.equal(r.summary.allocated, 3);
  assert.equal(r.summary.leftover, 7);
  assert.deepEqual(r.lines.map((l) => l.householdId), ['b', 'c', 'a']);
  assert.ok(r.lines.every((l) => l.reasons.length > 0)); // explainable
});

test('shortage: highest priority first, the rest uncovered with reason, still feasible', () => {
  const r = planAllocation([hh('a'), hh('b', { damageLevel: 'TOTAL' }), hh('c', { members: elderly })], FOOD, opts({ stock: 2 }), NOW);
  assert.equal(r.feasible, true);
  assert.deepEqual(r.lines.map((l) => l.householdId), ['b', 'c']);
  assert.deepEqual(r.uncovered.map((u) => [u.householdId, u.reason]), [['a', 'STOCK_EXHAUSTED']]);
  assert.ok(r.conflicts.some((c) => c.code === 'SHORTAGE' && c.severity === 'warning'));
});

test('cooldown: recently served families are excluded and explained', () => {
  const r = planAllocation([hh('a', { lastReceivedAt: new Date(NOW.getTime() - 2 * DAY) }), hh('b')], FOOD, opts(), NOW);
  assert.deepEqual(r.lines.map((l) => l.householdId), ['b']);
  assert.deepEqual(r.uncovered.map((u) => [u.householdId, u.reason]), [['a', 'IN_COOLDOWN']]);
  assert.equal(r.summary.excludedCooldown, 1);
});

test('conflicting constraints: must-include need exceeds stock -> infeasible, best partial plan, explained', () => {
  const families = [hh('d1', { members: disabled }), hh('d2', { members: disabled }), hh('d3', { members: disabled }), hh('x', { damageLevel: 'TOTAL' })];
  const r = planAllocation(families, FOOD, opts({ stock: 2, mustInclude: ['DISABILITY'] }), NOW);
  assert.equal(r.feasible, false);
  const c = r.conflicts.find((k) => k.code === 'MUST_EXCEEDS_STOCK');
  assert.ok(c && c.severity === 'blocking');
  assert.equal(r.lines.length, 2);
  assert.ok(r.lines.every((l) => l.mustIncluded)); // must-include served before the higher-damage family
  assert.ok(r.lines.every((l) => l.mustReasons.includes('প্রতিবন্ধী সদস্য আছে'))); // explains WHY it is must-include
  assert.ok(r.uncovered.some((u) => u.householdId === 'x'));
});

test('conflicting constraints: must-include family is in cooldown -> cooldown wins, warned', () => {
  const r = planAllocation([hh('d', { members: disabled, lastReceivedAt: new Date(NOW.getTime() - DAY) }), hh('b')], FOOD, opts({ mustInclude: ['DISABILITY'] }), NOW);
  assert.ok(r.conflicts.some((c) => c.code === 'MUST_IN_COOLDOWN'));
  assert.deepEqual(r.lines.map((l) => l.householdId), ['b']);
  assert.equal(r.feasible, true);
});

test('infeasible: zero stock / nobody eligible', () => {
  const a = planAllocation([hh('a')], FOOD, opts({ stock: 0 }), NOW);
  assert.equal(a.feasible, false);
  assert.ok(a.conflicts.some((c) => c.code === 'NO_STOCK'));
  assert.equal(a.lines.length, 0);
  const b = planAllocation([hh('a', { lastReceivedAt: NOW })], FOOD, opts(), NOW);
  assert.equal(b.feasible, false);
  assert.ok(b.conflicts.some((c) => c.code === 'NO_ELIGIBLE'));
});

test('invalid input is rejected, not crashed on', () => {
  const r = planAllocation([hh('a')], FOOD, opts({ stock: -5 }), NOW);
  assert.equal(r.feasible, false);
  assert.ok(r.conflicts.some((c) => c.code === 'INVALID_INPUT'));
  assert.equal(r.summary.allocated, 0);
});

test('partial mode shares water across more families; never exceeds stock or need', () => {
  const fam = [hh('a', { memberCount: 5 }), hh('b', { memberCount: 5 }), hh('c', { memberCount: 5 })]; // need 45 each
  const full = planAllocation(fam, WATER, opts({ stock: 100 }), NOW);
  assert.equal(full.lines.length, 2); // 45 + 45, 10 left cannot fit a full share
  const part = planAllocation(fam, WATER, opts({ stock: 100, allowPartial: true }), NOW);
  assert.equal(part.lines.length, 3);
  assert.equal(part.summary.allocated, 100);
  assert.ok(part.lines.every((l) => l.qty <= l.need && l.qty >= 1));
});

test('household limit (one boat trip) and per-household cap', () => {
  const fam = [hh('a', { memberCount: 5 }), hh('b', { memberCount: 5 }), hh('c', { memberCount: 5 })];
  const r = planAllocation(fam, WATER, opts({ stock: 1000, maxHouseholds: 2, perHouseholdCap: 20 }), NOW);
  assert.equal(r.lines.length, 2);
  assert.ok(r.lines.every((l) => l.qty === 20));
  assert.equal(r.uncovered.filter((u) => u.reason === 'HOUSEHOLD_LIMIT').length, 1);
});

test('deterministic: same input, same plan', () => {
  const fam = Array.from({ length: 20 }, (_, i) => hh(`h${i}`));
  const a = planAllocation(fam, FOOD, opts({ stock: 7 }), NOW);
  const b = planAllocation([...fam].reverse(), FOOD, opts({ stock: 7 }), NOW);
  assert.deepEqual(a.lines.map((l) => l.householdId), b.lines.map((l) => l.householdId));
});

test('gap report: need vs confirmed delivered within the window; pending kept separate', () => {
  const households = [{ id: 'a', memberCount: 5 }, { id: 'b', memberCount: 2 }];
  const deliveries = [
    { householdId: 'a', categoryId: 'water', quantity: 30, occurredAt: new Date(NOW.getTime() - DAY), status: 'DELIVERED' },
    { householdId: 'b', categoryId: 'water', quantity: 18, occurredAt: new Date(NOW.getTime() - DAY), status: 'AWAITING_CONFIRMATION' },
    { householdId: 'b', categoryId: 'water', quantity: 99, occurredAt: new Date(NOW.getTime() - 10 * DAY), status: 'DELIVERED' }, // outside window
    { householdId: 'zz', categoryId: 'water', quantity: 50, occurredAt: NOW, status: 'DELIVERED' }, // not in area
  ];
  const g = categoryGap(households, WATER, deliveries, NOW);
  assert.equal(g.need, 45 + 18);
  assert.equal(g.delivered, 30);
  assert.equal(g.gap, 33);
  assert.equal(g.pending, 18);
  assert.equal(g.covered, 1);
  assert.equal(g.coveragePct, 50);
});

test('unreached = no confirmed delivery ever', () => {
  assert.deepEqual(unreachedIds([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['b']), ['a', 'c']);
});

test('Bangla display: digits and Dhaka time regardless of server zone', () => {
  assert.equal(bnDigits('3 দিন, 12'), '৩ দিন, ১২');
  // 07:28 UTC is 1:28 PM in Dhaka
  assert.match(fmtDateTime('2026-11-24T07:28:00Z'), /১:২৮/);
  const p = priorityScore({ memberCount: 4, femaleHeaded: false, damageLevel: 'SEVERE', members: disabled, daysSinceLastRelief: 3 });
  assert.ok(p.reasons.every((r) => !/[0-9]/.test(r.label)), JSON.stringify(p.reasons));
  assert.ok(p.reasons.some((r) => r.label.includes('গুরুতর')));
});
