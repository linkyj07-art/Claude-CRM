'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Badge from './Badge';
import { Customer } from '@/lib/types';
import { statusBadge, leadAgeLabel, fmtMoney0 } from '@/lib/util';

type LeadRow = Customer & { vendor_name: string | null };

export default function LeadsTable({ leads }: { leads: LeadRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const allSelected = leads.length > 0 && selected.size === leads.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)));
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Permanently delete ${selected.size} lead${selected.size === 1 ? '' : 's'}? This can't be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/leads', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) })
      });
      if (!res.ok) {
        alert('Could not delete those leads — please try again.');
        return;
      }
      setSelected(new Set());
      router.refresh();
    } finally { setBusy(false); }
  }

  async function deleteAll() {
    if (confirmText !== 'DELETE ALL') return;
    setBusy(true);
    try {
      const res = await fetch('/api/leads', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true })
      });
      if (!res.ok) {
        alert('Could not delete these leads — please try again.');
        return;
      }
      setConfirmAll(false);
      setConfirmText('');
      setSelected(new Set());
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {selected.size > 0 && (
          <button className="btn-danger text-sm" disabled={busy} onClick={deleteSelected}>
            🗑 Delete Selected ({selected.size})
          </button>
        )}
        <button className="btn-danger text-sm" onClick={() => setConfirmAll(true)}>🗑 Delete All Leads</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase text-slate-400">
              <th className="w-8 px-3 py-2">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all leads" />
              </th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Coverage</th>
              <th className="px-3 py-2">Ad / Platform</th>
              <th className="px-3 py-2">Vendor</th>
              <th className="px-3 py-2">Age</th>
              <th className="px-3 py-2">Lead Cost</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const badge = statusBadge(l.status, l.purchased_at);
              return (
                <tr key={l.id} className={`border-b border-line last:border-0 hover:bg-slate-50 ${selected.has(l.id) ? 'bg-brand-50' : ''}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${l.first_name} ${l.last_name}`} />
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/leads/${l.id}`} className="font-medium text-ink hover:text-brand-600">
                      {l.first_name} {l.last_name}
                    </Link>
                    <div className="text-xs text-slate-400">{l.phone}</div>
                  </td>
                  <td className="px-3 py-2"><Badge label={badge.label} color={badge.color} /></td>
                  <td className="px-3 py-2 text-slate-600">{l.state}</td>
                  <td className="px-3 py-2 text-slate-600">{l.coverage_wanted ? fmtMoney0(l.coverage_wanted) : '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{l.ad_type} / {l.platform}</td>
                  <td className="px-3 py-2 text-slate-600">{l.vendor_name || '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{leadAgeLabel(l.purchased_at)}</td>
                  <td className="px-3 py-2 text-slate-600">{fmtMoney0(l.lead_cost)}</td>
                </tr>
              );
            })}
            {leads.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">No leads match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {confirmAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setConfirmAll(false); setConfirmText(''); }}>
          <div className="w-full max-w-md rounded-xl bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-lg font-bold text-bad">⚠️ Delete ALL leads</h2>
            <p className="mb-3 text-sm text-slate-500">
              This permanently deletes every lead in the system — names, notes, call history, quotes, appointments, everything.
              There is no undo. Type <span className="font-mono font-semibold text-ink">DELETE ALL</span> to confirm.
            </p>
            <input
              className="input mb-3"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE ALL"
              autoFocus
            />
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => { setConfirmAll(false); setConfirmText(''); }}>Cancel</button>
              <button className="btn-danger flex-1" disabled={busy || confirmText !== 'DELETE ALL'} onClick={deleteAll}>
                {busy ? 'Deleting…' : 'Delete Everything'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
