'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Badge from './Badge';
import {
  Customer, NoteVersion, CallRecord, Policy, Commission, Carrier, CarrierRule, LeadVendor
} from '@/lib/types';
import { fmtMoney, fmtMoney0, leadAgeLabel, localTimeForState, agentLocalTime, statusBadge, isValidRoutingNumber, callsToday, MAX_CALLS_PER_DAY, isWithinCallingHours, callingWindowStatus } from '@/lib/util';
import { suggestCarriers } from '@/lib/underwriting';
import RoutingLookup from './RoutingLookup';
import SellModal from './SellModal';

type AnyRow = Record<string, any>;

const NOTE_FIELDS: { key: keyof NoteVersion; label: string; type?: 'text' | 'textarea' | 'date' }[] = [
  { key: 'name', label: 'NAME' },
  { key: 'note_date', label: 'DOB', type: 'date' },
  { key: 'phone', label: 'PHONE #' },
  { key: 'beneficiary', label: 'BENI' },
  { key: 'beneficiary_dob', label: 'BENI DOB', type: 'date' },
  { key: 'budget', label: 'BUDGET' },
  { key: 'health', label: 'HEALTH', type: 'textarea' },
  { key: 'discount', label: 'DISCOUNT (Non-Smoker)' },
  { key: 'mailing_address', label: 'MAILING ADDRESS' },
  { key: 'email', label: 'EMAIL' },
  { key: 'born_in', label: 'BORN IN' },
  { key: 'draft_date', label: 'DRAFT DATE' },
  { key: 'code_word', label: 'CODE WORD' }
];

const PLAN_TIERS: { tier: string; coverageKey: keyof NoteVersion; priceKey: keyof NoteVersion }[] = [
  { tier: 'BRONZE', coverageKey: 'plan_bronze_coverage', priceKey: 'plan_bronze_price' },
  { tier: 'SILVER', coverageKey: 'plan_silver_coverage', priceKey: 'plan_silver_price' },
  { tier: 'GOLD', coverageKey: 'plan_gold_coverage', priceKey: 'plan_gold_price' }
];

function emptyNoteForm(customer: Customer): AnyRow {
  return {
    label: 'Call Note',
    name: `${customer.first_name} ${customer.last_name}`,
    note_date: customer.dob ? customer.dob.slice(0, 10) : '',
    phone: customer.phone || '',
    beneficiary: '', beneficiary_dob: '', budget: '', health: '', discount: '',
    bank_name: '', bank_state: customer.state || '', routing_number: '', account_number: '',
    mailing_address: '', email: customer.email || '', born_in: '', ssn: '',
    plan_bronze_coverage: '', plan_bronze_price: '', plan_silver_coverage: '', plan_silver_price: '',
    plan_gold_coverage: '', plan_gold_price: '', draft_date: '', code_word: '', free_text: ''
  };
}

const NOTE_FORM_KEYS = [
  'label', 'name', 'note_date', 'phone', 'beneficiary', 'beneficiary_dob', 'budget', 'health', 'discount',
  'bank_name', 'bank_state', 'routing_number', 'account_number', 'mailing_address', 'email',
  'born_in', 'ssn', 'plan_bronze_coverage', 'plan_bronze_price', 'plan_silver_coverage', 'plan_silver_price',
  'plan_gold_coverage', 'plan_gold_price', 'draft_date', 'code_word', 'free_text'
] as const;

function noteFormFromNote(note: NoteVersion | undefined, customer: Customer): AnyRow {
  if (!note) return emptyNoteForm(customer);
  const form: AnyRow = {};
  for (const key of NOTE_FORM_KEYS) form[key] = (note as AnyRow)[key] ?? '';
  return form;
}

