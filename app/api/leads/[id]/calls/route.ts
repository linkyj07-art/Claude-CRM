import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId, callsToday, MAX_CALLS_PER_DAY } from '@/lib/util';
import { logAudit, touchCustomer } from '@/lib/audit';

const OUTCOME_LABEL: Record<string, string> = {
  no_answer: 'No Answer',
  voicemail: 'Voicemail',
  connected: 'Connected',
  busy: 'Busy',
  wrong_number: 'Wrong Number',
  dnc: 'Requested DNC'
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const db = getDb();
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

  const outcomeLabel = OUTCOME_LABEL[body.outcome] || body.outcome;
  logAudit(params.id, 'call', `Call attempt #${attempt} — ${outcomeLabel}${body.disposition ? ` (${body.disposition})` : ''}`);

  // Auto status nudges
  if (body.outcome === 'dnc') {
    db.prepare(`UPDATE customers SET status = 'dnc' WHERE id = ?`).run(params.id);
  } else if (body.outcome === 'wrong_number' && attempt >= 2) {
    db.prepare(`UPDATE customers SET status = 'invalid' WHERE id = ?`).run(params.id);
  } else if (body.outcome === 'connected' && body.disposition) {
    const map: Record<string, string> = {
      not_interested: 'lost', unqualified: 'lost', qualified: 'working',
      interested: 'working', callback: 'working', sold: 'sold'
    };
    if (map[body.disposition]) {
      db.prepare(`UPDATE customers SET status = ? WHERE id = ?`).run(map[body.disposition], params.id);
    }
  }
  touchCustomer(params.id);
  return NextResponse.json({ id, attempt });
}
