import { requireUser } from '@/lib/auth';
import { json, readJson, route } from '@/lib/http';
import { applyPlan } from '@/lib/planning';
import { applyPlanSchema } from '@/lib/validation';

// POST /api/plan/apply - allot the planned total to a volunteer (stock decremented atomically)
export const POST = route(async (req) => {
  const user = await requireUser(['ADMIN', 'COORDINATOR']);
  const input = applyPlanSchema.parse(await readJson(req));
  return json(await applyPlan(user, input), 201);
});
