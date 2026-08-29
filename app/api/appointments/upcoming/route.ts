import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Feeds the on-screen reminder popup. Returns scheduled appointments in a
// window around "now" and lets the client (which knows its own local clock,
// the same clock the datetime-local input used when the appointment was
// booked) decide exactly which ones are due.
export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.id, a.customer_id, a.scheduled_at, a.type, c.first_name, c.last_name
       FROM appointments a JOIN customers c ON c.id = a.customer_id
       WHERE a.status = 'scheduled'
       ORDER BY a.scheduled_at ASC LIMIT 200`
    )
    .all();
  return NextResponse.json(rows);
}
