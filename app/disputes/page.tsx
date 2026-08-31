import Link from 'next/link';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';
import { redirect } from 'next/navigation';
import DisputeRow, { DisputeRowData } from '@/components/DisputeRow';

export const dynamic = 'force-dynamic';

export default async function DisputesPage({ searchParams }: { searchParams: { filter?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = getDb();
  const allDisputes = db
    .prepare(
      `SELECT d.*, c.first_name, c.last_name, c.phone, c.lead_cost, c.was_import_duplicate, v.name as vendor_name
       FROM disputes d
       JOIN customers c ON c.id = d.customer_id
       LEFT JOIN lead_vendors v ON v.id = c.lead_vendor_id
       WHERE c.owner_id = ?
       ORDER BY CASE d.status WHEN 'open' THEN 0 WHEN 'submitted' THEN 1 ELSE 2 END, d.created_at DESC`
    )
    .all(user.id) as DisputeRowData[];

  const duplicateOnly = searchParams.filter === 'duplicate';
  const duplicateCount = allDisputes.filter((d) => d.was_import_duplicate).length;
  const disputes = duplicateOnly ? allDisputes.filter((d) => d.was_import_duplicate) : allDisputes;

  const openCount = disputes.filter((d) => d.status === 'open').length;
  const submittedCount = disputes.filter((d) => d.status === 'submitted').length;
  const resolvedCount = disputes.filter((d) => d.status === 'resolved').length;
  const creditedTotal = disputes
    .filter((d) => d.status === 'resolved' && d.credit_amount)
    .reduce((sum, d) => sum + (d.credit_amount || 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">🧾 Dispute Log</h1>
        <p className="text-sm text-slate-500">Bad leads (disconnected numbers, invalid data, etc.) tracked from open through vendor resolution.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-3">
          <div className="label">Open</div>
          <div className="text-xl font-bold text-amber-600">{openCount}</div>
        </div>
        <div className="card p-3">
          <div className="label">Submitted</div>
          <div className="text-xl font-bold text-brand-600">{submittedCount}</div>
        </div>
        <div className="card p-3">
          <div className="label">Resolved</div>
          <div className="text-xl font-bold text-green-600">{resolvedCount}</div>
        </div>
        <div className="card p-3">
          <div className="label">Total Credited</div>
          <div className="text-xl font-bold text-green-600">${creditedTotal.toFixed(2)}</div>
        </div>
      </div>

      <div className="flex gap-1 border-b border-line">
        <Link
          href="/disputes"
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${!duplicateOnly ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-ink'}`}
        >
          All ({allDisputes.length})
        </Link>
        <Link
          href="/disputes?filter=duplicate"
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${duplicateOnly ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-ink'}`}
        >
          🔁 Started as Import Duplicate ({duplicateCount})
        </Link>
      </div>

      <div className="space-y-3">
        {disputes.map((d) => <DisputeRow key={d.id} dispute={d} />)}
        {disputes.length === 0 && (
          <div className="card p-8 text-center text-sm text-slate-400">
            {duplicateOnly
              ? 'No disputes on leads that started as an import-flagged duplicate.'
              : <>No disputes yet. They&apos;ll show up here automatically when a call is dispositioned as Disconnected Number, or you use the Dispute button on a lead.</>}
          </div>
        )}
      </div>
    </div>
  );
}
