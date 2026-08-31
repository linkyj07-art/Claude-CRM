'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Badge from './Badge';
import {
  Customer, NoteVersion, CallRecord, Policy, Commission, Carrier, CarrierRule, LeadVendor
} from '@/lib/types';
import { fmtMoney, fmtMoney0, leadAgeLabel, localTimeForState, agentLocalTime, statusBadge, isValidRoutingNumber, callsToday, MAX_CALLS_PER_DAY, isWithinCallingHours, callingWindowStatus, isTestLead } from '@/lib/util';
import { suggestCarriers } from '@/lib/underwriting';
import RoutingLookup from './RoutingLookup';
import SellModal from './SellModal';
import AddressAutocomplete from './AddressAutocomplete';

type AnyRow = Record<string, any>;

// One-shot handoff of Auto-Dial's on/off + pace from the lead a Power Dial
// session is leaving to the one it's landing on, via sessionStorage --
// read-and-cleared by the new lead's mount effect so it can fire
// immediately instead of waiting on a fetch to re-derive values the
// previous lead's component already had in hand.
const DIAL_HANDOFF_KEY = 'crm_dial_handoff';

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
    plan_gold_coverage: '', plan_gold_price: '', selected_plan: '', draft_date: '', code_word: '', free_text: ''
  };
}

// Plain-text rendering of the note form for "Copy All" — a second place
// (Google Docs, etc.) to keep this info, formatted as simple labeled lines
// rather than the grid layout so it pastes cleanly outside the app.
function buildNoteCopyText(noteForm: AnyRow, customer: Customer): string {
  const lines: string[] = [`${customer.first_name} ${customer.last_name}`, ''];
  for (const f of NOTE_FIELDS) {
    const value = noteForm[f.key];
    if (value) lines.push(`${f.label}: ${value}`);
  }
  const planLines = PLAN_TIERS
    .filter(({ coverageKey, priceKey }) => noteForm[coverageKey] || noteForm[priceKey])
    .map(({ tier, coverageKey, priceKey }) => `${tier}: ${noteForm[coverageKey] || '—'} coverage, ${noteForm[priceKey] || '—'}/mo`);
  if (planLines.length) lines.push('', 'PLAN OPTIONS', ...planLines);

  const bankLines: string[] = [];
  if (noteForm.bank_name) bankLines.push(`Bank: ${noteForm.bank_name}`);
  if (noteForm.bank_state) bankLines.push(`Bank State: ${noteForm.bank_state}`);
  if (noteForm.routing_number) bankLines.push(`Routing #: ${noteForm.routing_number}`);
  if (noteForm.account_number) bankLines.push(`Account #: ${noteForm.account_number}`);
  if (noteForm.ssn) bankLines.push(`SSN: ${noteForm.ssn}`);
  if (bankLines.length) lines.push('', 'BANK / SSN', ...bankLines);

  if (noteForm.free_text) lines.push('', 'NOTES', noteForm.free_text);
  return lines.join('\n');
}

