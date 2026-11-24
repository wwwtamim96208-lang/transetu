/* Demo data. Everything here is fictional: names, phones and NIDs are random.
 * Area names are a demo setup for Sunamganj and should be checked before
 * being shown as real administrative data.
 * Run: npm run db:seed   (wipes and recreates all data)
 */
import { PrismaClient, type AreaLevel, type DamageLevel, type Gender } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { nameKey } from '../src/lib/domain/normalize';
import { generateCardCode, hashCardCode, hashNid } from '../src/lib/domain/token';

const prisma = new PrismaClient();
const NID_SECRET = process.env.NID_HASH_SECRET;
const CARD_SECRET = process.env.CARD_TOKEN_SECRET;
if (!NID_SECRET || !CARD_SECRET) throw new Error('Set NID_HASH_SECRET and CARD_TOKEN_SECRET in .env first');
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'Demo@1234';

// Deterministic PRNG so every seed run produces the same data.
let s = 20261123;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const chance = (p: number) => rnd() < p;

const MALE = ['রহিম', 'করিম', 'জামাল', 'কামাল', 'আব্দুল', 'হাসান', 'সাইফুল', 'মনির', 'জসিম', 'নূর', 'আলমগীর', 'শফিক', 'বাবুল', 'রফিক', 'সেলিম', 'খোকন', 'দুলাল', 'হারুন', 'মতিন', 'আজিজ'];
const FEMALE = ['রহিমা', 'ফাতেমা', 'সালমা', 'আমেনা', 'রাশিদা', 'শাহিদা', 'নাসরিন', 'জোহরা', 'মরিয়ম', 'হালিমা', 'রোকেয়া', 'কুলসুম', 'শিরিন', 'পারভীন', 'মর্জিনা'];
const MALE_SUR = ['উদ্দিন', 'মিয়া', 'হোসেন', 'আলী', 'ইসলাম', 'শেখ', 'সরকার', 'মোল্লা'];
const FEMALE_SUR = ['বেগম', 'খাতুন', 'আক্তার', 'বিবি'];
const PREFIX_M = ['', '', 'মোঃ ', 'মো. '];
const PREFIX_F = ['', '', 'মোছাঃ '];

let phoneSeq = 0;
const usedNids = new Set<string>();
function phone() {
  phoneSeq++;
  return `01${pick(['3', '5', '6', '7', '8', '9'])}${String(10000000 + ((phoneSeq * 7919) % 89999999)).padStart(8, '0')}`;
}
function nid() {
  let n: string;
  do n = String(int(1, 9)) + Array.from({ length: 9 }, () => int(0, 9)).join('');
  while (usedNids.has(n));
  usedNids.add(n);
  return n;
}

