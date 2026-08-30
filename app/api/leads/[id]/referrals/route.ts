import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId } from '@/lib/util';
import { logAudit } from '@/lib/audit';
import { getCurrentUser } from '@/lib/currentUser';
import { ownsCustomer } from '@/lib/ownership';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  if (!ownsCustomer(db, params.id, user.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const referredName = typeof body.referred_name === 'string' ? body.referred_name.trim() : '';
  if (!referredName) return NextResponse.json({ error: 'Enter the referred person\'s name.' }, { status: 400 });

  const value = body.value ? Number(body.value) || 0 : 0;
  const id = newId();
  db.prepare(
    `INSERT INTO referrals (id, referrer_customer_id, referred_name, value, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(id, params.id, referredName, value);

  logAudit(params.id, 'referral', `Referred ${referredName}${value ? ` — ${value}` : ''}`);
  return NextResponse.json({ id });
}
