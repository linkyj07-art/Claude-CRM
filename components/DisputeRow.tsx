'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const STEPS = [
  { key: 'open', label: 'Open' },
  { key: 'submitted', label: 'Submitted to Vendor' },
  { key: 'resolved', label: 'Resolved' }
] as const;

export type DisputeRowData = {
  id: string;
  customer_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  lead_cost: number | null;
  vendor_name: string | null;
  reason: string;
  status: string;
  credit_amount: number | null;
  notes: string | null;
  created_at: string;
  was_import_duplicate: number;
};

export default function DisputeRow({ dispute }: { dispute: DisputeRowData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [creditAmount, setCreditAmount] = useState(dispute.credit_amount?.toString() || '');
  const [notes, setNotes] = useState(dispute.notes || '');

  const isDenied = dispute.status === 'denied';
  const stepIndex = isDenied ? STEPS.length : STEPS.findIndex((s) => s.key === dispute.status);

  async function update(fields: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/disputes/${dispute.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields)
      });
      if (!res.ok) {
        alert('Could not save that change — please try again.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/leads/${dispute.customer_id}`} className="font-semibold text-ink hover:text-brand-600">
            {dispute.first_name} {dispute.last_name}
          </Link>
          <div className="text-xs text-slate-500">
            {dispute.phone || '—'} · {dispute.vendor_name || 'Unassigned vendor'} · Lead cost {dispute.lead_cost ? `$${dispute.lead_cost}` : '—'}
          </div>
          <div className="mt-1 text-sm text-slate-600">{dispute.reason}</div>
          {!!dispute.was_import_duplicate && (
            <div className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
              🔁 Started as an import-flagged duplicate, added anyway
            </div>
          )}
        </div>
        {isDenied ? (
          <span className="badge-bad">DENIED</span>
        ) : dispute.status === 'resolved' ? (
          <span className="badge-good">RESOLVED</span>
        ) : (
          <span className="text-xs text-slate-400">Opened {dispute.created_at}</span>
        )}
      </div>

      {/* Progress stepper */}
      <div className="mt-3 flex items-center gap-1">
        {STEPS.map((step, i) => (
          <div key={step.key} className="flex flex-1 items-center gap-1">
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                isDenied ? 'bg-red-100 text-red-600' : i <= stepIndex ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-400'
              }`}
            >
              {isDenied && i === STEPS.length - 1 ? '✕' : i < stepIndex || (i === stepIndex && dispute.status === 'resolved') ? '✓' : i + 1}
            </div>
            <span className={`text-xs ${i <= stepIndex ? 'text-ink' : 'text-slate-400'}`}>{step.label}</span>
            {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 ${i < stepIndex ? 'bg-brand-500' : 'bg-slate-100'}`} />}
          </div>
        ))}
      </div>

      {dispute.status !== 'resolved' && dispute.status !== 'denied' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {dispute.status === 'open' && (
            <button className="btn-secondary text-xs" disabled={busy} onClick={() => update({ status: 'submitted' })}>
              ▶ Mark Submitted to Vendor
            </button>
          )}
          {dispute.status === 'submitted' && (
            <>
              <input
                className="input w-28 text-xs"
                placeholder="Credit $"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                onBlur={() => update({ credit_amount: creditAmount })}
              />
              <button className="btn-good text-xs" disabled={busy} onClick={() => update({ status: 'resolved', credit_amount: creditAmount })}>
                ✓ Mark Resolved
              </button>
            </>
          )}
          <button className="btn-danger text-xs" disabled={busy} onClick={() => update({ status: 'denied' })}>
            ✕ Mark Denied
          </button>
        </div>
      )}

      <textarea
        className="input mt-2 min-h-[50px] text-xs"
        placeholder="Notes (what you told the vendor, their response, etc.)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => update({ notes })}
      />
    </div>
  );
}
