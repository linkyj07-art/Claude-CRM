import Link from 'next/link';
import { getDb } from '@/lib/db';
import StatCard from '@/components/StatCard';
import { fmtMoney, fmtMoney0, fmtPct, agentDateStr, agentWeekStart, agentHour } from '@/lib/util';
import { getMoneyTiles, getActivityStats, getConversionRates, getLeadEconomics, getGoalProgress, getDailyTrend, Period } from '@/lib/metrics';
import { DailyGoal, WeeklyGoal, LeadVendor } from '@/lib/types';
import { quoteOfTheDay } from '@/lib/quotes';
import { getCurrentUser } from '@/lib/currentUser';
import { redirect } from 'next/navigation';
import LineChart from '@/components/charts/LineChart';

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

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default async function DashboardPage({ searchParams }: { searchParams: { period?: string; vendor?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = getDb();
  const period = (['today', 'week', 'month', 'all'].includes(searchParams.period || '') ? searchParams.period : 'today') as Period;
  const vendorId = searchParams.vendor || undefined;
  const vendors = db.prepare('SELECT * FROM lead_vendors ORDER BY name').all() as LeadVendor[];

  const money = getMoneyTiles(db, user.id);
  const activity = getActivityStats(db, period, user.id, vendorId);
  const conversion = getConversionRates(activity);
  const leadEcon = getLeadEconomics(db, activity, period, user.id, vendorId);

  const freshCount = (db.prepare(`SELECT COUNT(*) n FROM customers WHERE status = 'fresh' AND archived = 0 AND owner_id = ?`).get(user.id) as { n: number }).n;
  const workingCount = (db.prepare(`SELECT COUNT(*) n FROM customers WHERE status IN ('working','aging_45_90') AND archived = 0 AND owner_id = ?`).get(user.id) as { n: number }).n;

  const today = agentDateStr();
  const weekStart = agentWeekStart();
  const dailyGoal = db.prepare('SELECT * FROM daily_goals WHERE date = ? AND user_id = ?').get(today, user.id) as DailyGoal | undefined;
  const weeklyGoal = db.prepare('SELECT * FROM weekly_goals WHERE week_start = ? AND user_id = ?').get(weekStart, user.id) as WeeklyGoal | undefined;

  const dailyProgress = getGoalProgress(db, 'daily', today, user.id);
  const weeklyProgress = getGoalProgress(db, 'weekly', weekStart, user.id);
  const hasAnyGoal = !!(dailyGoal?.target_dials || dailyGoal?.target_ap || weeklyGoal?.target_dials || weeklyGoal?.target_ap);

  const firstName = user.name.split(' ')[0];
  const quote = quoteOfTheDay(today);
  const trend = getDailyTrend(db, user.id, 14);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-brand-400">{greeting(agentHour())}, {firstName} 👋</p>
          <h1 className="text-xl font-bold">Production Dashboard</h1>
          <p className="text-sm text-slate-500">{freshCount} fresh leads · {workingCount} in progress right now</p>
          <p className="mt-1 text-xs italic text-slate-400">"{quote}"</p>
        </div>
        <div className="flex gap-2">
          <a href="/dial" className="btn-primary">⚡ Power Dial</a>
          <Link href="/leads" className="btn-secondary">View Leads</Link>
        </div>
      </div>

      {hasAnyGoal && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(weeklyGoal?.target_dials || weeklyGoal?.target_ap) && (
            <div className="card space-y-2 p-4">
              <div className="label">🗓️ This Week&apos;s Goals</div>
              <GoalBar label="Dials" actual={weeklyProgress.dials} target={weeklyGoal?.target_dials ?? null} />
              <GoalBar label="AP" actual={weeklyProgress.ap} target={weeklyGoal?.target_ap ?? null} />
            </div>
          )}
          {(dailyGoal?.target_dials || dailyGoal?.target_ap) && (
            <div className="card space-y-2 p-4">
              <div className="label">☀️ Today&apos;s Goals</div>
              <GoalBar label="Dials" actual={dailyProgress.dials} target={dailyGoal?.target_dials ?? null} />
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
        <div className="card mt-3 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Net Commission — Last 14 Days</div>
          <LineChart points={trend.commission} color="#8b5cf6" gradientId="dash-commission-trend" height={90} formatValue={(v) => fmtMoney0(v)} />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {(['today', 'week', 'month', 'all'] as Period[]).map((p) => (
          <a
            key={p}
            href={`/?period=${p}${vendorId ? `&vendor=${vendorId}` : ''}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${period === p ? 'bg-brand-500 text-white' : 'bg-panel2 border border-line text-slate-600 hover:bg-slate-100'}`}
          >
            {PERIOD_LABEL[p]}
          </a>
        ))}
        <form action="/" method="get" className="flex items-center gap-1.5">
          <input type="hidden" name="period" value={period} />
          <select name="vendor" defaultValue={vendorId || ''} className="input h-[34px] w-44 py-1 text-sm">
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <button type="submit" className="btn-secondary text-sm">Filter</button>
          {vendorId && <a href={`/?period=${period}`} className="text-xs text-slate-400 hover:underline">Reset</a>}
        </form>
        <span className="text-xs text-slate-400">— activity, conversion &amp; lead economics below</span>
      </div>

      {/* ACTIVITY */}
      <section>
        <div className="mb-2 label">📞 Activity ({PERIOD_LABEL[period]}{vendorId ? ` · ${vendors.find((v) => v.id === vendorId)?.name || 'Vendor'}` : ''})</div>
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
        <div className="mb-2 label">📈 Conversion{vendorId ? ` · ${vendors.find((v) => v.id === vendorId)?.name || 'Vendor'}` : ''}</div>
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
