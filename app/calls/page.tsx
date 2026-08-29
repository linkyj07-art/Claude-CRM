import Link from 'next/link';
import { getDb } from '@/lib/db';
import Badge from '@/components/Badge';
import { getCurrentUser } from '@/lib/currentUser';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type CallRow = {
  id: string; customer_id: string; outcome: string; disposition: string | null;
  attempt_number: number; occurred_at: string; first_name: string; last_name: string; phone: string | null; state: string | null;
};

const OUTCOME_COLOR: Record<string, string> = {
  connected: 'good', dnc: 'bad', pending: 'warn', google_voice: 'brand'
};

export default async function CallsPage({ searchParams }: { searchParams: { outcome?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = getDb();
  let sql = `SELECT ca.id, ca.customer_id, ca.outcome, ca.disposition, ca.attempt_number, ca.occurred_at,
                    c.first_name, c.last_name, c.phone, c.state
             FROM calls ca JOIN customers c ON c.id = ca.customer_id
             WHERE c.owner_id = ?`;
  const params: unknown[] = [user.id];
  if (searchParams.outcome) {
    sql += ' AND ca.outcome = ?';
    params.push(searchParams.outcome);
  }
  sql += ' ORDER BY ca.occurred_at DESC LIMIT 150';
  const calls = db.prepare(sql).all(...params) as CallRow[];

  const todayCount = (
    db.prepare(`SELECT COUNT(*) n FROM calls ca JOIN customers c ON c.id = ca.customer_id WHERE c.owner_id = ? AND date(ca.occurred_at) = date('now')`).get(user.id) as { n: number }
  ).n;

  const OUTCOME_OPTIONS = [
    ['', 'All outcomes'], ['connected', 'Connected'], ['no_answer', 'No Answer'], ['voicemail', 'Voicemail'],
    ['google_voice', 'Google Voice'], ['busy', 'Busy'], ['wrong_number', 'Wrong #'], ['dnc', 'DNC'], ['pending', 'In Progress']
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">📞 Recent Calls</h1>
          <p className="text-sm text-slate-500">{todayCount} dial{todayCount === 1 ? '' : 's'} today · showing your most recent {calls.length}</p>
        </div>
        <a href="/dial" className="btn-primary">⚡ Power Dial</a>
      </div>

      <form className="card flex flex-wrap items-end gap-2 p-3" action="/calls">
        <div>
          <label className="label mb-1 block">Outcome</label>
          <select className="input w-48" name="outcome" defaultValue={searchParams.outcome || ''}>
            {OUTCOME_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <button className="btn-secondary" type="submit">Filter</button>
        {searchParams.outcome && <a href="/calls" className="text-xs text-slate-400 hover:underline">Reset</a>}
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase text-slate-400">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Attempt</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2">Disposition</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0 hover:bg-slate-50">
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400 tabular-nums">{c.occurred_at}</td>
                <td className="px-3 py-2">
                  <Link href={`/leads/${c.customer_id}`} className="font-medium text-ink hover:text-brand-600">
                    {c.first_name} {c.last_name}
                  </Link>
                  {c.state && <span className="ml-1 text-xs text-slate-400">({c.state})</span>}
                </td>
                <td className="px-3 py-2 text-slate-600">{c.phone || '—'}</td>
                <td className="px-3 py-2 tabular-nums text-slate-600">#{c.attempt_number}</td>
                <td className="px-3 py-2">
                  <Badge label={c.outcome.replace('_', ' ').toUpperCase()} color={OUTCOME_COLOR[c.outcome] || 'brand'} />
                </td>
                <td className="px-3 py-2 text-slate-500">{c.disposition || '—'}</td>
              </tr>
            ))}
            {calls.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No calls logged yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
