'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function FixMisalignedButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ scanned: number; fixedCount: number } | null>(null);

  async function run() {
    if (!confirm('Scan all your leads and fix any with phone/DOB/email/gender/state mixed up from a bad import? This updates those leads in place.')) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/leads/fix-misaligned', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setResult({ scanned: data.scanned, fixedCount: data.fixedCount });
        router.refresh();
      } else {
        alert(data.error || 'Could not run the fix.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button className="btn-secondary" disabled={busy} onClick={run}>
        {busy ? 'Scanning…' : '🔧 Fix Misaligned Data'}
      </button>
      {result && (
        <span className="text-xs text-slate-500">
          {result.fixedCount > 0
            ? `Fixed ${result.fixedCount} of ${result.scanned} leads.`
            : `Checked ${result.scanned} leads — nothing to fix.`}
        </span>
      )}
    </div>
  );
}
