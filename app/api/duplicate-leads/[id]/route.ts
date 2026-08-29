import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  db.prepare('DELETE FROM duplicate_leads WHERE id = ?').run(params.id);
  return NextResponse.json({ ok: true });
}
