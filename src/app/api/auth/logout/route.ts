import { logout } from '@/lib/auth';
import { json, route } from '@/lib/http';

export const POST = route(async () => {
  await logout();
  return json({ ok: true });
});
