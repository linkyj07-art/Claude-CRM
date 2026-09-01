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
  // A live bank-name search stays capped tight -- typing more narrows it
  // further, so 25 is plenty. Browsing by state alone is different: the
  // whole point is "show me every bank on file for this state," and a
  // bigger state (Texas alone has ~900 entries in the current sheet) was
  // getting silently truncated to the alphabetically-first 25 with no
  // indication anything was missing. 2000 comfortably covers every state's
  // real count while still bounding a pathological query.
  sql += bank ? ' ORDER BY bank_name LIMIT 25' : ' ORDER BY bank_name LIMIT 2000';
  const rows = db.prepare(sql).all(...params);
  return NextResponse.json(rows);
}
