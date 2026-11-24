import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { HttpError, json, route } from '@/lib/http';
import { closeAllotment } from '@/lib/stock';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_req, ctx) => {
  const user = await requireUser(['ADMIN', 'COORDINATOR']);
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, 'NOT_FOUND', 'বরাদ্দ পাওয়া যায়নি।');
  return json(await closeAllotment(user, id));
});
