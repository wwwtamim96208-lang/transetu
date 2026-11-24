import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { HttpError, json, readJson, route } from '@/lib/http';
import { confirmOnline } from '@/lib/distributions';
import { confirmSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, 'NOT_FOUND', 'বিতরণটি পাওয়া যায়নি।');
  const { code } = confirmSchema.parse(await readJson(req));
  const result = await confirmOnline(user, id, code);
  if ('wrongCode' in result && result.wrongCode) {
    throw new HttpError(400, 'WRONG_CODE', result.status === 'FAILED'
      ? 'অনেকবার ভুল কোড। বিতরণটি ব্যর্থ হিসেবে চিহ্নিত ও যাচাইয়ে পাঠানো হয়েছে।'
      : `কোড মেলেনি। আর ${result.attemptsLeft} বার চেষ্টা করা যাবে।`, { attemptsLeft: result.attemptsLeft });
  }
  return json(result);
});
