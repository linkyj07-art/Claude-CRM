import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { agentDateStr } from '@/lib/util';
import { getGoalProgress } from '@/lib/metrics';
import { DailyGoal } from '@/lib/types';
import { getCurrentUser } from '@/lib/currentUser';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date') || agentDateStr();

  const goal = db.prepare('SELECT * FROM daily_goals WHERE date = ? AND user_id = ?').get(date, user.id) as DailyGoal | undefined;
  const progress = getGoalProgress(db, 'daily', date, user.id);
  return NextResponse.json({ goal: goal || null, progress });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const date = body.date || agentDateStr();
  const db = getDb();
  db.prepare(
    `INSERT INTO daily_goals (date, user_id, target_dials, target_appointments, target_ap) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date, user_id) DO UPDATE SET target_dials = excluded.target_dials, target_appointments = excluded.target_appointments, target_ap = excluded.target_ap`
  ).run(date, user.id, body.target_dials ?? null, body.target_appointments ?? null, body.target_ap ?? null);
  return NextResponse.json({ ok: true });
}
