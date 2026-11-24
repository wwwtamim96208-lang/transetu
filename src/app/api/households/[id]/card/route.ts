import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { HttpError, json, route } from '@/lib/http';
import { revealCardCode } from '@/lib/households';

type Ctx = { params: Promise<{ id: string }> };

// POST (not GET) so the code never lands in browser history or caches. Audit-logged.
export const POST = route<Ctx>(async (_req, ctx) => {
  const user = await requireUser(['ADMIN', 'COORDINATOR']);
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, 'NOT_FOUND', 'পরিবারটি পাওয়া যায়নি।');
  return json(await revealCardCode(user, id));
});
