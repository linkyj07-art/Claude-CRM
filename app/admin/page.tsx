import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// A heartbeat that's gone quiet (browser closed, laptop asleep) shouldn't
// keep showing "connected" forever — helper_connected is just whatever the
// last report said, with no expiry of its own.
const STALE_AFTER_MS = 2 * 60 * 1000;

type TeamRow = {
  id: string; name: string; username: string; role: string;
  helper_connected: number; helper_last_seen: string | null; auto_dial: number;
  lead_count: number; calls_today: number;
};
type RecentCallRow = {
  id: string; outcome: string; disposition: string | null; occurred_at: string;
  customer_id: string; first_name: string; last_name: string; owner_name: string;
};
type RecentLeadRow = {
  id: string; first_name: string; last_name: string; phone: string | null;
  status: string; state: string | null; purchased_at: string; owner_name: string;
};

function isFresh(lastSeen: string | null): boolean {
  if (!lastSeen) return false;
  const seenMs = new Date(lastSeen.replace(' ', 'T') + 'Z').getTime();
  return Date.now() - seenMs < STALE_AFTER_MS;
}

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');

  const db = getDb();

  const team = db
    .prepare(
      `SELECT u.id, u.name, u.username, u.role, u.helper_connected, u.helper_last_seen,
              COALESCE(ds.auto_dial, 0) as auto_dial,
              (SELECT COUNT(*) FROM customers c WHERE c.owner_id = u.id AND c.archived = 0) as lead_count,
              (SELECT COUNT(*) FROM calls ca JOIN customers c ON c.id = ca.customer_id WHERE c.owner_id = u.id AND date(ca.occurred_at) = date('now')) as calls_today
       FROM users u
       LEFT JOIN dial_sessions ds ON ds.user_id = u.id
       ORDER BY u.name`
    )
    .all() as TeamRow[];

  const recentCalls = db
    .prepare(
      `SELECT ca.id, ca.outcome, ca.disposition, ca.occurred_at, c.id as customer_id, c.first_name, c.last_name, u.name as owner_name
       FROM calls ca
       JOIN customers c ON c.id = ca.customer_id
       JOIN users u ON u.id = c.owner_id
       WHERE ca.outcome != 'pending'
       ORDER BY ca.occurred_at DESC
       LIMIT 50`
    )
    .all() as RecentCallRow[];

  const recentLeads = db
    .prepare(
      `SELECT c.id, c.first_name, c.last_name, c.phone, c.status, c.state, c.purchased_at, u.name as owner_name
       FROM customers c
       JOIN users u ON u.id = c.owner_id
       WHERE c.archived = 0
       ORDER BY c.purchased_at DESC
       LIMIT 200`
    )
    .all() as RecentLeadRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">🛡️ Admin</h1>
        <p className="text-sm text-slate-500">Team status, and every user&apos;s leads/calls — not just your own.</p>
      </div>

      {/* Team status */}
      <div className="card overflow-x-auto p-4">
        <div className="label mb-3">Team Status</div>
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase text-slate-400">
              <th className="py-1.5 pr-3">Name</th>
              <th className="py-1.5 pr-3">Role</th>
              <th className="py-1.5 pr-3">Quo Helper</th>
              <th className="py-1.5 pr-3">Auto-Dial</th>
              <th className="py-1.5 pr-3">Leads</th>
              <th className="py-1.5 pr-3">Calls Today</th>
            </tr>
          </thead>
          <tbody>
            {team.map((t) => {
              const connected = !!t.helper_connected && isFresh(t.helper_last_seen);
              return (
                <tr key={t.id} className="border-b border-line last:border-0">
                  <td className="py-1.5 pr-3 font-medium">{t.name}{t.id === user.id ? ' (you)' : ''}</td>
                  <td className="py-1.5 pr-3 capitalize">{t.role}</td>
                  <td className="py-1.5 pr-3">
                    <span className={connected ? 'text-emerald-600' : 'text-slate-400'}>
                      {connected ? '🟢 Connected' : t.helper_last_seen ? '⚪ Not connected' : '⚪ Never reported'}
                    </span>
                    {t.helper_last_seen && (
                      <span className="ml-1 text-xs text-slate-400">
                        (last seen {new Date(t.helper_last_seen.replace(' ', 'T') + 'Z').toLocaleTimeString()})
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">{t.auto_dial ? <span className="font-medium text-brand-600">▶️ On</span> : <span className="text-slate-400">Off</span>}</td>
                  <td className="py-1.5 pr-3">{t.lead_count}</td>
                  <td className="py-1.5 pr-3">{t.calls_today}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-400">
          Quo Helper status is self-reported by each person&apos;s own browser every 30s — there&apos;s no way to check another user&apos;s machine directly.
        </p>
      </div>

      {/* All leads across every user */}
      <div className="card overflow-x-auto p-4">
        <div className="label mb-3">All Leads (most recent 200, every user)</div>
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase text-slate-400">
              <th className="py-1.5 pr-3">Name</th>
              <th className="py-1.5 pr-3">Owner</th>
              <th className="py-1.5 pr-3">Phone</th>
              <th className="py-1.5 pr-3">Status</th>
              <th className="py-1.5 pr-3">State</th>
              <th className="py-1.5 pr-3">Purchased</th>
            </tr>
          </thead>
          <tbody>
            {recentLeads.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0">
                <td className="py-1.5 pr-3 font-medium">
                  <a href={`/leads/${l.id}`} className="hover:text-brand-600 hover:underline">{l.first_name} {l.last_name}</a>
                </td>
                <td className="py-1.5 pr-3">{l.owner_name}</td>
                <td className="py-1.5 pr-3">{l.phone || '—'}</td>
                <td className="py-1.5 pr-3 capitalize">{l.status.replace(/_/g, ' ')}</td>
                <td className="py-1.5 pr-3">{l.state || '—'}</td>
                <td className="py-1.5 pr-3 text-slate-500">{l.purchased_at.slice(0, 10)}</td>
              </tr>
            ))}
            {recentLeads.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-400">No leads yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Recent calls across every user */}
      <div className="card overflow-x-auto p-4">
        <div className="label mb-3">Recent Calls (last 50, every user)</div>
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase text-slate-400">
              <th className="py-1.5 pr-3">Lead</th>
              <th className="py-1.5 pr-3">Owner</th>
              <th className="py-1.5 pr-3">Outcome</th>
              <th className="py-1.5 pr-3">Disposition</th>
              <th className="py-1.5 pr-3">When</th>
            </tr>
          </thead>
          <tbody>
            {recentCalls.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="py-1.5 pr-3 font-medium">
                  <a href={`/leads/${c.customer_id}`} className="hover:text-brand-600 hover:underline">{c.first_name} {c.last_name}</a>
                </td>
                <td className="py-1.5 pr-3">{c.owner_name}</td>
                <td className="py-1.5 pr-3 capitalize">{c.outcome.replace(/_/g, ' ')}</td>
                <td className="py-1.5 pr-3 capitalize">{c.disposition ? c.disposition.replace(/_/g, ' ') : '—'}</td>
                <td className="py-1.5 pr-3 text-slate-500">{c.occurred_at.slice(0, 16).replace('T', ' ')}</td>
              </tr>
            ))}
            {recentCalls.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">No calls logged yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
