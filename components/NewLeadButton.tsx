'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LeadVendor } from '@/lib/types';
import { US_STATES } from '@/lib/util';

type AnyRow = Record<string, any>;

export default function NewLeadButton({ vendors }: { vendors: LeadVendor[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<AnyRow>({
    first_name: '', last_name: '', phone: '', email: '', state: '', coverage_wanted: '',
    ad_type: 'Final Expense', platform: 'Facebook', lead_vendor_id: vendors[0]?.id || '', lead_cost: '', best_time: 'Evening'
  });

  async function save() {
    setBusy(true);
    try {
      const res = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) {
        alert(data.error || 'Could not add that lead — please try again.');
        return;
      }
      if (data.dncMatch) {
        alert(`Heads up: this phone number is on your internal Do Not Call list (${data.dncReason || 'marked DNC'} on a previous lead). Saved, but marked DNC so it won't be dialed.`);
      }
      setOpen(false);
      router.push(`/leads/${data.id}`);
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <>
      <button className="btn-secondary" onClick={() => setOpen(true)}>+ Add Lead</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-lg font-bold">+ Add Lead</h2>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
              <input className="input" placeholder="Last name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
              <input className="input" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <input className="input" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <select className="input" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>
                <option value="">State</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input className="input" type="number" placeholder="Coverage wanted $" value={form.coverage_wanted} onChange={(e) => setForm({ ...form, coverage_wanted: e.target.value })} />
              <select className="input" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                {['Facebook', 'Google', 'TikTok', 'Direct Mail', 'Referral'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="input" value={form.lead_vendor_id} onChange={(e) => setForm({ ...form, lead_vendor_id: e.target.value })}>
                <option value="">Vendor</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <input className="input" type="number" placeholder="Lead cost $" value={form.lead_cost} onChange={(e) => setForm({ ...form, lead_cost: e.target.value })} />
              <select className="input" value={form.best_time} onChange={(e) => setForm({ ...form, best_time: e.target.value })}>
                {['Morning', 'Afternoon', 'Evening'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <button className="btn-primary mt-3 w-full" disabled={busy || !form.first_name} onClick={save}>
              {busy ? 'Saving…' : 'Add Lead'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
