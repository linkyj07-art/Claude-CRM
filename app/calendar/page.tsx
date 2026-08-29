import Link from 'next/link';
import { getDb } from '@/lib/db';
import CalendarQuickAdd from '@/components/CalendarQuickAdd';

export const dynamic = 'force-dynamic';

type ApptRow = {
  id: string; customer_id: string; scheduled_at: string; type: string; status: string;
  first_name: string; last_name: string; phone: string | null;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function CalendarPage({ searchParams }: { searchParams: { month?: string } }) {
  const month = /^\d{4}-\d{2}$/.test(searchParams.month || '') ? searchParams.month! : new Date().toISOString().slice(0, 7);
  const db = getDb();
  const appointments = db
    .prepare(
      `SELECT a.*, c.first_name, c.last_name, c.phone
       FROM appointments a JOIN customers c ON c.id = a.customer_id
       WHERE a.scheduled_at LIKE ? AND a.status != 'cancelled'
       ORDER BY a.scheduled_at ASC`
    )
    .all(`${month}%`) as ApptRow[];

  const byDay = new Map<number, ApptRow[]>();
  for (const a of appointments) {
    const day = Number(a.scheduled_at.slice(8, 10));
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(a);
  }

  const [year, monthNum] = month.split('-').map(Number);
  const firstOfMonth = new Date(Date.UTC(year, monthNum - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const startOffset = firstOfMonth.getUTCDay();
  const monthLabel = firstOfMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const todayStr = new Date().toISOString().slice(0, 10);

  const cells: (number | null)[] = [...Array(startOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">📅 Calendar</h1>
          <p className="text-sm text-slate-500">{appointments.length} appointment{appointments.length === 1 ? '' : 's'} in {monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/calendar?month=${shiftMonth(month, -1)}`} className="btn-secondary">◀</Link>
          <span className="text-sm font-medium">{monthLabel}</span>
          <Link href={`/calendar?month=${shiftMonth(month, 1)}`} className="btn-secondary">▶</Link>
          <CalendarQuickAdd defaultDate={todayStr} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-slate-50 text-center text-xs font-semibold text-slate-500">
          {WEEKDAYS.map((w) => <div key={w} className="p-2">{w}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const dateStr = day ? `${month}-${String(day).padStart(2, '0')}` : null;
            const isToday = dateStr === todayStr;
            return (
              <div key={i} className={`min-h-[100px] border-b border-r border-line p-1.5 last:border-r-0 ${day ? '' : 'bg-slate-50'}`}>
                {day && (
                  <>
                    <div className={`mb-1 text-xs font-semibold ${isToday ? 'text-brand-600' : 'text-slate-400'}`}>{day}</div>
                    <div className="max-h-20 space-y-0.5 overflow-y-auto">
                      {(byDay.get(day) || []).map((a) => (
                        <Link
                          key={a.id}
                          href={`/leads/${a.customer_id}`}
                          className="block truncate rounded bg-brand-50 px-1 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
                          title={`${a.scheduled_at.slice(11, 16)} — ${a.first_name} ${a.last_name}`}
                        >
                          {a.scheduled_at.slice(11, 16)} {a.first_name} {a.last_name}
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
