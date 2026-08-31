import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId } from '@/lib/util';
import { getCurrentUser } from '@/lib/currentUser';

// Vendors themselves are shared by the whole team (same as carriers), but the
// lead counts / spend returned alongside each one are scoped to the caller's
// own book of business, matching how Analytics reports per-vendor ROI.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const rows = db.prepare(
    `SELECT v.id, v.name, v.notes, v.default_lead_cost, v.created_at,
       (SELECT COUNT(*) FROM customers c WHERE c.lead_vendor_id = v.id AND c.owner_id = @ownerId) AS lead_count,
       (SELECT COALESCE(SUM(c.lead_cost), 0) FROM customers c WHERE c.lead_vendor_id = v.id AND c.owner_id = @ownerId) AS total_spend,
       (SELECT COUNT(*) FROM customers c WHERE c.lead_vendor_id = v.id AND c.owner_id = @ownerId AND (c.lead_cost IS NULL OR c.lead_cost = 0)) AS uncosted_count
     FROM lead_vendors v ORDER BY v.name COLLATE NOCASE`
  ).all({ ownerId: user.id });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Vendor name is required.' }, { status: 400 });

  const db = getDb();
  const existing = db.prepare('SELECT id FROM lead_vendors WHERE name = ? COLLATE NOCASE').get(name) as { id: string } | undefined;
  if (existing) return NextResponse.json({ error: 'A vendor with that name already exists.' }, { status: 409 });

  const cost = body.default_lead_cost === '' || body.default_lead_cost === null || body.default_lead_cost === undefined
    ? null
    : Number(body.default_lead_cost);
  if (cost !== null && (!isFinite(cost) || cost < 0)) {
    return NextResponse.json({ error: 'Default lead cost must be a positive number.' }, { status: 400 });
  }

  const id = newId();
  db.prepare('INSERT INTO lead_vendors (id, name, default_lead_cost) VALUES (?, ?, ?)').run(id, name, cost);
  return NextResponse.json({ id });
}
