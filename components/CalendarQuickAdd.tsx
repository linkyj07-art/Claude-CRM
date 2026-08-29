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
  const [scheduledAt, setScheduledAt] = useState(`${defaultDate}T09:00`);
  const [type, setType] = useState('phone');
  const [notes, setNotes] = useState('');

  async function search(q: string) {
    setQuery(q);
    setSelected(null);
    if (q.trim().length < 2) { setResults([]); return; }
    const res = await fetch(`/api/leads?q=${encodeURIComponent(q)}`);
    setResults(await res.json());
  }

  async function save() {
    if (!selected) return;
    setBusy(true);
    try {
      await fetch(`/api/leads/${selected.id}/appointments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_at: scheduledAt, type, notes })
      });
      close();
      router.refresh();
    } finally { setBusy(false); }
  }

  function close() {
    setOpen(false);
    setQuery(''); setResults([]); setSelected(null); setNotes('');
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
              <button className="btn-primary w-full" disabled={busy || !selected || !scheduledAt} onClick={save}>
                {busy ? 'Saving…' : 'Save Appointment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
