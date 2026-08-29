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
    `INSERT INTO appointments (id, customer_id, scheduled_at, type, status, notes)
     VALUES (?, ?, ?, ?, 'scheduled', ?)`
  ).run(id, params.id, body.scheduled_at, body.type || 'phone', body.notes || null);
  logAudit(params.id, 'appointment', `Appointment set for ${body.scheduled_at}`);
  db.prepare(`UPDATE customers SET status = 'working' WHERE id = ? AND status NOT IN ('sold')`).run(params.id);
  touchCustomer(params.id);
  return NextResponse.json({ id });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  if (!ownsCustomer(db, params.id, user.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  if (!body.appointment_id) return NextResponse.json({ error: 'appointment_id required' }, { status: 400 });
  db.prepare(`UPDATE appointments SET status = ? WHERE id = ? AND customer_id = ?`).run(body.status, body.appointment_id, params.id);
  logAudit(params.id, 'appointment', `Appointment marked ${body.status.replace('_', ' ')}`);
  return NextResponse.json({ ok: true });
}
