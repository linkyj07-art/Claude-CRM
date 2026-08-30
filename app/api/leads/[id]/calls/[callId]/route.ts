import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { applyCallOutcome } from '@/lib/audit';
import { getCurrentUser } from '@/lib/currentUser';
import { ownsCustomer } from '@/lib/ownership';

// Completes a call that was started as 'pending' when the agent tapped Call —
// updates the same row's outcome instead of creating a second one.
export async function PATCH(req: NextRequest, { params }: { params: { id: string; callId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  if (!ownsCustomer(db, params.id, user.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const call = db.prepare('SELECT attempt_number FROM calls WHERE id = ? AND customer_id = ?').get(params.callId, params.id) as { attempt_number: number } | undefined;
  if (!call) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  db.prepare('UPDATE calls SET outcome = ?, disposition = ?, duration_seconds = ? WHERE id = ?')
    .run(body.outcome, body.disposition || null, body.duration_seconds || 0, params.callId);

  applyCallOutcome(params.id, body.outcome, body.disposition, call.attempt_number, user.id);
  return NextResponse.json({ ok: true });
}

// "Didn't mean to dial" — removes a pending call entirely rather than
// leaving a misclicked dial in the history.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; callId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  if (!ownsCustomer(db, params.id, user.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  db.prepare('DELETE FROM calls WHERE id = ? AND customer_id = ?').run(params.callId, params.id);
  return NextResponse.json({ ok: true });
}
