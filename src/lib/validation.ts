import { z } from 'zod';

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const memberSchema = z
  .object({
    name: optionalText(100),
    age: z.coerce.number({ invalid_type_error: 'বয়স সংখ্যায় লিখুন' }).int().min(0, 'বয়স ০ বা বেশি').max(120, 'বয়স ১২০-এর বেশি হতে পারে না'),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
    disability: z.boolean().default(false),
    chronicIllness: z.boolean().default(false),
    pregnant: z.boolean().default(false),
  })
  .refine((m) => !m.pregnant || (m.gender === 'FEMALE' && m.age >= 12 && m.age <= 55), {
    message: 'গর্ভবতী শুধু ১২–৫৫ বছর বয়সী নারী সদস্যের জন্য প্রযোজ্য',
    path: ['pregnant'],
  });

const householdBase = z.object({
  headName: z.string().trim().min(2, 'পরিবার প্রধানের নাম কমপক্ষে ২ অক্ষর').max(100),
  phone: optionalText(20),
  nid: optionalText(25),
  wardId: z.string().uuid('ওয়ার্ড নির্বাচন করুন'),
  address: optionalText(300),
  memberCount: z.coerce.number({ invalid_type_error: 'সদস্য সংখ্যা লিখুন' }).int().min(1, 'কমপক্ষে ১ জন').max(30, 'সর্বোচ্চ ৩০ জন'),
  femaleHeaded: z.boolean().default(false),
  damageLevel: z.enum(['NONE', 'PARTIAL', 'SEVERE', 'TOTAL']),
  members: z.array(memberSchema).max(30).default([]),
  confirmDuplicate: z.boolean().optional(),
  duplicateReason: optionalText(500),
});

const membersFit = <T extends { members: unknown[]; memberCount: number }>(d: T) => d.members.length <= d.memberCount;
const membersFitMsg = { message: 'বিশেষ সদস্যের তালিকা মোট সদস্য সংখ্যার বেশি হতে পারে না', path: ['members'] };

export const householdCreateSchema = householdBase
  .extend({ id: z.string().uuid().optional() })
  .refine(membersFit, membersFitMsg);

export const householdUpdateSchema = householdBase
  .extend({ version: z.number().int().min(1) })
  .refine(membersFit, membersFitMsg);

export const duplicateCheckSchema = z.object({
  headName: z.string().trim().max(100).default(''),
  phone: optionalText(20),
  nid: optionalText(25),
  wardId: z.string().uuid(),
  excludeId: z.string().uuid().optional(),
});

export const listQuerySchema = z.object({
  q: optionalText(100).catch(undefined),
  upazilaId: z.string().uuid().optional().catch(undefined),
  unionId: z.string().uuid().optional().catch(undefined),
  wardId: z.string().uuid().optional().catch(undefined),
  vulnerable: z.enum(['1']).optional().catch(undefined),
  damage: z.enum(['NONE', 'PARTIAL', 'SEVERE', 'TOTAL']).optional().catch(undefined),
  sort: z.enum(['createdAt', 'headName', 'memberCount']).catch('createdAt'),
  order: z.enum(['asc', 'desc']).catch('desc'),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(5).max(100).catch(20),
});

export const loginSchema = z.object({
  email: z.string().trim().email('সঠিক ইমেইল দিন'),
  password: z.string().min(1, 'পাসওয়ার্ড দিন').max(200),
});

export type HouseholdCreateInput = z.infer<typeof householdCreateSchema>;
export type HouseholdUpdateInput = z.infer<typeof householdUpdateSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;

// ---------------------------------------------------------------- Day 2

export const syncItemSchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  categoryId: z.string().uuid(),
  allotmentId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10000),
  status: z.enum(['AWAITING_CONFIRMATION', 'DELIVERED', 'FAILED']),
  occurredAt: z.string().datetime(),
  confirmCode: z.string().max(20).optional(),
  confirmAttempts: z.number().int().min(0).max(100).default(0),
  overrideReason: optionalText(500),
  note: optionalText(300),
  createdOffline: z.boolean().default(false),
});

export const pushSchema = z.object({
  deviceId: z.string().min(8).max(64),
  items: z.array(syncItemSchema).min(1).max(100),
});

export const confirmSchema = z.object({ code: z.string().trim().min(1, 'কোড লিখুন').max(20) });

export const allotmentSchema = z.object({
  stockId: z.string().uuid('স্টক নির্বাচন করুন'),
  volunteerId: z.string().uuid('স্বেচ্ছাসেবী নির্বাচন করুন'),
  quantity: z.coerce.number({ invalid_type_error: 'পরিমাণ লিখুন' }).int().min(1, 'কমপক্ষে ১').max(100000),
});

export const receiveStockSchema = z.object({
  categoryId: z.string().uuid('ক্যাটাগরি নির্বাচন করুন'),
  areaId: z.string().uuid('উপজেলা নির্বাচন করুন'),
  quantity: z.coerce.number({ invalid_type_error: 'পরিমাণ লিখুন' }).int().min(1, 'কমপক্ষে ১').max(1000000),
  orgId: z.string().uuid().optional(),
});

export const resolveReviewSchema = z.object({
  status: z.enum(['RESOLVED', 'DISMISSED']),
  resolution: z.string().trim().min(5, 'সিদ্ধান্তের কারণ লিখুন (কমপক্ষে ৫ অক্ষর)').max(500),
});

export const ledgerQuerySchema = z.object({
  q: optionalText(100).catch(undefined),
  status: z.enum(['PLANNED', 'DISPATCHED', 'AWAITING_CONFIRMATION', 'DELIVERED', 'FAILED', 'EXPIRED']).optional().catch(undefined),
  categoryId: z.string().uuid().optional().catch(undefined),
  orgId: z.string().uuid().optional().catch(undefined),
  upazilaId: z.string().uuid().optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
});

export type SyncItemInput = z.infer<typeof syncItemSchema>;
export type PushInput = z.infer<typeof pushSchema>;
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

// ---------------------------------------------------------------- Day 3

const optionalPositiveInt = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? null : v),
  z.coerce.number({ invalid_type_error: 'সংখ্যা লিখুন' }).int('পূর্ণ সংখ্যা লিখুন').min(1, 'কমপক্ষে ১').max(1000000).nullable(),
);

export const planSchema = z.object({
  categoryId: z.string().uuid('ত্রাণের ধরন নির্বাচন করুন'),
  unionId: z.string().uuid('ইউনিয়ন নির্বাচন করুন'),
  stockId: z.string().uuid('মজুদ নির্বাচন করুন'),
  useQuantity: optionalPositiveInt,
  skipCooldown: z.boolean().default(true),
  mustInclude: z.array(z.enum(['DISABILITY', 'ELDERLY', 'UNDER5', 'PREGNANT', 'CHRONIC'])).max(5).default([]),
  perHouseholdCap: optionalPositiveInt,
  allowPartial: z.boolean().default(false),
  maxHouseholds: optionalPositiveInt,
});

export const applyPlanSchema = z.object({
  stockId: z.string().uuid(),
  volunteerId: z.string().uuid('স্বেচ্ছাসেবী নির্বাচন করুন'),
  categoryId: z.string().uuid(),
  unionId: z.string().uuid(),
  lines: z.array(z.object({ householdId: z.string().uuid(), qty: z.number().int().min(1).max(100000) })).min(1, 'পরিকল্পনা খালি').max(2000),
});

export const dashboardQuerySchema = z.object({
  upazilaId: z.string().uuid().optional().catch(undefined),
  unionId: z.string().uuid().optional().catch(undefined),
});
