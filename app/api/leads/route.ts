import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId, normalizePhone } from '@/lib/util';
import { logAudit, openDispute } from '@/lib/audit';
import { getCurrentUser } from '@/lib/currentUser';
import { findDncMatch } from '@/lib/dnc';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const q = searchParams.get('q');

  let sql = `SELECT c.*, v.name as vendor_name FROM customers c LEFT JOIN lead_vendors v ON v.id = c.lead_vendor_id WHERE c.owner_id = ?`;
  const params: unknown[] = [user.id];
  if (status) {
    sql += ` AND c.status = ?`;
    params.push(status);
  }
  if (q) {
    sql += ` AND (c.first_name || ' ' || c.last_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY c.purchased_at DESC LIMIT 500`;
  const rows = db.prepare(sql).all(...params);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const db = getDb();

  // Same phone-based duplicate check as the CSV import and Goat webhook
  // paths: catch a re-entered lead before it becomes a second customer
  // record, and open the vendor dispute immediately instead of losing track
  // of it.
  const phoneDigits = normalizePhone(body.phone);
  if (phoneDigits) {
    const existingCustomers = db
      .prepare('SELECT id, phone FROM customers WHERE owner_id = ? AND phone IS NOT NULL')
      .all(user.id) as { id: string; phone: string }[];
    const dupeMatch = existingCustomers.find((c) => normalizePhone(c.phone) === phoneDigits);
    if (dupeMatch) {
      const dupeId = newId();
      db.prepare(
        `INSERT INTO duplicate_leads (id, customer_id, first_name, last_name, phone, email, dob, state, raw_data, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(
        dupeId, dupeMatch.id, body.first_name || null, body.last_name || null, body.phone || null,
        body.email || null, body.dob || null, body.state || null, JSON.stringify(body), 'Manual entry'
      );
      openDispute(dupeMatch.id, 'Duplicate lead — same phone number added again');
      return NextResponse.json({ duplicate: true, matchedCustomerId: dupeMatch.id, duplicateId: dupeId });
    }
  }

  const id = newId();
  const dncMatch = findDncMatch(body.phone);
  db.prepare(
    `INSERT INTO customers (id, owner_id, first_name, last_name, phone, email, dob, gender, marital_status,
      military, military_branch, coverage_wanted, address, city, state, postal_code, timezone,
      ad_type, platform, lead_vendor_id, best_time, lead_cost, status, purchased_at, created_at, updated_at)
     VALUES (@id, @owner_id, @first_name, @last_name, @phone, @email, @dob, @gender, @marital_status,
      @military, @military_branch, @coverage_wanted, @address, @city, @state, @postal_code, @timezone,
      @ad_type, @platform, @lead_vendor_id, @best_time, @lead_cost, @status, datetime('now'), datetime('now'), datetime('now'))`
  ).run({
    id,
    owner_id: user.id,
    first_name: body.first_name || 'New',
    last_name: body.last_name || 'Lead',
    phone: body.phone || null,
    status: dncMatch ? 'dnc' : 'fresh',
    email: body.email || null,
    dob: body.dob || null,
    gender: body.gender || null,
    marital_status: body.marital_status || null,
    military: body.military ? 1 : 0,
    military_branch: body.military_branch || null,
    coverage_wanted: body.coverage_wanted ? Number(body.coverage_wanted) : null,
    address: body.address || null,
    city: body.city || null,
    state: body.state || null,
    postal_code: body.postal_code || null,
    timezone: body.timezone || null,
    ad_type: body.ad_type || 'Final Expense',
    platform: body.platform || null,
    lead_vendor_id: body.lead_vendor_id || null,
    best_time: body.best_time || null,
    lead_cost: body.lead_cost ? Number(body.lead_cost) : 0
  });
  logAudit(id, 'lead_purchased', `Lead added — ${body.ad_type || 'Final Expense'} / ${body.platform || 'manual entry'}`);
  if (dncMatch) {
    return NextResponse.json({
      id,
      dncMatch: true,
      dncReason: dncMatch.reason,
      dncSince: dncMatch.created_at
    });
  }
  return NextResponse.json({ id });
}

// Bulk delete: { ids: string[] } deletes just those leads; { all: true }
// deletes every lead the CALLER owns. Both are scoped to the logged-in
// user's own leads and are permanent (cascades to notes, calls, quotes,
// appointments, etc. via ON DELETE CASCADE) — the client is responsible
// for confirming with the user before calling this, especially for "all".
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const db = getDb();

  if (body.all === true) {
    const result = db.prepare('DELETE FROM customers WHERE owner_id = ?').run(user.id);
    return NextResponse.json({ deleted: result.changes });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === 'string') : [];
  if (ids.length === 0) return NextResponse.json({ error: 'No lead ids provided.' }, { status: 400 });

  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM customers WHERE owner_id = ? AND id IN (${placeholders})`).run(user.id, ...ids);
  return NextResponse.json({ deleted: result.changes });
}
