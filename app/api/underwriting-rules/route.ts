import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId } from '@/lib/util';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();
  const id = newId();
  db.prepare(
    `INSERT INTO carrier_underwriting_rules (id, carrier_id, keywords, tier_note, priority, is_knockout)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, body.carrier_id, body.keywords, body.tier_note || null, body.priority || 0, body.is_knockout ? 1 : 0);
  return NextResponse.json({ id });
}
