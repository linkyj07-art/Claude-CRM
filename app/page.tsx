import Link from 'next/link';
import { getDb } from '@/lib/db';
import StatCard from '@/components/StatCard';
import { fmtMoney, fmtMoney0, fmtPct, agentDateStr, agentWeekStart } from '@/lib/util';
import { getMoneyTiles, getActivityStats, getConversionRates, getLeadEconomics, getGoalProgress, Period } from '@/lib/metrics';
import { DailyGoal, WeeklyGoal } from '@/lib/types';

function GoalBar({ label, actual, target }: { label: string; actual: number; target: number | null; }) {
  if (!target || target <= 0) return null;
  const pct = Math.min(100, Math.round((actual / target) * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-500">{label}</span>
        <span className="text-slate-400">{actual} / {target}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';

const PERIOD_LABEL: Record<Period, string> = { today: 'Today', week: 'Last 7 Days', month: 'Last 30 Days', all: 'All Time' };

export default function DashboardPage({ searchParams }: { searchParams: { period?: string } }) {
  const db = getDb();
  const period = (['today', 'week', 'month', 'all'].includes(searchParams.period || '') ? searchParams.period : 'today') as Period;

  const money = getMoneyTiles(db);
  const activity = getActivityStats(db, period);
  const conversion = getConversionRates(activity);
  const leadEcon = getLeadEconomics(db, activity, period);

  const freshCount = (db.prepare(`SELECT COUNT(*) n FROM customers WHERE status = 'fresh' AND archived = 0`).get() as { n: number }).n;
  const workingCount = (db.prepare(`SELECT COUNT(*) n FROM customers WHERE status IN ('working','aging_45_90') AND archived = 0`).get() as { n: number }).n;

  const today = agentDateStr();
  const weekStart = agentWeekStart();
  const dailyGoal = db.prepare('SELECT * FROM daily_goals WHERE date = ?').get(today) as DailyGoal | undefined;
  const weeklyGoal = db.prepare('SELECT * FROM weekly_goals WHERE week_start = ?').get(weekStart) as WeeklyGoal | undefined;

  const dailyProgress = getGoalProgress(db, 'daily', today);
  const weeklyProgress = getGoalProgress(db, 'weekly', weekStart);
  const hasAnyGoal = !!(dailyGoal?.target_dials || dailyGoal?.target_appointments || dailyGoal?.target_ap || weeklyGoal?.target_dials || weeklyGoal?.target_appointments || weeklyGoal?.target_ap);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Production Dashboard</h1>
          <p className="text-sm text-slate-500">{freshCount} fresh leads · {workingCount} in progress right now</p>
        </div>
        <div className="flex gap-2">
          <a href="/dial" className="btn-primary">⚡ Power Dial</a>
          <Link href="/leads" className="btn-secondary">View Leads</Link>
        </div>
      </div>

      {hasAnyGoal && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(weeklyGoal?.target_dials || weeklyGoal?.target_appointments || weeklyGoal?.target_ap) && (
            <div className="card space-y-2 p-4">
              <div className="label">🗓️ This Week&apos;s Goals</div>
              <GoalBar label="Dials" actual={weeklyProgress.dials} target={weeklyGoal?.target_dials ?? null} />
              <GoalBar label="Appointments" actual={weeklyProgress.appointments} target={weeklyGoal?.target_appointments ?? null} />
              <GoalBar label="AP" actual={weeklyProgress.ap} target={weeklyGoal?.target_ap ?? null} />
            </div>
          )}
          {(dailyGoal?.target_dials || dailyGoal?.target_appointments || dailyGoal?.target_ap) && (
            <div className="card space-y-2 p-4">
              <div className="label">☀️ Today&apos;s Goals</div>
              <GoalBar label="Dials" actual={dailyProgress.dials} target={dailyGoal?.target_dials ?? null} />
              <GoalBar label="Appointments" actual={dailyProgress.appointments} target={dailyGoal?.target_appointments ?? null} />
              <GoalBar label="AP" actual={dailyProgress.ap} target={dailyGoal?.target_ap ?? null} />
            </div>
          )}
        </section>
      )}

      {/* MONEY */}
      <section>
        <div className="mb-2 label">💰 Money</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Today's Commission" value={fmtMoney(money.today)} tone="good" icon="💵" />
          <StatCard label="This Week" value={fmtMoney(money.week)} tone="good" icon="📆" />
          <StatCard label="This Month" value={fmtMoney(money.month)} tone="good" icon="📈" />
          <StatCard label="Pending" value={fmtMoney(money.pending)} icon="⏳" />
          <StatCard label="Net" value={fmtMoney(money.net)} tone="good" icon="🏆" />
        </div>
      </section>

      <div className="flex items-center gap-2">
        {(['today', 'week', 'month', 'all'] as Period[]).map((p) => (
          <a
            key={p}
            href={`/?period=${p}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${period === p ? 'bg-brand-500 text-white' : 'bg-panel2 border border-line text-slate-600 hover:bg-slate-100'}`}
          >
            {PERIOD_LABEL[p]}
          </a>
        ))}
        <span className="text-xs text-slate-400">— activity, conversion &amp; lead economics below</span>
      </div>

      {/* ACTIVITY */}
      <section>
        <div className="mb-2 label">📞 Activity ({PERIOD_LABEL[period]})</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Calls" value={String(activity.calls)} />
          <StatCard label="Contacts" value={String(activity.contacts)} />
          <StatCard label="Conversations" value={String(activity.conversations)} />
          <StatCard label="Appointments" value={String(activity.appointments)} />
          <StatCard label="Applications" value={String(activity.applications)} />
          <StatCard label="Issued" value={String(activity.issued)} tone="good" />
        </div>
      </section>

      {/* CONVERSION */}
      <section>
        <div className="mb-2 label">📈 Conversion</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Contact Rate" value={fmtPct(conversion.contactRate)} />
          <StatCard label="Appointment Rate" value={fmtPct(conversion.appointmentRate)} />
          <StatCard label="Application Rate" value={fmtPct(conversion.applicationRate)} />
          <StatCard label="Issue Rate" value={fmtPct(conversion.issueRate)} />
        </div>
      </section>

      {/* LEAD ECONOMICS */}
      <section>
        <div className="mb-2 label">💳 Lead Economics</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Lead Spend" value={fmtMoney0(leadEcon.leadSpend)} />
          <StatCard label="Cost / Lead" value={leadEcon.costPerLead !== null ? fmtMoney(leadEcon.costPerLead) : '—'} />
          <StatCard label="Cost / Issued" value={leadEcon.costPerIssued !== null ? fmtMoney0(leadEcon.costPerIssued) : '—'} />
          <StatCard label="Net Commission" value={fmtMoney0(leadEcon.netCommission)} tone="good" />
          <StatCard label="ROI" value={leadEcon.roi !== null ? `${leadEcon.roi.toFixed(0)}%` : '—'} tone={leadEcon.roi !== null && leadEcon.roi >= 0 ? 'good' : 'bad'} />
        </div>
      </section>

      <div className="card p-4 text-sm text-slate-500">
        Want the full pipeline, cost-per-stage breakdown, and ROI by vendor / lead age / state / source?
        See <Link href="/analytics" className="font-medium text-brand-600 hover:underline">Analytics →</Link>
      </div>
    </div>
  );
}
