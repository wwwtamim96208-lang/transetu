'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ResolveReview({ id }: { id: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(status: 'RESOLVED' | 'DISMISSED') {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/reviews/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, resolution: text }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok || body?.error?.code === 'ALREADY_RESOLVED') router.refresh();
      if (!res.ok) setErr(body?.error?.details?.resolution?.[0] ?? body?.error?.message ?? 'সংরক্ষণ করা যায়নি।');
    } catch {
      setErr('সার্ভারে সংযোগ করা যাচ্ছে না।');
    }
    setBusy(false);
  }

  return (
    <div className="stack">
      <div>
        <label htmlFor={`rr-${id}`}>সিদ্ধান্ত / মন্তব্য</label>
        <input id={`rr-${id}`} type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="যেমন: দুই ভাই আলাদা পরিবার, যাচাই করা হয়েছে" aria-describedby={`rr-err-${id}`} />
        <div id={`rr-err-${id}`} className="field-error" role="alert">{err}</div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" disabled={busy} onClick={() => act('RESOLVED')}>সমাধান হয়েছে</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => act('DISMISSED')}>সমস্যা নয় (বাতিল)</button>
      </div>
    </div>
  );
}
