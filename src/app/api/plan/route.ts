import { requireUser } from '@/lib/auth';
import { json, readJson, route } from '@/lib/http';
import { runPlan } from '@/lib/planning';
import { planSchema } from '@/lib/validation';

// POST /api/plan - build an explainable allocation plan (read-only)
export const POST = route(async (req) => {
  const user = await requireUser(['ADMIN', 'COORDINATOR']);
  const input = planSchema.parse(await readJson(req));
  return json(await runPlan(user, input));
});
