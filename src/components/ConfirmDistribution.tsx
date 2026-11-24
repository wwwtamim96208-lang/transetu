'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Confirm a pending/expired distribution with the family's card code (online, e.g. at the office). */
export function ConfirmDistribution({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/distributions/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        router.refresh();
        setOpen(false);
      } else {
        setErr(body?.error?.message ?? 'নিশ্চিত করা যায়নি।');
        if (body?.error?.code === 'WRONG_CODE') router.refresh();
      }
    } catch {
      setErr('সার্ভারে সংযোগ করা যাচ্ছে না।');
    }
    setBusy(false);
  }

  if (!open) return <div><button type="button" className="btn-link" onClick={() => setOpen(true)}>কোড দিয়ে নিশ্চিত করুন</button></div>;
  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
      <label htmlFor={`c-${id}`} className="visually-hidden">কার্ড কোড</label>
      <input id={`c-${id}`} type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX" autoComplete="off" style={{ maxWidth: 140 }} />
      <button type="submit" disabled={busy}>নিশ্চিত</button>
      {err && <span className="field-error" role="alert" style={{ width: '100%' }}>{err}</span>}
    </form>
  );
}
