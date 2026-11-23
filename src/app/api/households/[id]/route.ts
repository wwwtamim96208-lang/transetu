import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { HttpError, json, readJson, route } from '@/lib/http';
import { deleteHousehold, getHousehold, updateHousehold } from '@/lib/households';
import { householdUpdateSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

async function idFrom(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, 'NOT_FOUND', 'পরিবারটি পাওয়া যায়নি।');
  return id;
}

export const GET = route<Ctx>(async (_req, ctx) => {
  const user = await requireUser();
  return json({ household: await getHousehold(user, await idFrom(ctx)) });
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const user = await requireUser();
  const id = await idFrom(ctx);
  const input = householdUpdateSchema.parse(await readJson(req));
  return json(await updateHousehold(user, id, input));
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const user = await requireUser(['ADMIN']);
  const id = await idFrom(ctx);
  const { reason } = z.object({ reason: z.string().default('') }).parse(await readJson(req));
  await deleteHousehold(user, id, reason);
  return json({ ok: true });
});
