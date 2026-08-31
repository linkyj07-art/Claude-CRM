import { cookies } from 'next/headers';
import { getDb } from './db';
import { SESSION_COOKIE, verifySessionToken } from './session';

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  role: string;
}

// middleware.ts already blocks any request without a valid session cookie
// from reaching a page or API route (except /login and /api/auth/*), so by
// the time this runs a valid session should always exist. It still returns
// null on a race (user deleted mid-session, cookie tampered) so callers stay
// defensive rather than assuming.
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const uid = await verifySessionToken(token);
  if (!uid) return null;
  const db = getDb();
  const user = db.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(uid) as SessionUser | undefined;
  return user || null;
}
