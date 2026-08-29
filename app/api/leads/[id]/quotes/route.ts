import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId } from '@/lib/util';
import { logAudit, touchCustomer } from '@/lib/audit';
import { getCurrentUser } from '@/lib/currentUser';
import { ownsCustomer } from '@/lib/ownership';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  if (!ownsCustomer(db, params.id, user.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const id = newId();
  db.prepare(
    `INSERT INTO quotes (id, customer_id, carrier, product, face_amount, monthly_premium, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, params.id, body.carrier || null, body.product || null, body.face_amount || null, body.monthly_premium || null, body.notes || null);
  logAudit(params.id, 'quote', `Quote run — ${body.carrier || 'carrier TBD'} $${body.face_amount || 0} / $${body.monthly_premium || 0} mo`);
  touchCustomer(params.id);
  return NextResponse.json({ id });
}
