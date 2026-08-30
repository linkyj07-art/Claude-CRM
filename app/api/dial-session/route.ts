import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';
import { isWithinCallingHours, isTestLead } from '@/lib/util';
import { DialSessionRow, serializeDialSession as serialize } from '@/lib/dialSession';
import { fetchEligibleLeads } from '@/lib/dialQueue';

type Db = ReturnType<typeof getDb>;

// A lead queued while its state was inside the calling window can age out of
// that window before Power Dial actually reaches it (deep queue, or a state
// whose window closes early). Rather than only catching that once the agent
// lands on the lead's page — which flashed a visible "skipping…" card —
// every read/write of the queue drops anything that's gone out of hours in
// the meantime, so the agent never sees a dead-on-arrival lead at all.
function dropOutOfHours(db: Db, ids: string[]): string[] {
  if (ids.length === 0) return ids;
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, state, first_name, last_name FROM customers WHERE id IN (${placeholders})`).all(...ids) as
    { id: string; state: string | null; first_name: string; last_name: string }[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.filter((id) => {
    const c = byId.get(id);
    return !!c && (isTestLead(c) || isWithinCallingHours(c.state));
  });
}

// A single Power Dial session per user, persisted server-side, is what lets
// a second device (phone alongside laptop) follow the exact same queue
// instead of building its own — LeadWorkspace polls this while dialing and
// jumps to match currentLeadId whenever it changes, so a disposition logged
// on one device carries the other one along within a few seconds.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const db = getDb();
  const row = db.prepare('SELECT * FROM dial_sessions WHERE user_id = ?').get(user.id) as DialSessionRow | undefined;
  let newLeads: { id: string; firstName: string; lastName: string; phone: string | null }[] = [];
  if (row) {
    const queue = row.queue ? row.queue.split(',').filter(Boolean) : [];
    const recycle = row.recycle ? row.recycle.split(',').filter(Boolean) : [];
    const cleanQueue = dropOutOfHours(db, queue);
    const cleanRecycle = dropOutOfHours(db, recycle);
    if (cleanQueue.length !== queue.length || cleanRecycle.length !== recycle.length) {
      db.prepare(`UPDATE dial_sessions SET queue = ?, recycle = ?, updated_at = datetime('now') WHERE user_id = ?`)
        .run(cleanQueue.join(','), cleanRecycle.join(','), user.id);
      row.queue = cleanQueue.join(',');
      row.recycle = cleanRecycle.join(',');
    }

    // Leads that just became dialable since this session's queue was built
    // (a fresh import/drip, or a state's calling window just opening) never
    // show up on their own — the queue is a frozen snapshot otherwise. The
    // client shows these as a "new lead ready" banner and lets the agent
    // decide whether to work it in now or queue it up next, rather than
    // silently reordering their in-progress session for them.
    const known = new Set([row.current_lead_id, ...cleanQueue, ...cleanRecycle].filter(Boolean) as string[]);
    newLeads = fetchEligibleLeads(db, user.id)
      .filter((c) => !known.has(c.id))
      .map((c) => ({ id: c.id, firstName: c.first_name, lastName: c.last_name, phone: c.phone }));
  }
  return NextResponse.json({ ...serialize(row), newLeads });
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
  const cleanQueue = dropOutOfHours(db, queue);
  const cleanRecycle = dropOutOfHours(db, recycle);
  db.prepare(
    `INSERT INTO dial_sessions (user_id, current_lead_id, queue, recycle, pass, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       current_lead_id = excluded.current_lead_id, queue = excluded.queue,
       recycle = excluded.recycle, pass = excluded.pass, updated_at = excluded.updated_at`
  ).run(user.id, currentLeadId, cleanQueue.join(','), cleanRecycle.join(','), pass);

  const row = db.prepare('SELECT * FROM dial_sessions WHERE user_id = ?').get(user.id) as DialSessionRow;
  return NextResponse.json(serialize(row));
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  getDb().prepare('DELETE FROM dial_sessions WHERE user_id = ?').run(user.id);
  return NextResponse.json({ ok: true });
}
