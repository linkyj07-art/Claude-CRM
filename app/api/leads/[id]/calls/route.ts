import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId, callsToday, MAX_CALLS_PER_DAY } from '@/lib/util';
import { applyCallOutcome } from '@/lib/audit';
import { getCurrentUser } from '@/lib/currentUser';
import { ownsCustomer } from '@/lib/ownership';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  if (!ownsCustomer(db, params.id, user.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();

  // The client already guards against a second pending call via its own
  // pendingCallId state, but that's just one browser tab's memory -- two
  // devices sharing the same Power Dial session (explicitly supported),
  // or a manual Call click landing while Auto-Dial's own dial is mid-
  // flight, can both pass that check before either response comes back.
  // Enforcing "one pending call per lead" here, at the actual insert, is
  // what makes it not a race: hand back the SAME pending call's id rather
  // than create a second, orphaned one that never gets dispositioned.
  if (body.outcome === 'pending') {
    const existingPending = db
      .prepare(`SELECT id, attempt_number FROM calls WHERE customer_id = ? AND outcome = 'pending' ORDER BY occurred_at DESC LIMIT 1`)
      .get(params.id) as { id: string; attempt_number: number } | undefined;
    if (existingPending) {
      return NextResponse.json({ id: existingPending.id, attempt: existingPending.attempt_number, alreadyPending: true });
    }
  }

  const countRow = db
    .prepare('SELECT COUNT(*) n FROM calls WHERE customer_id = ?')
    .get(params.id) as { n: number };
  const attempt = countRow.n + 1;

  // DNC is a compliance stop, not another dial attempt — it's always allowed through.
  if (body.outcome !== 'dnc') {
    const recentCalls = db
      .prepare('SELECT occurred_at FROM calls WHERE customer_id = ? AND occurred_at >= datetime(?, \'-2 days\')')
      .all(params.id, new Date().toISOString()) as { occurred_at: string }[];
    if (callsToday(recentCalls) >= MAX_CALLS_PER_DAY) {
      return NextResponse.json({ error: `Already called this lead ${MAX_CALLS_PER_DAY} times today.` }, { status: 429 });
    }
  }
  const id = newId();
  db.prepare(
    `INSERT INTO calls (id, customer_id, direction, attempt_number, outcome, disposition, duration_seconds, notes, occurred_at)
     VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, datetime('now'))`
  ).run(id, params.id, attempt, body.outcome, body.disposition || null, body.duration_seconds || 0, body.notes || null);

  applyCallOutcome(params.id, body.outcome, body.disposition, attempt, user.id);
  return NextResponse.json({ id, attempt });
}
