import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId } from '@/lib/util';
import { getCurrentUser } from '@/lib/currentUser';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const carriers = db.prepare('SELECT * FROM carriers ORDER BY sort_order, name').all();
  const rules = db.prepare('SELECT * FROM carrier_underwriting_rules ORDER BY created_at').all();
  return NextResponse.json({ carriers, rules });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const db = getDb();
  const id = newId();
  const maxOrder = (db.prepare('SELECT MAX(sort_order) m FROM carriers').get() as { m: number | null }).m ?? -1;
  db.prepare(
    `INSERT INTO carriers (id, name, agent_portal_url, application_url, claims_url, support_phone, notes, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, body.name, body.agent_portal_url || null, body.application_url || null, body.claims_url || null, body.support_phone || null, body.notes || null, maxOrder + 1);
  return NextResponse.json({ id });
}
