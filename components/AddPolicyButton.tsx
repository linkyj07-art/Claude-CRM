'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Customer, Carrier } from '@/lib/types';
import { US_STATES } from '@/lib/util';
import SellModal from './SellModal';

type AnyRow = Record<string, any>;

// Entry point for logging a policy from the Policies page directly, without
// having to already be on that lead's own page first -- find the lead by
// name/phone (or add them on the spot if they're not in the CRM yet, e.g. a
// referral or a client sold outside the normal call flow), then hand off to
// the same SellModal the lead page itself uses so the policy/commission
// math stays in exactly one place.
export default function AddPolicyButton({ carriers }: { carriers: Carrier[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [showNewLead, setShowNewLead] = useState(false);
  const [newLead, setNewLead] = useState<AnyRow>({ first_name: '', last_name: '', phone: '', state: '' });
  const [creating, setCreating] = useState(false);

  const searchSeq = useRef(0);
  async function search(q: string) {
    setQuery(q);
    if (!q.trim()) { setResults([]); return; }
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const res = await fetch(`/api/leads?q=${encodeURIComponent(q)}`);
      const data = res.ok ? await res.json() : [];
      // A slower earlier request landing after a faster later one would
      // otherwise flash stale results back onto the screen.
      if (seq === searchSeq.current) setResults(data);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }

  async function createLead() {
    if (!newLead.first_name.trim() && !newLead.last_name.trim() && !newLead.phone.trim()) {
      alert('Enter at least a name or phone number.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newLead) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) {
        alert(data.error || 'Could not add that lead — please try again.');
        return;
      }
      // The create endpoint only echoes back {id} (see app/api/leads/route.ts) --
      // SellModal needs the full row (coverage_wanted, lead_cost, etc.), so fetch it.
      const full = await fetch(`/api/leads/${data.id}`);
      if (!full.ok) { alert('Lead was added, but could not load it — find it in Leads and mark it Sold from there.'); return; }
      const { customer } = await full.json();
      setSelected(customer);
    } finally {
      setCreating(false);
    }
  }

  function reset() {
    setOpen(false);
    setQuery('');
    setResults([]);
    setSelected(null);
    setShowNewLead(false);
    setNewLead({ first_name: '', last_name: '', phone: '', state: '' });
  }

  if (selected) {
    return (
      <SellModal
        customer={selected}
        carriers={carriers}
        onClose={reset}
        onSaved={() => { reset(); router.refresh(); }}
      />
    );
  }

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>➕ Add Policy</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={reset}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-bold">➕ Add Policy</h2>
            <p className="mb-3 text-sm text-slate-500">Find the lead this policy belongs to, or add them if they&apos;re not in the CRM yet.</p>

            {!showNewLead ? (
              <>
                <input
                  className="input mb-2 w-full"
                  placeholder="Search name or phone…"
                  value={query}
                  onChange={(e) => search(e.target.value)}
                  autoFocus
                />
                <div className="mb-3 max-h-64 space-y-1 overflow-y-auto">
                  {searching && <div className="px-1 text-xs text-slate-400">Searching…</div>}
                  {!searching && query.trim() && results.length === 0 && (
                    <div className="px-1 text-xs text-slate-400">No matching leads.</div>
                  )}
                  {results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg border border-line p-2 text-left text-sm hover:bg-slate-50"
                      onClick={() => setSelected(r)}
                    >
                      <span className="font-medium">{r.first_name} {r.last_name}</span>
                      <span className="text-xs text-slate-400">{r.phone || '—'}</span>
                    </button>
                  ))}
                </div>
                <button type="button" className="btn-secondary w-full" onClick={() => setShowNewLead(true)}>+ Add New Lead</button>
              </>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" placeholder="First name" value={newLead.first_name} onChange={(e) => setNewLead({ ...newLead, first_name: e.target.value })} />
                  <input className="input" placeholder="Last name" value={newLead.last_name} onChange={(e) => setNewLead({ ...newLead, last_name: e.target.value })} />
                  <input className="input" placeholder="Phone" value={newLead.phone} onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })} />
                  <select className="input" value={newLead.state} onChange={(e) => setNewLead({ ...newLead, state: e.target.value })}>
                    <option value="">State</option>
                    {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary flex-1" onClick={() => setShowNewLead(false)}>Back</button>
                  <button type="button" className="btn-primary flex-1" disabled={creating} onClick={createLead}>
                    {creating ? 'Adding…' : 'Add & Continue'}
                  </button>
                </div>
              </div>
            )}

            <button type="button" className="mt-3 w-full text-center text-xs text-slate-400 hover:underline" onClick={reset}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
