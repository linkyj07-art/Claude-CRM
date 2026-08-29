import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const db = getDb();
  db.prepare(
    `UPDATE carriers SET name = ?, agent_portal_url = ?, application_url = ?, claims_url = ?, support_phone = ?, notes = ? WHERE id = ?`
  ).run(body.name, body.agent_portal_url || null, body.application_url || null, body.claims_url || null, body.support_phone || null, body.notes || null, params.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  db.prepare('DELETE FROM carriers WHERE id = ?').run(params.id);
  return NextResponse.json({ ok: true });
}
