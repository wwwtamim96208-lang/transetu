import { NextResponse, type NextRequest } from 'next/server';

// Fast gate only: checks that a session cookie exists. The real check
// (token hash, expiry, active user, role) happens in requireUser()/getCurrentUser().
const PUBLIC = ['/login', '/api/auth/login', '/sw.js'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p)) return NextResponse.next();
  if (req.cookies.has('ts_session')) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'আগে লগইন করুন।' } }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js).*)'],
};