export default function LeadWorkspace({
  customer, notes, calls, quotes, appointments, applications, policies, commissions, payments, vendors, carriers, rules, quoteToken
}: {
  customer: Customer; notes: NoteVersion[]; calls: CallRecord[]; quotes: AnyRow[]; appointments: AnyRow[];
  applications: AnyRow[]; policies: Policy[]; commissions: Commission[]; payments: AnyRow[];
  vendors: LeadVendor[]; carriers: Carrier[]; rules: CarrierRule[]; quoteToken: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDialing = searchParams.get('dialing') === '1';
  const withinCallingHours = isWithinCallingHours(customer.state);
  const marketWindow = callingWindowStatus(customer.state);
  // The Power Dial queue lives server-side (dial_sessions, one row per user)
  // instead of in the URL, specifically so a second device (phone alongside
  // laptop) can follow the same session — polled below, and re-fetched
  // on-demand by advanceQueue whenever this hasn't loaded yet.
  type DialSession = { currentLeadId: string | null; queue: string[]; recycle: string[]; pass: number };
  const [dialSession, setDialSession] = useState<DialSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [quoBusy, setQuoBusy] = useState(false);
  const [noteForm, setNoteForm] = useState<AnyRow>(() => noteFormFromNote(notes[0], customer));
  const [editingNote, setEditingNote] = useState(() => !notes[0]);
  const [showSell, setShowSell] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const [showAppt, setShowAppt] = useState(false);
  const [activeTab, setActiveTab] = useState<'calls' | 'notes'>('calls');
  // Power Dial is meant to be fast — agents found the full three-panel
  // workspace too busy while just dialing through a queue, so those panels
  // start collapsed behind toggle buttons there and get opened on demand.
  // Browsing a lead outside Power Dial keeps the original always-open layout.
  const [showInfoPanel, setShowInfoPanel] = useState(!isDialing);
  const [showNotesPanel, setShowNotesPanel] = useState(!isDialing);
  const [showStatusPanel, setShowStatusPanel] = useState(!isDialing);

  const badge = statusBadge(customer.status, customer.purchased_at);
  // Health conditions are often disclosed across several calls/notes rather than
  // all at once, so carrier suggestions need the full history, not just whatever
  // is in the note currently being typed — otherwise an earlier "cancer" note and
  // a later "smoker" note never get weighed against each other together.
  const combinedHealthText = useMemo(
    () => [...notes.map((n) => n.health), noteForm.health].filter(Boolean).join('. '),
    [notes, noteForm.health]
  );
  const suggestions = useMemo(() => suggestCarriers(combinedHealthText, carriers, rules), [combinedHealthText, carriers, rules]);
  const top3 = suggestions.filter((s) => !s.knockout).slice(0, 3);
  const knockouts = suggestions.filter((s) => s.knockout);

  const attemptCount = calls.length;
  const todayCount = callsToday(calls);
  const dailyLimitReached = todayCount >= MAX_CALLS_PER_DAY;
  const lastNote = notes[0];
  const [callError, setCallError] = useState('');
  // Recovered from the server's own call history, not just live client state —
  // otherwise a reload mid-call (crash, accidental refresh) would silently
  // drop the "must disposition before moving on" lock and leave the pending
  // dial orphaned forever.
  const [pendingCallId, setPendingCallId] = useState<string | null>(() => calls.find((c) => c.outcome === 'pending')?.id || null);
  const pendingDisposition = pendingCallId !== null;

  async function refresh() {
    router.refresh();
  }

  async function endQuoCall() {
    setQuoBusy(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_QUO_HELPER_URL || 'http://127.0.0.1:8787'}/end-call`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
    } catch {
      alert('Could not reach the Quo helper. Make sure it\'s running on this Mac (`npm run quo-helper`) and try again.');
    } finally {
      setQuoBusy(false);
    }
  }

  // Tapping Call logs the dial immediately (as 'pending') instead of waiting
  // for an outcome — that's the actual attempt being made, and the agent
  // picks what happened once the call is over via the outcome buttons below,
  // which complete this same row instead of creating a second one.
  async function startCall() {
    setCallError('');
    try {
      const res = await fetch(`/api/leads/${customer.id}/calls`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: 'pending' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCallError(data.error || 'Could not start that call.');
        return;
      }
      setPendingCallId(data.id);
      await refresh();
    } catch {
      setCallError('Could not start that call.');
    }
  }

  async function cancelPendingCall() {
    if (!pendingCallId) return;
    setBusy(true);
    try {
      await fetch(`/api/leads/${customer.id}/calls/${pendingCallId}`, { method: 'DELETE' });
      setPendingCallId(null);
      await refresh();
    } finally { setBusy(false); }
  }

  // Picks up the latest known session, fetching fresh if this device hasn't
  // loaded it yet (e.g. the calling-hours effect below can fire before the
  // first poll resolves) — never falls back to an empty queue just because
  // local state is momentarily behind, which would wrongly end the session
  // for every device sharing it.
  async function currentDialSession(): Promise<DialSession | null> {
    if (dialSession) return dialSession;
    try {
      const res = await fetch('/api/dial-session');
      return await res.json();
    } catch {
      return null;
    }
  }

  // Single place that knows how to move to the next lead in a Power Dial
  // session: pull from the live queue first, and once that's empty fall back
  // to the recycled (maxed-out) leads for one more pass before finally
  // ending the session. Pass maxedOutId when this lead just hit its 2nd
  // unanswered dial so it rejoins the queue instead of disappearing. Writes
  // the new position to the server (not just this device's own URL) so
  // every device sharing this session follows along within one poll.
  async function advanceQueue(maxedOutId?: string) {
    const session = (await currentDialSession()) || { currentLeadId: customer.id, queue: [], recycle: [], pass: 1 };
    const updatedRecycle =
      maxedOutId && session.pass !== 2 && !session.recycle.includes(maxedOutId)
        ? [...session.recycle, maxedOutId]
        : session.recycle;

    async function moveTo(next: string, queue: string[], recycle: string[], pass: number) {
      try {
        await fetch('/api/dial-session', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentLeadId: next, queue, recycle, pass })
        });
      } catch {
        // Network hiccup — still navigate locally; the next poll on any
        // device (including this one) will reconcile once it succeeds.
      }
      router.push(`/leads/${next}?dialing=1`);
    }

    if (session.queue.length > 0) {
      const [next, ...rest] = session.queue;
      await moveTo(next, rest, updatedRecycle, session.pass);
      return;
    }

    if (session.pass !== 2 && updatedRecycle.length > 0) {
      const [next, ...rest] = updatedRecycle;
      await moveTo(next, rest, [], 2);
      return;
    }

    try {
      await fetch('/api/dial-session', { method: 'DELETE' });
    } catch {
      // best-effort — a stray session row just means /dial resumes it later
    }
    router.push('/leads');
  }

  // Poll the shared session while dialing so a disposition logged on another
  // device (or this same one, from an earlier tab) carries this view along
  // — no websocket infra needed, just a cheap same-origin GET every few
  // seconds. Also the single source of truth for this device's own queue
  // position, refreshed on every tick.
  useEffect(() => {
    if (!isDialing) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch('/api/dial-session');
        const data: DialSession | null = await res.json();
        if (cancelled) return;
        if (!data) {
          router.push('/leads');
          return;
        }
        if (data.currentLeadId && data.currentLeadId !== customer.id) {
          router.push(`/leads/${data.currentLeadId}?dialing=1`);
          return;
        }
        setDialSession(data);
      } catch {
        // transient network error — next tick retries
      }
    }

    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDialing, customer.id]);

  async function logCall(outcome: string, disposition?: string) {
    setBusy(true);
    setCallError('');
    try {
      const url = pendingCallId
        ? `/api/leads/${customer.id}/calls/${pendingCallId}`
        : `/api/leads/${customer.id}/calls`;
      const res = await fetch(url, {
        method: pendingCallId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, disposition, duration_seconds: outcome === 'connected' ? 60 : 0 })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCallError(data.error || 'Could not log that call.');
        return;
      }
      setPendingCallId(null);
      if (outcome === 'dnc' && confirm('Marked Do Not Call. Delete this lead entirely too?')) {
        await fetch(`/api/leads/${customer.id}`, { method: 'DELETE' });
        router.push('/leads');
        return;
      }
      // A "Sold" disposition needs the full Sell modal (policy/commission
      // details) before this lead is really done — open it and stay put
      // instead of auto-advancing Power Dial out from under the agent.
      if (outcome === 'connected' && disposition === 'sold') {
        await refresh();
        setShowSell(true);
        return;
      }
      // Power Dial: once this lead's disposition is logged, move straight to
      // the next one instead of making the agent click Skip / Next Lead too —
      // relying on the just-cleared pendingCallId here rather than the
      // (still-stale-until-re-render) pendingDisposition flag. No Answer and
      // Voicemail are the exception, but only once: after the FIRST such
      // outcome on this lead, stay put for an immediate redial; once a
      // SECOND one lands (this lead has now gone unanswered twice), it's
      // "maxed out" — move on now, but let advanceQueue hold onto it for a
      // second pass once the rest of the queue is worked through.
      const isRedialOutcome = outcome === 'no_answer' || outcome === 'voicemail';
      const priorRedialAttempts = calls.filter(
        (c) => c.id !== pendingCallId && (c.outcome === 'no_answer' || c.outcome === 'voicemail')
      ).length;
      const redialAttemptsSoFar = priorRedialAttempts + (isRedialOutcome ? 1 : 0);
      const shouldRedial = isRedialOutcome && redialAttemptsSoFar < 2;
      if (isDialing && !shouldRedial) {
        const maxedOutId = isRedialOutcome && redialAttemptsSoFar >= 2 ? customer.id : undefined;
        advanceQueue(maxedOutId);
        return;
      }
      await refresh();
    } finally { setBusy(false); }
  }

  async function saveNote() {
    setBusy(true);
    try {
      if (lastNote) {
        await fetch(`/api/leads/${customer.id}/notes/${lastNote.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(noteForm)
        });
      } else {
        await fetch(`/api/leads/${customer.id}/notes`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(noteForm)
        });
      }
      setEditingNote(false);
      await refresh();
    } finally { setBusy(false); }
  }

  async function setStatus(status: string) {
    if (!confirm(`Set lead status to "${status}"?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/leads/${customer.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status })
      });
      await refresh();
    } finally { setBusy(false); }
  }

  async function nextInQueue() {
    if (pendingDisposition) return;
    await advanceQueue();
  }

  async function exitQueue() {
    if (pendingDisposition) return;
    try {
      await fetch('/api/dial-session', { method: 'DELETE' });
    } catch {
      // best-effort
    }
    router.push('/leads');
  }

  // A lead can still land here even though it's not actually dialable right
  // now — its state's calling window closed after /dial built the queue (or
  // this is a recycled lead being retried later), it has no phone number to
  // call at all, or it already hit today's 4-dial cap. Skip it immediately
  // in all three cases rather than stranding the agent on a lead with no
  // Call button to press; it stays eligible for a future Power Dial run
  // once whichever condition cleared it out reverses (window reopens, a
  // phone number gets added, or the day rolls over).
  const skipReason = !withinCallingHours
    ? `outside calling hours right now (${customer.state || 'unknown state'})`
    : !customer.phone
      ? 'has no phone number on file'
      : dailyLimitReached
        ? `already dialed ${MAX_CALLS_PER_DAY}x today`
        : null;

  useEffect(() => {
    if (isDialing && skipReason) {
      advanceQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.id, isDialing, skipReason]);

  if (isDialing && skipReason) {
    return (
      <div className="card p-8 text-center text-sm text-slate-500">
        ⏭️ {customer.first_name} {customer.last_name} — {skipReason} — skipping…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isDialing && (
        <div className="card flex items-center justify-between bg-brand-50 p-3 text-sm">
          <span className="font-medium text-brand-700">
            ⚡ Power Dial — {dialSession ? `${dialSession.queue.length} more lead${dialSession.queue.length === 1 ? '' : 's'} in queue` : 'syncing…'}
          </span>
          <div className="flex items-center gap-2">
            {pendingDisposition && <span className="text-xs text-amber-700">Log this call&apos;s outcome before moving on</span>}
            <button className="btn-secondary text-xs" disabled={pendingDisposition} title={pendingDisposition ? "Log this call's outcome first" : undefined} onClick={exitQueue}>
              Exit Queue
            </button>
            <button className="btn-primary text-xs" disabled={pendingDisposition} onClick={nextInQueue}>Skip This Lead ▶</button>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-ink">{customer.first_name} {customer.last_name}</h1>
            <Badge label={badge.label} color={badge.color} />
            {customer.military ? <Badge label={`🎖 ${customer.military_branch || 'Military'}`} color="brand" /> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-slate-500">
            <span>📍 {customer.city ? `${customer.city}, ` : ''}{customer.state}</span>
            <span>🕐 {localTimeForState(customer.state)} local</span>
            <span>🕐 {agentLocalTime()} your time (Mountain)</span>
            {marketWindow.label && (
              <span className={marketWindow.isOpen ? 'font-medium text-green-600' : 'font-medium text-red-500'}>
                {marketWindow.isOpen ? '🟢' : '🔴'} {marketWindow.label}
              </span>
            )}
            <span>{leadAgeLabel(customer.purchased_at)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            {customer.phone && (
              <a href={`tel:${customer.phone.replace(/[^\d+]/g, '')}`} className="btn-good" onClick={startCall}>
                📞 Call {customer.phone}
              </a>
            )}
            {pendingCallId && (
              <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-line bg-panel p-3 shadow-2xl">
                <div className="mb-2 text-xs font-semibold text-brand-400">📞 In progress — what happened?</div>
                {callError && <div className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{callError}</div>}
                <div className="grid grid-cols-2 gap-1.5">
                  <button disabled={busy} onClick={() => logCall('no_answer')} className="btn-secondary text-xs px-2 py-1.5">No Answer</button>
                  <button disabled={busy} onClick={() => logCall('voicemail')} className="btn-secondary text-xs px-2 py-1.5">Voicemail</button>
                  <button disabled={busy} onClick={() => logCall('google_voice')} className="btn-secondary text-xs px-2 py-1.5">Google Voice</button>
                  <button disabled={busy} onClick={() => logCall('busy')} className="btn-secondary text-xs px-2 py-1.5">Busy</button>
                  <button disabled={busy} onClick={() => logCall('wrong_number')} className="btn-secondary text-xs px-2 py-1.5">Wrong #</button>
                  <button disabled={busy} onClick={() => logCall('connected', 'interested')} className="btn-good text-xs px-2 py-1.5">Connected</button>
                  <button disabled={busy} onClick={() => logCall('connected', 'sold')} className="btn-good text-xs px-2 py-1.5">💰 Sold</button>
                  <button disabled={busy} onClick={() => logCall('connected', 'not_interested')} className="btn-secondary text-xs px-2 py-1.5">Not Interested</button>
                  <button disabled={busy} onClick={() => logCall('dnc')} className="btn-danger text-xs px-2 py-1.5">DNC</button>
                </div>
                <button className="mt-2 w-full text-center text-xs text-slate-400 hover:text-ink" disabled={busy} onClick={cancelPendingCall}>
                  ↩️ Didn&apos;t mean to dial
                </button>
              </div>
            )}
          </div>
          <button
            className="btn-danger"
            disabled={quoBusy}
            onClick={endQuoCall}
            title="Ends the active call in Quo (requires the local Quo helper running on this Mac — npm run quo-helper)"
          >
            {quoBusy ? '⏳ Ending…' : '☎️ End Quo Call'}
          </button>
          <button className="btn-secondary" onClick={() => setShowQuote(true)}>🧮 Run Quote</button>
          <button className="btn-secondary" onClick={() => setShowAppt(true)}>📅 Appointment</button>
          {customer.status !== 'sold' && (
            <button className="btn-primary" onClick={() => setShowSell(true)}>💰 Sold</button>
          )}
          <button className="btn-danger" onClick={() => setStatus('disputed')}>🚫 Dispute</button>
          <button className="btn-secondary" onClick={() => setStatus('archived')}>🗑 Archive</button>
        </div>
      </div>

      {isDialing && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary text-xs" onClick={() => setShowInfoPanel((v) => !v)}>
            {showInfoPanel ? '▾' : '▸'} Lead Info
          </button>
          <button className="btn-secondary text-xs" onClick={() => setShowNotesPanel((v) => !v)}>
            {showNotesPanel ? '▾' : '▸'} Notes
          </button>
          <button className="btn-secondary text-xs" onClick={() => setShowStatusPanel((v) => !v)}>
            {showStatusPanel ? '▾' : '▸'} Funnel &amp; Status
          </button>
        </div>
      )}

      <div className={`grid grid-cols-1 gap-4 ${isDialing ? '' : 'lg:grid-cols-[340px_1fr_320px]'}`}>
        {/* Lead info panel */}
        {showInfoPanel && (
        <div className="card space-y-3 p-4">
          <div className="label">Lead Information</div>
          <dl className="space-y-2 text-sm">
            <InfoRow label="📞 Phone" value={customer.phone} />
            <InfoRow label="✉️ Email" value={customer.email} />
            <InfoRow label="🎂 DOB" value={customer.dob} />
            <InfoRow label="♂ Gender" value={customer.gender} />
            <InfoRow label="💰 Coverage" value={customer.coverage_wanted ? fmtMoney0(customer.coverage_wanted) : null} />
            <InfoRow label="💍 Marital" value={customer.marital_status} />
            <InfoRow label="📢 Ad" value={customer.ad_type} />
            <InfoRow label="📱 Platform" value={customer.platform} />
            <InfoRow label="🕐 Best Time" value={customer.best_time} />
            <InfoRow label="🏷 Vendor" value={vendors.find((v) => v.id === customer.lead_vendor_id)?.name} />
            <InfoRow label="💵 Lead Cost" value={fmtMoney(customer.lead_cost)} />
          </dl>

          <div className="border-t border-line pt-3">
            <div className="label mb-2">Call Attempts</div>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-bold tabular-nums">{attemptCount}</div>
              <div className="text-xs text-slate-500">total · {todayCount}/{MAX_CALLS_PER_DAY} today</div>
            </div>
            {dailyLimitReached && !pendingCallId && (
              <div className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">Daily call limit reached for this lead — try again tomorrow.</div>
            )}
            {!pendingCallId && <div className="mt-2 text-xs text-slate-400">Tap 📞 Call above to log a dial and pick the outcome.</div>}
          </div>

          {/* Carrier suggestions based on HEALTH note */}
          <div className="border-t border-line pt-3">
            <div className="label mb-2">💡 Suggested Carrier Order</div>
            {noteForm.health?.trim() ? (
              <div className="space-y-1.5">
                {top3.map((s, i) => (
                  <div key={s.carrier.id} className="rounded-lg border border-line bg-slate-50 p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">#{i + 1} {s.carrier.name}</span>
                      {s.carrier.agent_portal_url && (
                        <a href={s.carrier.agent_portal_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-600 hover:underline">
                          Agent Login →
                        </a>
                      )}
                    </div>
                    {s.tierNotes[0] && <div className="mt-0.5 text-xs text-slate-500">{s.tierNotes[0]}</div>}
                    {s.matchedKeywords.length > 0 && (
                      <div className="mt-0.5 text-[11px] text-slate-400">matched: {Array.from(new Set(s.matchedKeywords)).join(', ')}</div>
                    )}
                  </div>
                ))}
                {knockouts.length > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2">
                    <div className="text-xs font-semibold text-red-700">⚠ Avoid running first:</div>
                    {knockouts.map((k) => (
                      <div key={k.carrier.id} className="text-xs text-red-600">{k.carrier.name} — {Array.from(new Set(k.knockoutReasons)).join(', ')}</div>
                    ))}
                  </div>
                )}
                <div className="text-[11px] text-slate-400">Based on your keyword rules in Manage Carriers — always verify against the carrier&apos;s actual field guide.</div>
              </div>
            ) : (
              <div className="text-xs text-slate-400">Type in the HEALTH field to get a suggested carrier order, ranked from your carrier rules.</div>
            )}
          </div>
        </div>
        )}

        {/* Notes panel */}
        {showNotesPanel && (
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="label">Notes {!editingNote && <span className="font-normal normal-case text-slate-400">(locked — click Edit to change)</span>}</div>
            <div className="flex items-center gap-3">
              {!editingNote && (
                <button className="btn-secondary text-xs" type="button" onClick={() => setEditingNote(true)}>✏️ Edit</button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {NOTE_FIELDS.map((f) => (
              <div key={String(f.key)} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                <label className="label mb-1 block">{f.label}</label>
                {f.type === 'textarea' ? (
                  <textarea
                    className="input min-h-[70px] disabled:bg-slate-50 disabled:text-slate-500"
                    disabled={!editingNote}
                    value={noteForm[f.key] || ''}
                    onChange={(e) => setNoteForm((s) => ({ ...s, [f.key]: e.target.value }))}
                    placeholder="e.g. controlled diabetes, non-smoker, high blood pressure..."
                  />
                ) : (
                  <input
                    className="input disabled:bg-slate-50 disabled:text-slate-500"
                    disabled={!editingNote}
                    type={f.type === 'date' ? 'date' : 'text'}
                    value={noteForm[f.key] || ''}
                    onChange={(e) => setNoteForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="mt-3">
            <label className="label mb-1 block">Plan Options</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {PLAN_TIERS.map(({ tier, coverageKey, priceKey }) => (
                <div key={tier} className="rounded-lg border border-line p-2.5">
                  <div className="mb-1.5 text-xs font-semibold text-slate-500">{tier}</div>
                  <div className="space-y-1.5">
                    <input
                      className="input disabled:bg-slate-50 disabled:text-slate-500"
                      disabled={!editingNote}
                      placeholder="Coverage amount"
                      value={noteForm[coverageKey] || ''}
                      onChange={(e) => setNoteForm((s) => ({ ...s, [coverageKey]: e.target.value }))}
                    />
                    <input
                      className="input disabled:bg-slate-50 disabled:text-slate-500"
                      disabled={!editingNote}
                      placeholder="Price / month"
                      value={noteForm[priceKey] || ''}
                      onChange={(e) => setNoteForm((s) => ({ ...s, [priceKey]: e.target.value }))}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-line p-3">
            <div className="mb-2 text-xs font-semibold text-slate-500">Bank / SSN</div>
            <RoutingLookup
              bankName={noteForm.bank_name}
              state={noteForm.bank_state || customer.state || ''}
              routingNumber={noteForm.routing_number}
              onBankChange={(v) => setNoteForm((s) => ({ ...s, bank_name: v }))}
              onStateChange={(v) => setNoteForm((s) => ({ ...s, bank_state: v }))}
              onRoutingChange={(v) => setNoteForm((s) => ({ ...s, routing_number: v }))}
              disabled={!editingNote}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className="label mb-1 block">ACCOUNT #</label>
                <input className="input disabled:bg-slate-50 disabled:text-slate-500" disabled={!editingNote} value={noteForm.account_number || ''} onChange={(e) => setNoteForm((s) => ({ ...s, account_number: e.target.value }))} />
              </div>
              <div>
                <label className="label mb-1 block">SSN</label>
                <input className="input disabled:bg-slate-50 disabled:text-slate-500" disabled={!editingNote} value={noteForm.ssn || ''} onChange={(e) => setNoteForm((s) => ({ ...s, ssn: e.target.value }))} placeholder="XXX-XX-XXXX" />
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            {editingNote ? (
              <>
                <button
                  className="btn-secondary"
                  onClick={() => { setNoteForm(noteFormFromNote(lastNote, customer)); setEditingNote(false); }}
                >
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy} onClick={saveNote}>💾 Save Note</button>
              </>
            ) : (
              <span className="text-xs text-slate-400">{lastNote ? `Last saved ${lastNote.created_at}` : 'No note saved yet'}</span>
            )}
          </div>
        </div>
        )}

        {/* Right: quick summary + status actions */}
        {showStatusPanel && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="label mb-2">Funnel Status</div>
            <div className="space-y-1.5 text-sm">
              <FunnelRow label="Quotes run" value={quotes.length} />
              <FunnelRow label="Appointments" value={appointments.length} />
              <FunnelRow label="Applications" value={applications.length} />
              <FunnelRow label="Policies" value={policies.length} />
            </div>
          </div>
          {policies.length > 0 && (
            <div className="card p-4">
              <div className="label mb-2">💰 Policy &amp; Commission</div>
              {policies.map((p) => {
                const comm = commissions.find((c) => c.policy_id === p.id);
                return (
                  <div key={p.id} className="mb-3 border-b border-line pb-3 last:mb-0 last:border-0 last:pb-0">
                    <div className="text-sm font-semibold">{p.carrier}</div>
                    <div className="text-xs text-slate-500">{p.product} · {p.policy_number}</div>
                    <div className="mt-1 text-sm">Face: {fmtMoney0(p.face_amount)} · {fmtMoney(p.monthly_premium)}/mo</div>
                    {comm && (
                      <div className="mt-1 text-sm font-semibold text-emerald-600">Net Commission: {fmtMoney(comm.net_commission)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="card p-4">
            <div className="label mb-2">Status</div>
            <div className="flex flex-wrap gap-1.5">
              <button className="btn-secondary text-xs" onClick={() => setStatus('working')}>Working</button>
              <button className="btn-secondary text-xs" onClick={() => setStatus('lost')}>Lost</button>
              <button className="btn-secondary text-xs" onClick={() => setStatus('invalid')}>Invalid</button>
              <button className="btn-secondary text-xs" onClick={() => setStatus('dnc')}>DNC</button>
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Tabs: calls / notes history */}
      <div className="card p-4">
        <div className="mb-3 flex gap-1 border-b border-line">
          {(['calls', 'notes'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-3 py-2 text-sm font-medium capitalize border-b-2 -mb-px ${activeTab === t ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-ink'}`}
            >
              {t === 'calls' ? 'Call History' : 'Notes History'}
            </button>
          ))}
        </div>

        {activeTab === 'calls' && (
          <div className="space-y-2">
            {calls.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg border border-line p-2.5 text-sm">
                <span className="w-40 shrink-0 text-xs text-slate-400 tabular-nums">{c.occurred_at}</span>
                <span className="font-medium">Attempt #{c.attempt_number}</span>
                <Badge label={c.outcome.replace('_', ' ').toUpperCase()} color={c.outcome === 'connected' ? 'good' : c.outcome === 'dnc' ? 'bad' : 'brand'} />
                {c.disposition && <span className="text-slate-500">Disposition: {c.disposition}</span>}
              </div>
            ))}
            {calls.length === 0 && <div className="text-sm text-slate-400">No calls logged yet.</div>}
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="space-y-3">
            {notes.map((n) => (
              <details key={n.id} className="rounded-lg border border-line p-2.5">
                <summary className="cursor-pointer text-sm font-medium">
                  {n.label} — {n.created_at} <span className="text-slate-400">by {n.created_by}</span>
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-600 sm:grid-cols-3">
                  {NOTE_FIELDS.filter((f) => n[f.key]).map((f) => (
                    <div key={String(f.key)}><span className="text-slate-400">{f.label}:</span> {String(n[f.key])}</div>
                  ))}
                  {n.bank_name && <div><span className="text-slate-400">BANK:</span> {n.bank_name}</div>}
                  {n.routing_number && <div><span className="text-slate-400">ROUTING:</span> {n.routing_number}</div>}
                  {n.account_number && <div><span className="text-slate-400">ACCT:</span> {n.account_number}</div>}
                  {n.ssn && <div><span className="text-slate-400">SSN:</span> {n.ssn}</div>}
                  {PLAN_TIERS.filter(({ coverageKey, priceKey }) => n[coverageKey] || n[priceKey]).map(({ tier, coverageKey, priceKey }) => (
                    <div key={tier}>
                      <span className="text-slate-400">{tier}:</span> {[n[coverageKey], n[priceKey]].filter(Boolean).join(' — ')}
                    </div>
                  ))}
                </div>
              </details>
            ))}
            {notes.length === 0 && <div className="text-sm text-slate-400">No notes yet.</div>}
          </div>
        )}
      </div>

      {showQuote && <QuoteModal customer={customer} quoteToken={quoteToken} onClose={() => setShowQuote(false)} onSaved={refresh} />}
      {showAppt && <ApptModal customer={customer} onClose={() => setShowAppt(false)} onSaved={refresh} />}
      {showSell && (
        <SellModal
          customer={customer}
          carriers={carriers}
          onClose={() => setShowSell(false)}
          onSaved={async () => { setShowSell(false); await refresh(); }}
        />
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-ink">{value || '—'}</dd>
    </div>
  );
}

function FunnelRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-ink">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function calcAge(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

function genderToSex(gender: string | null): string {
  const g = (gender || '').trim().toLowerCase();
  if (g === 'm' || g === 'male') return 'Male';
  if (g === 'f' || g === 'female') return 'Female';
  return '';
}

function QuoteModal({ customer, quoteToken, onClose, onSaved }: { customer: Customer; quoteToken: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AnyRow>({ carrier: '', product: '', face_amount: customer.coverage_wanted || '', monthly_premium: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [quoteParams, setQuoteParams] = useState<AnyRow>({
    age: calcAge(customer.dob) ?? '',
    sex: genderToSex(customer.gender),
    state: customer.state || '',
    tobacco: 'None',
    paymentType: 'Bank Draft/EFT',
    coverageType: 'Level',
    faceAmount: customer.coverage_wanted || ''
  });

  function openQuoter() {
    const url = new URL('https://app.insurancetoolkits.com/fex/lite');
    url.searchParams.set('age', String(quoteParams.age || ''));
    url.searchParams.set('sex', quoteParams.sex || '');
    url.searchParams.set('state', quoteParams.state || '');
    url.searchParams.set('tobacco', quoteParams.tobacco || '');
    url.searchParams.set('paymentType', quoteParams.paymentType || '');
    url.searchParams.set('coverageType', quoteParams.coverageType || '');
    url.searchParams.set('faceAmount', String(quoteParams.faceAmount || ''));
    url.searchParams.set('runQuote', 'true');
    if (quoteToken) url.searchParams.set('token', quoteToken);
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }

  async function save() {
    setBusy(true);
    try {
      await fetch(`/api/leads/${customer.id}/quotes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      onSaved(); onClose();
    } finally { setBusy(false); }
  }
  return (
    <Modal title="🧮 Run Quote" onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-lg border border-line bg-slate-50 p-3">
          <div className="mb-2 text-xs font-semibold text-slate-500">FEX Lite Quoter — check the details below, then open it</div>
          {!quoteToken && (
            <div className="mb-2 text-xs text-amber-700">
              No quoter account token configured — set INSURANCE_TOOLKIT_TOKEN in your environment to skip logging in each time.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Age"><input className="input" type="number" value={quoteParams.age} onChange={(e) => setQuoteParams({ ...quoteParams, age: e.target.value })} /></Field>
            <Field label="Sex">
              <select className="input" value={quoteParams.sex} onChange={(e) => setQuoteParams({ ...quoteParams, sex: e.target.value })}>
                <option value="">Select…</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </Field>
            <Field label="State"><input className="input" value={quoteParams.state} onChange={(e) => setQuoteParams({ ...quoteParams, state: e.target.value.toUpperCase() })} /></Field>
            <Field label="Tobacco">
              <select className="input" value={quoteParams.tobacco} onChange={(e) => setQuoteParams({ ...quoteParams, tobacco: e.target.value })}>
                <option value="None">None</option>
                <option value="Cigarettes">Cigarettes</option>
                <option value="Other">Other</option>
              </select>
            </Field>
            <Field label="Payment Type">
              <select className="input" value={quoteParams.paymentType} onChange={(e) => setQuoteParams({ ...quoteParams, paymentType: e.target.value })}>
                <option value="Bank Draft/EFT">Bank Draft/EFT</option>
                <option value="Credit Card">Credit Card</option>
                <option value="Direct Bill">Direct Bill</option>
              </select>
            </Field>
            <Field label="Coverage Type">
              <select className="input" value={quoteParams.coverageType} onChange={(e) => setQuoteParams({ ...quoteParams, coverageType: e.target.value })}>
                <option value="Level">Level</option>
                <option value="Graded">Graded</option>
                <option value="Guaranteed">Guaranteed</option>
              </select>
            </Field>
            <Field label="Face Amount">
              <input className="input" type="number" value={quoteParams.faceAmount} onChange={(e) => setQuoteParams({ ...quoteParams, faceAmount: e.target.value })} />
            </Field>
          </div>
          <button type="button" className="btn-primary mt-3 w-full" onClick={openQuoter}>Open FEX Lite Quoter →</button>
        </div>

        <div className="border-t border-line pt-3">
          <div className="mb-2 text-xs font-semibold text-slate-500">Save the resulting quote to this lead</div>
          <div className="space-y-2">
            <Field label="Carrier"><input className="input" value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} /></Field>
            <Field label="Product"><input className="input" value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} /></Field>
            <Field label="Face Amount"><input className="input" type="number" value={form.face_amount} onChange={(e) => setForm({ ...form, face_amount: e.target.value })} /></Field>
            <Field label="Monthly Premium"><input className="input" type="number" value={form.monthly_premium} onChange={(e) => setForm({ ...form, monthly_premium: e.target.value })} /></Field>
            <Field label="Notes"><textarea className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <button className="btn-primary w-full" disabled={busy} onClick={save}>Save Quote</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ApptModal({ customer, onClose, onSaved }: { customer: Customer; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AnyRow>({ scheduled_at: '', type: 'phone', notes: '' });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await fetch(`/api/leads/${customer.id}/appointments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      onSaved(); onClose();
    } finally { setBusy(false); }
  }
  return (
    <Modal title="📅 Set Appointment" onClose={onClose}>
      <div className="space-y-2">
        <Field label="Date &amp; Time"><input className="input" type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} /></Field>
        <Field label="Type">
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="phone">Phone</option>
            <option value="in_person">In Person</option>
            <option value="video">Video</option>
          </select>
        </Field>
        <Field label="Notes"><textarea className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <button className="btn-primary w-full" disabled={busy || !form.scheduled_at} onClick={save}>Save Appointment</button>
      </div>
    </Modal>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label mb-1 block">{label}</label>
      {children}
    </div>
  );
}
