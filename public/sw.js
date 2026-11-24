/* TranSetu service worker: makes the field page (/field) open without internet.
 * - /_next/static/* : cache-first (hashed, immutable build files)
 * - /field navigation: network-first with a 4s timeout, falls back to cache
 * - /api/*          : never cached. Field data lives in IndexedDB, not in HTTP cache.
 */
const CACHE = 'transetu-v1';
const FIELD = '/field';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page sends the URLs it was built from (first visit happens before the SW controls it).
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'CACHE_URLS' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        data.urls.map((u) =>
          fetch(u, { credentials: 'same-origin' })
            .then((res) => (res.ok && !res.redirected ? cache.put(u, res) : undefined))
            .catch(() => undefined),
        ),
      ),
    ),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === 'navigate' && url.pathname === FIELD) {
    event.respondWith(
      withTimeout(fetch(req), 4000)
        .then((res) => {
          // Do not cache the login redirect: only a real field page.
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(FIELD, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(FIELD).then(
            (hit) => hit || new Response('<h1>অফলাইন</h1><p>প্রথমবার ইন্টারনেট থাকা অবস্থায় মাঠের পাতা খুলুন।</p>', {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            }),
          ),
        ),
    );
  }
});
