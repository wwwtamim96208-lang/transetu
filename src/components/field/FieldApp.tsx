'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FieldPack, OutboxItem } from '@/lib/offline/types';
import { getPack, outboxAll, outboxPut } from '@/lib/offline/idb';
import { syncNow, downloadPack } from '@/lib/offline/sync';
import { effectiveRemaining, packExpired, rankHouseholds, type Ranked } from '@/lib/offline/derive';
import { verifyCardCodeWeb } from '@/lib/domain/token-web';
import { looksLikeCardCode } from '@/lib/domain/cardcode';
import { suggestedQuantity, STATUS_BN, type DistStatus } from '@/lib/domain/distribution';
import { FLAG_BN } from '@/lib/domain/flags';
import { fmtDateTime, unitBn } from '@/lib/domain/format';

const LOCAL_CODE_TRIES = 3;
const bn = (n: number) => n.toLocaleString('bn-BD');
const timeBn = (iso: string) => fmtDateTime(iso);

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Register the service worker and hand it the files this page was built from. */
function useServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        const assets = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((n) => n.startsWith(location.origin) && new URL(n).pathname.startsWith('/_next/static/'));
        reg.active?.postMessage({ type: 'CACHE_URLS', urls: ['/field', ...assets] });
      })
      .catch(() => undefined);
  }, []);
}

