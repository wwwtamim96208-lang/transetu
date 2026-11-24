import { requireUser } from '@/lib/auth';
import { json, readJson, route } from '@/lib/http';
import { pushSync } from '@/lib/distributions';
import { pushSchema } from '@/lib/validation';

// POST /api/sync/push - idempotent batch of device-recorded distributions
export const POST = route(async (req) => {
  const user = await requireUser(['VOLUNTEER']);
  const input = pushSchema.parse(await readJson(req));
  return json(await pushSync(user, input));
});
