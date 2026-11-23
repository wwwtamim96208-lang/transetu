import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { LoginForm } from './LoginForm';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect('/households');
  const { next } = await searchParams;
  // Only allow internal redirects (prevents open-redirect via ?next=https://evil).
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/households';
  return (
    <div className="card stack" style={{ maxWidth: 420, margin: '2rem auto' }}>
      <h1>লগইন</h1>
      <p className="hint">প্রশাসন, এনজিও সমন্বয়কারী ও স্বেচ্ছাসেবীদের জন্য।</p>
      <LoginForm next={safeNext} />
    </div>
  );
}
