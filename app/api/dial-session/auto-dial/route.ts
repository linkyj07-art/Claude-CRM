import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';
import { DialSessionRow, serializeDialSession } from '@/lib/dialSession';

// Separate from the main /api/dial-session POST (which fully replaces the
// queue/currentLeadId/recycle/pass on every advance) because this only ever
// patches a subset of columns — the toggle, the pace setting, or one of the
// session counters — and the counters need an atomic SQL increment rather
// than a read-modify-write from whatever stale value the client last saw
// (two devices sharing a session, or two calls landing close together,
// would otherwise stomp on each other's increment).
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const db = getDb();

  const sets: string[] = [];
  const params: (string | number)[] = [];

  if (typeof body.autoDial === 'boolean') {
    sets.push('auto_dial = ?');
    params.push(body.autoDial ? 1 : 0);
  }
  if (typeof body.autoDialPaceMs === 'number' && Number.isFinite(body.autoDialPaceMs) && body.autoDialPaceMs >= 0) {
    sets.push('auto_dial_pace_ms = ?');
    params.push(Math.round(body.autoDialPaceMs));
  }
  if (body.incrementDial === true) {
    sets.push('session_dials = session_dials + 1');
  }
  if (body.incrementConnect === true) {
    sets.push('session_connects = session_connects + 1');
  }
  if (body.noAnswerStreak === 'increment') {
    sets.push('consecutive_no_answer = consecutive_no_answer + 1');
  } else if (body.noAnswerStreak === 'reset') {
    sets.push('consecutive_no_answer = 0');
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE dial_sessions SET ${sets.join(', ')} WHERE user_id = ?`).run(...params, user.id);
  }

  const row = db.prepare('SELECT * FROM dial_sessions WHERE user_id = ?').get(user.id) as DialSessionRow | undefined;
  if (!row) return NextResponse.json({ error: 'No active dial session' }, { status: 404 });
  return NextResponse.json(serializeDialSession(row));
}
