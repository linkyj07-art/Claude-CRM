import Link from 'next/link';
import { getDb } from '@/lib/db';
import { Customer, DuplicateLead } from '@/lib/types';
import { leadAgeLabel } from '@/lib/util';
import { DismissDuplicateButton, AddAnywayButton, ArchiveLeadButton } from '@/components/ReviewActions';
import { getCurrentUser } from '@/lib/currentUser';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ReviewQueuePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = getDb();

  const duplicates = db.prepare(
    `SELECT d.*, c.first_name AS match_first_name, c.last_name AS match_last_name, c.phone AS match_phone
     FROM duplicate_leads d JOIN customers c ON c.id = d.customer_id
     WHERE c.owner_id = ?
     ORDER BY d.created_at DESC`
  ).all(user.id) as (DuplicateLead & { match_first_name: string; match_last_name: string; match_phone: string | null })[];

  const agingLeads = db.prepare(
    `SELECT * FROM customers
     WHERE archived = 0 AND owner_id = ? AND status NOT IN ('sold', 'lost', 'dnc', 'invalid', 'archived')
       AND purchased_at <= datetime('now', '-90 days')
     ORDER BY purchased_at ASC LIMIT 300`
  ).all(user.id) as Customer[];

  const settingsRow = db.prepare(`SELECT value FROM app_settings WHERE key = 'licensed_states'`).get() as { value: string } | undefined;
  const licensedStates: string[] = settingsRow ? JSON.parse(settingsRow.value) : [];

  const unlicensedLeads = licensedStates.length === 0 ? [] : (db.prepare(
    `SELECT c.*, COUNT(ca.id) AS call_count, MAX(ca.occurred_at) AS last_call_at
     FROM customers c JOIN calls ca ON ca.customer_id = c.id
     WHERE c.owner_id = ? AND c.state IS NOT NULL AND c.state != '' AND c.state NOT IN (${licensedStates.map(() => '?').join(',')})
     GROUP BY c.id
     ORDER BY last_call_at DESC LIMIT 300`
  ).all(user.id, ...licensedStates) as (Customer & { call_count: number; last_call_at: string })[]);

  const disconnectedLeads = db.prepare(
    `SELECT c.*, COUNT(ca.id) AS wrong_number_count, MAX(ca.occurred_at) AS last_call_at
     FROM customers c JOIN calls ca ON ca.customer_id = c.id AND ca.outcome = 'wrong_number'
     WHERE c.archived = 0 AND c.owner_id = ?
     GROUP BY c.id
     ORDER BY last_call_at DESC LIMIT 300`
  ).all(user.id) as (Customer & { wrong_number_count: number; last_call_at: string })[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">🔎 Review Queue</h1>
        <p className="text-sm text-slate-500">Duplicate leads caught on import, leads aging past 90 days, leads you've called in states you're not licensed in, and disconnected/wrong numbers.</p>
      </div>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="label">Possible Duplicates ({duplicates.length})</div>
        </div>
        <div className="space-y-2">
          {duplicates.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3 text-sm">
              <div className="flex-1 min-w-[220px]">
                <div className="font-medium">{d.first_name} {d.last_name} · {d.phone || '—'}</div>
                <div className="text-xs text-slate-500">
                  Matches existing lead <Link href={`/leads/${d.customer_id}`} className="text-brand-600 hover:underline">{d.match_first_name} {d.match_last_name} · {d.match_phone || '—'}</Link>
                  {d.source && ` — from ${d.source}`}
                </div>
              </div>
              <Link href={`/leads/${d.customer_id}`} className="btn-secondary text-xs">View Original</Link>
              <AddAnywayButton id={d.id} />
              <DismissDuplicateButton id={d.id} />
            </div>
          ))}
          {duplicates.length === 0 && <div className="text-sm text-slate-400">No duplicates flagged right now.</div>}
        </div>
      </section>

      <section className="card p-4">
        <div className="mb-3 label">90+ Days Old, Still Open ({agingLeads.length})</div>
        <div className="space-y-2">
          {agingLeads.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3 text-sm">
              <div className="flex-1 min-w-[220px]">
                <Link href={`/leads/${l.id}`} className="font-medium text-brand-600 hover:underline">{l.first_name} {l.last_name}</Link>
                <div className="text-xs text-slate-500">{l.state || '—'} · {leadAgeLabel(l.purchased_at)}</div>
              </div>
              <ArchiveLeadButton id={l.id} />
            </div>
          ))}
          {agingLeads.length === 0 && <div className="text-sm text-slate-400">Nothing sitting past 90 days.</div>}
        </div>
      </section>

      <section className="card p-4">
        <div className="mb-3 label">Called in an Unlicensed State ({unlicensedLeads.length})</div>
        {licensedStates.length === 0 ? (
          <div className="text-sm text-slate-400">
            Set your licensed states under <Link href="/quick-links" className="text-brand-600 hover:underline">Settings → Licensed States</Link> to enable this check.
          </div>
        ) : (
          <div className="space-y-2">
            {unlicensedLeads.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3 text-sm">
                <div className="flex-1 min-w-[220px]">
                  <Link href={`/leads/${l.id}`} className="font-medium text-brand-600 hover:underline">{l.first_name} {l.last_name}</Link>
                  <div className="text-xs text-slate-500">{l.state} · {l.call_count} call{l.call_count === 1 ? '' : 's'} · last {l.last_call_at}</div>
                </div>
                <ArchiveLeadButton id={l.id} />
              </div>
            ))}
            {unlicensedLeads.length === 0 && <div className="text-sm text-slate-400">No calls logged outside your licensed states.</div>}
          </div>
        )}
      </section>

      <section className="card p-4">
        <div className="mb-3 label">Disconnected / Wrong Numbers ({disconnectedLeads.length})</div>
        <div className="space-y-2">
          {disconnectedLeads.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3 text-sm">
              <div className="flex-1 min-w-[220px]">
                <Link href={`/leads/${l.id}`} className="font-medium text-brand-600 hover:underline">{l.first_name} {l.last_name}</Link>
                <div className="text-xs text-slate-500">{l.phone || '—'} · {l.wrong_number_count} wrong-number call{l.wrong_number_count === 1 ? '' : 's'} · last {l.last_call_at}</div>
              </div>
              <ArchiveLeadButton id={l.id} />
            </div>
          ))}
          {disconnectedLeads.length === 0 && <div className="text-sm text-slate-400">No disconnected/wrong numbers logged.</div>}
        </div>
      </section>
    </div>
  );
}
