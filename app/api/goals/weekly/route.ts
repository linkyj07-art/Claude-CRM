import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { agentWeekStart } from '@/lib/util';
import { getGoalProgress } from '@/lib/metrics';
import { WeeklyGoal } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const weekStart = searchParams.get('week') || agentWeekStart();

  const goal = db.prepare('SELECT * FROM weekly_goals WHERE week_start = ?').get(weekStart) as WeeklyGoal | undefined;
  const progress = getGoalProgress(db, 'weekly', weekStart);
  return NextResponse.json({ goal: goal || null, progress });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const weekStart = body.week_start || agentWeekStart();
  const db = getDb();
  db.prepare(
    `INSERT INTO weekly_goals (week_start, target_dials, target_appointments, target_ap) VALUES (?, ?, ?, ?)
     ON CONFLICT(week_start) DO UPDATE SET target_dials = excluded.target_dials, target_appointments = excluded.target_appointments, target_ap = excluded.target_ap`
  ).run(weekStart, body.target_dials ?? null, body.target_appointments ?? null, body.target_ap ?? null);
  return NextResponse.json({ ok: true });
}
