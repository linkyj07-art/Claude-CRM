import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'licensed_states'`).get() as { value: string } | undefined;
  const states: string[] = row ? JSON.parse(row.value) : [];
  return NextResponse.json({ states });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const states = Array.isArray(body.states) ? body.states.filter((s: unknown) => typeof s === 'string') : [];
  const db = getDb();
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('licensed_states', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(JSON.stringify(states));
  return NextResponse.json({ states });
}