const NOTE_FORM_KEYS = [
  'label', 'name', 'note_date', 'phone', 'beneficiary', 'beneficiary_dob', 'budget', 'health', 'discount',
  'bank_name', 'bank_state', 'routing_number', 'account_number', 'mailing_address', 'email',
  'born_in', 'ssn', 'plan_bronze_coverage', 'plan_bronze_price', 'plan_silver_coverage', 'plan_silver_price',
  'plan_gold_coverage', 'plan_gold_price', 'selected_plan', 'draft_date', 'code_word', 'free_text'
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
  // A lead with "fake" in its name (test data for trying out Power
  // Dial/Auto-Dial) is always treated as callable, regardless of state or
  // time of day.
  const withinCallingHours = isTestLead(customer) || isWithinCallingHours(customer.state);
  const marketWindow = callingWindowStatus(customer.state);
  // The Power Dial queue lives server-side (dial_sessions, one row per user)
  // instead of in the URL, specifically so a second device (phone alongside
  // laptop) can follow the same session — polled below, and re-fetched
  // on-demand by advanceQueue whenever this hasn't loaded yet.
  type DialSession = {
    currentLeadId: string | null; queue: string[]; recycle: string[]; pass: number;
    autoDial: boolean; autoDialPaceMs: number; sessionDials: number; sessionConnects: number; consecutiveNoAnswer: number;
  };
  type NewLeadInfo = { id: string; firstName: string; lastName: string; phone: string | null };
  const [dialSession, setDialSession] = useState<DialSession | null>(null);
  // Leads that became dialable after this session's queue was built (a
  // fresh drip, or a state's calling window just opening) — surfaced as a
  // banner the agent acts on deliberately, rather than silently spliced
  // into the queue: whether a brand new lead is worth dropping the current
  // one for depends on things only the agent watching the call can judge.
  const [newLeads, setNewLeads] = useState<NewLeadInfo[]>([]);
  const dismissedNewLeadIdsRef = useRef<Set<string>>(new Set());
  // Flips false the instant this lead's workspace unmounts (navigated away
  // via Skip/Exit/advance) — checked by fireAutoDial after its pace delay
  // so a queued auto-dial can't fire against a lead the agent already left.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [busy, setBusy] = useState(false);
  const [quoBusy, setQuoBusy] = useState(false);
  const [autoDialing, setAutoDialing] = useState(false);
  // Remembered drag position for the disposition popup (top-left corner,
  // in pixels) -- null means "use the default bottom-right corner".
  // Persisted to localStorage (a per-browser preference, not data anyone
  // else needs) so it stays wherever it's dragged across every future
  // call, not just the current one.
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('crm_disposition_popup_pos');
      if (saved) setPopupPos(JSON.parse(saved));
    } catch {
      // ignore -- just falls back to the default corner
    }
  }, []);

  function startDragPopup(e: React.MouseEvent) {
    const rect = (e.currentTarget.closest('[data-drag-popup]') as HTMLElement)?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const x = Math.min(Math.max(0, ev.clientX - dragRef.current.dx), window.innerWidth - 288);
      const y = Math.min(Math.max(0, ev.clientY - dragRef.current.dy), window.innerHeight - 40);
      setPopupPos({ x, y });
    }
    function onUp() {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setPopupPos((pos) => {
        try {
          if (pos) localStorage.setItem('crm_disposition_popup_pos', JSON.stringify(pos));
        } catch {
          // best-effort -- position just won't be remembered next time
        }
        return pos;
      });
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  // Guards against firing a second auto-dial for the same lead — e.g. a
  // React effect re-run (dev strict mode double-invoke) or a `refresh()`
  // re-render that doesn't actually change the lead.
  const dialedForLeadRef = useRef<string | null>(null);
  const [noteForm, setNoteForm] = useState<AnyRow>(() => noteFormFromNote(notes[0], customer));
  const [editingNote, setEditingNote] = useState(() => !notes[0]);
  const [copied, setCopied] = useState(false);
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
  const [pendingCallId, setPendingCallIdState] = useState<string | null>(() => calls.find((c) => c.outcome === 'pending')?.id || null);
  const pendingDisposition = pendingCallId !== null;
  // React state updates aren't reflected in the current closure until the
  // next render -- logCall calls setPendingCallId(null) and then, still
  // within that same synchronous call, may fire off a redial through
  // startCall(). Without this ref, startCall()'s "is one already pending"
  // guard would read the OLD (not-yet-updated) pendingCallId and wrongly
  // treat the redial as a duplicate, silently declining to log it at all.
  const pendingCallIdRef = useRef<string | null>(pendingCallId);
  function setPendingCallId(id: string | null) {
    pendingCallIdRef.current = id;
    setPendingCallIdState(id);
  }

  async function refresh() {
    router.refresh();
  }

  // silent=true is for the automatic hangup logCall fires after a No
  // Answer/Voicemail/etc. disposition -- that call site awaits this (see
  // logCall) specifically so a slow hangup command can't still be in
  // flight to the helper once Auto-Dial has already moved on and started
  // ringing the NEXT lead. A blocking alert() there would freeze that same
  // sequencing on a transient helper hiccup, which defeats the point, so it
  // stays silent; the explicit End Quo Call button (silent=false, the
  // default) still alerts since a person is sitting right there to act on it.
  async function endQuoCall(silent = false) {
    setQuoBusy(true);
    try {
      // The silent (auto-hangup) call site awaits this promise before
      // letting Auto-Dial fire the next dial -- if the helper's /end-call
      // ever hangs instead of failing fast (a stuck AppleScript call, a
      // permission prompt it's silently waiting on, anything not
      // returning cleanly), that await would otherwise block forever and
      // Auto-Dial would just stop dead. A timeout caps how long this can
      // ever hold things up, so a stuck helper degrades to "this one
      // hangup didn't confirm" instead of "the whole session is frozen."
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let res: Response;
      try {
        res = await fetch(`${process.env.NEXT_PUBLIC_QUO_HELPER_URL || 'http://127.0.0.1:8787'}/end-call`, { method: 'POST', signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) throw new Error(await res.text());
    } catch {
      if (!silent) alert('Could not reach the Quo helper. Make sure it\'s running on this Mac (`npm run quo-helper`) and try again.');
    } finally {
      setQuoBusy(false);
    }
  }

  // Tells the Quo helper to actually dial a number (open tel: + send Enter),
  // vs. the plain `tel:` link, which only opens Quo with the number filled
  // in and still needs a manual Enter. Returns whether it worked (plus the
  // helper's error text, when it didn't) so callers can tell "unreachable"
  // apart from a deliberate refusal, like declining to dial over a live
  // incoming ring — those need different handling, not just a flat pass/fail.
  async function quoDialCall(phone: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_QUO_HELPER_URL || 'http://127.0.0.1:8787'}/dial-call`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone })
      });
      if (res.ok) return { ok: true };
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: typeof data.error === 'string' ? data.error : undefined };
    } catch {
      return { ok: false };
    }
  }

  // Single place that patches the Auto-Dial toggle/pace or bumps a session
  // counter (dials/connects/no-answer streak) on the server, and syncs the
  // result back into local state. Counters are incremented atomically
  // server-side (see the route) rather than read-modify-write from
  // possibly-stale client state.
  async function patchDialSession(patch: {
    autoDial?: boolean; autoDialPaceMs?: number;
    incrementDial?: boolean; incrementConnect?: boolean; noAnswerStreak?: 'increment' | 'reset';
  }): Promise<DialSession | null> {
    try {
      const res = await fetch('/api/dial-session/auto-dial', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
      });
      if (!res.ok) return null;
      const raw = await res.json();
      if (isDialSession(raw)) {
        setDialSession(raw);
        return raw;
      }
      return null;
    } catch {
      return null;
    }
  }

  // Fires one auto-dial: waits the configured pace, re-checks (right before
  // dialing, not just whenever the queue was last built) that this lead is
  // still actually callable, then dials. Never fires blind past a failure —
  // if the helper can't be reached, Auto-Dial turns itself back off and
  // says so, rather than silently sitting there doing nothing call after
  // call.
  //
  // The pace delay is a real window where the agent can navigate away on
  // their own (Skip This Lead, Exit Queue) before this actually fires --
  // without the mountedRef check below, it would still go ahead and dial
  // whatever lead this closure was created for, log a "pending" call
  // against it, and leave that call orphaned (no disposition buttons
  // visible anywhere, since the agent's now looking at a different lead).
  async function fireAutoDial(phone: string, paceMs: number) {
    setAutoDialing(true);
    try {
      if (paceMs > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
      if (!mountedRef.current) return;
      if (!withinCallingHours || dailyLimitReached || customer.status === 'dnc' || !customer.phone) return;
      // This dial was scheduled paceMs ago, when there was no active call --
      // but the agent (or another auto-dial) may well have already started
      // a new one manually in the meantime, faster than this was waiting to
      // fire. Firing anyway would send the helper's safety hangup flush
      // straight into whatever call is now actually live -- mid-ring or
      // mid-conversation, whichever it catches -- before redialing over it.
      // Re-checking right here, as late as possible before actually
      // dialing, means only a genuinely still-idle lead ever gets auto-fired.
      if (pendingCallIdRef.current) return;
      // Logging the pending call and actually dialing via the helper don't
      // depend on each other -- running them together instead of one after
      // the other cuts real latency off every auto-fired dial.
      const [callId, dialResult] = await Promise.all([startCall(), quoDialCall(phone)]);
      if (!mountedRef.current) return;
      if (!dialResult.ok) {
        // A real inbound call takes priority -- the helper deliberately
        // refused rather than dial over it. This redial never actually
        // happened, so roll back the pending call startCall() logged in
        // parallel (it doesn't know the dial got skipped) rather than
        // leave a phantom row behind, and just try again on the next
        // redial/advance instead of treating this as a failure.
        if (dialResult.error && /ringing/i.test(dialResult.error)) {
          if (callId) {
            fetch(`/api/leads/${customer.id}/calls/${callId}`, { method: 'DELETE' }).catch(() => {});
            setPendingCallId(null);
          }
          return;
        }
        // Also fired by the always-on same-lead redial (independent of the
        // toggle), so this can't assume Auto-Dial was actually the one
        // running -- turning it off here is still correct either way
        // (harmless no-op if it wasn't on), just worded generically.
        await patchDialSession({ autoDial: false });
        alert('Could not reach the Quo helper to redial automatically. Make sure it\'s running on this Mac (`npm run quo-helper`), then try Call again.');
      }
    } finally {
      if (mountedRef.current) setAutoDialing(false);
    }
  }

  // Tapping Call logs the dial immediately (as 'pending') instead of waiting
  // for an outcome — that's the actual attempt being made, and the agent
  // picks what happened once the call is over via the outcome buttons below,
  // which complete this same row instead of creating a second one.
  async function startCall(): Promise<string | undefined> {
    // A call's already in progress for this lead -- never log a second one
    // on top of it. Without this, Auto-Dial firing automatically and then
    // a manual click of Call (or Auto-Dial firing twice in a race) each
    // created their own separate 'pending' row; only the LAST one's id
    // ever made it into pendingCallId, so the first was silently
    // orphaned -- stuck as pending forever, with no way to disposition it.
    if (pendingCallIdRef.current) return pendingCallIdRef.current;
    setCallError('');
    try {
      const res = await fetch(`/api/leads/${customer.id}/calls`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: 'pending' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCallError(data.error || 'Could not start that call.');
        return undefined;
      }
      setPendingCallId(data.id);
      // A leftover quoBusy=true from the PREVIOUS call's auto-hangup
      // (fired fire-and-forget in logCall, racing this brand-new call's
      // own startCall) has nothing to do with THIS call -- but since
      // quoBusy is a single flag shared across the whole lead, it was
      // still disabling this call's disposition buttons until that old
      // request happened to resolve. A new pending call means whatever
      // hangup was in flight is for a call that's already over, so it
      // can't still be blocking this one.
      setQuoBusy(false);
      // Counts every dial made during a Power Dial session, manual or
      // auto-fired, toward the session stats shown in the header — not
      // awaited, since it shouldn't slow down the actual call.
      if (isDialing) patchDialSession({ incrementDial: true });
      await refresh();
      return data.id as string;
    } catch {
      setCallError('Could not start that call.');
      return undefined;
    }
  }

  // Manual dial: goes through the Quo helper only -- no browser-level tel:
  // navigation at all anymore. This used to be a real <a href="tel:">
  // click (safer than a location.href assignment, which definitely blew
  // the tab away to a Google search when unresolved), but even a genuine
  // anchor click on an unregistered/no-longer-confirmed protocol can make
  // Chrome fall back to searching Google for the tel: text and replace the
  // whole CRM tab -- confirmed happening here, including from an impatient
  // click on the Call button during Auto-Dial's brief redial window (see
  // the pendingCallId check below). The helper's `open tel:` runs on the
  // Mac itself (a plain shell `open`, not a browser navigation), so it
  // can't ever trigger that failure mode -- routing every dial through it
  // exclusively removes the whole bug class instead of racing it.
  async function placeManualCall() {
    await startCall();
    if (!customer.phone) return;
    const result = await quoDialCall(customer.phone.replace(/[^\d+]/g, ''));
    if (!result.ok && !(result.error && /ringing/i.test(result.error))) {
      // The helper deliberately refuses to run a second action (dial, hang
      // up) while one's still in flight, rather than queue it — clicking
      // Call again while the last hangup/dial hasn't finished settling on
      // the Mac hits that guard, not a dead helper. result.error carries
      // its real reason ("Another action is already in progress...") when
      // it's reachable at all; only fall back to the generic "can't reach
      // it" message when there's no error text, i.e. the fetch itself failed.
      alert(result.error || 'Could not reach the Quo helper to dial. Make sure it\'s running on this Mac (`npm run quo-helper`), then dial this number directly in Quo.');
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

  // A 401 (session cookie expired mid-poll) or any other non-2xx response
  // still comes back as parseable JSON (e.g. {error: "Not authenticated"}),
  // which is NOT a DialSession — treating it as one crashed the render the
  // first time something read .queue.length off of it. Validate the actual
  // shape rather than trusting res.json()'s inferred type.
  function isDialSession(x: unknown): x is DialSession {
    return !!x && typeof x === 'object' && Array.isArray((x as DialSession).queue) && Array.isArray((x as DialSession).recycle);
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
      if (!res.ok) return null;
      const data = await res.json();
      return isDialSession(data) ? data : null;
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
    const session = (await currentDialSession()) || {
      currentLeadId: customer.id, queue: [], recycle: [], pass: 1,
      autoDial: false, autoDialPaceMs: 2000, sessionDials: 0, sessionConnects: 0, consecutiveNoAnswer: 0
    };
    const updatedRecycle =
      maxedOutId && session.pass !== 2 && !session.recycle.includes(maxedOutId)
        ? [...session.recycle, maxedOutId]
        : session.recycle;

    async function moveTo(next: string, queue: string[], recycle: string[], pass: number) {
      // Hand the auto-dial/pace values we already know straight to the
      // next lead's mount effect via sessionStorage, so it can fire
      // immediately instead of waiting on a fetch round trip to
      // re-derive the exact same values we're holding right now.
      try {
        sessionStorage.setItem(DIAL_HANDOFF_KEY, JSON.stringify({ autoDial: session.autoDial, autoDialPaceMs: session.autoDialPaceMs }));
      } catch {
        // best-effort -- the mount effect just falls back to fetching
      }
      // Not awaited: navigating doesn't need to wait on this landing --
      // the next lead's own poll reconciles it within a few seconds either
      // way, and any other device sharing the session already does the
      // same. Every ms here is a ms added before the next dial can fire.
      fetch('/api/dial-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentLeadId: next, queue, recycle, pass })
      }).catch(() => {
        // Network hiccup — still navigated already; the next poll on any
        // device (including this one) will reconcile once it succeeds.
      });
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
        if (!res.ok) return; // e.g. session expired mid-poll — next tick retries, no false "session ended"
        const raw = await res.json();
        if (cancelled) return;
        const newLeadsRaw: NewLeadInfo[] = Array.isArray(raw?.newLeads) ? raw.newLeads : [];
        if (!isDialSession(raw)) {
          router.push('/leads');
          return;
        }
        if (raw.currentLeadId && raw.currentLeadId !== customer.id) {
          router.push(`/leads/${raw.currentLeadId}?dialing=1`);
          return;
        }
        setDialSession(raw);
        setNewLeads(newLeadsRaw.filter((l) => !dismissedNewLeadIdsRef.current.has(l.id)));
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

  // Outcomes where the call is definitely over the instant this button is
  // clicked — nobody picked up, so there's nothing left to hang up on
  // manually. Other outcomes (Connected, Busy, etc.) don't auto-hang-up
  // since the agent might still be on the line or need to act on it
  // themselves; the End Quo Call button stays available for those.
  const AUTO_HANGUP_OUTCOMES = ['no_answer', 'voicemail', 'google_voice', 'disconnected'];

  async function logCall(outcome: string, disposition?: string) {
    // "Connected (HU)" -- they picked up, then hung up -- is also
    // definitely over the instant it's logged, same as the no-answer-like
    // outcomes above, even though the outcome itself is 'connected'.
    //
    // Kicked off here (not awaited yet) so it runs alongside logging the
    // disposition below rather than adding its latency on top -- but
    // whoever below actually triggers the NEXT dial (redialing this same
    // lead, or Auto-Dial firing on whatever advanceQueue lands on) awaits
    // this first. Without that, a slow hangup command could still be in
    // flight to the helper once the next dial's already gone out, and land
    // on THAT live call instead of the dead one it was meant for.
    const hangupPromise = AUTO_HANGUP_OUTCOMES.includes(outcome) || (outcome === 'connected' && disposition === 'hung_up')
      ? endQuoCall(true)
      : null;
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
      // DNC used to ask (via a blocking confirm()) whether to delete the
      // lead entirely -- a popup on every single DNC disposition. It just
      // marks the lead 'dnc' (already done by the outcome POST above) and
      // falls through to the normal advance logic below like any other
      // outcome now; deleting a lead outright is still available from the
      // lead's own page for whoever wants it, just not forced into this
      // flow on every DNC.
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
      // (still-stale-until-re-render) pendingDisposition flag. No Answer,
      // Voicemail, and Google Voice are the exception, but only once: after
      // the FIRST such outcome on this lead, stay put for an immediate
      // redial; once a SECOND one lands (this lead has now gone unanswered
      // twice), it's "maxed out" — move on now, but let advanceQueue hold
      // onto it for a second pass once the rest of the queue is worked
      // through.
      const isRedialOutcome = outcome === 'no_answer' || outcome === 'voicemail' || outcome === 'google_voice';
      const priorRedialAttempts = calls.filter(
        (c) => c.id !== pendingCallId && (c.outcome === 'no_answer' || c.outcome === 'voicemail' || c.outcome === 'google_voice')
      ).length;
      const redialAttemptsSoFar = priorRedialAttempts + (isRedialOutcome ? 1 : 0);
      const shouldRedial = isRedialOutcome && redialAttemptsSoFar < 2;

      // Session stats — tracked for every disposition made while dialing,
      // regardless of whether Auto-Dial is even on, so the connect count
      // stays accurate if it gets turned on mid-session.
      let session = dialSession;
      if (isDialing) {
        session = await patchDialSession({
          incrementConnect: outcome === 'connected',
          noAnswerStreak: isRedialOutcome ? 'increment' : 'reset'
        });
      }

      if (isDialing && !shouldRedial) {
        const maxedOutId = isRedialOutcome && redialAttemptsSoFar >= 2 ? customer.id : undefined;
        if (hangupPromise) await hangupPromise;
        // The lead advanceQueue navigates to fires its own auto-dial (if
        // enabled) from its mount effect once it lands.
        advanceQueue(maxedOutId);
        return;
      }
      await refresh();
      // Redialing a lead that's only gone unanswered once is independent of
      // the Auto-Dial toggle — it fires for manual dialing too, not just
      // while Auto-Dial is running the whole queue. Advancing to the NEXT
      // lead once this one's maxed out (the branch above) still only
      // auto-dials that new lead when Auto-Dial is actually on.
      if (isDialing && shouldRedial && customer.phone) {
        if (hangupPromise) await hangupPromise;
        fireAutoDial(customer.phone, session?.autoDialPaceMs ?? 2000);
      }
    } finally { setBusy(false); }
  }

  async function saveNote() {
    setBusy(true);
    try {
      const res = lastNote
        ? await fetch(`/api/leads/${customer.id}/notes/${lastNote.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(noteForm)
          })
        : await fetch(`/api/leads/${customer.id}/notes`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(noteForm)
          });
      if (!res.ok) {
        alert('Could not save this note — your changes are still in the form. Please try again.');
        return;
      }
      setEditingNote(false);
      await refresh();
    } finally { setBusy(false); }
  }

  async function copyAllNotes() {
    try {
      await navigator.clipboard.writeText(buildNoteCopyText(noteForm, customer));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('Could not copy — your browser may be blocking clipboard access.');
    }
  }

  async function setStatus(status: string) {
    // Dispute is a routine one-click disposition during dialing, not a
    // destructive/hard-to-undo action like Archive still is below -- no
    // popup needed to slow that down.
    if (status !== 'disputed' && !confirm(`Set lead status to "${status}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${customer.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status })
      });
      if (!res.ok) {
        alert('Could not update this lead\'s status — please try again.');
        return;
      }
      await refresh();
    } finally { setBusy(false); }
  }

  async function markFollowedUp() {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${customer.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ last_followed_up_at: new Date().toISOString() })
      });
      if (!res.ok) {
        alert('Could not mark this lead as followed up — please try again.');
        return;
      }
      await refresh();
    } finally { setBusy(false); }
  }

  async function nextInQueue() {
    if (pendingDisposition) return;
    await advanceQueue();
  }

  function dismissNewLead(id: string) {
    dismissedNewLeadIdsRef.current.add(id);
    setNewLeads((prev) => prev.filter((l) => l.id !== id));
  }

  // Queues one or more newly-eligible leads right after whoever's current,
  // without navigating away — they'll be dialed next once the current lead
  // is dispositioned/skipped. Safe to use mid-call, since it doesn't move
  // anyone off what they're currently on. Takes the whole batch in one
  // request rather than one call per lead, since firing several inserts
  // concurrently would each read the same stale queue and clobber each
  // other's update.
  async function insertNewLeadsNext(ids: string[]) {
    const session = (await currentDialSession()) || dialSession;
    if (!session) return;
    const nextQueue = [...ids.filter((id) => !session.queue.includes(id) && id !== session.currentLeadId), ...session.queue];
    try {
      const res = await fetch('/api/dial-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentLeadId: session.currentLeadId, queue: nextQueue, recycle: session.recycle, pass: session.pass })
      });
      const raw = await res.json().catch(() => null);
      if (isDialSession(raw)) setDialSession(raw);
    } catch {
      // best-effort — the next poll reconciles either way
    }
    for (const id of ids) dismissNewLead(id);
  }

  // Drops whatever's current back to the front of the queue and jumps
  // straight to this new lead instead — only offered while there's no call
  // actually in progress (see the disabled state on the button itself).
  async function callNewLeadNow(id: string) {
    const session = (await currentDialSession()) || dialSession;
    if (!session) return;
    const requeued = session.currentLeadId && session.currentLeadId !== id ? [session.currentLeadId] : [];
    const nextQueue = [...requeued, ...session.queue.filter((q) => q !== id)];
    try {
      await fetch('/api/dial-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentLeadId: id, queue: nextQueue, recycle: session.recycle, pass: session.pass })
      });
    } catch {
      // best-effort — still navigate; the next poll on the new lead's page reconciles
    }
    dismissNewLead(id);
    router.push(`/leads/${id}?dialing=1`);
  }

  async function exitQueue() {
    if (pendingDisposition) return;
    if (dialSession && dialSession.sessionDials > 0) {
      alert(`Session summary: ${dialSession.sessionDials} dial${dialSession.sessionDials === 1 ? '' : 's'}, ${dialSession.sessionConnects} connect${dialSession.sessionConnects === 1 ? '' : 's'}.`);
    }
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
  // The dial-session queue itself is kept free of out-of-hours leads (see
  // /api/dial-session), so landing here with the window already closed
  // should be rare — a lead that went out of hours while it was the one
  // actively being viewed, not one pulled fresh off the queue. Advance past
  // it silently rather than flashing a "skipping…" card the agent has to
  // watch; the phone/daily-limit cases are worth surfacing since they're
  // usually a one-off data issue rather than routine housekeeping.
  const outOfHours = !withinCallingHours;
  const skipReason = outOfHours
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

  // Fires Auto-Dial for whichever lead this view lands on with it already
  // on — covers both the very first lead of a session and every lead
  // advanceQueue navigates to afterward, since both are a fresh mount of
  // this component for a new customer.id. The same-lead redial case (no
  // navigation, no remount) is fired explicitly from logCall instead.
  useEffect(() => {
    if (!isDialing || skipReason || !customer.phone) return;
    if (dialedForLeadRef.current === customer.id) return;
    let cancelled = false;
    (async () => {
      // The previous lead's moveTo() hands its already-known autoDial/pace
      // straight through sessionStorage -- reading that (instant, no
      // network) instead of fetching lets Auto-Dial fire immediately on
      // arrival rather than waiting on a round trip to re-derive the exact
      // same values. Only actually falls back to fetching for the one
      // entry point that never went through moveTo: the very first lead
      // of a session, landed on via /dial's server-side redirect.
      let session: { autoDial: boolean; autoDialPaceMs: number } | DialSession | null = null;
      try {
        const handoff = sessionStorage.getItem(DIAL_HANDOFF_KEY);
        if (handoff) {
          sessionStorage.removeItem(DIAL_HANDOFF_KEY);
          session = JSON.parse(handoff);
        }
      } catch {
        // fall through to fetching
      }
      if (!session) session = await currentDialSession();
      if (cancelled || !session?.autoDial || dialedForLeadRef.current === customer.id) return;
      dialedForLeadRef.current = customer.id;
      await fireAutoDial(customer.phone!, session.autoDialPaceMs);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDialing, customer.id, skipReason]);

  // Alt+A toggles Auto-Dial without needing the mouse — the whole point is
  // being able to kill it fast (e.g. stepping away) without hunting for a
  // button. Ignored while typing in a field so it doesn't fight with the
  // Mac's own Option+A character shortcut mid-note.
  useEffect(() => {
    if (!isDialing) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!e.altKey || e.key.toLowerCase() !== 'a' || !dialSession) return;
      const active = document.activeElement as HTMLElement | null;
      const isTyping = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (isTyping) return;
      e.preventDefault();
      patchDialSession({ autoDial: !dialSession.autoDial });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDialing, dialSession]);

  if (isDialing && skipReason) {
    if (outOfHours) return null;
    return (
      <div className="card p-8 text-center text-sm text-slate-500">
        ⏭️ {customer.first_name} {customer.last_name} — {skipReason} — skipping…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isDialing && (
        <div className="card space-y-2 bg-brand-50 p-3 text-sm">
          <div className="flex items-center justify-between">
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
          <div className="flex flex-wrap items-center gap-3 border-t border-brand-100 pt-2">
            <button
              className={dialSession?.autoDial ? 'btn-danger text-xs' : 'btn-good text-xs'}
              disabled={!dialSession}
              onClick={() => dialSession && patchDialSession({ autoDial: !dialSession.autoDial })}
              title="Automatically dials the next lead in Quo as the queue redials/advances. Alt+A toggles this without the mouse."
            >
              {dialSession?.autoDial ? '⏸ Auto-Dial: ON (Alt+A to pause)' : '▶️ Auto-Dial: OFF (Alt+A to start)'}
            </button>
            <label className="flex items-center gap-1 text-xs text-slate-500">
              Pace:
              <select
                className="rounded border border-line bg-panel px-1 py-0.5"
                value={dialSession?.autoDialPaceMs ?? 2000}
                disabled={!dialSession}
                onChange={(e) => patchDialSession({ autoDialPaceMs: Number(e.target.value) })}
              >
                <option value={0}>Instant</option>
                <option value={2000}>2s</option>
                <option value={4000}>4s</option>
                <option value={6000}>6s</option>
              </select>
            </label>
            {dialSession && (
              <span className="text-xs text-slate-500">
                📞 {dialSession.sessionDials} dial{dialSession.sessionDials === 1 ? '' : 's'} · ✅ {dialSession.sessionConnects} connect{dialSession.sessionConnects === 1 ? '' : 's'} this session
              </span>
            )}
            {autoDialing && <span className="text-xs font-medium text-brand-600">📞 Auto-dialing…</span>}
          </div>
        </div>
      )}
      {isDialing && newLeads.length > 0 && (
        <div className="card space-y-2 border border-amber-300 bg-amber-50 p-3 text-sm">
          <div className="font-medium text-amber-800">
            🔥 {newLeads.length} new lead{newLeads.length === 1 ? '' : 's'} just became ready to call
            {newLeads.length <= 3 ? `: ${newLeads.map((l) => `${l.firstName} ${l.lastName}`).join(', ')}` : ''}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-good text-xs px-2 py-1.5"
              disabled={pendingDisposition}
              title={pendingDisposition ? "Finish this call first — won't interrupt an active call" : 'Puts this one on hold and jumps straight to the new lead'}
              onClick={() => callNewLeadNow(newLeads[0].id)}
            >
              📞 Call {newLeads[0].firstName} Now
            </button>
            <button className="btn-secondary text-xs px-2 py-1.5" onClick={() => insertNewLeadsNext(newLeads.map((l) => l.id))}>
              ➕ Queue Next (after this call)
            </button>
            <button className="text-xs text-slate-500 hover:text-ink" onClick={() => newLeads.forEach((l) => dismissNewLead(l.id))}>
              ✕ Dismiss
            </button>
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
            {isTestLead(customer) ? (
              <span className="font-medium text-brand-600">🧪 Test lead — always callable</span>
            ) : marketWindow.label && (
              <span className={marketWindow.isOpen ? 'font-medium text-green-600' : 'font-medium text-red-500'}>
                {marketWindow.isOpen ? '🟢' : '🔴'} {marketWindow.label}
              </span>
            )}
            <span>{leadAgeLabel(customer.purchased_at)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {customer.phone && (
            pendingCallId ? (
              // A call's already in progress -- no href, no click handler.
              // Clicking Call again here used to fire a second, separate
              // pending call on top of the one already running.
              <button className="btn-good" disabled title="A call is already in progress for this lead — log its outcome below">
                📞 Call {customer.phone}
              </button>
            ) : (
              <button className="btn-good" onClick={placeManualCall}>
                📞 Call {customer.phone}
              </button>
            )
          )}
          {pendingCallId && (
            // Fixed to the viewport (not positioned relative to the Call
            // button) and above everything else on the page — this used to
            // be an absolutely-positioned dropdown anchored under the
            // button, which could end up rendered behind later page
            // content (reported blocked by the Call History section in
            // Chrome) depending on exactly how the header wrapped. Pinning
            // it to a fixed screen corner instead means it can never again
            // be covered by anything else on the page, in any browser,
            // regardless of layout/scroll position.
            <div
              data-drag-popup
              className={`fixed z-50 max-h-[80vh] w-72 overflow-y-auto rounded-xl border border-line bg-panel p-3 shadow-2xl ${popupPos ? '' : 'bottom-4 right-4'}`}
              style={popupPos ? { left: popupPos.x, top: popupPos.y } : undefined}
            >
              <div
                onMouseDown={startDragPopup}
                className="mb-2 flex cursor-move items-center gap-1 text-xs font-semibold text-brand-400"
                title="Drag to move — stays here for future calls too"
              >
                <span className="text-slate-300">⠿</span> 📞 In progress — what happened?
              </div>
              {callError && <div className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{callError}</div>}
              {quoBusy && (
                <div className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-700">⏳ Ending the Quo call — one second before you can pick an outcome…</div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <button disabled={busy || quoBusy} onClick={() => logCall('no_answer')} className="btn-secondary text-xs px-2 py-1.5">No Answer</button>
                <button disabled={busy || quoBusy} onClick={() => logCall('voicemail')} className="btn-secondary text-xs px-2 py-1.5">Voicemail</button>
                <button disabled={busy || quoBusy} onClick={() => logCall('google_voice')} className="btn-secondary text-xs px-2 py-1.5">Google Voice</button>
                <button disabled={busy || quoBusy} onClick={() => logCall('busy')} className="btn-secondary text-xs px-2 py-1.5">Busy</button>
                <button disabled={busy || quoBusy} onClick={() => logCall('wrong_number')} className="btn-secondary text-xs px-2 py-1.5">Wrong #</button>
                <button disabled={busy || quoBusy} onClick={() => logCall('disconnected')} className="btn-secondary text-xs px-2 py-1.5">📵 Disconnected</button>
                <button disabled={busy || quoBusy} onClick={() => logCall('connected', 'interested')} className="btn-good text-xs px-2 py-1.5">Connected</button>
                <button disabled={busy || quoBusy} onClick={() => logCall('connected', 'hung_up')} className="btn-secondary text-xs px-2 py-1.5">Connected (HU)</button>
                <button disabled={busy || quoBusy} onClick={() => logCall('connected', 'sold')} className="btn-good text-xs px-2 py-1.5">💰 Sold</button>
                <button disabled={busy || quoBusy} onClick={() => logCall('connected', 'not_interested')} className="btn-secondary text-xs px-2 py-1.5">Not Interested</button>
                <button disabled={busy || quoBusy} onClick={() => logCall('dnc')} className="btn-danger text-xs px-2 py-1.5">DNC</button>
              </div>
              <button className="mt-2 w-full text-center text-xs text-slate-400 hover:text-ink" disabled={busy || quoBusy} onClick={cancelPendingCall}>
                ↩️ Didn&apos;t mean to dial
              </button>
            </div>
          )}
          <button
            className="btn-danger"
            disabled={quoBusy}
            onClick={() => endQuoCall()}
            title="Ends the active call in Quo (requires the local Quo helper running on this Mac — npm run quo-helper)"
          >
            {quoBusy ? '⏳ Ending…' : '☎️ End Quo Call'}
          </button>
          <button className="btn-secondary" onClick={() => setShowQuote(true)}>🧮 Run Quote</button>
          <button className="btn-secondary" onClick={() => setShowAppt(true)}>📅 Appointment</button>
          <button className="btn-secondary" disabled={busy} onClick={markFollowedUp} title={customer.last_followed_up_at ? `Last marked followed up: ${customer.last_followed_up_at}` : 'Clears this lead from the Needs Follow-Up list'}>
            ✅ Mark Followed Up
          </button>
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
            <InfoRow label="🎂 DOB" value={fmtDob(customer.dob)} />
            <InfoRow label="♂ Gender" value={customer.gender} />
            <InfoRow label="💰 Coverage" value={customer.coverage_wanted ? fmtMoney0(customer.coverage_wanted) : null} />
            <InfoRow label="📦 Plan Chosen" value={lastNote?.selected_plan ? lastNote.selected_plan.charAt(0).toUpperCase() + lastNote.selected_plan.slice(1) : null} />
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
              <button className="btn-secondary text-xs" type="button" onClick={copyAllNotes}>
                {copied ? '✅ Copied' : '📋 Copy All'}
              </button>
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
                ) : f.key === 'mailing_address' ? (
                  <AddressAutocomplete
                    disabled={!editingNote}
                    value={noteForm[f.key] || ''}
                    onChange={(v) => setNoteForm((s) => ({ ...s, [f.key]: v }))}
                    placeholder="Start typing an address…"
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
              {PLAN_TIERS.map(({ tier, coverageKey, priceKey }) => {
                const planKey = tier.toLowerCase();
                const isChosen = noteForm.selected_plan === planKey;
                return (
                  <div key={tier} className={`rounded-lg border p-2.5 ${isChosen ? 'border-brand-500 bg-brand-50/40' : 'border-line'}`}>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                      <input
                        type="checkbox"
                        disabled={!editingNote}
                        checked={isChosen}
                        onChange={() => setNoteForm((s) => ({ ...s, selected_plan: isChosen ? '' : planKey }))}
                      />
                      {tier}{isChosen && <span className="text-brand-600">✓ Chosen</span>}
                    </label>
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
                );
              })}
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

// Shows the lead's DOB as "Mar 15, 1958" instead of the raw stored
// "1958-03-15" -- easier to read/say out loud on a call than a numeric
// month. Formatted in UTC on purpose: a date-only string parses as UTC
// midnight, and formatting that in the agent's local (Mountain) time would
// roll it back to the previous day.
function fmtDob(dob: string | null): string | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return dob;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
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
      const res = await fetch(`/api/leads/${customer.id}/quotes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) {
        alert('Could not save this quote — please try again.');
        return;
      }
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
      const res = await fetch(`/api/leads/${customer.id}/appointments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) {
        alert('Could not save this appointment — please try again.');
        return;
      }
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
