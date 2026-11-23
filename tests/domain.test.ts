import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, namesSimilar, normalizePhone, normalizeNid, toAsciiDigits } from '../src/lib/domain/normalize';
import { findDuplicates } from '../src/lib/domain/duplicate';
import { priorityScore } from '../src/lib/domain/priority';
import { checkCooldown } from '../src/lib/domain/cooldown';
import { generateCardCode, hashCardCode, verifyCardCode, hashNid } from '../src/lib/domain/token';

test('Bangla digits convert', () => {
  assert.equal(toAsciiDigits('০১৭১২৩৪৫৬৭৮'), '01712345678');
});

test('phone normalisation', () => {
  assert.equal(normalizePhone('+880 1712-345678'), '01712345678');
  assert.equal(normalizePhone('8801712345678'), '01712345678');
  assert.equal(normalizePhone('1712345678'), '01712345678');
  assert.equal(normalizePhone('০১৭১২৩৪৫৬৭৮'), '01712345678');
  assert.equal(normalizePhone('01212345678'), null); // invalid operator digit
  assert.equal(normalizePhone('0171234'), null);
  assert.equal(normalizePhone(''), null);
});

test('NID normalisation', () => {
  assert.equal(normalizeNid('123 456 7890'), '1234567890');
  assert.equal(normalizeNid('1234567890123'), '1234567890123');
  assert.equal(normalizeNid('12345678901234567'), '12345678901234567');
  assert.equal(normalizeNid('12345'), null);
  assert.equal(normalizeNid('12345678901'), null);
});

test('name keys match across Bangla/English and honorifics', () => {
  const pairs: [string, string][] = [
    ['মোঃ রহিম উদ্দিন', 'Md. Rahim Uddin'],
    ['মো. রহিম উদ্দিন', 'রহিম উদ্দিন'],
    ['রহিমা বেগম', 'Rahima Begum'],
    ['মোছাঃ ফাতেমা খাতুন', 'Mst Fatema Khatun'],
    ['আক্তার হোসেন', 'Akhter Hossain'],
    ['রহীম', 'রহিম'],
    ['শাহিদা আক্তার', 'Shahida Akter'],
  ];
  for (const [a, b] of pairs) {
    assert.ok(namesSimilar(nameKey(a), nameKey(b)), `${a} [${nameKey(a)}] vs ${b} [${nameKey(b)}]`);
  }
});

test('different names do not match', () => {
  const pairs: [string, string][] = [
    ['রহিম উদ্দিন', 'করিম উদ্দিন'],
    ['Rahima Begum', 'Salma Begum'],
    ['ফাতেমা খাতুন', 'আমেনা খাতুন'],
  ];
  for (const [a, b] of pairs) {
    assert.ok(!namesSimilar(nameKey(a), nameKey(b)), `${a} [${nameKey(a)}] vs ${b} [${nameKey(b)}]`);
  }
});

test('duplicate tiers', () => {
  const nid = hashNid('test-secret-123456', '1234567890');
  const candidates = [
    { id: 'a', headNameKey: nameKey('Karim Mia'), phone: null, nidHash: nid, wardId: 'w2' },
    { id: 'b', headNameKey: nameKey('Salma Begum'), phone: '01712345678', nidHash: null, wardId: 'w9' },
    { id: 'c', headNameKey: nameKey('মোঃ রহিম উদ্দিন'), phone: null, nidHash: null, wardId: 'w1' },
    { id: 'd', headNameKey: nameKey('রহিম উদ্দিন'), phone: null, nidHash: null, wardId: 'w5' }, // other ward
  ];
  const m = findDuplicates(
    { headNameKey: nameKey('Md Rahim Uddin'), phone: '01712345678', nidHash: nid, wardId: 'w1' },
    candidates,
  );
  assert.deepEqual(m.map((x) => [x.householdId, x.level]), [['a', 'BLOCK'], ['b', 'FLAG'], ['c', 'REVIEW']]);
});

test('duplicate check ignores the record being edited', () => {
  const c = [{ id: 'x', headNameKey: 'rhm', phone: '01712345678', nidHash: null, wardId: 'w1' }];
  assert.equal(findDuplicates({ headNameKey: 'rhm', phone: '01712345678', nidHash: null, wardId: 'w1', excludeId: 'x' }, c).length, 0);
});

test('priority: vulnerable family outranks non-vulnerable one and explains why', () => {
  const vulnerable = priorityScore({
    memberCount: 5, femaleHeaded: true, damageLevel: 'SEVERE', daysSinceLastRelief: null,
    members: [
      { age: 70, disability: false, chronicIllness: true, pregnant: false },
      { age: 3, disability: false, chronicIllness: false, pregnant: false },
    ],
  });
  const other = priorityScore({
    memberCount: 5, femaleHeaded: false, damageLevel: 'PARTIAL', daysSinceLastRelief: 2, members: [],
  });
  assert.ok(vulnerable.score > other.score);
  assert.equal(vulnerable.score, vulnerable.reasons.reduce((s, r) => s + r.points, 0));
  assert.ok(vulnerable.reasons.some((r) => r.code === 'NEVER_RECEIVED'));
  // 10 + 10 + 8 + 6 + 10 + 15 + 25
  assert.equal(vulnerable.score, 84);
});

test('priority caps prevent one factor dominating', () => {
  const r = priorityScore({
    memberCount: 25, femaleHeaded: false, damageLevel: 'NONE', daysSinceLastRelief: 400,
    members: Array.from({ length: 6 }, () => ({ age: 80, disability: true, chronicIllness: false, pregnant: false })),
  });
  // members 20 + elderly 20 + disability 24 + waiting 20
  assert.equal(r.score, 84);
});

test('cooldown window', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  const r1 = checkCooldown({ cooldownDays: 7, lastDeliveredAt: new Date('2026-11-20T12:00:00Z'), now });
  assert.equal(r1.withinCooldown, true);
  assert.equal(r1.daysSince, 3);
  const r2 = checkCooldown({ cooldownDays: 7, lastDeliveredAt: new Date('2026-11-16T12:00:00Z'), now });
  assert.equal(r2.withinCooldown, false);
  assert.equal(checkCooldown({ cooldownDays: 7, lastDeliveredAt: null, now }).withinCooldown, false);
});

test('card code: deterministic, verifiable, tolerant of typing slips', () => {
  const secret = 'card-secret-for-tests';
  const id = '3f1c2b9e-1111-4222-8333-444455556666';
  const code = generateCardCode(secret, id);
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(code, generateCardCode(secret, id));
  const h = hashCardCode(code, id);
  assert.ok(verifyCardCode(code.toLowerCase().replace('-', ' '), id, h));
  assert.ok(!verifyCardCode('0000-0000', id, h));
  // same code, other household -> different hash (salted)
  assert.notEqual(h, hashCardCode(code, '00000000-0000-4000-8000-000000000000'));
});
