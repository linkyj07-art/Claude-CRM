'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type IncomingCall = {
  id: string;
  customer_id: string;
  phone: string;
  created_at: string;
  first_name: string;
  last_name: string;
};

const DISMISSED_KEY = 'crm_dismissed_incoming_calls';
const SHOWN_KEY = 'crm_shown_incoming_calls';
// Purely a safety net against unbounded growth if a call is resolved
// directly in Quo without ever touching this popup (common, since Quo's a
// separate app/window) -- there's no server-side "resolved" signal to key
// off of. Deliberately much longer than the server's own 3-minute "recent"
// window (see app/api/incoming-calls/recent/route.ts) so it doesn't fight
// the actual point of this change (don't auto-dismiss), it just stops a
// truly ancient, definitely-over call from lingering forever.
const SHOWN_MAX_AGE_MINUTES = 30;
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

// "Open lead" and the OS notification's click both used to be full page
// loads, which remount this component and wipe its in-memory shownRef --
// so a call that had already aged out of the server's recent window
// disappeared the moment the agent used the popup's own primary actions to
// go look at it. Persisting to localStorage survives that (and an actual
// tab refresh/reopen too), on top of switching those two navigations to
// the client-side router so they don't even remount this component in the
// first place.
function loadShown(): Map<string, IncomingCall> {
  try {
    const raw = JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]') as IncomingCall[];
    return new Map(raw.map((c) => [c.id, c]));
  } catch {
    return new Map();
  }
}

function saveShown(shown: Map<string, IncomingCall>) {
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify(Array.from(shown.values())));
  } catch {
    // best-effort -- worst case a call re-shows or doesn't survive a refresh
  }
}

const QUO_HELPER_URL = process.env.NEXT_PUBLIC_QUO_HELPER_URL || 'http://127.0.0.1:8787';

export default function IncomingCallPopup() {
  const router = useRouter();
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
  // (in-memory AND in localStorage, see loadShown/saveShown) and kept
  // displayed regardless of whether the server still reports it as
  // "recent" -- the only way it goes away now is the X.
  const shownRef = useRef<Map<string, IncomingCall>>(loadShown());

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
        for (const c of all) {
          if (!dismissed.has(c.id)) shownRef.current.set(c.id, c);
        }
        // Only ever walks the small set actually shown, not the whole
        // (unbounded, never-pruned) dismissed history -- checking
        // dismissed.has() per already-shown id instead of the reverse
        // keeps this cheap regardless of how many calls have accumulated
        // in localStorage over weeks of use, which matters given this
        // polls twice a second.
        for (const id of shownRef.current.keys()) {
          const c = shownRef.current.get(id)!;
          const ageMinutes = (Date.now() - new Date(c.created_at).getTime()) / 60000;
          if (dismissed.has(id) || ageMinutes > SHOWN_MAX_AGE_MINUTES) shownRef.current.delete(id);
        }
        saveShown(shownRef.current);
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
              // Client-side navigation, not window.location.href -- a full
              // page load remounts this component and wipes shownRef's
              // in-memory copy, right when the agent uses the popup's own
              // primary action to go look at the call.
              router.push(`/leads/${c.customer_id}`);
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
    shownRef.current.delete(id);
    saveShown(shownRef.current);
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
              {/* Client-side navigation (Link, not a plain <a>) -- a full
                  page load remounts this component and wipes shownRef's
                  in-memory copy, same reason the notification's onclick
                  switched to router.push above. */}
              <Link href={`/leads/${c.customer_id}`} className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline">Open lead →</Link>
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
