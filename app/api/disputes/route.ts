import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT d.*, c.first_name, c.last_name, c.phone, c.lead_cost, v.name as vendor_name
       FROM disputes d
       JOIN customers c ON c.id = d.customer_id
       LEFT JOIN lead_vendors v ON v.id = c.lead_vendor_id
       WHERE c.owner_id = ?
       ORDER BY CASE d.status WHEN 'open' THEN 0 WHEN 'submitted' THEN 1 ELSE 2 END, d.created_at DESC`
    )
    .all(user.id);
  return NextResponse.json(rows);
}
