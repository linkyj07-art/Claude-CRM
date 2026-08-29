import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(req: NextRequest) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, status FROM customers
       WHERE archived = 0 AND status IN ('fresh','working','aging_45_90')
       ORDER BY CASE status WHEN 'fresh' THEN 0 WHEN 'working' THEN 1 ELSE 2 END, purchased_at ASC`
    )
    .all() as { id: string; status: string }[];

  const url = new URL(req.url);
  if (rows.length === 0) {
    return NextResponse.redirect(new URL('/leads?empty=1', url));
  }
  const [first, ...rest] = rows;
  const queue = rest.map((r) => r.id).join(',');
  const dest = new URL(`/leads/${first.id}`, url);
  if (queue) dest.searchParams.set('queue', queue);
  dest.searchParams.set('dialing', '1');
  return NextResponse.redirect(dest);
}