export function FieldApp({ userId, userName }: { userId: string; userName: string }) {
  const online = useOnline();
  useServiceWorker();

  const [pack, setPack] = useState<FieldPack | null>(null);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [p, o] = await Promise.all([getPack(), outboxAll()]);
    setPack(p ?? null);
    setOutbox(o.filter((i) => i.volunteerId === userId));
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    reload().catch(() => setMsg({ kind: 'error', text: 'এই ব্রাউজারে অফলাইন স্টোরেজ চালু নেই।' }));
  }, [reload]);

  const packOwnerMismatch = !!pack && pack.user.id !== userId;
  const pendingCount = outbox.filter((i) => i.syncState === 'pending').length;

  const doSync = useCallback(
    async (quiet = false) => {
      if (busy) return;
      setBusy(true);
      const r = await syncNow(userId);
      await reload();
      setBusy(false);
      if (!r.ok) {
        if (!quiet || r.reason === 'auth') setMsg({ kind: r.reason === 'offline' ? 'warn' : 'error', text: r.message });
        return;
      }
      if (!r.pushed && !r.flagged && !r.rejected) {
        if (!quiet) setMsg({ kind: 'ok', text: 'সব হালনাগাদ আছে। পাঠানোর মতো নতুন কিছু নেই, এলাকার ডেটা নতুন করে নামানো হয়েছে।' });
        return;
      }
      const parts = [`${bn(r.pushed)}টি বিতরণ sync হয়েছে`];
      if (r.flagged) parts.push(`${bn(r.flagged)}টি যাচাইয়ের জন্য চিহ্নিত`);
      if (r.rejected) parts.push(`${bn(r.rejected)}টি গ্রহণ করা হয়নি`);
      if (!quiet || r.pushed) setMsg({ kind: r.flagged || r.rejected ? 'warn' : 'ok', text: parts.join(' · ') + '। ডেটা হালনাগাদ।' });
    },
    [busy, reload, userId],
  );

  // Auto-sync: when the connection returns, and every minute while there is work.
  const autoSync = useRef(() => {});
  autoSync.current = () => {
    if (navigator.onLine && pendingCount > 0 && !packOwnerMismatch) void doSync(true);
  };
  useEffect(() => {
    if (online) autoSync.current();
  }, [online]);
  useEffect(() => {
    const t = setInterval(() => autoSync.current(), 60000);
    return () => clearInterval(t);
  }, []);

  async function firstDownload() {
    setBusy(true);
    const r = await downloadPack();
    await reload();
    setBusy(false);
    setMsg(r.ok ? { kind: 'ok', text: 'এলাকার ডেটা ফোনে সংরক্ষিত। এখন ইন্টারনেট ছাড়াও কাজ করা যাবে।' } : { kind: 'error', text: r.message });
  }

  const remaining = useMemo<Record<string, number>>(() => (pack ? effectiveRemaining(pack, outbox) : {}), [pack, outbox]);
  const myCategories = useMemo(() => {
    if (!pack) return [];
    const ids = new Set(pack.allotments.map((a) => a.categoryId));
    return pack.categories.filter((c) => ids.has(c.id));
  }, [pack]);
  useEffect(() => {
    if (!categoryId && myCategories[0]) setCategoryId(myCategories[0].id);
  }, [myCategories, categoryId]);

  const ranked = useMemo(() => (pack && categoryId ? rankHouseholds(pack, outbox, categoryId) : []), [pack, outbox, categoryId]);
  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = s ? ranked.filter((r) => r.household.headName.toLowerCase().includes(s) || r.household.wardName.includes(s)) : ranked;
    return list.slice(0, 40);
  }, [ranked, search]);

  async function saveItem(item: OutboxItem) {
    await outboxPut(item);
    await reload();
    if (navigator.onLine) void doSync(true);
  }

  // ------------------------------------------------------------ render
  if (!loaded) return <p>লোড হচ্ছে…</p>;

  const statusBar = (
    <section className="card stack" aria-label="সংযোগ ও sync অবস্থা">
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span className={`badge ${online ? '' : 'badge-warn'}`} role="status">{online ? '● অনলাইন' : '○ অফলাইন — ফোনে সংরক্ষণ হচ্ছে'}</span>
        {pack && <span className="hint">{pack.unionName} · ডেটা: {timeBn(pack.downloadedAt)}</span>}
        <span className={`badge ${pendingCount ? 'badge-warn' : ''}`}>{bn(pendingCount)}টি sync বাকি</span>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => doSync(false)} disabled={busy || !online || packOwnerMismatch}>
          {busy ? 'Sync হচ্ছে…' : 'এখন Sync করুন'}
        </button>
      </div>
      <div aria-live="polite">{msg && <div className={`alert alert-${msg.kind}`}>{msg.text}</div>}</div>
    </section>
  );

  if (!pack) {
    return (
      <div className="stack">
        {statusBar}
        <section className="card stack">
          <h2 style={{ marginTop: 0 }}>প্রথমে এলাকার ডেটা নিন</h2>
          <p>মাঠে যাওয়ার আগে ইন্টারনেট থাকা অবস্থায় একবার ডাউনলোড করুন। এরপর নেট ছাড়াও পরিবার খোঁজা, বিতরণ ও কার্ড যাচাই করা যাবে।</p>
          <button type="button" onClick={firstDownload} disabled={busy || !online}>{busy ? 'ডাউনলোড হচ্ছে…' : 'এলাকার ডেটা ডাউনলোড করুন'}</button>
        </section>
      </div>
    );
  }

  if (packOwnerMismatch) {
    return (
      <div className="stack">
        {statusBar}
        <div className="alert alert-error">
          এই ফোনে অন্য স্বেচ্ছাসেবীর ({pack.user.name}) ডেটা আছে। আপনার ({userName}) কাজের জন্য নতুন ডেটা ডাউনলোড করুন।
        </div>
        <button type="button" onClick={firstDownload} disabled={busy || !online}>আমার এলাকার ডেটা ডাউনলোড করুন</button>
      </div>
    );
  }

  const expired = packExpired(pack);
  const current = selected ? ranked.find((r) => r.household.id === selected) ?? null : null;
  const cat = pack.categories.find((c) => c.id === categoryId);
  const allot = pack.allotments.find((a) => a.categoryId === categoryId);

  return (
    <div className="stack">
      {statusBar}
      {expired && (
        <div className="alert alert-error">ফোনের ডেটা ৭২ ঘণ্টার বেশি পুরনো। নিরাপত্তার জন্য নতুন বিতরণ বন্ধ। ইন্টারনেটে গিয়ে Sync করুন।</div>
      )}

      <section className="card" aria-label="আপনার বরাদ্দ">
        <h2 style={{ marginTop: 0 }}>আপনার হাতে আছে</h2>
        {pack.allotments.length === 0 && <p>আপনার নামে কোনো সক্রিয় বরাদ্দ নেই। সমন্বয়কারীর সাথে যোগাযোগ করুন।</p>}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {pack.allotments.map((a) => {
            const c = pack.categories.find((x) => x.id === a.categoryId);
            return <span key={a.id} className="badge" style={{ fontSize: '0.95rem' }}>{c?.nameBn}: {bn(remaining[a.id] ?? 0)} / {bn(a.quantity)} {unitBn(c?.unit ?? '')}</span>;
          })}
        </div>
      </section>

      {current && cat && allot ? (
        <DistributePanel
          key={current.household.id + categoryId}
          ranked={current}
          category={cat}
          allotmentId={allot.id}
          remaining={remaining[allot.id] ?? 0}
          userId={userId}
          disabled={expired}
          onClose={() => setSelected(null)}
          onSave={async (item) => {
            await saveItem(item);
            setSelected(null);
            setMsg({
              kind: 'ok',
              text: item.status === 'DELIVERED'
                ? `${current.household.headName}: বিতরণ নিশ্চিত, ফোনে সংরক্ষিত।`
                : `${current.household.headName}: অপেক্ষমাণ হিসেবে সংরক্ষিত। ২৪ ঘণ্টার মধ্যে কার্ড কোড দিন।`,
            });
          }}
        />
      ) : (
        <section className="card stack" aria-label="পরিবার নির্বাচন">
          <div className="grid">
            <div>
              <label htmlFor="cat">ত্রাণের ধরন</label>
              <select id="cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {myCategories.map((c) => <option key={c.id} value={c.id}>{c.nameBn}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="search">পরিবার খুঁজুন</label>
              <input id="search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="নাম বা ওয়ার্ড" />
            </div>
          </div>
          <p className="hint">সবচেয়ে বেশি প্রয়োজন এমন পরিবার আগে দেখানো হচ্ছে। সম্প্রতি পাওয়া পরিবার নিচে।</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="stack">
            {visible.map((r) => (
              <li key={r.household.id}>
                <button type="button" className="btn btn-secondary" style={{ width: '100%', textAlign: 'left' }} onClick={() => setSelected(r.household.id)}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span>{r.household.headName} <span className="hint">· {r.household.wardName}</span></span>
                    <span className="badge">অগ্রাধিকার {bn(r.priority.score)}</span>
                  </span>
                  <span className="hint" style={{ display: 'block' }}>
                    {r.priority.reasons.slice(0, 2).map((x) => x.label).join(' · ')}
                  </span>
                  {r.cooldown.withinCooldown && r.last && (
                    <span className="badge badge-warn">{bn(r.cooldown.daysSince ?? 0)} দিন আগে পেয়েছে ({r.last.orgName})</span>
                  )}
                </button>
              </li>
            ))}
            {visible.length === 0 && <li>কোনো পরিবার পাওয়া যায়নি।</li>}
          </ul>
        </section>
      )}

      <OutboxList pack={pack} items={outbox} onChange={saveItem} />
    </div>
  );
}

