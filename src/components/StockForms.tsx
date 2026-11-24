'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Opt = { id: string; label: string };
type FieldErrors = Record<string, string[] | undefined>;

async function post(url: string, body?: unknown) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: { message: 'সার্ভারে সংযোগ করা যাচ্ছে না।' } } };
  }
}

export function AllotForm({ stocks, volunteers }: {
  stocks: (Opt & { orgId: string; areaId: string })[];
  volunteers: (Opt & { orgId: string; upazilaId: string | null })[];
}) {
  const router = useRouter();
  const [stockId, setStockId] = useState('');
  const [volunteerId, setVolunteerId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Only volunteers of the same organisation working in the stock's upazila.
  const stock = stocks.find((s) => s.id === stockId);
  const eligible = useMemo(
    () => (stock ? volunteers.filter((v) => v.orgId === stock.orgId && v.upazilaId === stock.areaId) : []),
    [stock, volunteers],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    setErrors({});
    const r = await post('/api/allotments', { stockId, volunteerId, quantity });
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, text: 'বরাদ্দ দেওয়া হয়েছে।' });
      setQuantity('');
      router.refresh();
    } else {
      setMsg({ ok: false, text: r.data?.error?.message ?? 'বরাদ্দ দেওয়া যায়নি।' });
      if (r.data?.error?.details) setErrors(r.data.error.details);
    }
  }

  return (
    <form onSubmit={submit} className="card stack" aria-labelledby="af-h" noValidate>
      <h2 id="af-h" style={{ marginTop: 0 }}>স্বেচ্ছাসেবীকে বরাদ্দ</h2>
      <div>
        <label htmlFor="af-stock">মজুদ থেকে</label>
        <select id="af-stock" value={stockId} onChange={(e) => { setStockId(e.target.value); setVolunteerId(''); }} aria-invalid={!!errors.stockId}>
          <option value="">নির্বাচন করুন</option>
          {stocks.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <div className="field-error">{errors.stockId?.[0]}</div>
      </div>
      <div>
        <label htmlFor="af-vol">স্বেচ্ছাসেবী</label>
        <select id="af-vol" value={volunteerId} onChange={(e) => setVolunteerId(e.target.value)} aria-invalid={!!errors.volunteerId} disabled={!stock}>
          <option value="">{stock ? (eligible.length ? 'নির্বাচন করুন' : 'এই উপজেলায় আপনার কোনো স্বেচ্ছাসেবী নেই') : 'আগে মজুদ বাছুন'}</option>
          {eligible.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
        <div className="field-error">{errors.volunteerId?.[0]}</div>
      </div>
      <div>
        <label htmlFor="af-q">পরিমাণ</label>
        <input id="af-q" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={!!errors.quantity} />
        <div className="field-error">{errors.quantity?.[0]}</div>
      </div>
      <div aria-live="polite">{msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`}>{msg.text}</div>}</div>
      <button type="submit" disabled={busy}>{busy ? 'হচ্ছে…' : 'বরাদ্দ দিন'}</button>
    </form>
  );
}

export function ReceiveForm({ categories, upazilas, orgs }: { categories: Opt[]; upazilas: Opt[]; orgs: Opt[] }) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [orgId, setOrgId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    setErrors({});
    const r = await post('/api/stock/receive', { categoryId, areaId, quantity, orgId: orgId || undefined });
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, text: 'মজুদে যোগ হয়েছে।' });
      setQuantity('');
      router.refresh();
    } else {
      setMsg({ ok: false, text: r.data?.error?.message ?? 'যোগ করা যায়নি।' });
      if (r.data?.error?.details) setErrors(r.data.error.details);
    }
  }

  return (
    <form onSubmit={submit} className="card stack" aria-labelledby="rf-h" noValidate>
      <h2 id="rf-h" style={{ marginTop: 0 }}>নতুন ত্রাণ এসেছে</h2>
      {orgs.length > 0 && (
        <div>
          <label htmlFor="rf-org">সংস্থা</label>
          <select id="rf-org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">নিজের সংস্থা</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      )}
      <div>
        <label htmlFor="rf-cat">ত্রাণের ধরন</label>
        <select id="rf-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-invalid={!!errors.categoryId}>
          <option value="">নির্বাচন করুন</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <div className="field-error">{errors.categoryId?.[0]}</div>
      </div>
      <div>
        <label htmlFor="rf-area">উপজেলা</label>
        <select id="rf-area" value={areaId} onChange={(e) => setAreaId(e.target.value)} aria-invalid={!!errors.areaId}>
          <option value="">নির্বাচন করুন</option>
          {upazilas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <div className="field-error">{errors.areaId?.[0]}</div>
      </div>
      <div>
        <label htmlFor="rf-q">পরিমাণ</label>
        <input id="rf-q" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={!!errors.quantity} />
        <div className="field-error">{errors.quantity?.[0]}</div>
      </div>
      <div aria-live="polite">{msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`}>{msg.text}</div>}</div>
      <button type="submit" disabled={busy}>{busy ? 'হচ্ছে…' : 'মজুদে যোগ করুন'}</button>
    </form>
  );
}

export function CloseAllotmentButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn-link"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await post(`/api/allotments/${id}/close`);
          setBusy(false);
          if (r.ok) router.refresh();
          else setErr(r.data?.error?.message ?? 'বন্ধ করা যায়নি।');
        }}
      >
        বন্ধ করে বাকি ফেরত নিন
      </button>
      {err && <span className="field-error" role="alert"> {err}</span>}
    </>
  );
}