async function main() {
  console.log('Clearing data…');
  await prisma.$transaction([
    prisma.auditLog.deleteMany(), prisma.reviewItem.deleteMany(), prisma.distribution.deleteMany(),
    prisma.allotment.deleteMany(), prisma.stock.deleteMany(), prisma.member.deleteMany(),
    prisma.household.deleteMany(), prisma.session.deleteMany(), prisma.user.deleteMany(),
    prisma.organization.deleteMany(), prisma.reliefCategory.deleteMany(), prisma.area.deleteMany(),
  ]);

  // ---- Areas: 1 district, 2 upazilas, 2 unions each, 3 wards each ----
  const mkArea = (name: string, nameBn: string, level: AreaLevel, parentId?: string) =>
    prisma.area.create({ data: { name, nameBn, level, parentId } });
  const district = await mkArea('Sunamganj', 'সুনামগঞ্জ', 'DISTRICT');
  const tree: Record<string, [string, string][]> = {
    'Tahirpur|তাহিরপুর': [['Tahirpur Sadar', 'তাহিরপুর সদর'], ['Balijuri', 'বালিজুরী']],
    'Jamalganj|জামালগঞ্জ': [['Jamalganj Sadar', 'জামালগঞ্জ সদর'], ['Fenarbak', 'ফেনারবাঁক']],
  };
  const upazilas: Record<string, string> = {};
  const unions: Record<string, string> = {};
  const wards: string[] = [];
  for (const [key, unionList] of Object.entries(tree)) {
    const [en, bn] = key.split('|');
    const u = await mkArea(en, bn, 'UPAZILA', district.id);
    upazilas[en] = u.id;
    for (const [uen, ubn] of unionList) {
      const un = await mkArea(uen, ubn, 'UNION', u.id);
      unions[uen] = un.id;
      for (let w = 1; w <= 3; w++) {
        const bnNum = '০১২৩৪৫৬৭৮৯'[w];
        const ward = await mkArea(`${uen} Ward ${w}`, `${ubn} ওয়ার্ড ${bnNum}`, 'WARD', un.id);
        wards.push(ward.id);
      }
    }
  }

  // ---- Organisations ----
  const govt = await prisma.organization.create({ data: { name: 'Upazila Administration (demo)', nameBn: 'উপজেলা প্রশাসন (ডেমো)', type: 'GOVT' } });
  const alo = await prisma.organization.create({ data: { name: 'Alo Foundation (fictional)', nameBn: 'আলো ফাউন্ডেশন', type: 'NGO' } });
  const setu = await prisma.organization.create({ data: { name: 'Setubandhan Youth Club (fictional)', nameBn: 'সেতুবন্ধন যুব সংঘ', type: 'VOLUNTEER_GROUP' } });

  // ---- Users ----
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const mkUser = (email: string, name: string, role: 'ADMIN' | 'COORDINATOR' | 'VOLUNTEER', orgId: string, areaId?: string) =>
    prisma.user.create({ data: { email, name, role, orgId, areaId, passwordHash } });
  const admin = await mkUser('admin@demo.bd', 'প্রশাসক (ডেমো)', 'ADMIN', govt.id);
  const coordAlo = await mkUser('coord.alo@demo.bd', 'নুসরাত জাহান', 'COORDINATOR', alo.id);
  const coordSetu = await mkUser('coord.setu@demo.bd', 'তানভীর আহমেদ', 'COORDINATOR', setu.id);
  const vol1 = await mkUser('vol1@demo.bd', 'সাকিব (স্বেচ্ছাসেবী)', 'VOLUNTEER', alo.id, unions['Tahirpur Sadar']);
  const vol2 = await mkUser('vol2@demo.bd', 'মিতু (স্বেচ্ছাসেবী)', 'VOLUNTEER', alo.id, unions['Tahirpur Sadar']);
  const vol3 = await mkUser('vol3@demo.bd', 'রাকিব (স্বেচ্ছাসেবী)', 'VOLUNTEER', setu.id, unions['Fenarbak']);
  const creators = [
    { user: coordAlo, orgId: alo.id }, { user: coordSetu, orgId: setu.id }, { user: admin, orgId: govt.id },
  ];

  // ---- Relief categories (needs and cooldowns documented in README) ----
  const food = await prisma.reliefCategory.create({ data: { code: 'FOOD', nameBn: 'খাদ্য প্যাকেট', nameEn: 'Food pack', unit: 'packet', needBasis: 'PER_HOUSEHOLD', needPerDay: 1 / 7, cooldownDays: 7 } });
  const water = await prisma.reliefCategory.create({ data: { code: 'WATER', nameBn: 'বিশুদ্ধ পানি', nameEn: 'Drinking water', unit: 'litre', needBasis: 'PER_PERSON', needPerDay: 3, cooldownDays: 3 } });
  const med = await prisma.reliefCategory.create({ data: { code: 'MEDICINE', nameBn: 'ওষুধের কিট', nameEn: 'Medicine kit', unit: 'kit', needBasis: 'PER_HOUSEHOLD', needPerDay: 1 / 14, cooldownDays: 14 } });

  for (const [org, qty] of [[alo, 1], [setu, 0.6]] as const) {
    for (const up of Object.values(upazilas)) {
      await prisma.stock.createMany({
        data: [
          { orgId: org.id, categoryId: food.id, areaId: up, quantity: Math.round(120 * qty) },
          { orgId: org.id, categoryId: water.id, areaId: up, quantity: Math.round(2000 * qty) },
          { orgId: org.id, categoryId: med.id, areaId: up, quantity: Math.round(40 * qty) },
        ],
      });
    }
  }

  // ---- Households ----
  type H = {
    headName: string; phone: string | null; nid: string | null; wardId: string; memberCount: number;
    femaleHeaded: boolean; damageLevel: DamageLevel;
    members: { name?: string; age: number; gender: Gender; disability: boolean; chronicIllness: boolean; pregnant: boolean }[];
    creator: (typeof creators)[number];
  };
  const list: H[] = [];
  for (let i = 0; i < 240; i++) {
    const femaleHeaded = chance(0.25);
    const headName = femaleHeaded
      ? `${pick(PREFIX_F)}${pick(FEMALE)} ${pick(FEMALE_SUR)}`
      : `${pick(PREFIX_M)}${pick(MALE)} ${pick(MALE_SUR)}`;
    const memberCount = int(2, 8);
    const members: H['members'] = [];
    // Record only the members relevant for vulnerability, not always everyone.
    if (chance(0.3)) members.push({ age: int(60, 85), gender: chance(0.5) ? 'MALE' : 'FEMALE', disability: chance(0.2), chronicIllness: chance(0.5), pregnant: false });
    if (chance(0.35)) members.push({ age: int(0, 4), gender: chance(0.5) ? 'MALE' : 'FEMALE', disability: false, chronicIllness: false, pregnant: false });
    if (chance(0.1)) members.push({ age: int(20, 35), gender: 'FEMALE', disability: false, chronicIllness: false, pregnant: true });
    if (chance(0.08)) members.push({ age: int(10, 50), gender: chance(0.5) ? 'MALE' : 'FEMALE', disability: true, chronicIllness: false, pregnant: false });
    list.push({
      headName, femaleHeaded, memberCount: Math.max(memberCount, members.length),
      phone: chance(0.85) ? phone() : null,
      nid: chance(0.75) ? nid() : null,
      wardId: pick(wards),
      damageLevel: pick(['NONE', 'PARTIAL', 'PARTIAL', 'SEVERE', 'SEVERE', 'TOTAL'] as const),
      members, creator: pick(creators),
    });
  }

  // Fixed households used in the demo script (README "Demo cases").
  const ward1 = wards[0]; // Tahirpur Sadar Ward 1
  const sharedPhone = '01711000111';
  list.push(
    { headName: 'মোঃ রহিম উদ্দিন', phone: null, nid: null, wardId: ward1, memberCount: 5, femaleHeaded: false, damageLevel: 'SEVERE', members: [{ age: 72, gender: 'MALE', disability: false, chronicIllness: true, pregnant: false }], creator: creators[0] },
    { headName: 'রহিমা বেগম', phone: sharedPhone, nid: '1990123456', wardId: ward1, memberCount: 4, femaleHeaded: true, damageLevel: 'TOTAL', members: [{ age: 2, gender: 'FEMALE', disability: false, chronicIllness: false, pregnant: false }, { age: 66, gender: 'FEMALE', disability: true, chronicIllness: false, pregnant: false }], creator: creators[1] },
  );

  console.log(`Creating ${list.length} households…`);
  const createdIds: { id: string; wardId: string }[] = [];
  for (const h of list) {
    const id = randomUUID();
    createdIds.push({ id, wardId: h.wardId });
    await prisma.household.create({
      data: {
        id, headName: h.headName, headNameKey: nameKey(h.headName), phone: h.phone,
        nidHash: h.nid ? hashNid(NID_SECRET!, h.nid) : null, nidLast4: h.nid ? h.nid.slice(-4) : null,
        wardId: h.wardId, memberCount: h.memberCount, femaleHeaded: h.femaleHeaded, damageLevel: h.damageLevel,
        tokenHash: hashCardCode(generateCardCode(CARD_SECRET!, id), id),
        createdById: h.creator.user.id, createdByOrgId: h.creator.orgId,
        members: { create: h.members },
      },
    });
  }

  // ---- Allotments: stock handed to volunteers for their field trip ----
  const stockOf = (orgId: string, categoryId: string, upazila: string) =>
    prisma.stock.findUniqueOrThrow({ where: { orgId_categoryId_areaId: { orgId, categoryId, areaId: upazilas[upazila] } } });
  const allot = async (volunteerId: string, orgId: string, categoryId: string, upazila: string, quantity: number) => {
    const st = await stockOf(orgId, categoryId, upazila);
    await prisma.stock.update({ where: { id: st.id }, data: { quantity: { decrement: quantity } } });
    await prisma.allotment.create({ data: { stockId: st.id, volunteerId, quantity, remaining: quantity } });
  };
  await allot(vol1.id, alo.id, food.id, 'Tahirpur', 30);
  await allot(vol1.id, alo.id, water.id, 'Tahirpur', 400);
  await allot(vol1.id, alo.id, med.id, 'Tahirpur', 10);
  await allot(vol2.id, alo.id, food.id, 'Tahirpur', 20);
  await allot(vol3.id, setu.id, food.id, 'Jamalganj', 20);
  await allot(vol3.id, setu.id, water.id, 'Jamalganj', 200);

  // ---- Past deliveries (before this system's allotments; no stock link) ----
  const orgUsers = [
    { orgId: alo.id, userId: coordAlo.id }, { orgId: setu.id, userId: coordSetu.id }, { orgId: govt.id, userId: admin.id },
  ];
  const cats = [food, food, water, med];
  const DAY = 24 * 60 * 60 * 1000;
  const past = createdIds.slice(0, -2).filter(() => chance(0.3)); // keep demo households clean
  for (const h of past) {
    const by = pick(orgUsers);
    const cat = pick(cats);
    const occurredAt = new Date(Date.now() - int(1, 12) * DAY - int(0, 600) * 60000);
    await prisma.distribution.create({
      data: {
        householdId: h.id, categoryId: cat.id, quantity: cat.code === 'WATER' ? int(20, 60) : 1, orgId: by.orgId, volunteerId: by.userId,
        status: 'DELIVERED', confirmMethod: 'TOKEN_CARD', confirmedAt: occurredAt, occurredAt, syncedAt: occurredAt,
      },
    });
  }
  // Demo case: রহিমা বেগম got food from Setubandhan 3 days ago -> Alo's volunteer will see a cooldown warning.
  const rahima = createdIds[createdIds.length - 1];
  const threeDaysAgo = new Date(Date.now() - 3 * DAY);
  await prisma.distribution.create({
    data: {
      householdId: rahima.id, categoryId: food.id, quantity: 1, orgId: setu.id, volunteerId: coordSetu.id,
      status: 'DELIVERED', confirmMethod: 'TOKEN_CARD', confirmedAt: threeDaysAgo, occurredAt: threeDaysAgo, syncedAt: threeDaysAgo,
    },
  });
  console.log(`Created ${past.length + 1} past deliveries; ${createdIds.length - past.length - 1} households have received nothing yet.`);

  // Card codes for the demo households (printed cards in real life).
  const rahim = createdIds[createdIds.length - 2];
  console.log('\nDemo token-card codes (Tahirpur Sadar Ward 1):');
  console.log(`  মোঃ রহিম উদ্দিন : ${generateCardCode(CARD_SECRET!, rahim.id)}`);
  console.log(`  রহিমা বেগম      : ${generateCardCode(CARD_SECRET!, rahima.id)}`);

  console.log('\nDone. Demo accounts (password: ' + DEMO_PASSWORD + '):');
  for (const u of [admin, coordAlo, coordSetu, vol1, vol2, vol3]) console.log(`  ${u.role.padEnd(11)} ${u.email}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
