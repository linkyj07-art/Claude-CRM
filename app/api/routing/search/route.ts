import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const bank = (searchParams.get('bank') || '').trim();
  const state = (searchParams.get('state') || '').trim();

  if (!bank && !state) return NextResponse.json([]);

  let sql = 'SELECT * FROM routing_lookup WHERE 1=1';
  const params: unknown[] = [];
  if (bank) {
    sql += ' AND bank_name LIKE ?';
    params.push(`%${bank}%`);
  }
  if (state) {
    sql += ' AND state = ?';
    params.push(state);
  }
  sql += ' ORDER BY bank_name LIMIT 25';
  const rows = db.prepare(sql).all(...params);
  return NextResponse.json(rows);
}
