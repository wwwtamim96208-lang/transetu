import { requireUser } from '@/lib/auth';
import { json, route } from '@/lib/http';
import { buildPack } from '@/lib/field';

// GET /api/field/pack - offline data for the volunteer's union
export const GET = route(async () => {
  const user = await requireUser(['VOLUNTEER']);
  return json(await buildPack(user));
});
