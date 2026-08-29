'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const TEMPLATE_HEADERS = [
  'First Name', 'Last Name', 'Phone', 'Email', 'DOB', 'Gender', 'Marital Status',
  'Address', 'City', 'State', 'Postal Code', 'Coverage Wanted', 'Ad Type', 'Platform',
  'Lead Vendor', 'Best Time', 'Lead Cost'
];

type ImportResult = { imported: number; total: number; skipped: { row: number; reason: string }[] };

export default function ImportLeadsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <>
      <button className="btn-secondary" onClick={() => setOpen(true)}>⇪ Import Leads</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-bold">Import Leads</h2>

            {!result && (
              <>
                <p className="mb-3 text-sm text-slate-500">
                  Upload a .csv export of your lead sheet. Column headers like &quot;First Name&quot;,
                  &quot;Phone&quot;, &quot;Email&quot; are matched automatically. In Google Sheets: File → Download → Comma Separated Values.
                </p>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="input mb-2 w-full" />
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
