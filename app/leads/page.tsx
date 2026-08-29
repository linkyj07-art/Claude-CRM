import Link from 'next/link';
import { getDb } from '@/lib/db';
import { US_STATES } from '@/lib/util';
import { Customer, LeadVendor } from '@/lib/types';
import NewLeadButton from '@/components/NewLeadButton';
import ImportLeadsButton from '@/components/ImportLeadsButton';
import LeadsTable from '@/components/LeadsTable';
import { getCurrentUser } from '@/lib/currentUser';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  ['', 'All statuses'], ['fresh', 'Fresh'], ['working', 'Working'], ['aging_45_90', '45-90 Day'],
  ['aging_90_plus', '90+ Day'], ['invalid', 'Invalid'], ['disputed', 'Disputed'], ['dnc', 'DNC'],
  ['sold', 'Sold'], ['lost', 'Lost'], ['archived', 'Archived']
];

export default async function LeadsPage({ searchParams }: { searchParams: { status?: string; q?: string; state?: string; vendor?: string; empty?: string; closed?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = getDb();
  const vendors = db.prepare('SELECT * FROM lead_vendors ORDER BY name').all() as LeadVendor[];

  let sql = `SELECT c.*, v.name as vendor_name FROM customers c LEFT JOIN lead_vendors v ON v.id = c.lead_vendor_id WHERE c.archived = 0 AND c.owner_id = ?`;
  const params: unknown[] = [user.id];
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

  const counts = db.prepare(`SELECT status, COUNT(*) n FROM customers WHERE archived = 0 AND owner_id = ? GROUP BY status`).all(user.id) as { status: string; n: number }[];
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
          <a href="/dial" className="btn-primary">⚡ Power Dial</a>
        </div>
      </div>

      {searchParams.empty && searchParams.closed && (
        <div className="card border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          You&apos;ve got fresh or working leads, but they&apos;re all outside their state&apos;s calling hours (8am-9pm local) right now. Check back later.
        </div>
      )}
      {searchParams.empty && !searchParams.closed && (
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

      <LeadsTable leads={leads} />
    </div>
  );
}
