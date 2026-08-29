import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { agentDateStr } from '@/lib/util';
import { getGoalProgress } from '@/lib/metrics';
import { DailyGoal } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date') || agentDateStr();

  const goal = db.prepare('SELECT * FROM daily_goals WHERE date = ?').get(date) as DailyGoal | undefined;
  const progress = getGoalProgress(db, 'daily', date);
  return NextResponse.json({ goal: goal || null, progress });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const date = body.date || agentDateStr();
  const db = getDb();
  db.prepare(
    `INSERT INTO daily_goals (date, target_dials, target_appointments, target_ap) VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET target_dials = excluded.target_dials, target_appointments = excluded.target_appointments, target_ap = excluded.target_ap`
  ).run(date, body.target_dials ?? null, body.target_appointments ?? null, body.target_ap ?? null);
  return NextResponse.json({ ok: true });
}
