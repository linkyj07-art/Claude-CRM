'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type LeadHit = { id: string; first_name: string; last_name: string; phone: string | null };

export default function CalendarQuickAdd({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LeadHit[]>([]);
  const [selected, setSelected] = useState<LeadHit | null>(null);
  // Override for someone not in the CRM yet — a quick minimal lead gets
  // created (same as the regular + Add Lead flow) and the appointment
  // attaches to that, so it's not left dangling with no lead record and
  // the person is there to work afterward instead of getting lost.
  const [quickAdd, setQuickAdd] = useState(false);
  const [quickFirst, setQuickFirst] = useState('');
  const [quickLast, setQuickLast] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [scheduledAt, setScheduledAt] = useState(`${defaultDate}T09:00`);
  const [type, setType] = useState('phone');
  const [notes, setNotes] = useState('');

  async function search(q: string) {
    setQuery(q);
    setSelected(null);
    if (q.trim().length < 2) { setResults([]); return; }
    const res = await fetch(`/api/leads?q=${encodeURIComponent(q)}`);
    const data = res.ok ? await res.json() : [];
    setResults(Array.isArray(data) ? data : []);
  }

  async function save() {
    if (!selected && !(quickAdd && quickFirst.trim())) return;
    setBusy(true);
    try {
      let leadId = selected?.id;
      if (!leadId) {
        const leadRes = await fetch('/api/leads', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ first_name: quickFirst.trim(), last_name: quickLast.trim(), phone: quickPhone.trim() || null })
        });
        const leadData = await leadRes.json().catch(() => ({}));
        if (!leadRes.ok || !leadData.id) {
          alert(leadData.error || 'Could not create that lead — please try again.');
          return;
        }
        leadId = leadData.id;
      }

      const res = await fetch(`/api/leads/${leadId}/appointments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_at: scheduledAt, type, notes })
      });
      if (!res.ok) {
        alert('Could not save this appointment — please try again.');
        return;
      }
      close();
      router.refresh();
    } finally { setBusy(false); }
  }

  function close() {
    setOpen(false);
    setQuery(''); setResults([]); setSelected(null); setNotes('');
    setQuickAdd(false); setQuickFirst(''); setQuickLast(''); setQuickPhone('');
    setScheduledAt(`${defaultDate}T09:00`);
  }

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>+ New Appointment</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div className="w-full max-w-md rounded-xl bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">📅 New Appointment</h2>
              <button onClick={close} className="text-slate-400 hover:text-ink">✕</button>
            </div>
            <div className="space-y-2">
              <div>
                <label className="label mb-1 block">Lead</label>
                {selected ? (
                  <div className="flex items-center justify-between rounded-lg border border-line p-2 text-sm">
                    <span>{selected.first_name} {selected.last_name} · {selected.phone || '—'}</span>
                    <button className="text-xs text-brand-600 hover:underline" onClick={() => setSelected(null)}>Change</button>
                  </div>
                ) : quickAdd ? (
                  <div className="space-y-1.5 rounded-lg border border-line p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-500">New lead — not in the CRM yet</span>
                      <button className="text-xs text-brand-600 hover:underline" onClick={() => { setQuickAdd(false); setQuickFirst(''); setQuickLast(''); setQuickPhone(''); }}>
                        Search instead
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input className="input" placeholder="First name" value={quickFirst} onChange={(e) => setQuickFirst(e.target.value)} />
                      <input className="input" placeholder="Last name" value={quickLast} onChange={(e) => setQuickLast(e.target.value)} />
                    </div>
                    <input className="input" placeholder="Phone (optional)" value={quickPhone} onChange={(e) => setQuickPhone(e.target.value)} />
                  </div>
                ) : (
                  <>
                    <input className="input" placeholder="Search leads by name or phone…" value={query} onChange={(e) => search(e.target.value)} />
                    {results.length > 0 && (
                      <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-line">
                        {results.map((r) => (
                          <button
                            key={r.id}
                            className="flex w-full items-center justify-between border-b border-line px-2 py-1.5 text-left text-sm last:border-0 hover:bg-brand-50"
                            onClick={() => setSelected(r)}
                          >
                            <span>{r.first_name} {r.last_name}</span>
                            <span className="text-xs text-slate-400">{r.phone || '—'}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <button className="mt-1 text-xs text-brand-600 hover:underline" onClick={() => setQuickAdd(true)}>
                      Can&apos;t find them? + Add as a new lead
                    </button>
                  </>
                )}
              </div>
              <div>
                <label className="label mb-1 block">Date &amp; Time</label>
                <input className="input" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              </div>
              <div>
                <label className="label mb-1 block">Type</label>
                <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="phone">Phone</option>
                  <option value="in_person">In Person</option>
                  <option value="video">Video</option>
                </select>
              </div>
              <div>
                <label className="label mb-1 block">Notes</label>
                <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <button className="btn-primary w-full" disabled={busy || (!selected && !(quickAdd && quickFirst.trim())) || !scheduledAt} onClick={save}>
                {busy ? 'Saving…' : 'Save Appointment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
