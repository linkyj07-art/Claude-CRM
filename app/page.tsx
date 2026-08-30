import Link from 'next/link';
import { getDb } from '@/lib/db';
import StatCard from '@/components/StatCard';
import { fmtMoney, fmtMoney0, fmtPct, agentDateStr, agentWeekStart, agentHour } from '@/lib/util';
import { getMoneyTiles, getActivityStats, getConversionRates, getLeadEconomics, getGoalProgress, getDailyTrend, getMoneyComparison, getRecentActivity, getNeedsFollowUp, getCommissionsAtRisk, Period } from '@/lib/metrics';
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

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span className={`ml-1.5 text-[11px] font-semibold ${up ? 'text-emerald-500' : 'text-red-400'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

function MiniStat({ label, value, tone = 'default', changePct }: { label: string; value: string; tone?: 'default' | 'good'; changePct?: number | null }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${tone === 'good' ? 'text-emerald-500' : 'text-ink'}`}>
        {value}
        {changePct !== undefined && <ChangeBadge pct={changePct} />}
      </div>
    </div>
  );
}

const ACTIVITY_ICON: Record<string, string> = {
  lead_purchased: '🆕', status_change: '🔄', call: '📞', note: '📝',
  quote: '🧮', appointment: '📅', policy_issued: '🏆', commission: '💰'
};

