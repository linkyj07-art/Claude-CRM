'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Carrier, CarrierRule, QuickLink } from '@/lib/types';
import { US_STATES } from '@/lib/util';

type AnyRow = Record<string, any>;

export default function SettingsManager({
  carriers, rules, quickLinks, licensedStates
}: {
  carriers: Carrier[]; rules: CarrierRule[]; quickLinks: QuickLink[]; licensedStates: string[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'carriers' | 'rules' | 'links' | 'licensing'>('carriers');

  async function refresh() { router.refresh(); }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-line">
        {(['carriers', 'rules', 'links', 'licensing'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-ink'}`}
          >
            {t === 'carriers' ? '🏢 Carriers & Logins' : t === 'rules' ? '💡 Underwriting Rules' : t === 'links' ? '🔗 Quick Links' : '🪪 Licensed States'}
          </button>
        ))}
      </div>

      {tab === 'carriers' && <CarriersTab carriers={carriers} onChanged={refresh} />}
      {tab === 'rules' && <RulesTab carriers={carriers} rules={rules} onChanged={refresh} />}
      {tab === 'links' && <LinksTab quickLinks={quickLinks} onChanged={refresh} />}
      {tab === 'licensing' && <LicensingTab licensedStates={licensedStates} onChanged={refresh} />}
    </div>
  );
}

function LicensingTab({ licensedStates, onChanged }: { licensedStates: string[]; onChanged: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(licensedStates));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggle(state: string) {
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state); else next.add(state);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    try {
      await fetch('/api/settings/licensed-states', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ states: Array.from(selected) })
      });
      setSaved(true);
      onChanged();
    } finally { setBusy(false); }
  }

  return (
    <div className="card p-4">
      <div className="mb-3 text-sm text-slate-600">
        Check every state you're licensed to sell in. When you log a call on a lead outside these states,
        it gets flagged on the <strong>Review Queue</strong> instead of getting worked as a normal lead.
      </div>
      <div className="mb-3 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {US_STATES.map((s) => (
          <label key={s} className={`flex cursor-pointer items-center justify-center rounded-lg border p-2 text-sm font-medium ${selected.has(s) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-slate-500 hover:bg-slate-50'}`}>
            <input type="checkbox" className="sr-only" checked={selected.has(s)} onChange={() => toggle(s)} />
            {s}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save Licensed States'}</button>
        {saved && <span className="text-sm text-emerald-600">Saved.</span>}
      </div>
    </div>
  );
}

