import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { createSessionToken, SESSION_COOKIE } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
    }

    const db = getDb();
    const user = db.prepare('SELECT id, username, name, password_hash FROM users WHERE username = ? COLLATE NOCASE').get(username) as
      | { id: string; username: string; name: string; password_hash: string }
      | undefined;

    if (!user || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
    }

    const token = await createSessionToken(user.id);
    const res = NextResponse.json({ ok: true, name: user.name });
    // `next start` always runs as NODE_ENV=production, including in local
    // testing over plain http, so gating Secure on NODE_ENV would make the
    // browser silently drop the cookie there. Key it off the actual request
    // scheme instead (same pattern as the dial route's proxy-aware redirect) —
    // correctly Secure behind Railway's HTTPS proxy, non-Secure over local http.
    const isHttps = req.headers.get('x-forwarded-proto') === 'https' || new URL(req.url).protocol === 'https:';
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      path: '/',
      maxAge: 30 * 24 * 60 * 60
    });
    return res;
  } catch (err) {
    // Without this, an unexpected exception here falls through to Next's
    // default HTML error page, which the login form's res.json() can't
    // parse — the request fails silently from the user's point of view
    // ("nothing happens" on Sign In) instead of showing a real error.
    console.error('[auth/login] Unexpected error', err);
    return NextResponse.json({ error: 'Something went wrong on our end. Please try again.' }, { status: 500 });
  }
}
