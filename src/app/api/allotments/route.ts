import { requireUser } from '@/lib/auth';
import { json, readJson, route } from '@/lib/http';
import { createAllotment } from '@/lib/stock';
import { allotmentSchema } from '@/lib/validation';

export const POST = route(async (req) => {
  const user = await requireUser(['ADMIN', 'COORDINATOR']);
  const input = allotmentSchema.parse(await readJson(req));
  return json({ allotment: await createAllotment(user, input) }, 201);
});
