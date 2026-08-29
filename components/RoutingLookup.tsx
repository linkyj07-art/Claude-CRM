'use client';

import { useEffect, useState } from 'react';
import { US_STATES, isValidRoutingNumber } from '@/lib/util';
import { RoutingEntry } from '@/lib/types';

export default function RoutingLookup({
  bankName, state, routingNumber, onBankChange, onStateChange, onRoutingChange, disabled
}: {
  bankName: string; state: string; routingNumber: string;
  onBankChange: (v: string) => void; onStateChange: (v: string) => void; onRoutingChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [results, setResults] = useState<RoutingEntry[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  async function search() {
    if (!bankName && !state) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (bankName) params.set('bank', bankName);
      if (state) params.set('state', state);
      const res = await fetch(`/api/routing/search?${params.toString()}`);
      const data = await res.json();
      setResults(data);
      setSearched(true);
    } finally { setLoading(false); }
  }

  const routingValid = routingNumber ? isValidRoutingNumber(routingNumber) : null;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label mb-1 block">BANK</label>
          <input className="input disabled:bg-slate-50 disabled:text-slate-500" disabled={disabled} placeholder="Type bank or credit union..." value={bankName || ''} onChange={(e) => onBankChange(e.target.value)} />
        </div>
        <div>
          <label className="label mb-1 block">STATE</label>
          <select className="input disabled:bg-slate-50 disabled:text-slate-500" disabled={disabled} value={state || ''} onChange={(e) => onStateChange(e.target.value)}>
            <option value="">Select state</option>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <button type="button" className="btn-secondary mt-2 w-full text-sm" onClick={search} disabled={loading || disabled}>
        🔎 {loading ? 'Looking up…' : 'Find Routing Number'}
      </button>

      {searched && (
        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-line">
          {results.length === 0 && (
            <div className="p-2 text-xs text-slate-500">
              No match in the sample lookup. Enter the routing number manually below — the client&apos;s check or online banking is the definitive source.
            </div>
          )}
          {results.map((r) => (
            <button
              type="button"
              key={r.id}
              onClick={() => { onBankChange(r.bank_name); onStateChange(r.state); onRoutingChange(r.routing_number); }}
              className="flex w-full items-center justify-between border-b border-line px-2 py-1.5 text-left text-xs last:border-0 hover:bg-brand-50"
            >
              <span>{r.bank_name} <span className="text-slate-400">({r.state})</span></span>
              <span className="font-mono font-semibold">{r.routing_number}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-2">
        <label className="label mb-1 block">ROUTING</label>
        <input
          className="input font-mono disabled:bg-slate-50 disabled:text-slate-500"
          disabled={disabled}
          value={routingNumber || ''}
          onChange={(e) => onRoutingChange(e.target.value)}
          placeholder="9-digit routing number"
          maxLength={9}
        />
        {routingNumber && (
          <div className={`mt-1 text-xs ${routingValid ? 'text-emerald-600' : 'text-red-600'}`}>
            {routingValid ? '✓ Valid 9-digit ABA format' : '⚠ Doesn’t look like a valid routing number — double check it'}
          </div>
        )}
      </div>
    </div>
  );
}
