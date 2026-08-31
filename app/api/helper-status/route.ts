import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';

// Fed by HelperStatusReporter, a client component every logged-in page
// mounts: it can only ever check ITS OWN machine's 127.0.0.1 helper — there
// is no way for this server, or any other user's browser, to reach across
// to someone else's Mac — so this is self-reported, on a timer, purely so
// an admin can see who currently has it reachable without anyone having to
// ask around. It grants nothing and blocks nothing.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const connected = body.connected === true;

  getDb()
    .prepare(`UPDATE users SET helper_connected = ?, helper_last_seen = datetime('now') WHERE id = ?`)
    .run(connected ? 1 : 0, user.id);

  return NextResponse.json({ ok: true });
}
