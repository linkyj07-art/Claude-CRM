'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Badge from './Badge';
import {
  Customer, NoteVersion, CallRecord, Policy, Commission, Carrier, CarrierRule, LeadVendor
} from '@/lib/types';
import { fmtMoney, fmtMoney0, leadAgeLabel, localTimeForState, agentLocalTime, statusBadge, maskSSN, maskAccount, isValidRoutingNumber } from '@/lib/util';
import { suggestCarriers } from '@/lib/underwriting';
import RoutingLookup from './RoutingLookup';
import SellModal from './SellModal';

type AnyRow = Record<string, any>;

const NOTE_FIELDS: { key: keyof NoteVersion; label: string; type?: 'text' | 'textarea' | 'date' }[] = [
  { key: 'name', label: 'NAME' },
  { key: 'note_date', label: 'DATE', type: 'date' },
  { key: 'phone', label: 'PHONE #' },
  { key: 'beneficiary', label: 'BENI' },
  { key: 'budget', label: 'BUDGET' },
  { key: 'health', label: 'HEALTH', type: 'textarea' },
  { key: 'discount', label: 'DISCOUNT (Non-Smoker)' },
  { key: 'mailing_address', label: 'MAILING ADDRESS' },
  { key: 'email', label: 'EMAIL' },
  { key: 'born_in', label: 'BORN IN' },
  { key: 'plan_bronze', label: 'BRONZE' },
  { key: 'plan_silver', label: 'SILVER' },
  { key: 'plan_gold', label: 'GOLD' },
  { key: 'draft_date', label: 'DRAFT DATE' },
  { key: 'code_word', label: 'CODE WORD' }
];

function emptyNoteForm(customer: Customer): AnyRow {
  return {
    label: 'Call Note',
    name: `${customer.first_name} ${customer.last_name}`,
    note_date: new Date().toISOString().slice(0, 10),
    phone: customer.phone || '',
    beneficiary: '', budget: '', health: '', discount: '',
    bank_name: '', bank_state: customer.state || '', routing_number: '', account_number: '',
    mailing_address: '', email: customer.email || '', born_in: '', ssn: '',
    plan_bronze: '', plan_silver: '', plan_gold: '', draft_date: '', code_word: '', free_text: ''
  };
}

