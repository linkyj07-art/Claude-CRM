import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';

export const dynamic = 'force-dynamic';

// Feeds the incoming-call popup. Only the last few minutes, and only calls
// for leads this agent owns — an old row from a call that already ended, or
// a teammate's lead ringing on their line, shouldn't pop up here.
const RECENT_WINDOW_MINUTES = 3;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ic.id, ic.customer_id, ic.phone, ic.created_at, c.first_name, c.last_name
       FROM incoming_calls ic JOIN customers c ON c.id = ic.customer_id
       WHERE c.owner_id = ? AND ic.created_at >= datetime('now', ?)
       ORDER BY ic.created_at DESC LIMIT 20`
    )
    .all(user.id, `-${RECENT_WINDOW_MINUTES} minutes`);
  return NextResponse.json(rows);
}
