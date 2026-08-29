import { NextRequest, NextResponse } from 'next/server';

// Simple shared-password gate for the whole app. Set BASIC_AUTH_USER and
// BASIC_AUTH_PASSWORD as environment variables in production (Railway/Fly/
// wherever this is hosted) — this CRM stores real lead/client PII (names,
// phone, DOB, SSN, bank/routing) and has no other login system, so it
// should not be reachable without this set once it's live.
//
// If either env var is unset, the gate is skipped (so local `npm run dev`
// keeps working with zero config). A console warning fires once per cold
// start if that happens while NODE_ENV=production, to make it hard to miss.

export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;

  if (!user || !pass) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[security] BASIC_AUTH_USER / BASIC_AUTH_PASSWORD are not set — this CRM is running in production with NO login gate. Set both env vars to protect it.'
      );
    }
    return NextResponse.next();
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Basic ')) {
    const decoded = atob(authHeader.slice(6));
    const sep = decoded.indexOf(':');
    const suppliedUser = decoded.slice(0, sep);
    const suppliedPass = decoded.slice(sep + 1);
    if (suppliedUser === user && suppliedPass === pass) {
      return NextResponse.next();
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="FEX CRM", charset="UTF-8"' }
  });
}

export const config = {
  matcher: [
    // Run on everything except Next's static/image internals and the icon.
    '/((?!_next/static|_next/image|icon.svg).*)'
  ]
};
