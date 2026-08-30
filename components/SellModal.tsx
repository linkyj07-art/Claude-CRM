'use client';

import { useMemo, useState } from 'react';
import { Customer, Carrier } from '@/lib/types';
import { fmtMoney } from '@/lib/util';

type AnyRow = Record<string, any>;

export default function SellModal({
  customer, carriers, onClose, onSaved
}: {
  customer: Customer; carriers: Carrier[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<AnyRow>({
    carrier: carriers[0]?.name || '',
    product: '',
    policy_type: 'Whole Life',
    face_amount: customer.coverage_wanted || '',
    monthly_premium: '',
    effective_date: new Date().toISOString().slice(0, 10),
    policy_number: '',
    agent: 'You',
    commission_pct: 100,
    commission_type: 'advance',
    expected_pay_date: '',
    actual_pay_date: '',
    chargeback: 0
  });
  const [busy, setBusy] = useState(false);

  const annualPremium = useMemo(() => {
    const m = parseFloat(form.monthly_premium) || 0;
    return Math.round(m * 12 * 100) / 100;
  }, [form.monthly_premium]);

  const expectedCommission = useMemo(() => {
    const pct = parseFloat(form.commission_pct) || 0;
    return Math.round(annualPremium * (pct / 100) * 100) / 100;
  }, [annualPremium, form.commission_pct]);

  const netCommission = useMemo(() => {
    const cb = parseFloat(form.chargeback) || 0;
    return Math.round((expectedCommission - cb) * 100) / 100;
  }, [expectedCommission, form.chargeback]);

  const leadRoi = useMemo(() => {
    const cost = customer.lead_cost || 0;
    if (!cost) return null;
    return ((netCommission - cost) / cost) * 100;
  }, [netCommission, customer.lead_cost]);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${customer.id}/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, annual_premium: annualPremium, expected_commission: expectedCommission, net_commission: netCommission })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Could not record this sale — please try again.');
        return;
      }
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">💰 Mark Sold — {customer.first_name} {customer.last_name}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-ink">✕</button>
        </div>

        <div className="mb-3 rounded-lg bg-brand-50 p-3 text-sm text-brand-700">
          This converts the lead into a Policy + Commission record while keeping the full lead/call/notes history attached to the same customer.
        </div>

        <div className="mb-4">
          <div className="label mb-2">Policy</div>
          <div className="grid grid-cols-2 gap-2">
            <F label="Carrier">
              <select className="input" value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })}>
                {carriers.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                {carriers.length === 0 && <option value="">Add a carrier first</option>}
              </select>
            </F>
            <F label="Product"><input className="input" value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} /></F>
            <F label="Policy Type"><input className="input" value={form.policy_type} onChange={(e) => setForm({ ...form, policy_type: e.target.value })} /></F>
            <F label="Policy Number"><input className="input" value={form.policy_number} onChange={(e) => setForm({ ...form, policy_number: e.target.value })} /></F>
            <F label="Face Amount"><input className="input" type="number" value={form.face_amount} onChange={(e) => setForm({ ...form, face_amount: e.target.value })} /></F>
            <F label="Monthly Premium"><input className="input" type="number" value={form.monthly_premium} onChange={(e) => setForm({ ...form, monthly_premium: e.target.value })} /></F>
            <F label="Annual Premium"><input className="input bg-slate-50" readOnly value={fmtMoney(annualPremium)} /></F>
            <F label="Effective Date"><input className="input" type="date" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} /></F>
            <F label="Agent"><input className="input" value={form.agent} onChange={(e) => setForm({ ...form, agent: e.target.value })} /></F>
          </div>
        </div>

        <div className="mb-4">
          <div className="label mb-2">Commission</div>
          <div className="grid grid-cols-2 gap-2">
            <F label="Commission %"><input className="input" type="number" value={form.commission_pct} onChange={(e) => setForm({ ...form, commission_pct: e.target.value })} /></F>
            <F label="Commission Type">
              <select className="input" value={form.commission_type} onChange={(e) => setForm({ ...form, commission_type: e.target.value })}>
                <option value="advance">Advance</option>
                <option value="as_earned">As Earned</option>
              </select>
            </F>
            <F label="Expected Commission"><input className="input bg-slate-50" readOnly value={fmtMoney(expectedCommission)} /></F>
            <F label="Chargeback"><input className="input" type="number" value={form.chargeback} onChange={(e) => setForm({ ...form, chargeback: e.target.value })} /></F>
            <F label="Expected Pay Date"><input className="input" type="date" value={form.expected_pay_date} onChange={(e) => setForm({ ...form, expected_pay_date: e.target.value })} /></F>
            <F label="Actual Pay Date"><input className="input" type="date" value={form.actual_pay_date} onChange={(e) => setForm({ ...form, actual_pay_date: e.target.value })} /></F>
            <F label="Net Commission"><input className="input bg-slate-50 font-semibold text-emerald-600" readOnly value={fmtMoney(netCommission)} /></F>
          </div>
        </div>

        <div className="mb-4 rounded-lg border border-line bg-slate-50 p-3">
          <div className="label mb-1">Sale Economics</div>
          <div className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
            <div><span className="text-slate-500">Lead Cost:</span> <span className="font-semibold">{fmtMoney(customer.lead_cost)}</span></div>
            <div><span className="text-slate-500">Net Commission:</span> <span className="font-semibold">{fmtMoney(netCommission)}</span></div>
            <div className="col-span-2"><span className="text-slate-500">Lead ROI:</span> <span className="font-bold text-emerald-600">{leadRoi === null ? '—' : `${leadRoi.toFixed(0)}%`}</span></div>
          </div>
        </div>

        <button className="btn-primary w-full" disabled={busy || !form.carrier} onClick={save}>
          {busy ? 'Saving…' : '💰 Confirm Sale'}
        </button>
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label mb-1 block">{label}</label>
      {children}
    </div>
  );
}
