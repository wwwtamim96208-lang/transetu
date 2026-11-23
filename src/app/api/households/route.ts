import { requireUser } from '@/lib/auth';
import { json, readJson, route } from '@/lib/http';
import { createHousehold, listHouseholds } from '@/lib/households';
import { householdCreateSchema, listQuerySchema } from '@/lib/validation';

// GET /api/households?q=&upazilaId=&unionId=&wardId=&vulnerable=1&damage=&sort=&order=&page=&pageSize=
export const GET = route(async (req) => {
  const user = await requireUser();
  const params = Object.fromEntries(new URL(req.url).searchParams);
  return json(await listHouseholds(user, listQuerySchema.parse(params)));
});

// POST /api/households  -> 201 created | 200 idempotent replay | 409 duplicate
export const POST = route(async (req) => {
  const user = await requireUser();
  const input = householdCreateSchema.parse(await readJson(req));
  const result = await createHousehold(user, input);
  return json(result, result.idempotent ? 200 : 201);
});
