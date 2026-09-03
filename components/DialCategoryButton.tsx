'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type CategoryCounts = { fresh: number; working: number; aging_45_90: number; aging_90_plus: number };

const AGE_CATEGORIES: { key: 'fresh' | 'aging_45_90' | 'aging_90_plus'; label: string }[] = [
  { key: 'fresh', label: 'Fresh' },
  { key: 'aging_45_90', label: '45-90 Day' },
  { key: 'aging_90_plus', label: '90+ Day' }
];

// Which lead categories feed the dialer, with a live count per category so
// it's clear how many leads a choice actually includes before starting a
// session -- rather than only finding out after Power Dial is already
// running which leads it picked up. Fetches its own counts (from
// /api/leads/status-counts) rather than requiring a server-computed prop,
// so this same button can drop into any page -- the dashboard, Calls,
// Leads -- with just the import; every other "⚡ Power Dial" link used to
// be a plain <a href="/dial"> on pages besides Leads, silently skipping
// this picker (and the import-date filter) entirely.
export default function DialCategoryButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<CategoryCounts | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({ fresh: true, aging_45_90: true, aging_90_plus: true });
  // Independent of the age-status categories above -- filters by when a
  // lead was actually imported (customers.created_at), for a batch bought
  // on a specific day/range rather than by its current fresh/aging bucket.
  // Both optional; blank means no bound on that side.
  const [importedFrom, setImportedFrom] = useState('');
  const [importedTo, setImportedTo] = useState('');

  useEffect(() => {
    if (!open || counts) return;
    let cancelled = false;
    fetch('/api/leads/status-counts')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setCounts(data);
      })
      .catch(() => {
        // best-effort -- the picker still works without counts, just shows 0s
      });
    return () => { cancelled = true; };
  }, [open, counts]);

  function toggle(key: string) {
    setSelected((s) => ({ ...s, [key]: !s[key] }));
  }

  function start() {
    // Working leads (already contacted/qualified) always ride along --
    // that's an engagement track, not an age bucket, so it isn't one of the
    // toggles here. At least one age category has to be picked or there's
    // nothing fresh/aging to actually queue.
    const chosen = AGE_CATEGORIES.filter((c) => selected[c.key]).map((c) => c.key);
    if (chosen.length === 0) {
      alert('Pick at least one category.');
      return;
    }
    const params = new URLSearchParams({ categories: ['working', ...chosen].join(',') });
    if (importedFrom) params.set('importedFrom', importedFrom);
    if (importedTo) params.set('importedTo', importedTo);
    router.push(`/dial?${params.toString()}`);
  }

  const c = counts || { fresh: 0, working: 0, aging_45_90: 0, aging_90_plus: 0 };
  const selectedTotal = c.working + AGE_CATEGORIES.reduce((sum, cat) => sum + (selected[cat.key] ? c[cat.key] : 0), 0);

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>⚡ Power Dial</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          {/* max-h + overflow-y-auto -- without this, a shorter browser
              window clips the Imported date fields and the Start button
              below the visible screen with no way to scroll down and
              reach them at all. */}
          <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-bold">Choose Dialer Categories</h2>
            <p className="mb-3 text-sm text-slate-500">
              Pick which lead ages Power Dial pulls from. Working leads ({counts ? c.working : '…'}) are always included.
            </p>
            <div className="mb-4 space-y-2">
              {AGE_CATEGORIES.map((cat) => (
                <label key={cat.key} className="flex cursor-pointer items-center justify-between rounded-lg border border-line p-2.5 text-sm">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={!!selected[cat.key]} onChange={() => toggle(cat.key)} />
                    {cat.label}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">{counts ? c[cat.key] : '…'} leads</span>
                </label>
              ))}
            </div>
            <div className="mb-4">
              <div className="label mb-1">Imported (optional)</div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  className="input flex-1"
                  value={importedFrom}
                  max={importedTo || undefined}
                  onChange={(e) => setImportedFrom(e.target.value)}
                  aria-label="Imported on or after"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="date"
                  className="input flex-1"
                  value={importedTo}
                  min={importedFrom || undefined}
                  onChange={(e) => setImportedTo(e.target.value)}
                  aria-label="Imported on or before"
                />
              </div>
              {(importedFrom || importedTo) && (
                <button type="button" className="mt-1 text-xs text-slate-400 hover:underline" onClick={() => { setImportedFrom(''); setImportedTo(''); }}>
                  Clear dates
                </button>
              )}
            </div>
            <div className="mb-3 text-xs text-slate-500">{counts ? selectedTotal : '…'} leads match the categories above{(importedFrom || importedTo) ? ', before the import date filter' : ''}.</div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn-primary flex-1" onClick={start}>⚡ Start Power Dial</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
