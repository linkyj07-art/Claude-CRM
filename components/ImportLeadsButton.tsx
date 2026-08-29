'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LeadVendor } from '@/lib/types';

const TEMPLATE_HEADERS = [
  'First Name', 'Last Name', 'Phone', 'Email', 'DOB', 'Gender', 'Marital Status',
  'Address', 'City', 'State', 'Postal Code', 'Coverage Wanted', 'Ad Type', 'Platform',
  'Lead Vendor', 'Best Time', 'Lead Cost', 'Purchase Date', 'Age Range'
];

type ImportResult = { imported: number; duplicates: number; total: number; skipped: { row: number; reason: string }[] };

export default function ImportLeadsButton({ vendors }: { vendors: LeadVendor[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [leadCost, setLeadCost] = useState('');
  const [ageRange, setAgeRange] = useState('');
  const [vendorName, setVendorName] = useState('');

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_HEADERS.join(',') + '\n'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lead-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('purchaseDate', purchaseDate);
      fd.append('leadCost', leadCost);
      fd.append('ageRange', ageRange);
      fd.append('vendorName', vendorName);
      const res = await fetch('/api/leads/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Import failed.');
        return;
      }
      setResult(data);
      router.refresh();
    } catch {
      setError('Import failed — check the file and try again.');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setResult(null);
    setError('');
    setLeadCost('');
    setAgeRange('');
    setVendorName('');
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <>
      <button className="btn-secondary" onClick={() => setOpen(true)}>⇪ Import Leads</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div className="w-full max-w-md rounded-xl bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-bold">Import Leads</h2>

            {!result && (
              <>
                <p className="mb-3 text-sm text-slate-500">
                  Upload a .csv or .xlsx lead sheet. Column headers like &quot;First Name&quot;, &quot;Phone&quot;,
                  &quot;State&quot;, &quot;How Much Coverage Do You Need?&quot; are matched automatically — including
                  full state names and coverage ranges like &quot;$10k - $25k&quot;.
                </p>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv" className="input mb-3 w-full" />

                <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-line bg-slate-50 p-3">
                  <div className="col-span-2 text-xs font-semibold text-slate-500">
                    Applies to the whole batch (a row&apos;s own column overrides this if present)
                  </div>
                  <div>
                    <label className="label mb-1 block">Day You Bought</label>
                    <input className="input" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="label mb-1 block">Cost / Lead</label>
                    <input className="input" type="number" placeholder="$" value={leadCost} onChange={(e) => setLeadCost(e.target.value)} />
                  </div>
                  <div>
                    <label className="label mb-1 block">Lead Age</label>
                    <select className="input" value={ageRange} onChange={(e) => setAgeRange(e.target.value)}>
                      <option value="">Fresh</option>
                      <option value="45-90">45-90 Day</option>
                      <option value="90+">90+ Day</option>
                    </select>
                  </div>
                  <div>
                    <label className="label mb-1 block">Lead Vendor</label>
                    <input className="input" list="vendor-options" placeholder="Type name…" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
                    <datalist id="vendor-options">
                      {vendors.map((v) => <option key={v.id} value={v.name} />)}
                    </datalist>
                  </div>
                </div>

                <button type="button" className="mb-3 text-xs font-medium text-brand-600 underline" onClick={downloadTemplate}>
                  Download a blank template
                </button>
                {error && <div className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}
                <button className="btn-primary w-full" disabled={busy} onClick={upload}>
                  {busy ? 'Importing…' : 'Import'}
                </button>
              </>
            )}

            {result && (
              <div className="space-y-2">
                <div className="rounded bg-green-50 p-3 text-sm text-green-800">
                  Imported {result.imported} of {result.total} rows.
                  {result.duplicates > 0 && ` ${result.duplicates} matched an existing lead and were sent to the Review Queue instead.`}
                </div>
                {result.skipped.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded bg-amber-50 p-2 text-xs text-amber-800">
                    {result.skipped.map((s, i) => (
                      <div key={i}>Row {s.row}: {s.reason}</div>
                    ))}
                  </div>
                )}
                <button className="btn-primary w-full" onClick={close}>Done</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
