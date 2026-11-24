// Device <-> server sync (browser only).
import { getDeviceId, outboxAll, outboxDelete, outboxPutMany, savePack } from './idb';
import type { FieldPack, OutboxItem, SyncResult } from './types';

export type SyncOutcome =
  | { ok: true; pushed: number; flagged: number; rejected: number; pack?: FieldPack }
  | { ok: false; reason: 'offline' | 'auth' | 'server'; message: string };

const LOCAL_STATUSES = ['AWAITING_CONFIRMATION', 'DELIVERED', 'FAILED'] as const;
const KEEP_HISTORY_MS = 3 * 24 * 60 * 60 * 1000;

function toWire(i: OutboxItem) {
  return {
    id: i.id, householdId: i.householdId, categoryId: i.categoryId, allotmentId: i.allotmentId,
    quantity: i.quantity, status: i.status, occurredAt: i.occurredAt, confirmCode: i.confirmCode,
    confirmAttempts: i.confirmAttempts, overrideReason: i.overrideReason, note: i.note, createdOffline: i.createdOffline,
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000); // slow rural networks
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return null; // network down / timeout
  }
}

/** Push pending items. Results are applied only to items not edited meanwhile. */
async function push(userId: string): Promise<SyncOutcome> {
  const pending = (await outboxAll()).filter((i) => i.volunteerId === userId && i.syncState === 'pending');
  let pushed = 0, flagged = 0, rejected = 0;
  if (!pending.length) return { ok: true, pushed, flagged, rejected };
  const deviceId = await getDeviceId();

  for (let k = 0; k < pending.length; k += 100) {
    const chunk = pending.slice(k, k + 100);
    const res = await fetchJson('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, items: chunk.map(toWire) }),
    });
    if (!res) return { ok: false, reason: 'offline', message: 'ইন্টারনেট নেই। ডেটা ফোনে নিরাপদে আছে, নেট এলে আবার চেষ্টা হবে।' };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'auth', message: 'Sync করতে আবার লগইন করুন। ফোনের ডেটা মুছবে না।' };
    }
    if (res.status !== 200) return { ok: false, reason: 'server', message: 'সার্ভারে সমস্যা। একটু পরে আবার চেষ্টা হবে।' };

    const results = (res.body as { results: SyncResult[] }).results;
    const byId = new Map(results.map((r) => [r.id, r]));
    const current = new Map((await outboxAll()).map((i) => [i.id, i]));
    const now = new Date().toISOString();
    const updates: OutboxItem[] = [];
    for (const sent of chunk) {
      const r = byId.get(sent.id);
      const cur = current.get(sent.id);
      if (!r || !cur || cur.updatedAt !== sent.updatedAt) continue; // edited during sync: send again next time
      if (r.result === 'rejected') {
        if (r.retryable) continue;
        rejected++;
        updates.push({ ...cur, syncState: 'rejected', error: r.error, confirmCode: undefined });
        continue;
      }
      pushed++;
      if (r.flags.length) flagged++;
      const serverStatus = r.status ?? cur.status;
      const localStatus = (LOCAL_STATUSES as readonly string[]).includes(serverStatus) ? (serverStatus as OutboxItem['status']) : cur.status;
      // The card code is wiped as soon as the server has seen it.
      updates.push({ ...cur, status: localStatus, serverStatus, flags: r.flags, syncState: 'synced', syncedAt: now, confirmCode: undefined, error: undefined });
    }
    await outboxPutMany(updates);
  }
  return { ok: true, pushed, flagged, rejected };
}

export async function downloadPack(): Promise<SyncOutcome> {
  const res = await fetchJson('/api/field/pack');
  if (!res) return { ok: false, reason: 'offline', message: 'ইন্টারনেট নেই। ডেটা ডাউনলোড করা যায়নি।' };
  if (res.status === 401 || res.status === 403) {
    const msg = (res.body as { error?: { message?: string } } | null)?.error?.message;
    return { ok: false, reason: 'auth', message: msg ?? 'আবার লগইন করুন।' };
  }
  if (res.status !== 200) return { ok: false, reason: 'server', message: 'সার্ভারে সমস্যা। আবার চেষ্টা করুন।' };
  const pack = res.body as FieldPack;
  await savePack(pack);
  // Prune old, already-synced history (it is now part of the server snapshot).
  const cutoff = Date.now() - KEEP_HISTORY_MS;
  for (const i of await outboxAll()) {
    if (i.syncState === 'synced' && i.syncedAt && i.syncedAt <= pack.downloadedAt && new Date(i.occurredAt).getTime() < cutoff) {
      await outboxDelete(i.id);
    }
  }
  return { ok: true, pushed: 0, flagged: 0, rejected: 0, pack };
}

let running: Promise<SyncOutcome> | null = null;

/** Push, then refresh the pack. Only one sync runs at a time. */
export function syncNow(userId: string): Promise<SyncOutcome> {
  if (!running) {
    running = (async () => {
      const p = await push(userId);
      if (!p.ok) return p;
      const d = await downloadPack();
      return d.ok ? { ...p, pack: d.pack } : d;
    })().finally(() => {
      running = null;
    });
  }
  return running;
}
