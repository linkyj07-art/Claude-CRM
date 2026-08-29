import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId } from '@/lib/util';
import { logAudit, touchCustomer } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const db = getDb();
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
  const body = await req.json();
  const db = getDb();
  if (!body.appointment_id) return NextResponse.json({ error: 'appointment_id required' }, { status: 400 });
  db.prepare(`UPDATE appointments SET status = ? WHERE id = ? AND customer_id = ?`).run(body.status, body.appointment_id, params.id);
  logAudit(params.id, 'appointment', `Appointment marked ${body.status.replace('_', ' ')}`);
  return NextResponse.json({ ok: true });
}
