import { requireUser } from '@/lib/auth';
import { json, readJson, route } from '@/lib/http';
import { checkDuplicates } from '@/lib/households';
import { duplicateCheckSchema } from '@/lib/validation';

// Live duplicate warning while the form is being filled. Read-only.
export const POST = route(async (req) => {
  const user = await requireUser();
  const input = duplicateCheckSchema.parse(await readJson(req));
  return json({ matches: await checkDuplicates(user, input) });
});