function timeAgo(occurredAt: string): string {
  const then = new Date(occurredAt.replace(' ', 'T') + (occurredAt.includes('Z') ? '' : 'Z'));
  const mins = Math.max(0, Math.floor((Date.now() - then.getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
  const moneyComparison = getMoneyComparison(db, user.id);
  const recentActivity = getRecentActivity(db, user.id, 8);
  const needsFollowUp = getNeedsFollowUp(db, user.id, 7, 6);
  const commissionsAtRisk = getCommissionsAtRisk(db, user.id);

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
  const vendorLabel = vendorId ? vendors.find((v) => v.id === vendorId)?.name || 'Vendor' : null;

  return (
    <div className="space-y-6">
      {/* HERO */}
      <div className="card relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -left-16 -top-24 h-64 w-64 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-10 h-56 w-56 rounded-full bg-brand-400/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-brand-400">{greeting(agentHour())}, {firstName} 👋</p>
            <h1 className="text-2xl font-bold tracking-tight">Production Dashboard</h1>
            <p className="text-sm text-slate-500">
              <Link href="/leads?status=fresh" className="hover:text-brand-500 hover:underline">{freshCount} fresh leads</Link>
              {' · '}
              <Link href="/leads?status=working" className="hover:text-brand-500 hover:underline">{workingCount} in progress</Link>
              {' right now'}
            </p>
            <p className="mt-1.5 text-xs italic text-slate-400">&ldquo;{quote}&rdquo;</p>
          </div>
          <div className="flex gap-2">
            <a href="/dial" className="btn-primary">⚡ Power Dial</a>
            <Link href="/leads" className="btn-secondary">View Leads</Link>
          </div>
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

      {(needsFollowUp.length > 0 || commissionsAtRisk.length > 0) && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {needsFollowUp.length > 0 && (
            <div className="card p-4">
              <div className="label mb-2">🕸️ Needs Follow-Up</div>
              <div className="space-y-1.5">
                {needsFollowUp.map((lead) => (
                  <Link key={lead.id} href={`/leads/${lead.id}`} className="flex items-center justify-between rounded-lg -mx-1.5 px-1.5 py-1 text-sm hover:bg-slate-50">
                    <span className="truncate font-medium text-ink">{lead.name}</span>
                    <span className="shrink-0 text-xs text-amber-600">
                      {lead.lastActivityAt ? `${lead.daysQuiet}d since last call` : `${lead.daysQuiet}d, never called`}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {commissionsAtRisk.length > 0 && (
            <div className="card p-4">
              <div className="label mb-2">⚠️ Commissions Past Expected Pay Date</div>
              <div className="space-y-1.5">
                {commissionsAtRisk.map((c) => (
                  <Link key={c.id} href={`/leads/${c.customerId}`} className="flex items-center justify-between rounded-lg -mx-1.5 px-1.5 py-1 text-sm hover:bg-slate-50">
                    <span className="truncate font-medium text-ink">{c.customerName} <span className="text-slate-400">· {c.carrier || 'No carrier'}</span></span>
                    <span className="shrink-0 text-xs text-red-500">{fmtMoney(c.netCommission)} · {c.daysOverdue}d overdue</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* MONEY — hero figure + trend, secondary stats as a light row instead of five boxes */}
      <section className="card relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="label mb-1">💰 This Month</div>
            <div className="flex items-baseline gap-1">
              <div className="text-4xl font-bold leading-none tracking-tight text-ink">{fmtMoney(money.month)}</div>
              <ChangeBadge pct={moneyComparison.monthChangePct} />
            </div>
            <div className="mt-1.5 text-xs text-slate-500">Net commission booked this month · vs. prior 30 days</div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <MiniStat label="Today" value={fmtMoney(money.today)} tone="good" changePct={moneyComparison.todayChangePct} />
            <MiniStat label="This Week" value={fmtMoney(money.week)} tone="good" changePct={moneyComparison.weekChangePct} />
            <MiniStat label="Pending" value={fmtMoney(money.pending)} />
            <MiniStat label="Net (Lifetime)" value={fmtMoney(money.net)} tone="good" />
          </div>
        </div>
        <div className="relative mt-5">
          <LineChart points={trend.commission} color="#8b5cf6" gradientId="dash-commission-trend" height={90} formatValue={(v) => fmtMoney0(v)} />
        </div>
      </section>

      {/* FILTER BAR */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel2/60 p-1.5">
        {(['today', 'week', 'month', 'all'] as Period[]).map((p) => (
          <a
            key={p}
            href={`/?period=${p}${vendorId ? `&vendor=${vendorId}` : ''}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${period === p ? 'bg-brand-500 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-ink'}`}
          >
            {PERIOD_LABEL[p]}
          </a>
        ))}
        <div className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <form action="/" method="get" className="flex items-center gap-1.5">
          <input type="hidden" name="period" value={period} />
          <select name="vendor" defaultValue={vendorId || ''} className="input h-[34px] w-44 py-1 text-sm">
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <button type="submit" className="btn-secondary text-sm">Filter</button>
          {vendorId && <a href={`/?period=${period}`} className="text-xs text-slate-400 hover:underline">Reset</a>}
        </form>
        <span className="ml-auto hidden text-xs text-slate-400 lg:inline">activity, conversion &amp; lead economics below</span>
      </div>

      {/* ACTIVITY + CONVERSION — one surface, two rows */}
      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="label">📞 Activity &amp; Conversion — {PERIOD_LABEL[period]}{vendorLabel ? ` · ${vendorLabel}` : ''}</div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Calls" value={String(activity.calls)} />
          <StatCard label="Contacts" value={String(activity.contacts)} />
          <StatCard label="Conversations" value={String(activity.conversations)} />
          <StatCard label="Appointments" value={String(activity.appointments)} href="/calendar" />
          <StatCard label="Applications" value={String(activity.applications)} />
          <StatCard label="Issued" value={String(activity.issued)} tone="good" href="/leads?status=sold" />
        </div>
        <div className="my-4 border-t border-line" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Contact Rate" value={fmtPct(conversion.contactRate)} />
          <StatCard label="Appointment Rate" value={fmtPct(conversion.appointmentRate)} />
          <StatCard label="Application Rate" value={fmtPct(conversion.applicationRate)} />
          <StatCard label="Issue Rate" value={fmtPct(conversion.issueRate)} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {/* LEAD ECONOMICS */}
          <section>
            <div className="mb-2 label">💳 Lead Economics</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard label="Lead Spend" value={fmtMoney0(leadEcon.leadSpend)} />
              <StatCard label="Cost / Lead" value={leadEcon.costPerLead !== null ? fmtMoney(leadEcon.costPerLead) : '—'} />
              <StatCard label="Cost / Issued" value={leadEcon.costPerIssued !== null ? fmtMoney0(leadEcon.costPerIssued) : '—'} />
              <StatCard label="Net Commission" value={fmtMoney0(leadEcon.netCommission)} tone="good" href="/commissions" />
              <StatCard label="ROI" value={leadEcon.roi !== null ? `${leadEcon.roi.toFixed(0)}%` : '—'} tone={leadEcon.roi !== null && leadEcon.roi >= 0 ? 'good' : 'bad'} href="/analytics" />
            </div>
          </section>

          <div className="card p-4 text-sm text-slate-500">
            Want the full pipeline, cost-per-stage breakdown, and ROI by vendor / lead age / state / source?
            See <Link href="/analytics" className="font-medium text-brand-600 hover:underline">Analytics →</Link>
          </div>
        </div>

        {/* RECENT ACTIVITY */}
        <div className="card p-4">
          <div className="label mb-3">🕒 Recent Activity</div>
          {recentActivity.length === 0 ? (
            <div className="text-sm text-slate-400">Nothing logged yet — activity from your leads will show up here.</div>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((a) => (
                <Link key={a.id} href={`/leads/${a.customerId}`} className="flex gap-2.5 rounded-lg -mx-1.5 px-1.5 py-1 hover:bg-slate-50">
                  <span className="mt-0.5 text-sm">{ACTIVITY_ICON[a.eventType] || '•'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-ink">{a.customerName}</div>
                    <div className="truncate text-xs text-slate-500">{a.summary}</div>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(a.occurredAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
