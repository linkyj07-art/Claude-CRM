import Link from 'next/link';
import { getDb } from '@/lib/db';
import Badge from '@/components/Badge';
import { statusBadge, leadAgeLabel, fmtMoney0, US_STATES } from '@/lib/util';
import { Customer, LeadVendor } from '@/lib/types';
import NewLeadButton from '@/components/NewLeadButton';
import ImportLeadsButton from '@/components/ImportLeadsButton';

export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  ['', 'All statuses'], ['fresh', 'Fresh'], ['working', 'Working'], ['aging_45_90', '45-90 Day'],
  ['aging_90_plus', '90+ Day'], ['invalid', 'Invalid'], ['disputed', 'Disputed'], ['dnc', 'DNC'],
  ['sold', 'Sold'], ['lost', 'Lost'], ['archived', 'Archived']
];

export default function LeadsPage({ searchParams }: { searchParams: { status?: string; q?: string; state?: string; vendor?: string; empty?: string } }) {
  const db = getDb();
  const vendors = db.prepare('SELECT * FROM lead_vendors ORDER BY name').all() as LeadVendor[];

  let sql = `SELECT c.*, v.name as vendor_name FROM customers c LEFT JOIN lead_vendors v ON v.id = c.lead_vendor_id WHERE c.archived = 0`;
  const params: unknown[] = [];
  if (searchParams.status) { sql += ' AND c.status = ?'; params.push(searchParams.status); }
  if (searchParams.state) { sql += ' AND c.state = ?'; params.push(searchParams.state); }
  if (searchParams.vendor) { sql += ' AND c.lead_vendor_id = ?'; params.push(searchParams.vendor); }
  if (searchParams.q) {
    sql += ` AND (c.first_name || ' ' || c.last_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)`;
    const term = `%${searchParams.q}%`;
    params.push(term, term, term);
  }
  sql += ' ORDER BY c.purchased_at DESC LIMIT 300';
  const leads = db.prepare(sql).all(...params) as (Customer & { vendor_name: string | null })[];

  const counts = db.prepare(`SELECT status, COUNT(*) n FROM customers WHERE archived = 0 GROUP BY status`).all() as { status: string; n: number }[];
  const countMap = Object.fromEntries(counts.map((c) => [c.status, c.n]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Leads</h1>
          <p className="text-sm text-slate-500">{leads.length} showing · {countMap.fresh || 0} fresh · {(countMap.working || 0) + (countMap.aging_45_90 || 0)} working</p>
        </div>
        <div className="flex gap-2">
          <NewLeadButton vendors={vendors} />
          <ImportLeadsButton vendors={vendors} />
          <Link href="/leads/review" className="btn-secondary">🔎 Review Queue</Link>
          <a href="/dial" className="btn-primary">☎️ Dial For The Day</a>
        </div>
      </div>

      {searchParams.empty && (
        <div className="card border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">No fresh or working leads left in the queue right now.</div>
      )}

      <form className="card flex flex-wrap items-end gap-2 p-3" action="/leads">
        <div>
          <label className="label mb-1 block">Search</label>
          <input className="input w-56" name="q" defaultValue={searchParams.q || ''} placeholder="Name, phone, email…" />
        </div>
        <div>
          <label className="label mb-1 block">Status</label>
          <select className="input w-40" name="status" defaultValue={searchParams.status || ''}>
            {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}{v && countMap[v] ? ` (${countMap[v]})` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="label mb-1 block">State</label>
          <select className="input w-32" name="state" defaultValue={searchParams.state || ''}>
            <option value="">All</option>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label mb-1 block">Vendor</label>
          <select className="input w-48" name="vendor" defaultValue={searchParams.vendor || ''}>
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <button className="btn-secondary" type="submit">Filter</button>
        <a href="/leads" className="text-xs text-slate-400 hover:underline">Reset</a>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase text-slate-400">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Coverage</th>
              <th className="px-3 py-2">Ad / Platform</th>
              <th className="px-3 py-2">Vendor</th>
              <th className="px-3 py-2">Age</th>
              <th className="px-3 py-2">Lead Cost</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const badge = statusBadge(l.status, l.purchased_at);
              return (
                <tr key={l.id} className="border-b border-line last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link href={`/leads/${l.id}`} className="font-medium text-ink hover:text-brand-600">
                      {l.first_name} {l.last_name}
                    </Link>
                    <div className="text-xs text-slate-400">{l.phone}</div>
                  </td>
                  <td className="px-3 py-2"><Badge label={badge.label} color={badge.color} /></td>
                  <td className="px-3 py-2 text-slate-600">{l.state}</td>
                  <td className="px-3 py-2 text-slate-600">{l.coverage_wanted ? fmtMoney0(l.coverage_wanted) : '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{l.ad_type} / {l.platform}</td>
                  <td className="px-3 py-2 text-slate-600">{l.vendor_name || '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{leadAgeLabel(l.purchased_at)}</td>
                  <td className="px-3 py-2 text-slate-600">{fmtMoney0(l.lead_cost)}</td>
                </tr>
              );
            })}
            {leads.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">No leads match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
