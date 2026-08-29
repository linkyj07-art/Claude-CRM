import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';

type DialSessionRow = { current_lead_id: string | null; queue: string; recycle: string; pass: number; updated_at: string };

function serialize(row: DialSessionRow | undefined) {
  if (!row) return null;
  return {
    currentLeadId: row.current_lead_id,
    queue: row.queue ? row.queue.split(',').filter(Boolean) : [],
    recycle: row.recycle ? row.recycle.split(',').filter(Boolean) : [],
    pass: row.pass,
    updatedAt: row.updated_at
  };
}

// A single Power Dial session per user, persisted server-side, is what lets
// a second device (phone alongside laptop) follow the exact same queue
// instead of building its own — LeadWorkspace polls this while dialing and
// jumps to match currentLeadId whenever it changes, so a disposition logged
// on one device carries the other one along within a few seconds.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const row = getDb().prepare('SELECT * FROM dial_sessions WHERE user_id = ?').get(user.id) as DialSessionRow | undefined;
  return NextResponse.json(serialize(row));
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const currentLeadId: string | null = body.currentLeadId || null;
  const queue: string[] = Array.isArray(body.queue) ? body.queue : [];
  const recycle: string[] = Array.isArray(body.recycle) ? body.recycle : [];
  const pass = body.pass === 2 ? 2 : 1;

  const db = getDb();
  db.prepare(
    `INSERT INTO dial_sessions (user_id, current_lead_id, queue, recycle, pass, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       current_lead_id = excluded.current_lead_id, queue = excluded.queue,
       recycle = excluded.recycle, pass = excluded.pass, updated_at = excluded.updated_at`
  ).run(user.id, currentLeadId, queue.join(','), recycle.join(','), pass);

  const row = db.prepare('SELECT * FROM dial_sessions WHERE user_id = ?').get(user.id) as DialSessionRow;
  return NextResponse.json(serialize(row));
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  getDb().prepare('DELETE FROM dial_sessions WHERE user_id = ?').run(user.id);
  return NextResponse.json({ ok: true });
}
