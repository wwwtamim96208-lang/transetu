import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { HttpError, json, readJson, route } from '@/lib/http';
import { resolveReview } from '@/lib/reviews';
import { resolveReviewSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, ctx) => {
  const user = await requireUser(['ADMIN', 'COORDINATOR']);
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, 'NOT_FOUND', 'পাওয়া যায়নি।');
  const input = resolveReviewSchema.parse(await readJson(req));
  return json(await resolveReview(user, id, input));
});
