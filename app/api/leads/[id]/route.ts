import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logAudit, openDispute } from '@/lib/audit';
import { getCurrentUser } from '@/lib/currentUser';
import { ownsCustomer } from '@/lib/ownership';
import { addToDncRegistry } from '@/lib/dnc';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND owner_id = ?').get(params.id, user.id);
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const notes = db.prepare('SELECT * FROM note_versions WHERE customer_id = ? ORDER BY created_at DESC').all(params.id);
  const calls = db.prepare('SELECT * FROM calls WHERE customer_id = ? ORDER BY occurred_at DESC').all(params.id);
  const quotes = db.prepare('SELECT * FROM quotes WHERE customer_id = ? ORDER BY created_at DESC').all(params.id);
  const appointments = db.prepare('SELECT * FROM appointments WHERE customer_id = ? ORDER BY scheduled_at DESC').all(params.id);
  const applications = db.prepare('SELECT * FROM applications WHERE customer_id = ? ORDER BY submitted_at DESC').all(params.id);
  const policies = db.prepare('SELECT * FROM policies WHERE customer_id = ? ORDER BY created_at DESC').all(params.id);
  const commissions = db
    .prepare('SELECT * FROM commissions WHERE customer_id = ? ORDER BY created_at DESC')
    .all(params.id);
  const payments = db.prepare('SELECT * FROM payments WHERE customer_id = ? ORDER BY paid_at DESC').all(params.id);
  const referrals = db.prepare('SELECT * FROM referrals WHERE referrer_customer_id = ? ORDER BY created_at DESC').all(params.id);
  const audit = db.prepare('SELECT * FROM audit_history WHERE customer_id = ? ORDER BY occurred_at DESC').all(params.id);
  return NextResponse.json({ customer, notes, calls, quotes, appointments, applications, policies, commissions, payments, referrals, audit });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  if (!ownsCustomer(db, params.id, user.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const fields: string[] = [];
  const values: unknown[] = [];
  const allowed = [
    'status', 'archived', 'first_name', 'last_name', 'phone', 'email', 'dob', 'gender',
    'marital_status', 'military', 'military_branch', 'coverage_wanted', 'address', 'city',
    'state', 'postal_code', 'timezone', 'ad_type', 'platform', 'lead_vendor_id', 'best_time', 'lead_cost',
    'trusted_form_url', 'last_followed_up_at'
  ];
  for (const key of allowed) {
    if (key in body) {
      fields.push(`${key} = ?`);
      values.push(body[key]);
    }
  }
  if (fields.length === 0) return NextResponse.json({ ok: true });
  fields.push(`updated_at = datetime('now')`);
  values.push(params.id);
  db.prepare(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  if (body.status) {
    const labelMap: Record<string, string> = {
      invalid: 'Marked invalid / disputed with vendor',
      disputed: 'Disputed with vendor',
      dnc: 'Marked Do Not Call',
      archived: 'Archived',
      lost: 'Marked lost',
      working: 'Status set to working'
    };
    logAudit(params.id, 'status_change', labelMap[body.status] || `Status changed to ${body.status}`);
    if (body.status === 'disputed') openDispute(params.id, 'Disputed with vendor');
    if (body.status === 'dnc') {
      const customer = db.prepare('SELECT phone, first_name, last_name FROM customers WHERE id = ?').get(params.id) as
        { phone: string | null; first_name: string; last_name: string } | undefined;
      if (customer) addToDncRegistry(customer.phone, customer.first_name, customer.last_name, 'Marked Do Not Call', user.id);
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  if (!ownsCustomer(db, params.id, user.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  db.prepare('DELETE FROM customers WHERE id = ?').run(params.id);
  return NextResponse.json({ ok: true });
}
