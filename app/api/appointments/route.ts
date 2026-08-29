import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Appointments across all leads, for the /calendar view. `month` is YYYY-MM;
// defaults to the current month. scheduled_at is stored as the raw
// datetime-local string the agent typed (no timezone), so this is a simple
// text-prefix match, same convention as everywhere else that touches it.
export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);

  const rows = db
    .prepare(
      `SELECT a.*, c.first_name, c.last_name, c.phone
       FROM appointments a JOIN customers c ON c.id = a.customer_id
       WHERE a.scheduled_at LIKE ?
       ORDER BY a.scheduled_at ASC`
    )
    .all(`${month}%`);
  return NextResponse.json(rows);
}
