import { login } from '@/lib/auth';
import { json, readJson, route } from '@/lib/http';
import { loginSchema } from '@/lib/validation';

export const POST = route(async (req) => {
  const { email, password } = loginSchema.parse(await readJson(req));
  const user = await login(email, password, req.headers.get('user-agent'));
  return json({ user });
});
