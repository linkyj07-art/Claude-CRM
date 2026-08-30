import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const db = getDb();
  db.prepare('UPDATE quick_links SET category = ?, label = ?, url = ? WHERE id = ?').run(
    body.category || 'general', body.label, body.url, params.id
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  db.prepare('DELETE FROM quick_links WHERE id = ?').run(params.id);
  return NextResponse.json({ ok: true });
}
