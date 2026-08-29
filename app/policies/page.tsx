import Link from 'next/link';
import { getDb } from '@/lib/db';
import { fmtMoney, fmtMoney0 } from '@/lib/util';
import Badge from '@/components/Badge';

export const dynamic = 'force-dynamic';

export default function PoliciesPage() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.*, c.first_name, c.last_name, c.id as customer_id
       FROM policies p JOIN customers c ON c.id = p.customer_id
       ORDER BY p.created_at DESC`
    )
    .all() as any[];

  const totalFace = rows.reduce((s, r) => s + (r.face_amount || 0), 0);
  const totalAnnual = rows.reduce((s, r) => s + (r.annual_premium || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Policies</h1>
          <p className="text-sm text-slate-500">{rows.length} issued · {fmtMoney0(totalFace)} total face amount · {fmtMoney0(totalAnnual)} annualized premium</p>
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase text-slate-400">
              <th className="px-3 py-2">Client</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Face</th><th className="px-3 py-2">Monthly</th><th className="px-3 py-2">Annual</th>
              <th className="px-3 py-2">Effective</th><th className="px-3 py-2">Policy #</th><th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-line last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/leads/${p.customer_id}`} className="font-medium text-ink hover:text-brand-600">{p.first_name} {p.last_name}</Link>
                </td>
                <td className="px-3 py-2 text-slate-600">{p.carrier}</td>
                <td className="px-3 py-2 text-slate-600">{p.product}</td>
                <td className="px-3 py-2">{fmtMoney0(p.face_amount)}</td>
                <td className="px-3 py-2">{fmtMoney(p.monthly_premium)}</td>
                <td className="px-3 py-2">{fmtMoney0(p.annual_premium)}</td>
                <td className="px-3 py-2 text-slate-600">{p.effective_date}</td>
                <td className="px-3 py-2 text-slate-600">{p.policy_number}</td>
                <td className="px-3 py-2"><Badge label={p.status.toUpperCase()} color={p.status === 'active' ? 'good' : p.status === 'lapsed' ? 'warn' : 'bad'} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">No policies issued yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
