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
