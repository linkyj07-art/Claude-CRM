import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const db = getDb();
  db.prepare(
    `UPDATE carrier_underwriting_rules SET keywords = ?, tier_note = ?, priority = ?, is_knockout = ? WHERE id = ?`
  ).run(body.keywords, body.tier_note || null, body.priority || 0, body.is_knockout ? 1 : 0, params.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  db.prepare('DELETE FROM carrier_underwriting_rules WHERE id = ?').run(params.id);
  return NextResponse.json({ ok: true });
}
