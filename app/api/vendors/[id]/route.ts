import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const vendor = db.prepare('SELECT id, default_lead_cost FROM lead_vendors WHERE id = ?').get(params.id) as
    { id: string; default_lead_cost: number | null } | undefined;
  if (!vendor) return NextResponse.json({ error: 'Vendor not found.' }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  if (body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return NextResponse.json({ error: 'Vendor name cannot be empty.' }, { status: 400 });
    const clash = db.prepare('SELECT id FROM lead_vendors WHERE name = ? COLLATE NOCASE AND id != ?').get(name, params.id);
    if (clash) return NextResponse.json({ error: 'Another vendor already has that name.' }, { status: 409 });
    db.prepare('UPDATE lead_vendors SET name = ? WHERE id = ?').run(name, params.id);
  }

  let newCost = vendor.default_lead_cost;
  if (body.default_lead_cost !== undefined) {
    newCost = body.default_lead_cost === '' || body.default_lead_cost === null ? null : Number(body.default_lead_cost);
    if (newCost !== null && (!isFinite(newCost) || newCost < 0)) {
      return NextResponse.json({ error: 'Default lead cost must be a positive number.' }, { status: 400 });
    }
    db.prepare('UPDATE lead_vendors SET default_lead_cost = ? WHERE id = ?').run(newCost, params.id);
  }

  // Optionally push the default onto this vendor's already-imported leads
  // that came in with no cost — scoped to the caller's own leads only, so
  // one agent's backfill never rewrites a teammate's numbers.
  let applied = 0;
  if (body.apply_to_uncosted === true && newCost !== null && newCost > 0) {
    const result = db.prepare(
      `UPDATE customers SET lead_cost = ?, updated_at = datetime('now')
       WHERE owner_id = ? AND lead_vendor_id = ? AND (lead_cost IS NULL OR lead_cost = 0)`
    ).run(newCost, user.id, params.id);
    applied = result.changes;
  }

  return NextResponse.json({ ok: true, applied });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const vendor = db.prepare('SELECT id FROM lead_vendors WHERE id = ?').get(params.id);
  if (!vendor) return NextResponse.json({ error: 'Vendor not found.' }, { status: 404 });

  // Leads keep their recorded lead_cost — they just lose the vendor tag
  // (grouped as "Unassigned" in Analytics from then on).
  const removeVendor = db.transaction(() => {
    db.prepare(`UPDATE customers SET lead_vendor_id = NULL, updated_at = datetime('now') WHERE lead_vendor_id = ?`).run(params.id);
    db.prepare('DELETE FROM lead_vendors WHERE id = ?').run(params.id);
  });
  removeVendor();
  return NextResponse.json({ ok: true });
}
