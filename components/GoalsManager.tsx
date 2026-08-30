'use client';

import { useEffect, useRef, useState } from 'react';

type Progress = { dials: number; appointments: number; ap: number };
type Goal = { target_dials: number | null; target_appointments: number | null; target_ap: number | null } | null;

const THRESHOLDS = [50, 75, 100];
const POLL_MS = 3 * 60 * 1000;
const NOTIFIED_KEY = 'crm_goal_notified';
const SKIPPED_KEY = 'crm_goal_skipped';

function loadSet(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
}
function saveSet(key: string, set: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify(Array.from(set))); } catch { /* unavailable */ }
}

async function fetchAgentClock() {
  // The agent's local clock is what decides "is it 8am Monday" — this runs
  // entirely client-side against the browser's own timezone-aware Date, no
  // server round trip needed for the clock check itself.
  const now = new Date();
  return now;
}

export default function GoalsManager() {
  const [showWeekly, setShowWeekly] = useState<string | null>(null); // week_start when shown
  const [showDaily, setShowDaily] = useState<string | null>(null); // date when shown
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const busyRef = useRef(false);
  const tickRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const now = await fetchAgentClock();
        const { agentDateStr, agentWeekStart, agentHour, agentWeekday } = await import('@/lib/util');
        const hour = agentHour(now);
        const weekday = agentWeekday(now);
        const date = agentDateStr(now);
        const weekStart = agentWeekStart(now);
        const skipped = loadSet(SKIPPED_KEY);

        if (hour >= 8) {
          // Weekly prompt takes priority on Monday; only show the daily one
          // once the weekly one is resolved (saved or skipped) so they don't stack.
          const weeklyKey = `weekly-${weekStart}`;
          if (weekday === 1 && !skipped.has(weeklyKey)) {
            const res = await fetch(`/api/goals/weekly?week=${weekStart}`);
            if (!res.ok) return; // e.g. session hiccup mid-poll — don't misread as "no goal set"
            const data = await res.json();
            if (!data.goal) {
              if (!cancelled) setShowWeekly(weekStart);
              return;
            }
          }

          const dailyKey = `daily-${date}`;
          if (!skipped.has(dailyKey)) {
            const res = await fetch(`/api/goals/daily?date=${date}`);
            if (!res.ok) return;
            const data = await res.json();
            if (!data.goal) {
              if (!cancelled) setShowDaily(date);
              return;
            }
          }
        }

        // Motivational nudges against whatever goals ARE set.
        const notified = loadSet(NOTIFIED_KEY);
        const newToasts: { id: string; text: string }[] = [];

        async function checkPeriod(kind: 'daily' | 'weekly', key: string, label: string) {
          const res = await fetch(`/api/goals/${kind}?${kind === 'daily' ? 'date' : 'week'}=${key}`);
          if (!res.ok) return;
          const data: { goal: Goal; progress: Progress } = await res.json();
          if (!data.goal) return;
          const metrics: [string, number | null, number][] = [
            ['dials', data.goal.target_dials, data.progress.dials],
            ['ap', data.goal.target_ap, data.progress.ap]
          ];
          for (const [metric, target, actual] of metrics) {
            if (!target || target <= 0) continue;
            const pct = (actual / target) * 100;
            for (const threshold of THRESHOLDS) {
              const notifyKey = `${kind}-${key}-${metric}-${threshold}`;
              if (pct >= threshold && !notified.has(notifyKey)) {
                notified.add(notifyKey);
                const metricLabel = metric === 'ap' ? 'AP' : 'dial';
                const msg = threshold >= 100
                  ? `🎉 ${label} ${metricLabel} goal hit! (${actual}/${target})`
                  : `🔥 ${threshold}% to your ${label.toLowerCase()} ${metricLabel} goal (${actual}/${target})`;
                newToasts.push({ id: notifyKey, text: msg });
              }
            }
          }
        }

        await checkPeriod('daily', date, 'Daily');
        await checkPeriod('weekly', weekStart, 'Weekly');

        if (newToasts.length > 0) {
          saveSet(NOTIFIED_KEY, notified);
          if (!cancelled) setToasts((prev) => [...prev, ...newToasts]);
        }
      } catch {
        // network hiccup — try again next tick
      } finally {
        busyRef.current = false;
      }
    }

    tickRef.current = tick;
    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  function recheck() {
    tickRef.current();
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function skipWeekly() {
    if (!showWeekly) return;
    const skipped = loadSet(SKIPPED_KEY);
    skipped.add(`weekly-${showWeekly}`);
    saveSet(SKIPPED_KEY, skipped);
    setShowWeekly(null);
    recheck();
  }

  function skipDaily() {
    if (!showDaily) return;
    const skipped = loadSet(SKIPPED_KEY);
    skipped.add(`daily-${showDaily}`);
    saveSet(SKIPPED_KEY, skipped);
    setShowDaily(null);
  }

  return (
    <>
      {showWeekly && (
        <GoalModal
          title="🗓️ Set This Week's Goals"
          onSkip={skipWeekly}
          onSave={async (vals) => {
            const res = await fetch('/api/goals/weekly', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ week_start: showWeekly, ...vals })
            });
            if (!res.ok) {
              alert('Could not save this week\'s goals — please try again.');
              return;
            }
            setShowWeekly(null);
            recheck();
          }}
        />
      )}
      {!showWeekly && showDaily && (
        <GoalModal
          title="☀️ Set Today's Goals"
          onSkip={skipDaily}
          onSave={async (vals) => {
            const res = await fetch('/api/goals/daily', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ date: showDaily, ...vals })
            });
            if (!res.ok) {
              alert('Could not save today\'s goals — please try again.');
              return;
            }
            setShowDaily(null);
            recheck();
          }}
        />
      )}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 left-4 z-50 space-y-2">
          {toasts.map((t) => (
            <div key={t.id} className="flex w-72 items-center gap-2 rounded-lg border border-line bg-panel p-3 text-sm shadow-2xl">
              <span className="flex-1">{t.text}</span>
              <button onClick={() => dismissToast(t.id)} className="text-slate-400 hover:text-ink" aria-label="Dismiss">✕</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function GoalModal({ title, onSave, onSkip }: { title: string; onSave: (vals: { target_dials: number | null; target_ap: number | null }) => Promise<void>; onSkip: () => void }) {
  const [dials, setDials] = useState('');
  const [ap, setAp] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await onSave({
        target_dials: dials ? Number(dials) : null,
        target_ap: ap ? Number(ap) : null
      });
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-panel p-5 shadow-2xl">
        <h2 className="mb-3 text-lg font-bold">{title}</h2>
        <div className="space-y-2">
          <div>
            <label className="label mb-1 block">Dial Goal</label>
            <input className="input" type="number" placeholder="e.g. 60" value={dials} onChange={(e) => setDials(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block">AP Goal ($)</label>
            <input className="input" type="number" placeholder="e.g. 2000" value={ap} onChange={(e) => setAp(e.target.value)} />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button className="btn-secondary flex-1" onClick={onSkip}>Skip</button>
          <button className="btn-primary flex-1" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save Goals'}</button>
        </div>
      </div>
    </div>
  );
}
