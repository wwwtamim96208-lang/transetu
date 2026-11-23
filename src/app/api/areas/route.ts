import { requireUser } from '@/lib/auth';
import { json, route } from '@/lib/http';
import { listAreas } from '@/lib/households';

export const GET = route(async () => {
  await requireUser();
  return json({ areas: await listAreas() });
});
