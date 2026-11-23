'use client';

import { useState } from 'react';

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }),
      });
      if (res.ok) {
        window.location.href = next;
        return;
      }
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'লগইন করা যায়নি।');
    } catch {
      setError('সার্ভারে সংযোগ করা যাচ্ছে না। ইন্টারনেট সংযোগ দেখুন।');
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="stack" noValidate>
      <div role="alert" aria-live="assertive">{error && <div className="alert alert-error">{error}</div>}</div>
      <div>
        <label htmlFor="email">ইমেইল</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div>
        <label htmlFor="password">পাসওয়ার্ড</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button type="submit" disabled={pending}>{pending ? 'অপেক্ষা করুন…' : 'লগইন'}</button>
    </form>
  );
}
