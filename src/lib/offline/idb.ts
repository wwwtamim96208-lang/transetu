// Tiny promise wrapper over IndexedDB (browser only). Two stores:
//   kv     - field pack, device id
//   outbox - distributions recorded on this device
import type { FieldPack, OutboxItem } from './types';

const DB_NAME = 'transetu-field';
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        // Resolve only when the transaction commits, so data is durably written.
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      }),
  );
}

export const kvGet = <T,>(key: string) => run<T>('kv', 'readonly', (s) => s.get(key) as IDBRequest<T>);
export const kvSet = (key: string, value: unknown) => run('kv', 'readwrite', (s) => { s.put(value, key); });

export const getPack = () => kvGet<FieldPack>('pack');
export const savePack = (p: FieldPack) => kvSet('pack', p);

export async function getDeviceId(): Promise<string> {
  let id = await kvGet<string>('deviceId');
  if (!id) {
    id = crypto.randomUUID();
    await kvSet('deviceId', id);
  }
  return id;
}

export const outboxAll = async () => (await run<OutboxItem[]>('outbox', 'readonly', (s) => s.getAll() as IDBRequest<OutboxItem[]>)) ?? [];
export const outboxPut = (item: OutboxItem) => run('outbox', 'readwrite', (s) => { s.put(item); });
export const outboxDelete = (id: string) => run('outbox', 'readwrite', (s) => { s.delete(id); });

/** Write many items in ONE transaction (all-or-nothing). */
export function outboxPutMany(items: OutboxItem[]) {
  return run('outbox', 'readwrite', (s) => { for (const i of items) s.put(i); });
}
