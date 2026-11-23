'use client';

import { useState } from 'react';

export function DeleteHousehold({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onDelete() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/households/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        window.location.href = '/households';
        return;
      }
      const body = await res.json().catch(() => null);
      setError(body?.error?.details?.reason?.[0] ?? body?.error?.message ?? 'মুছে ফেলা যায়নি।');
    } catch {
      setError('সার্ভারে সংযোগ করা যাচ্ছে না।');
    }
    setPending(false);
  }

  if (!open) {
    return <button type="button" className="btn btn-secondary no-print" onClick={() => setOpen(true)}>পরিবারটি মুছে ফেলুন</button>;
  }
  return (
    <section className="card stack no-print" aria-labelledby="del-title">
      <h2 id="del-title">পরিবারটি মুছে ফেলবেন?</h2>
      <p className="hint">রেকর্ডটি তালিকা থেকে সরে যাবে, কিন্তু অডিট লগ ও আগের বিতরণের ইতিহাস থেকে যাবে।</p>
      <div>
        <label htmlFor="del-reason">কারণ</label>
        <input id="del-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!error} aria-describedby="del-err" />
        <div id="del-err" className="field-error" role="alert">{error}</div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" className="btn-danger" disabled={pending} onClick={onDelete}>{pending ? 'মুছছে…' : 'হ্যাঁ, মুছে ফেলুন'}</button>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>বাতিল</button>
      </div>
    </section>
  );
}