function CarriersTab({ carriers, onChanged }: { carriers: Carrier[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<AnyRow>({ name: '', agent_portal_url: '', application_url: '', claims_url: '', support_phone: '', notes: '' });
  const [busy, setBusy] = useState(false);

  async function addCarrier() {
    setBusy(true);
    try {
      await fetch('/api/carriers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      setForm({ name: '', agent_portal_url: '', application_url: '', claims_url: '', support_phone: '', notes: '' });
      setAdding(false);
      onChanged();
    } finally { setBusy(false); }
  }

  async function saveCarrier(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    await fetch(`/api/carriers/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    onChanged();
  }

  async function deleteCarrier(id: string) {
    if (!confirm('Remove this carrier? Its underwriting rules will be removed too.')) return;
    await fetch(`/api/carriers/${id}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="label">Carriers</div>
        <button className="btn-secondary text-xs" onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : '+ Add Carrier'}</button>
      </div>

      {adding && (
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-line bg-slate-50 p-3">
          <input className="input" placeholder="Carrier name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Support phone" value={form.support_phone} onChange={(e) => setForm({ ...form, support_phone: e.target.value })} />
          <input className="input col-span-2" placeholder="Agent login URL" value={form.agent_portal_url} onChange={(e) => setForm({ ...form, agent_portal_url: e.target.value })} />
          <input className="input col-span-2" placeholder="eApp / application URL" value={form.application_url} onChange={(e) => setForm({ ...form, application_url: e.target.value })} />
          <input className="input col-span-2" placeholder="Claims / service URL" value={form.claims_url} onChange={(e) => setForm({ ...form, claims_url: e.target.value })} />
          <button className="btn-primary col-span-2" disabled={busy || !form.name} onClick={addCarrier}>Add Carrier</button>
        </div>
      )}

      <div className="space-y-2">
        {carriers.map((c) => (
          <form key={c.id} onSubmit={(e) => saveCarrier(c.id, e)} className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3">
            <input className="input" name="name" defaultValue={c.name} placeholder="Carrier name" />
            <input className="input" name="support_phone" defaultValue={c.support_phone || ''} placeholder="Support phone" />
            <input className="input col-span-2" name="agent_portal_url" defaultValue={c.agent_portal_url || ''} placeholder="Agent login URL" />
            <input className="input col-span-2" name="application_url" defaultValue={c.application_url || ''} placeholder="eApp URL" />
            <input className="input col-span-2" name="claims_url" defaultValue={c.claims_url || ''} placeholder="Claims URL" />
            <div className="col-span-2 flex gap-2">
              <button type="submit" className="btn-secondary text-xs">Save</button>
              <button type="button" className="btn-danger text-xs" onClick={() => deleteCarrier(c.id)}>Delete</button>
              {c.agent_portal_url && <a href={c.agent_portal_url} target="_blank" rel="noreferrer" className="btn-secondary text-xs ml-auto">🔑 Agent Login →</a>}
            </div>
          </form>
        ))}
        {carriers.length === 0 && <div className="text-sm text-slate-400">No carriers yet — add your first one above.</div>}
      </div>
    </div>
  );
}

function RulesTab({ carriers, rules, onChanged }: { carriers: Carrier[]; rules: CarrierRule[]; onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm text-slate-600">
        Add keywords for each carrier (comma-separated — e.g. <code className="rounded bg-slate-100 px-1">diabetes, insulin, a1c</code>).
        When those words show up in a lead&apos;s HEALTH note, that carrier gets ranked in the Suggested Carrier Order.
        Turn on <strong>Avoid / knockout</strong> for conditions that carrier typically declines, so it gets flagged instead of recommended.
        This is a starting point from general FEX practice — always confirm against each carrier&apos;s actual field guide.
      </div>
      {carriers.map((c) => (
        <CarrierRuleCard key={c.id} carrier={c} rules={rules.filter((r) => r.carrier_id === c.id)} onChanged={onChanged} />
      ))}
      {carriers.length === 0 && <div className="card p-4 text-sm text-slate-400">Add a carrier first, under the Carriers tab.</div>}
    </div>
  );
}

function CarrierRuleCard({ carrier, rules, onChanged }: { carrier: Carrier; rules: CarrierRule[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<AnyRow>({ keywords: '', tier_note: '', priority: 0, is_knockout: false });
  const [busy, setBusy] = useState(false);

  async function addRule() {
    setBusy(true);
    try {
      await fetch('/api/underwriting-rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, carrier_id: carrier.id })
      });
      setForm({ keywords: '', tier_note: '', priority: 0, is_knockout: false });
      setAdding(false);
      onChanged();
    } finally { setBusy(false); }
  }

  async function saveRule(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      keywords: fd.get('keywords'),
      tier_note: fd.get('tier_note'),
      priority: Number(fd.get('priority') || 0),
      is_knockout: fd.get('is_knockout') === 'on'
    };
    await fetch(`/api/underwriting-rules/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    onChanged();
  }

  async function deleteRule(id: string) {
    await fetch(`/api/underwriting-rules/${id}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold">{carrier.name}</div>
        <button className="btn-secondary text-xs" onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : '+ Add Rule'}</button>
      </div>

      {adding && (
        <div className="mb-2 grid grid-cols-1 gap-2 rounded-lg border border-line bg-slate-50 p-3 sm:grid-cols-2">
          <input className="input sm:col-span-2" placeholder="Keywords, comma separated" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
          <input className="input" placeholder="Tier note (e.g. Level Benefit up to $15k)" value={form.tier_note} onChange={(e) => setForm({ ...form, tier_note: e.target.value })} />
          <input className="input" type="number" placeholder="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.is_knockout} onChange={(e) => setForm({ ...form, is_knockout: e.target.checked })} />
            Avoid / knockout — flag this carrier instead of recommending it when matched
          </label>
          <button className="btn-primary sm:col-span-2" disabled={busy || !form.keywords} onClick={addRule}>Add Rule</button>
        </div>
      )}

      <div className="space-y-1.5">
        {rules.map((r) => (
          <form key={r.id} onSubmit={(e) => saveRule(r.id, e)} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_1fr_80px_auto_auto]">
            <input className="input" name="keywords" defaultValue={r.keywords} />
            <input className="input" name="tier_note" defaultValue={r.tier_note || ''} placeholder="Tier note" />
            <input className="input" name="priority" type="number" defaultValue={r.priority} />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="is_knockout" defaultChecked={!!r.is_knockout} /> Avoid
            </label>
            <div className="flex gap-1">
              <button type="submit" className="btn-secondary text-xs">Save</button>
              <button type="button" className="btn-danger text-xs" onClick={() => deleteRule(r.id)}>✕</button>
            </div>
          </form>
        ))}
        {rules.length === 0 && !adding && <div className="text-xs text-slate-400">No rules yet for {carrier.name}.</div>}
      </div>
    </div>
  );
}

function LinksTab({ quickLinks, onChanged }: { quickLinks: QuickLink[]; onChanged: () => void }) {
  const [form, setForm] = useState<AnyRow>({ category: 'quoter', label: '', url: '' });
  const [busy, setBusy] = useState(false);

  async function addLink() {
    setBusy(true);
    try {
      await fetch('/api/quick-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      setForm({ category: 'quoter', label: '', url: '' });
      onChanged();
    } finally { setBusy(false); }
  }

  async function saveLink(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    await fetch(`/api/quick-links/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    onChanged();
  }

  async function deleteLink(id: string) {
    await fetch(`/api/quick-links/${id}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div className="card p-4">
      <div className="label mb-3">Quoter &amp; Resource Links</div>
      <div className="mb-3 grid grid-cols-1 gap-2 rounded-lg border border-line bg-slate-50 p-3 sm:grid-cols-[140px_1fr_1fr_auto]">
        <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          <option value="quoter">Quoter</option>
          <option value="resource">Resource</option>
          <option value="general">General</option>
        </select>
        <input className="input" placeholder="Label (e.g. FEX Lite Quoter)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <input className="input" placeholder="https://…" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        <button className="btn-primary" disabled={busy || !form.label || !form.url} onClick={addLink}>+ Add</button>
      </div>
      <div className="space-y-1.5">
        {quickLinks.map((l) => (
          <form key={l.id} onSubmit={(e) => saveLink(l.id, e)} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[140px_1fr_1fr_auto] rounded-lg border border-line p-2">
            <select className="input" name="category" defaultValue={l.category}>
              <option value="quoter">Quoter</option>
              <option value="resource">Resource</option>
              <option value="general">General</option>
            </select>
            <input className="input" name="label" defaultValue={l.label} />
            <input className="input" name="url" defaultValue={l.url} />
            <div className="flex gap-1">
              <button type="submit" className="btn-secondary text-xs">Save</button>
              <button type="button" className="btn-danger text-xs" onClick={() => deleteLink(l.id)}>✕</button>
            </div>
          </form>
        ))}
        {quickLinks.length === 0 && <div className="text-xs text-slate-400">No quick links yet.</div>}
      </div>
    </div>
  );
}