// ------------------------------------------------------------ distribute panel

function DistributePanel(props: {
  ranked: Ranked;
  category: FieldPack['categories'][number];
  allotmentId: string;
  remaining: number;
  userId: string;
  disabled: boolean;
  onClose: () => void;
  onSave: (item: OutboxItem) => Promise<void>;
}) {
  const { ranked, category, remaining } = props;
  const h = ranked.household;
  const [qty, setQty] = useState(String(Math.min(suggestedQuantity(category, h.memberCount), Math.max(remaining, 1))));
  const [override, setOverride] = useState('');
  const [code, setCode] = useState('');
  const [tries, setTries] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const needsOverride = ranked.cooldown.withinCooldown;

  function validate(): number | null {
    const q = Number(qty);
    let problem: string | null = null;
    if (!Number.isInteger(q) || q < 1) problem = 'সঠিক পরিমাণ দিন।';
    else if (q > remaining) problem = `আপনার হাতে আছে মাত্র ${bn(remaining)} ${unitBn(category.unit)}।`;
    else if (needsOverride && override.trim().length < 10) problem = 'আগে পেয়েছে, তবুও দিলে কারণ লিখুন (কমপক্ষে ১০ অক্ষর)।';
    if (problem) {
      setError(problem);
      return null;
    }
    return q;
  }

  function build(status: OutboxItem['status'], q: number, confirmCode?: string): OutboxItem {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(), volunteerId: props.userId, householdId: h.id, categoryId: category.id, allotmentId: props.allotmentId,
      quantity: q, status, occurredAt: now, confirmCode, confirmAttempts: tries, overrideReason: needsOverride ? override.trim() : undefined,
      createdOffline: !navigator.onLine, syncState: 'pending', updatedAt: now,
    };
  }

  async function withCode() {
    if (pending) return;
    setError(null);
    const q = validate();
    if (q === null) return;
    if (!looksLikeCardCode(code)) {
      setError('কার্ডের ৮ অক্ষরের কোড লিখুন (যেমন 7KQ2-M9XA)।');
      return;
    }
    setPending(true);
    const ok = await verifyCardCodeWeb(code, h.id, h.tokenHash);
    if (!ok) {
      const t = tries + 1;
      setTries(t);
      setPending(false);
      setError(t >= LOCAL_CODE_TRIES
        ? 'কোড বারবার মেলেনি। ত্রাণ দিলে "কার্ড ছাড়া" বোতাম ব্যবহার করুন — পরে যাচাই হবে।'
        : `কোড মেলেনি। আর ${bn(LOCAL_CODE_TRIES - t)} বার চেষ্টা করা যাবে।`);
      return;
    }
    await props.onSave(build('DELIVERED', q, code));
  }

  async function withoutCode() {
    if (pending) return;
    setError(null);
    const q = validate();
    if (q === null) return;
    setPending(true);
    await props.onSave(build('AWAITING_CONFIRMATION', q));
  }

  return (
    <section className="card stack" aria-labelledby="dp-title">
      <h2 id="dp-title" style={{ marginTop: 0 }}>{h.headName}</h2>
      <p className="hint">{h.wardName} · {bn(h.memberCount)} জন সদস্য{h.phoneMasked ? ` · ${h.phoneMasked}` : ''}</p>
      <div>
        <strong>অগ্রাধিকার স্কোর {bn(ranked.priority.score)}</strong>
        <ul>{ranked.priority.reasons.map((r) => <li key={r.code}>{r.label} (+{bn(r.points)})</li>)}</ul>
      </div>

      {needsOverride && ranked.last && (
        <div className="alert alert-warn" role="alert">
          <strong>সতর্কতা:</strong> এই পরিবার {bn(ranked.cooldown.daysSince ?? 0)} দিন আগে {ranked.last.orgName}-এর কাছ থেকে {category.nameBn} পেয়েছে
          ({bn(category.cooldownDays)} দিনের মধ্যে আবার দেওয়ার নিয়ম নেই)।
          <div style={{ marginTop: '0.5rem' }}>
            <label htmlFor="override">তবুও দিলে কারণ *</label>
            <input id="override" type="text" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="যেমন: আগের খাবার বন্যার পানিতে নষ্ট হয়েছে" />
          </div>
        </div>
      )}

      <div className="grid">
        <div>
          <label htmlFor="qty">পরিমাণ ({unitBn(category.unit)}) <span className="hint">— হাতে আছে {bn(remaining)}</span></label>
          <input id="qty" type="number" min={1} max={remaining} value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div>
          <label htmlFor="code">পরিবারের কার্ড কোড</label>
          <input id="code" type="text" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" placeholder="XXXX-XXXX"
            style={{ fontFamily: 'monospace', letterSpacing: '0.1em' }} disabled={tries >= LOCAL_CODE_TRIES} />
        </div>
      </div>

      <div role="alert" aria-live="assertive">{error && <div className="alert alert-error">{error}</div>}</div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={withCode} disabled={pending || props.disabled || tries >= LOCAL_CODE_TRIES || remaining < 1}>কোড যাচাই করে বিতরণ</button>
        <button type="button" className="btn btn-secondary" onClick={withoutCode} disabled={pending || props.disabled || remaining < 1}>কার্ড ছাড়া দিন (পরে নিশ্চিত)</button>
        <button type="button" className="btn-link" onClick={props.onClose}>ফিরে যান</button>
      </div>
      {remaining < 1 && <p className="field-error">এই ধরনের ত্রাণ আপনার হাতে আর নেই।</p>}
    </section>
  );
}

