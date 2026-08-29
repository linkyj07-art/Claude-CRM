import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId } from '@/lib/util';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();
  const id = newId();
  const maxOrder = (db.prepare('SELECT MAX(sort_order) m FROM quick_links WHERE category = ?').get(body.category || 'general') as { m: number | null }).m ?? -1;
  db.prepare('INSERT INTO quick_links (id, category, label, url, sort_order) VALUES (?, ?, ?, ?, ?)').run(
    id, body.category || 'general', body.label, body.url, maxOrder + 1
  );
  return NextResponse.json({ id });
}
