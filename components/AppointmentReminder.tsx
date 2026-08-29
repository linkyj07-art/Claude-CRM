'use client';

import { useEffect, useState } from 'react';

type UpcomingAppointment = {
  id: string;
  customer_id: string;
  scheduled_at: string;
  type: string;
  first_name: string;
  last_name: string;
};

const DISMISSED_KEY = 'crm_dismissed_appt_reminders';
// How long after the scheduled time an appointment still counts as "due" —
// wide enough to survive a missed poll, not so wide that a reminder from
// hours ago still pops up after the browser was closed and reopened.
const DUE_WINDOW_MS = 30 * 60 * 1000;
const POLL_MS = 30 * 1000;

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
    // localStorage unavailable — reminders just won't remember dismissals
  }
}

export default function AppointmentReminder() {
  const [due, setDue] = useState<UpcomingAppointment[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch('/api/appointments/upcoming');
        if (!res.ok) return;
        const all: UpcomingAppointment[] = await res.json();
        const dismissed = loadDismissed();
        const now = Date.now();
        const dueNow = all.filter((a) => {
          if (dismissed.has(a.id)) return false;
          const t = new Date(a.scheduled_at).getTime();
          if (isNaN(t)) return false;
          return t <= now && now - t <= DUE_WINDOW_MS;
        });
        if (!cancelled) setDue(dueNow);
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
    setDue((prev) => prev.filter((a) => a.id !== id));
  }

  if (due.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {due.map((a) => (
        <div key={a.id} className="flex w-72 items-start gap-2 rounded-lg border border-line bg-white p-3 shadow-2xl">
          <div className="flex-1 text-sm">
            <div className="font-semibold text-ink">📅 {a.first_name} {a.last_name}</div>
            <div className="text-xs text-slate-500">{a.type} appointment — {new Date(a.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
            <a href={`/leads/${a.customer_id}`} className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline">Open lead →</a>
          </div>
          <button onClick={() => dismiss(a.id)} className="text-slate-400 hover:text-ink" aria-label="Dismiss">✕</button>
        </div>
      ))}
    </div>
  );
}