// ------------------------------------------------------------ outbox

function OutboxList({ pack, items, onChange }: { pack: FieldPack; items: OutboxItem[]; onChange: (i: OutboxItem) => Promise<void> }) {
  const sorted = [...items].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  if (!sorted.length) return null;
  const name = (id: string) => pack.households.find((h) => h.id === id)?.headName ?? 'অজানা পরিবার';
  const catName = (id: string) => pack.categories.find((c) => c.id === id)?.nameBn ?? '';
  return (
    <section className="card stack" aria-label="এই ফোনের বিতরণ">
      <h2 style={{ marginTop: 0 }}>এই ফোনে রেকর্ড করা বিতরণ</h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="stack">
        {sorted.map((i) => (
          <li key={i.id} className="member-row">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span><strong>{name(i.householdId)}</strong> · {catName(i.categoryId)} × {bn(i.quantity)}</span>
              <span className="hint">{timeBn(i.occurredAt)}{i.createdOffline ? ' · অফলাইনে' : ''}</span>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
              <span className={`badge ${i.status === 'DELIVERED' ? '' : 'badge-warn'}`}>{STATUS_BN[(i.serverStatus ?? i.status) as DistStatus] ?? i.status}</span>
              <span className={`badge ${i.syncState === 'rejected' ? 'badge-danger' : i.syncState === 'pending' ? 'badge-warn' : ''}`}>
                {i.syncState === 'pending' ? 'sync বাকি' : i.syncState === 'synced' ? '✓ sync হয়েছে' : 'গ্রহণ হয়নি'}
              </span>
              {i.flags?.map((f) => <span key={f} className="badge badge-danger">{FLAG_BN[f] ?? f}</span>)}
            </div>
            {i.error && <p className="field-error">{i.error}</p>}
            {i.status === 'AWAITING_CONFIRMATION' && <LateConfirm pack={pack} item={i} onChange={onChange} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function LateConfirm({ pack, item, onChange }: { pack: FieldPack; item: OutboxItem; onChange: (i: OutboxItem) => Promise<void> }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const h = pack.households.find((x) => x.id === item.householdId);
  const canCancel = item.serverStatus !== 'EXPIRED';

  async function confirm() {
    if (!h || busy) return;
    setBusy(true);
    const ok = looksLikeCardCode(code) && (await verifyCardCodeWeb(code, h.id, h.tokenHash));
    if (!ok) {
      setErr('কোড মেলেনি।');
      await onChange({ ...item, confirmAttempts: item.confirmAttempts + 1, updatedAt: new Date().toISOString() });
      setBusy(false);
      return;
    }
    await onChange({ ...item, status: 'DELIVERED', confirmCode: code, syncState: 'pending', updatedAt: new Date().toISOString() });
    setBusy(false);
  }

  async function cancel() {
    if (busy) return;
    setBusy(true);
    await onChange({ ...item, status: 'FAILED', note: 'দেওয়া হয়নি / ফেরত নেওয়া হয়েছে', syncState: 'pending', updatedAt: new Date().toISOString() });
    setBusy(false);
  }

  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end', marginTop: '0.5rem' }}>
      <div style={{ flex: '1 1 160px' }}>
        <label htmlFor={`lc-${item.id}`} className="hint">কার্ড কোড দিয়ে নিশ্চিত করুন</label>
        <input id={`lc-${item.id}`} type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX" autoComplete="off" />
      </div>
      <button type="button" onClick={confirm} disabled={busy}>নিশ্চিত</button>
      {canCancel && <button type="button" className="btn btn-secondary" onClick={cancel} disabled={busy}>দেওয়া হয়নি</button>}
      {err && <span className="field-error" role="alert">{err}</span>}
    </div>
  );
}
