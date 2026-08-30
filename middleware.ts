import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

// Real per-user login. Each agent gets their own username/password (created
// by an admin from Settings → Team) and only ever sees leads they own — this
// CRM stores real client PII (names, phone, DOB, SSN, bank/routing), so
// nothing renders without a verified session.
//
// Runs on the Edge runtime, so no Node built-ins / native addons here — the
// session token is signed with the Web Crypto API (see lib/session.ts),
// which works identically here and in Node route handlers.

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/webhooks/incoming-call', '/api/webhooks/leads/goat'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const uid = await verifySessionToken(token);

  if (uid) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Run on everything except Next's static/image internals and the icon.
    '/((?!_next/static|_next/image|icon.svg).*)'
  ]
};
