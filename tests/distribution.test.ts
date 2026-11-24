import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, consumesStock, isConfirmExpired, suggestedQuantity } from '../src/lib/domain/distribution';
import { generateCardCode, hashCardCode } from '../src/lib/domain/token';
import { hashCardCodeWeb, verifyCardCodeWeb } from '../src/lib/domain/token-web';
import { looksLikeCardCode } from '../src/lib/domain/cardcode';

test('state machine: only legal transitions', () => {
  assert.ok(canTransition('AWAITING_CONFIRMATION', 'DELIVERED'));
  assert.ok(canTransition('AWAITING_CONFIRMATION', 'FAILED'));
  assert.ok(canTransition('AWAITING_CONFIRMATION', 'EXPIRED'));
  assert.ok(canTransition('EXPIRED', 'DELIVERED'));
  assert.ok(!canTransition('DELIVERED', 'FAILED'));
  assert.ok(!canTransition('DELIVERED', 'AWAITING_CONFIRMATION'));
  assert.ok(!canTransition('FAILED', 'DELIVERED'));
  assert.ok(!canTransition('EXPIRED', 'FAILED'));
});

test('stock is consumed only when goods left the volunteer', () => {
  assert.ok(consumesStock('AWAITING_CONFIRMATION'));
  assert.ok(consumesStock('DELIVERED'));
  assert.ok(!consumesStock('FAILED'));
  assert.ok(consumesStock('EXPIRED')); // handed over, just unverified
  assert.ok(!consumesStock('PLANNED'));
});

test('confirmation window', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  assert.ok(!isConfirmExpired(new Date('2026-11-24T00:00:00Z'), now));
  assert.ok(isConfirmExpired(new Date('2026-11-23T11:00:00Z'), now));
});

test('suggested quantity covers one cooldown period', () => {
  assert.equal(suggestedQuantity({ needBasis: 'PER_HOUSEHOLD', needPerDay: 1 / 7, cooldownDays: 7 }, 5), 1);
  assert.equal(suggestedQuantity({ needBasis: 'PER_PERSON', needPerDay: 3, cooldownDays: 3 }, 5), 45);
  assert.equal(suggestedQuantity({ needBasis: 'PER_HOUSEHOLD', needPerDay: 1 / 14, cooldownDays: 14 }, 3), 1);
  assert.equal(suggestedQuantity({ needBasis: 'PER_PERSON', needPerDay: 3, cooldownDays: 3 }, 0), 9);
});

test('browser (WebCrypto) hash equals server hash, so offline verification matches', async () => {
  const id = '6b1c2b9e-1111-4222-8333-444455556666';
  const code = generateCardCode('card-secret-for-tests', id);
  assert.equal(await hashCardCodeWeb(code, id), hashCardCode(code, id));
  const stored = hashCardCode(code, id);
  assert.ok(await verifyCardCodeWeb(code.toLowerCase(), id, stored));
  assert.ok(!(await verifyCardCodeWeb('ZZZZ-ZZZZ', id, stored)));
});

test('card code shape check', () => {
  assert.ok(looksLikeCardCode('7KQ2-M9XA'));
  assert.ok(looksLikeCardCode('7kq2 m9xa'));
  assert.ok(!looksLikeCardCode('7KQ2-M9X'));
  assert.ok(!looksLikeCardCode('UUUU-UUUU'));
});
