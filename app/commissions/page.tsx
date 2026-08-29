import Link from 'next/link';
import { getDb } from '@/lib/db';
import { fmtMoney } from '@/lib/util';
import Badge from '@/components/Badge';

export const dynamic = 'force-dynamic';

export default function CommissionsPage() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT cm.*, c.first_name, c.last_name, c.id as customer_id, p.carrier, p.policy_number
       FROM commissions cm
       JOIN customers c ON c.id = cm.customer_id
       LEFT JOIN policies p ON p.id = cm.policy_id
       ORDER BY cm.created_at DESC`
    )
    .all() as any[];

  const gross = rows.reduce((s, r) => s + (r.expected_commission || 0), 0);
  const net = rows.reduce((s, r) => s + (r.net_commission || 0), 0);
  const pending = rows.filter((r) => r.status === 'pending').reduce((s, r) => s + (r.net_commission || 0), 0);
  const paid = rows.filter((r) => r.status === 'paid').reduce((s, r) => s + (r.net_commission || 0), 0);
  const chargebacks = rows.reduce((s, r) => s + (r.chargeback || 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Commissions</h1>
        <p className="text-sm text-slate-500">
          Gross {fmtMoney(gross)} · Net {fmtMoney(net)} · Paid {fmtMoney(paid)} · Pending {fmtMoney(pending)} · Chargebacks {fmtMoney(-chargebacks)}
        </p>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase text-slate-400">
              <th className="px-3 py-2">Client</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">%</th>
              <th className="px-3 py-2">Expected</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Chargeback</th>
              <th className="px-3 py-2">Net</th><th className="px-3 py-2">Expected Pay</th><th className="px-3 py-2">Actual Pay</th><th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2"><Link href={`/leads/${r.customer_id}`} className="font-medium text-ink hover:text-brand-600">{r.first_name} {r.last_name}</Link></td>
                <td className="px-3 py-2 text-slate-600">{r.carrier}</td>
                <td className="px-3 py-2">{r.commission_pct}%</td>
                <td className="px-3 py-2">{fmtMoney(r.expected_commission)}</td>
                <td className="px-3 py-2 text-slate-600 capitalize">{r.commission_type?.replace('_', ' ')}</td>
                <td className="px-3 py-2 text-red-600">{r.chargeback ? fmtMoney(-r.chargeback) : '—'}</td>
                <td className="px-3 py-2 font-semibold">{fmtMoney(r.net_commission)}</td>
                <td className="px-3 py-2 text-slate-600">{r.expected_pay_date || '—'}</td>
                <td className="px-3 py-2 text-slate-600">{r.actual_pay_date || '—'}</td>
                <td className="px-3 py-2"><Badge label={r.status.replace('_', ' ').toUpperCase()} color={r.status === 'paid' ? 'good' : r.status === 'charged_back' ? 'bad' : 'warn'} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">No commissions recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
