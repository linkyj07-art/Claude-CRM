import { getDb } from '@/lib/db';
import { fmtMoney, fmtMoney0, fmtPct } from '@/lib/util';
import {
  getFunnel, getRoiByVendor, getRoiByAge, getRoiByState, getRoiBySource, getTopLifetimeValue
} from '@/lib/metrics';

export const dynamic = 'force-dynamic';

export default function AnalyticsPage() {
  const db = getDb();
  const funnel = getFunnel(db);
  const vendorRoi = getRoiByVendor(db);
  const ageRoi = getRoiByAge(db);
  const stateRoi = getRoiByState(db).slice(0, 12);
  const sourceRoi = getRoiBySource(db).slice(0, 12);
  const ltv = getTopLifetimeValue(db, 8);

  const leadSpendTotal = (db.prepare(`SELECT COALESCE(SUM(lead_cost),0) s FROM customers`).get() as { s: number }).s;
  const netCommissionTotal = (db.prepare(`SELECT COALESCE(SUM(net_commission),0) s FROM commissions`).get() as { s: number }).s;
  const overallRoi = leadSpendTotal > 0 ? ((netCommissionTotal - leadSpendTotal) / leadSpendTotal) * 100 : null;

  const maxFunnel = funnel[0]?.count || 1;

  const costPerStage = funnel.map((s, i) => ({
    label: s.label,
    cost: s.count > 0 ? leadSpendTotal / s.count : null
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Analytics</h1>
        <p className="text-sm text-slate-500">Full pipeline, cost-per-stage, and ROI by vendor / lead age / state / source — all-time.</p>
      </div>

      {/* Overall ROI */}
      <div className="card flex flex-wrap items-center gap-6 p-4">
        <div>
          <div className="label">Total Lead Spend</div>
          <div className="text-2xl font-bold">{fmtMoney0(leadSpendTotal)}</div>
        </div>
        <div>
          <div className="label">Total Net Commission</div>
          <div className="text-2xl font-bold text-emerald-600">{fmtMoney0(netCommissionTotal)}</div>
        </div>
        <div>
          <div className="label">Overall ROI</div>
          <div className={`text-2xl font-bold ${overallRoi !== null && overallRoi >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {overallRoi !== null ? `${overallRoi.toFixed(0)}%` : '—'}
          </div>
        </div>
      </div>

      {/* Funnel */}
      <div className="card p-4">
        <div className="label mb-3">Sales Funnel</div>
        <div className="space-y-1.5">
          {funnel.map((s, i) => {
            const pctOfTop = maxFunnel > 0 ? (s.count / maxFunnel) * 100 : 0;
            const prev = i > 0 ? funnel[i - 1].count : null;
            const stepConv = prev && prev > 0 ? (s.count / prev) * 100 : null;
            return (
              <div key={s.key} className="flex items-center gap-3">
                <div className="w-32 shrink-0 text-sm text-slate-600">{s.label}</div>
                <div className="h-6 flex-1 rounded bg-slate-100">
                  <div className="h-6 rounded bg-brand-400" style={{ width: `${Math.max(2, pctOfTop)}%` }} />
                </div>
                <div className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums">{s.count}</div>
                <div className="w-16 shrink-0 text-right text-xs text-slate-400 tabular-nums">{stepConv !== null ? `${stepConv.toFixed(0)}%` : ''}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cost per stage */}
      <div className="card p-4">
        <div className="label mb-3">Cost Per Stage (lead spend ÷ stage count)</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {costPerStage.slice(1).map((c) => (
            <div key={c.label} className="rounded-lg border border-line p-2.5">
              <div className="text-xs text-slate-500">Cost / {c.label}</div>
              <div className="text-lg font-bold">{c.cost !== null ? fmtMoney(c.cost) : '—'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ROI by vendor */}
      <div className="card overflow-x-auto p-4">
        <div className="label mb-3">ROI by Lead Vendor</div>
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase text-slate-400">
              <th className="py-1.5 pr-3">Vendor</th><th className="py-1.5 pr-3">Leads</th><th className="py-1.5 pr-3">Spend</th>
              <th className="py-1.5 pr-3">Issued</th><th className="py-1.5 pr-3">Commission</th><th className="py-1.5 pr-3">ROI</th>
            </tr>
          </thead>
          <tbody>
            {vendorRoi.map((v) => (
              <tr key={v.vendor} className="border-b border-line last:border-0">
                <td className="py-1.5 pr-3 font-medium">{v.vendor}</td>
                <td className="py-1.5 pr-3">{v.leads}</td>
                <td className="py-1.5 pr-3">{fmtMoney0(v.spend)}</td>
                <td className="py-1.5 pr-3">{v.issued}</td>
                <td className="py-1.5 pr-3">{fmtMoney0(v.commission)}</td>
                <td className={`py-1.5 pr-3 font-semibold ${v.roi !== null && v.roi >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{v.roi !== null ? `${v.roi.toFixed(0)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ROI by age */}
      <div className="card overflow-x-auto p-4">
        <div className="label mb-3">ROI by Lead Age</div>
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase text-slate-400">
              <th className="py-1.5 pr-3">Bucket</th><th className="py-1.5 pr-3">Leads</th><th className="py-1.5 pr-3">Spend</th>
              <th className="py-1.5 pr-3">Issued</th><th className="py-1.5 pr-3">Commission</th><th className="py-1.5 pr-3">ROI</th>
            </tr>
          </thead>
          <tbody>
            {ageRoi.map((v) => (
              <tr key={v.bucket} className="border-b border-line last:border-0">
                <td className="py-1.5 pr-3 font-medium">{v.bucket}</td>
                <td className="py-1.5 pr-3">{v.leads}</td>
                <td className="py-1.5 pr-3">{fmtMoney0(v.spend)}</td>
                <td className="py-1.5 pr-3">{v.issued}</td>
                <td className="py-1.5 pr-3">{fmtMoney0(v.commission)}</td>
                <td className={`py-1.5 pr-3 font-semibold ${v.roi !== null && v.roi >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{v.roi !== null ? `${v.roi.toFixed(0)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ROI by state */}
      <div className="card overflow-x-auto p-4">
        <div className="label mb-3">ROI by State</div>
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase text-slate-400">
              <th className="py-1.5 pr-3">State</th><th className="py-1.5 pr-3">Leads</th><th className="py-1.5 pr-3">Close Rate</th>
              <th className="py-1.5 pr-3">Spend</th><th className="py-1.5 pr-3">Commission</th><th className="py-1.5 pr-3">ROI</th>
            </tr>
          </thead>
          <tbody>
            {stateRoi.map((v) => (
              <tr key={v.state} className="border-b border-line last:border-0">
                <td className="py-1.5 pr-3 font-medium">{v.state}</td>
                <td className="py-1.5 pr-3">{v.leads}</td>
                <td className="py-1.5 pr-3">{fmtPct(v.closeRate)}</td>
                <td className="py-1.5 pr-3">{fmtMoney0(v.spend)}</td>
                <td className="py-1.5 pr-3">{fmtMoney0(v.commission)}</td>
                <td className={`py-1.5 pr-3 font-semibold ${v.roi !== null && v.roi >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{v.roi !== null ? `${v.roi.toFixed(0)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ROI by source combo */}
      <div className="card overflow-x-auto p-4">
        <div className="label mb-3">ROI by Ad / Platform / Vendor</div>
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase text-slate-400">
              <th className="py-1.5 pr-3">Platform</th><th className="py-1.5 pr-3">Ad Type</th><th className="py-1.5 pr-3">Vendor</th>
              <th className="py-1.5 pr-3">Leads</th><th className="py-1.5 pr-3">Spend</th><th className="py-1.5 pr-3">Issued</th>
              <th className="py-1.5 pr-3">Commission</th><th className="py-1.5 pr-3">ROI</th>
            </tr>
          </thead>
          <tbody>
            {sourceRoi.map((v) => (
              <tr key={v.key} className="border-b border-line last:border-0">
                <td className="py-1.5 pr-3">{v.platform}</td>
                <td className="py-1.5 pr-3">{v.adType}</td>
                <td className="py-1.5 pr-3">{v.vendor}</td>
                <td className="py-1.5 pr-3">{v.leads}</td>
                <td className="py-1.5 pr-3">{fmtMoney0(v.spend)}</td>
                <td className="py-1.5 pr-3">{v.issued}</td>
                <td className="py-1.5 pr-3">{fmtMoney0(v.commission)}</td>
                <td className={`py-1.5 pr-3 font-semibold ${v.roi !== null && v.roi >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{v.roi !== null ? `${v.roi.toFixed(0)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Lifetime value */}
      <div className="card overflow-x-auto p-4">
        <div className="label mb-3">Top Client Lifetime Value</div>
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase text-slate-400">
              <th className="py-1.5 pr-3">Client</th><th className="py-1.5 pr-3">Initial Commission</th>
              <th className="py-1.5 pr-3">Renewals</th><th className="py-1.5 pr-3">Additional Policies</th>
              <th className="py-1.5 pr-3">Referral Value</th><th className="py-1.5 pr-3">LTV</th>
            </tr>
          </thead>
          <tbody>
            {ltv.map((c) => (
              <tr key={c.customerId} className="border-b border-line last:border-0">
                <td className="py-1.5 pr-3 font-medium">
                  <a href={`/leads/${c.customerId}`} className="hover:text-brand-600 hover:underline">{c.name}</a>
                </td>
                <td className="py-1.5 pr-3">{fmtMoney0(c.initialCommission)}</td>
                <td className="py-1.5 pr-3">{fmtMoney0(c.renewals)}</td>
                <td className="py-1.5 pr-3">{c.additionalPolicies}</td>
                <td className="py-1.5 pr-3">{fmtMoney0(c.referralValue)}</td>
                <td className="py-1.5 pr-3 font-semibold text-emerald-600">{fmtMoney0(c.ltv)}</td>
              </tr>
            ))}
            {ltv.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-400">No sold clients yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
