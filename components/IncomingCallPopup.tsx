'use client';

import { useEffect, useRef, useState } from 'react';

type IncomingCall = {
  id: string;
  customer_id: string;
  phone: string;
  created_at: string;
  first_name: string;
  last_name: string;
};

const DISMISSED_KEY = 'crm_dismissed_incoming_calls';
// Calls need to be noticed within a second or two of ringing, not the 30s
// cadence appointment reminders use — Quo doesn't ring long, and Answer/
// Decline only work while the call is still actually up on Quo's screen, so
// slow polling here directly costs usable reaction time for those buttons.
const POLL_MS = 500;

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // localStorage unavailable — dismissals just won't be remembered
  }
}

const QUO_HELPER_URL = process.env.NEXT_PUBLIC_QUO_HELPER_URL || 'http://127.0.0.1:8787';

export default function IncomingCallPopup() {
  const [due, setDue] = useState<IncomingCall[]>([]);
  const [actingOn, setActingOn] = useState<string | null>(null);
  // Tracks which ids have already fired a native OS notification, so a
  // re-poll of the same still-undismissed call doesn't notify twice.
  const notifiedRef = useRef<Set<string>>(new Set());
  // The server only reports calls from the last few minutes (see
  // app/api/incoming-calls/recent/route.ts) so old rows don't pile up
  // there forever -- but that meant a shown popup would silently vanish
  // once its call aged out of that window, even though the agent never
  // dismissed it. Once a call has been shown here, it's remembered
  // client-side and kept displayed regardless of whether the server still
  // reports it as "recent" -- the only way it goes away now is the X.
  const shownRef = useRef<Map<string, IncomingCall>>(new Map());

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch('/api/incoming-calls/recent');
        if (!res.ok) return;
        const all: IncomingCall[] = await res.json();
        const dismissed = loadDismissed();
        // Merge into what's already been shown rather than replacing it --
        // a call that's aged out of the server's "recent" window but was
        // never dismissed stays visible using the copy already captured
        // here, instead of disappearing the moment the server stops
        // reporting it.
        for (const c of all) {
          if (!dismissed.has(c.id)) shownRef.current.set(c.id, c);
        }
        for (const id of dismissed) shownRef.current.delete(id);
        const dueNow = Array.from(shownRef.current.values());
        if (cancelled) return;
        setDue(dueNow);

        for (const c of dueNow) {
          if (notifiedRef.current.has(c.id)) continue;
          notifiedRef.current.add(c.id);
          if ('Notification' in window && Notification.permission === 'granted') {
            const n = new Notification(`📞 Incoming call — ${c.first_name} ${c.last_name}`, {
              body: c.phone,
              tag: c.id
            });
            n.onclick = () => {
              window.focus();
              window.location.href = `/leads/${c.customer_id}`;
            };
          }
        }
      } catch {
        // network hiccup — try again on the next poll
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  function dismiss(id: string) {
    const dismissed = loadDismissed();
    dismissed.add(id);
    saveDismissed(dismissed);
    setDue((prev) => prev.filter((c) => c.id !== id));
  }

  async function respond(id: string, action: 'answer' | 'decline') {
    setActingOn(id);
    try {
      const res = await fetch(`${QUO_HELPER_URL}/${action}-call`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      dismiss(id);
    } catch {
      alert(`Could not ${action} the call from here — the Quo helper may not be running, or the call may have already ended. You can still ${action} it directly in Quo.`);
    } finally {
      setActingOn(null);
    }
  }

  if (due.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 space-y-2">
      {due.map((c) => (
        <div key={c.id} className="w-72 rounded-lg border border-brand-500 bg-panel p-3 shadow-2xl">
          <div className="flex items-start gap-2">
            <div className="flex-1 text-sm">
              <div className="font-semibold text-ink">📞 {c.first_name} {c.last_name}</div>
              <div className="text-xs text-slate-500">Incoming call — {c.phone}</div>
              <a href={`/leads/${c.customer_id}`} className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline">Open lead →</a>
            </div>
            <button onClick={() => dismiss(c.id)} className="text-slate-400 hover:text-ink" aria-label="Dismiss">✕</button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              disabled={actingOn === c.id}
              onClick={() => respond(c.id, 'answer')}
              className="btn-good text-xs px-2 py-1.5"
            >
              ✅ Answer
            </button>
            <button
              disabled={actingOn === c.id}
              onClick={() => respond(c.id, 'decline')}
              className="btn-danger text-xs px-2 py-1.5"
            >
              ❌ Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
