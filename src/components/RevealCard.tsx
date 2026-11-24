'use client';

import { useState } from 'react';

/** Reprint a lost token card. The code is fetched on demand (audit-logged), never embedded in the page. */
export function RevealCard({ id }: { id: string }) {
  const [card, setCard] = useState<{ cardCode: string; headName: string; wardName: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/households/${id}/card`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (res.ok) setCard(body);
      else setErr(body?.error?.message ?? 'কার্ড আনা যায়নি।');
    } catch {
      setErr('সার্ভারে সংযোগ করা যাচ্ছে না।');
    }
    setBusy(false);
  }

  if (!card) {
    return (
      <div className="no-print">
        <button type="button" className="btn btn-secondary" onClick={load} disabled={busy}>টোকেন কার্ড আবার প্রিন্ট করুন</button>
        {err && <p className="field-error" role="alert">{err}</p>}
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="code-card">
        <div><strong>ত্রাণসেতু · টোকেন কার্ড</strong></div>
        <div style={{ margin: '0.5rem 0' }}>{card.headName}<br /><span className="hint">{card.wardName}</span></div>
        <div className="code">{card.cardCode}</div>
        <div className="hint">ত্রাণ নেওয়ার সময় এই কোড দেখাতে হবে।</div>
      </div>
      <div className="no-print" style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" onClick={() => window.print()}>প্রিন্ট</button>
        <button type="button" className="btn btn-secondary" onClick={() => setCard(null)}>লুকান</button>
      </div>
    </div>
  );
}
