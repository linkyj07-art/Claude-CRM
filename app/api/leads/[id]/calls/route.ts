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

  applyCallOutcome(params.id, body.outcome, body.disposition, attempt);
  return NextResponse.json({ id, attempt });
}
