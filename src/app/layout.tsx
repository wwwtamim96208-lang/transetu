import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { getCurrentUser, ROLE_BN } from '@/lib/auth';
import { LogoutButton } from '@/components/LogoutButton';
import { countOpenReviews } from '@/lib/reviews';

export const metadata: Metadata = {
  title: 'ত্রাণসেতু | TranSetu',
  description: 'সব সংস্থার ত্রাণ বিতরণের একক, স্বচ্ছ হিসাব',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0a4f44' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const openReviews = user && user.role !== 'VOLUNTEER' ? await countOpenReviews() : 0;
  return (
    <html lang="bn">
      <body>
        <a href="#main" className="skip-link">মূল অংশে যান</a>
        <header className="topbar">
          <Link href="/" className="brand">ত্রাণসেতু</Link>
          {user && (
            <>
              <nav aria-label="প্রধান মেনু">
                {user.role === 'VOLUNTEER' ? (
                  <>
                    {/* Plain <a>: the field page must be a full page load so it works offline. */}
                    <a href="/field">মাঠের কাজ</a>
                    <Link href="/households">পরিবার</Link>
                    <Link href="/households/new">নতুন পরিবার</Link>
                    <Link href="/distributions">আমার বিতরণ</Link>
                  </>
                ) : (
                  <>
                    <Link href="/dashboard">ড্যাশবোর্ড</Link>
                    <Link href="/households">পরিবার</Link>
                    <Link href="/households/new">নতুন পরিবার</Link>
                    <Link href="/plan">বরাদ্দ পরিকল্পনা</Link>
                    <Link href="/distributions">বিতরণ লেজার</Link>
                    <Link href="/stock">স্টক ও বরাদ্দ</Link>
                    <Link href="/reviews">যাচাই{openReviews > 0 ? ` (${openReviews.toLocaleString('bn-BD')})` : ''}</Link>
                  </>
                )}
              </nav>
              <div className="who">
                <span>{user.name} · {ROLE_BN[user.role]} · <span className="hide-sm">{user.orgName}</span></span>
                <LogoutButton />
              </div>
            </>
          )}
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
