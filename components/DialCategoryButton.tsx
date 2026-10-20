'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

type Vendor = { id: string; name: string };
type CategoryCounts = { fresh: number; working: number; aging_45_90: number; aging_90_plus: number; vendors: Vendor[] };

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
  // document doesn't exist during SSR/the first server-rendered pass, so
  // the portal target can only be resolved once mounted in the browser --
  // this flips true on the client after that first render.
  const [mounted, setMounted] = useState(false);
  const [counts, setCounts] = useState<CategoryCounts | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({ fresh: true, aging_45_90: true, aging_90_plus: true });
  // Independent of the age-status categories above -- filters by when a
  // lead was actually bought (customers.lead_date, from the lead sheet's own
  // purchase-date column or the import batch's Purchase Date field -- not
  // whatever day it happened to get uploaded into the CRM), for a batch
  // bought on a specific day/range rather than by its current fresh/aging
  // bucket. Both optional; blank means no bound on that side.
  const [importedFrom, setImportedFrom] = useState('');
  const [importedTo, setImportedTo] = useState('');
  // Which lead vendor to restrict the queue to -- empty means all vendors,
  // same "empty = no filter" convention as the date range above.
  const [vendorId, setVendorId] = useState('');
  // Separate from the Lead date range above -- this filters by
  // customers.created_at, the real moment a lead landed in THIS CRM (CSV
  // import, manual add, webhook), not when it was bought. A batch can sit
  // around after being bought and not get uploaded until days later, so
  // "uploaded on the 14th" and "bought on the 14th" are genuinely different
  // filters.
  const [uploadedFrom, setUploadedFrom] = useState('');
  const [uploadedTo, setUploadedTo] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  // Refetches whenever the vendor changes (not just on first open) since the
  // category counts themselves are scoped to the selected vendor -- picking
  // a different vendor without this would leave stale, wrong-vendor counts
  // on screen until the picker was closed and reopened.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const qs = vendorId ? `?vendor=${encodeURIComponent(vendorId)}` : '';
    fetch(`/api/leads/status-counts${qs}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setCounts(data);
      })
      .catch(() => {
        // best-effort -- the picker still works without counts, just shows 0s
      });
    return () => { cancelled = true; };
  }, [open, vendorId]);

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
    if (vendorId) params.set('vendor', vendorId);
    if (uploadedFrom) params.set('uploadedFrom', uploadedFrom);
    if (uploadedTo) params.set('uploadedTo', uploadedTo);
    router.push(`/dial?${params.toString()}`);
  }

  const c = counts || { fresh: 0, working: 0, aging_45_90: 0, aging_90_plus: 0, vendors: [] };
  const selectedTotal = c.working + AGE_CATEGORIES.reduce((sum, cat) => sum + (selected[cat.key] ? c[cat.key] : 0), 0);

  // Portaled straight to document.body rather than rendered inline --
  // this button gets dropped into pages (the Dashboard's hero card, in
  // particular) that wrap their content in a `fade-in` animation. That
  // animation's fill-mode leaves a `transform` permanently applied to the
  // wrapping element even after it finishes playing, which per the CSS
  // spec turns it into the containing block for any `position: fixed`
  // descendant -- so a plain inline-rendered modal doesn't actually anchor
  // to the real browser viewport at all, it gets trapped inside that
  // card's own (much smaller) box and clips at its edge no matter what
  // height or overflow rules the modal itself is given. Portaling to
  // document.body sidesteps the whole ancestor chain, so this can't
  // silently break again if some other page wraps the button in its own
  // transformed/animated container later.
  const modal = open && (
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
            {c.vendors.length > 0 && (
              <div className="mb-4">
                <div className="label mb-1">Lead vendor (optional)</div>
                <select className="input w-full" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                  <option value="">All vendors</option>
                  {c.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            )}
            <div className="mb-4">
              <div className="label mb-1">Lead date (optional)</div>
              <p className="mb-1 text-xs text-slate-400">When the lead was actually bought, per the lead sheet — not when it was uploaded here.</p>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  className="input flex-1"
                  value={importedFrom}
                  max={importedTo || undefined}
                  onChange={(e) => setImportedFrom(e.target.value)}
                  aria-label="Bought on or after"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="date"
                  className="input flex-1"
                  value={importedTo}
                  min={importedFrom || undefined}
                  onChange={(e) => setImportedTo(e.target.value)}
                  aria-label="Bought on or before"
                />
              </div>
              {(importedFrom || importedTo) && (
                <button type="button" className="mt-1 text-xs text-slate-400 hover:underline" onClick={() => { setImportedFrom(''); setImportedTo(''); }}>
                  Clear dates
                </button>
              )}
            </div>
            <div className="mb-4">
              <div className="label mb-1">Upload date (optional)</div>
              <p className="mb-1 text-xs text-slate-400">When the lead actually landed in this CRM — not when it was bought.</p>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  className="input flex-1"
                  value={uploadedFrom}
                  max={uploadedTo || undefined}
                  onChange={(e) => setUploadedFrom(e.target.value)}
                  aria-label="Uploaded on or after"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="date"
                  className="input flex-1"
                  value={uploadedTo}
                  min={uploadedFrom || undefined}
                  onChange={(e) => setUploadedTo(e.target.value)}
                  aria-label="Uploaded on or before"
                />
              </div>
              {(uploadedFrom || uploadedTo) && (
                <button type="button" className="mt-1 text-xs text-slate-400 hover:underline" onClick={() => { setUploadedFrom(''); setUploadedTo(''); }}>
                  Clear dates
                </button>
              )}
            </div>
            <div className="mb-3 text-xs text-slate-500">{counts ? selectedTotal : '…'} leads match the categories above{(importedFrom || importedTo || uploadedFrom || uploadedTo) ? ', before the date filters' : ''}.</div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn-primary flex-1" onClick={start}>⚡ Start Power Dial</button>
            </div>
          </div>
        </div>
      );

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>⚡ Power Dial</button>
      {mounted && modal ? createPortal(modal, document.body) : null}
    </>
  );
}
