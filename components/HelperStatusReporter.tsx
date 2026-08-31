'use client';

import { useEffect } from 'react';

// Silent background reporter: every 30s, checks whether THIS browser's own
// Quo helper (127.0.0.1, macOS only) is reachable and tells the server —
// purely so an admin's Team Status view can show who currently has it
// connected. Deliberately not user-visible (no UI, no errors) since most
// users won't have the helper running most of the time they're just
// browsing the CRM, and that's completely normal, not a problem to flag.
const QUO_HELPER_URL = process.env.NEXT_PUBLIC_QUO_HELPER_URL || 'http://127.0.0.1:8787';
const REPORT_INTERVAL_MS = 30000;

export default function HelperStatusReporter() {
  useEffect(() => {
    let cancelled = false;

    async function checkAndReport() {
      let connected = false;
      try {
        const res = await fetch(`${QUO_HELPER_URL}/health`, { signal: AbortSignal.timeout(3000) });
        connected = res.ok;
      } catch {
        connected = false;
      }
      if (cancelled) return;
      fetch('/api/helper-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connected })
      }).catch(() => {
        // best-effort — next tick retries
      });
    }

    checkAndReport();
    const interval = setInterval(checkAndReport, REPORT_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return null;
}
