import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';

// Referrals aren't reachable through ownsCustomer (that checks a customers.id
// against owner_id — a referral's id is its own row), so ownership is
// checked the same way disputes/duplicate_leads do it: join through to the
// referring customer's owner_id.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const referral = db
    .prepare(`SELECT r.id FROM referrals r JOIN customers c ON c.id = r.referrer_customer_id WHERE r.id = ? AND c.owner_id = ?`)
    .get(params.id, user.id);
  if (!referral) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const fields: string[] = [];
  const values: unknown[] = [];
  if ('referred_name' in body) { fields.push('referred_name = ?'); values.push(body.referred_name); }
  if ('value' in body) { fields.push('value = ?'); values.push(Number(body.value) || 0); }
  if (fields.length === 0) return NextResponse.json({ ok: true });
  values.push(params.id);
  db.prepare(`UPDATE referrals SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const referral = db
    .prepare(`SELECT r.id FROM referrals r JOIN customers c ON c.id = r.referrer_customer_id WHERE r.id = ? AND c.owner_id = ?`)
    .get(params.id, user.id);
  if (!referral) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  db.prepare('DELETE FROM referrals WHERE id = ?').run(params.id);
  return NextResponse.json({ ok: true });
}
