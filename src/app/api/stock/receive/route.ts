import { requireUser } from '@/lib/auth';
import { json, readJson, route } from '@/lib/http';
import { receiveStock } from '@/lib/stock';
import { receiveStockSchema } from '@/lib/validation';

export const POST = route(async (req) => {
  const user = await requireUser(['ADMIN', 'COORDINATOR']);
  const input = receiveStockSchema.parse(await readJson(req));
  return json({ stock: await receiveStock(user, input) }, 201);
});