export default function LeadWorkspace({
  customer, notes, calls, quotes, appointments, applications, policies, commissions, payments, audit, vendors, carriers, rules
}: {
  customer: Customer; notes: NoteVersion[]; calls: CallRecord[]; quotes: AnyRow[]; appointments: AnyRow[];
  applications: AnyRow[]; policies: Policy[]; commissions: Commission[]; payments: AnyRow[]; audit: AnyRow[];
  vendors: LeadVendor[]; carriers: Carrier[]; rules: CarrierRule[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queue = (searchParams.get('queue') || '').split(',').filter(Boolean);
  const isDialing = searchParams.get('dialing') === '1';
  const [busy, setBusy] = useState(false);
  const [noteForm, setNoteForm] = useState<AnyRow>(() => emptyNoteForm(customer));
  const [showSell, setShowSell] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const [showAppt, setShowAppt] = useState(false);
  const [showSensitive, setShowSensitive] = useState(false);
  const [activeTab, setActiveTab] = useState<'timeline' | 'calls' | 'notes' | 'policy'>('timeline');

  const badge = statusBadge(customer.status, customer.purchased_at);
  const suggestions = useMemo(() => suggestCarriers(noteForm.health || '', carriers, rules), [noteForm.health, carriers, rules]);
  const top3 = suggestions.filter((s) => !s.knockout).slice(0, 3);
  const knockouts = suggestions.filter((s) => s.knockout);

  const attemptCount = calls.length;
  const lastNote = notes[0];

  async function refresh() {
    router.refresh();
  }

  async function logCall(outcome: string, disposition?: string) {
    setBusy(true);
    try {
      await fetch(`/api/leads/${customer.id}/calls`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, disposition, duration_seconds: outcome === 'connected' ? 60 : 0 })
      });
      await refresh();
    } finally { setBusy(false); }
  }

  async function saveNote() {
    setBusy(true);
    try {
      await fetch(`/api/leads/${customer.id}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(noteForm)
      });
      await refresh();
    } finally { setBusy(false); }
  }

  async function setStatus(status: string) {
    if (!confirm(`Set lead status to "${status}"?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/leads/${customer.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status })
      });
      await refresh();
    } finally { setBusy(false); }
  }

  function nextInQueue() {
    if (queue.length === 0) { router.push('/leads'); return; }
    const [next, ...rest] = queue;
    const dest = `/leads/${next}?dialing=1${rest.length ? `&queue=${rest.join(',')}` : ''}`;
    router.push(dest);
  }

  return (
    <div className="space-y-4">
      {isDialing && (
        <div className="card flex items-center justify-between bg-brand-50 p-3 text-sm">
          <span className="font-medium text-brand-700">📞 Dialing for the day — {queue.length} more lead{queue.length === 1 ? '' : 's'} in queue</span>
          <div className="flex gap-2">
            <Link href="/leads" className="btn-secondary text-xs">Exit Queue</Link>
            <button className="btn-primary text-xs" onClick={nextInQueue}>Skip / Next Lead ▶</button>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-ink">{customer.first_name} {customer.last_name}</h1>
            <Badge label={badge.label} color={badge.color} />
            {customer.military ? <Badge label={`🎖 ${customer.military_branch || 'Military'}`} color="brand" /> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-slate-500">
            <span>📍 {customer.city ? `${customer.city}, ` : ''}{customer.state}</span>
            <span>🕐 {localTimeForState(customer.state)} local</span>
            <span>🕐 {agentLocalTime()} your time (Mountain)</span>
            <span>{leadAgeLabel(customer.purchased_at)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {customer.phone && (
            <a href={`tel:${customer.phone.replace(/[^\d+]/g, '')}`} className="btn-good" onClick={() => logCall('connected')}>
              📞 Call {customer.phone}
            </a>
          )}
          <button className="btn-secondary" onClick={() => setShowQuote(true)}>🧮 Run Quote</button>
          <button className="btn-secondary" onClick={() => setShowAppt(true)}>📅 Appointment</button>
          {customer.status !== 'sold' && (
            <button className="btn-primary" onClick={() => setShowSell(true)}>💰 Sold</button>
          )}
          <button className="btn-danger" onClick={() => setStatus('disputed')}>🚫 Dispute</button>
          <button className="btn-secondary" onClick={() => setStatus('archived')}>🗑 Archive</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr_320px]">
        {/* Lead info panel */}
        <div className="card space-y-3 p-4">
          <div className="label">Lead Information</div>
          <dl className="space-y-2 text-sm">
            <InfoRow label="📞 Phone" value={customer.phone} />
            <InfoRow label="✉️ Email" value={customer.email} />
            <InfoRow label="🎂 DOB" value={customer.dob} />
            <InfoRow label="♂ Gender" value={customer.gender} />
            <InfoRow label="💰 Coverage" value={customer.coverage_wanted ? fmtMoney0(customer.coverage_wanted) : null} />
            <InfoRow label="💍 Marital" value={customer.marital_status} />
            <InfoRow label="📢 Ad" value={customer.ad_type} />
            <InfoRow label="📱 Platform" value={customer.platform} />
            <InfoRow label="🕐 Best Time" value={customer.best_time} />
            <InfoRow label="🏷 Vendor" value={vendors.find((v) => v.id === customer.lead_vendor_id)?.name} />
            <InfoRow label="💵 Lead Cost" value={fmtMoney(customer.lead_cost)} />
          </dl>

          <div className="border-t border-line pt-3">
            <div className="label mb-2">Call Attempts</div>
            <div className="text-2xl font-bold tabular-nums">{attemptCount}</div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <button disabled={busy} onClick={() => logCall('no_answer')} className="btn-secondary text-xs px-2 py-1.5">No Answer</button>
              <button disabled={busy} onClick={() => logCall('voicemail')} className="btn-secondary text-xs px-2 py-1.5">Voicemail</button>
              <button disabled={busy} onClick={() => logCall('busy')} className="btn-secondary text-xs px-2 py-1.5">Busy</button>
              <button disabled={busy} onClick={() => logCall('wrong_number')} className="btn-secondary text-xs px-2 py-1.5">Wrong #</button>
              <button disabled={busy} onClick={() => logCall('dnc')} className="btn-danger text-xs px-2 py-1.5">DNC</button>
              <button disabled={busy} onClick={() => logCall('connected', 'interested')} className="btn-good text-xs px-2 py-1.5">Connected</button>
            </div>
          </div>

          {/* Carrier suggestions based on HEALTH note */}
          <div className="border-t border-line pt-3">
            <div className="label mb-2">💡 Suggested Carrier Order</div>
            {noteForm.health?.trim() ? (
              <div className="space-y-1.5">
                {top3.map((s, i) => (
                  <div key={s.carrier.id} className="rounded-lg border border-line bg-slate-50 p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">#{i + 1} {s.carrier.name}</span>
                      {s.carrier.agent_portal_url && (
                        <a href={s.carrier.agent_portal_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-600 hover:underline">
                          Agent Login →
                        </a>
                      )}
                    </div>
                    {s.tierNotes[0] && <div className="mt-0.5 text-xs text-slate-500">{s.tierNotes[0]}</div>}
                    {s.matchedKeywords.length > 0 && (
                      <div className="mt-0.5 text-[11px] text-slate-400">matched: {Array.from(new Set(s.matchedKeywords)).join(', ')}</div>
                    )}
                  </div>
                ))}
                {knockouts.length > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2">
                    <div className="text-xs font-semibold text-red-700">⚠ Avoid running first:</div>
                    {knockouts.map((k) => (
                      <div key={k.carrier.id} className="text-xs text-red-600">{k.carrier.name} — {Array.from(new Set(k.knockoutReasons)).join(', ')}</div>
                    ))}
                  </div>
                )}
                <div className="text-[11px] text-slate-400">Based on your keyword rules in Manage Carriers — always verify against the carrier&apos;s actual field guide.</div>
              </div>
            ) : (
              <div className="text-xs text-slate-400">Type in the HEALTH field to get a suggested carrier order, ranked from your carrier rules.</div>
            )}
          </div>
        </div>

        {/* Notes panel */}
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="label">Notes</div>
            <button
              className="text-xs font-medium text-brand-600 hover:underline"
              onClick={() => setShowSensitive((v) => !v)}
              type="button"
            >
              {showSensitive ? 'Hide' : 'Show'} bank / SSN fields
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {NOTE_FIELDS.map((f) => (
              <div key={String(f.key)} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                <label className="label mb-1 block">{f.label}</label>
                {f.type === 'textarea' ? (
                  <textarea
                    className="input min-h-[70px]"
                    value={noteForm[f.key] || ''}
                    onChange={(e) => setNoteForm((s) => ({ ...s, [f.key]: e.target.value }))}
                    placeholder="e.g. controlled diabetes, non-smoker, high blood pressure..."
                  />
                ) : (
                  <input
                    className="input"
                    type={f.type === 'date' ? 'date' : 'text'}
                    value={noteForm[f.key] || ''}
                    onChange={(e) => setNoteForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>

          {showSensitive && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="mb-2 text-xs font-semibold text-amber-800">🔒 Protected financial info — kept out of lead lists &amp; search</div>
              <RoutingLookup
                bankName={noteForm.bank_name}
                state={noteForm.bank_state || customer.state || ''}
                routingNumber={noteForm.routing_number}
                onBankChange={(v) => setNoteForm((s) => ({ ...s, bank_name: v }))}
                onStateChange={(v) => setNoteForm((s) => ({ ...s, bank_state: v }))}
                onRoutingChange={(v) => setNoteForm((s) => ({ ...s, routing_number: v }))}
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="label mb-1 block">ACCOUNT #</label>
                  <input className="input" value={noteForm.account_number || ''} onChange={(e) => setNoteForm((s) => ({ ...s, account_number: e.target.value }))} />
                </div>
                <div>
                  <label className="label mb-1 block">SSN</label>
                  <input className="input" value={noteForm.ssn || ''} onChange={(e) => setNoteForm((s) => ({ ...s, ssn: e.target.value }))} placeholder="XXX-XX-XXXX" />
                </div>
              </div>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-400">{notes.length} saved version{notes.length === 1 ? '' : 's'}</span>
            <button className="btn-primary" disabled={busy} onClick={saveNote}>💾 Save Note</button>
          </div>
        </div>

        {/* Right: quick summary + status actions */}
        <div className="space-y-4">
          <div className="card p-4">
            <div className="label mb-2">Funnel Status</div>
            <div className="space-y-1.5 text-sm">
              <FunnelRow label="Quotes run" value={quotes.length} />
              <FunnelRow label="Appointments" value={appointments.length} />
              <FunnelRow label="Applications" value={applications.length} />
              <FunnelRow label="Policies" value={policies.length} />
            </div>
          </div>
          {policies.length > 0 && (
            <div className="card p-4">
              <div className="label mb-2">💰 Policy &amp; Commission</div>
              {policies.map((p) => {
                const comm = commissions.find((c) => c.policy_id === p.id);
                return (
                  <div key={p.id} className="mb-3 border-b border-line pb-3 last:mb-0 last:border-0 last:pb-0">
                    <div className="text-sm font-semibold">{p.carrier}</div>
                    <div className="text-xs text-slate-500">{p.product} · {p.policy_number}</div>
                    <div className="mt-1 text-sm">Face: {fmtMoney0(p.face_amount)} · {fmtMoney(p.monthly_premium)}/mo</div>
                    {comm && (
                      <div className="mt-1 text-sm font-semibold text-emerald-600">Net Commission: {fmtMoney(comm.net_commission)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="card p-4">
            <div className="label mb-2">Status</div>
            <div className="flex flex-wrap gap-1.5">
              <button className="btn-secondary text-xs" onClick={() => setStatus('working')}>Working</button>
              <button className="btn-secondary text-xs" onClick={() => setStatus('lost')}>Lost</button>
              <button className="btn-secondary text-xs" onClick={() => setStatus('invalid')}>Invalid</button>
              <button className="btn-secondary text-xs" onClick={() => setStatus('dnc')}>DNC</button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs: timeline / calls / notes history / policy */}
      <div className="card p-4">
        <div className="mb-3 flex gap-1 border-b border-line">
          {(['timeline', 'calls', 'notes'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-3 py-2 text-sm font-medium capitalize border-b-2 -mb-px ${activeTab === t ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-ink'}`}
            >
              {t === 'timeline' ? 'Full Timeline' : t === 'calls' ? 'Call History' : 'Notes History'}
            </button>
          ))}
        </div>

        {activeTab === 'timeline' && (
          <ol className="space-y-2">
            {audit.map((a) => (
              <li key={a.id} className="flex gap-3 text-sm">
                <span className="w-40 shrink-0 text-xs text-slate-400 tabular-nums">{a.occurred_at}</span>
                <span className="text-ink">{a.summary}</span>
              </li>
            ))}
            {audit.length === 0 && <div className="text-sm text-slate-400">No activity yet.</div>}
          </ol>
        )}

        {activeTab === 'calls' && (
          <div className="space-y-2">
            {calls.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg border border-line p-2.5 text-sm">
                <span className="w-40 shrink-0 text-xs text-slate-400 tabular-nums">{c.occurred_at}</span>
                <span className="font-medium">Attempt #{c.attempt_number}</span>
                <Badge label={c.outcome.replace('_', ' ').toUpperCase()} color={c.outcome === 'connected' ? 'good' : c.outcome === 'dnc' ? 'bad' : 'brand'} />
                {c.disposition && <span className="text-slate-500">Disposition: {c.disposition}</span>}
              </div>
            ))}
            {calls.length === 0 && <div className="text-sm text-slate-400">No calls logged yet.</div>}
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="space-y-3">
            {notes.map((n) => (
              <details key={n.id} className="rounded-lg border border-line p-2.5">
                <summary className="cursor-pointer text-sm font-medium">
                  {n.label} — {n.created_at} <span className="text-slate-400">by {n.created_by}</span>
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-600 sm:grid-cols-3">
                  {NOTE_FIELDS.filter((f) => n[f.key]).map((f) => (
                    <div key={String(f.key)}><span className="text-slate-400">{f.label}:</span> {String(n[f.key])}</div>
                  ))}
                  {n.bank_name && <div><span className="text-slate-400">BANK:</span> {n.bank_name}</div>}
                  {n.routing_number && <div><span className="text-slate-400">ROUTING:</span> {n.routing_number}</div>}
                  {n.account_number && <div><span className="text-slate-400">ACCT:</span> {maskAccount(n.account_number)}</div>}
                  {n.ssn && <div><span className="text-slate-400">SSN:</span> {maskSSN(n.ssn)}</div>}
                </div>
              </details>
            ))}
            {notes.length === 0 && <div className="text-sm text-slate-400">No notes yet.</div>}
          </div>
        )}
      </div>

      {showQuote && <QuoteModal customer={customer} onClose={() => setShowQuote(false)} onSaved={refresh} />}
      {showAppt && <ApptModal customer={customer} onClose={() => setShowAppt(false)} onSaved={refresh} />}
      {showSell && (
        <SellModal
          customer={customer}
          carriers={carriers}
          onClose={() => setShowSell(false)}
          onSaved={async () => { setShowSell(false); await refresh(); }}
        />
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-ink">{value || '—'}</dd>
    </div>
  );
}

function FunnelRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-ink">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function QuoteModal({ customer, onClose, onSaved }: { customer: Customer; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AnyRow>({ carrier: '', product: '', face_amount: customer.coverage_wanted || '', monthly_premium: '', notes: '' });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await fetch(`/api/leads/${customer.id}/quotes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      onSaved(); onClose();
    } finally { setBusy(false); }
  }
  return (
    <Modal title="🧮 Run Quote" onClose={onClose}>
      <div className="space-y-2">
        <Field label="Carrier"><input className="input" value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} /></Field>
        <Field label="Product"><input className="input" value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} /></Field>
        <Field label="Face Amount"><input className="input" type="number" value={form.face_amount} onChange={(e) => setForm({ ...form, face_amount: e.target.value })} /></Field>
        <Field label="Monthly Premium"><input className="input" type="number" value={form.monthly_premium} onChange={(e) => setForm({ ...form, monthly_premium: e.target.value })} /></Field>
        <Field label="Notes"><textarea className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <button className="btn-primary w-full" disabled={busy} onClick={save}>Save Quote</button>
      </div>
    </Modal>
  );
}

function ApptModal({ customer, onClose, onSaved }: { customer: Customer; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AnyRow>({ scheduled_at: '', type: 'phone', notes: '' });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await fetch(`/api/leads/${customer.id}/appointments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      onSaved(); onClose();
    } finally { setBusy(false); }
  }
  return (
    <Modal title="📅 Set Appointment" onClose={onClose}>
      <div className="space-y-2">
        <Field label="Date &amp; Time"><input className="input" type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} /></Field>
        <Field label="Type">
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="phone">Phone</option>
            <option value="in_person">In Person</option>
            <option value="video">Video</option>
          </select>
        </Field>
        <Field label="Notes"><textarea className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <button className="btn-primary w-full" disabled={busy || !form.scheduled_at} onClick={save}>Save Appointment</button>
      </div>
    </Modal>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label mb-1 block">{label}</label>
      {children}
    </div>
  );
}
