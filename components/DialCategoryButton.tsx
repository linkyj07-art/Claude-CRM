'use client';

import { useState } from 'react';
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
// running which leads it picked up.
export default function DialCategoryButton({ counts }: { counts: CategoryCounts }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({ fresh: true, aging_45_90: true, aging_90_plus: true });

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
    router.push(`/dial?categories=${['working', ...chosen].join(',')}`);
  }

  const selectedTotal = counts.working + AGE_CATEGORIES.reduce((sum, c) => sum + (selected[c.key] ? counts[c.key] : 0), 0);

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>⚡ Power Dial</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-xl bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-bold">Choose Dialer Categories</h2>
            <p className="mb-3 text-sm text-slate-500">
              Pick which lead ages Power Dial pulls from. Working leads ({counts.working}) are always included.
            </p>
            <div className="mb-4 space-y-2">
              {AGE_CATEGORIES.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center justify-between rounded-lg border border-line p-2.5 text-sm">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={!!selected[c.key]} onChange={() => toggle(c.key)} />
                    {c.label}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">{counts[c.key]} leads</span>
                </label>
              ))}
            </div>
            <div className="mb-3 text-xs text-slate-500">{selectedTotal} leads will be in this dialer session.</div>
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
