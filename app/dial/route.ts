import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';
import { isWithinCallingHours, minutesUntilCallingWindowCloses, MAX_CALLS_PER_DAY, isTestLead, agentMidnightUTC, promoteAgingLeads } from '@/lib/util';
import { buildImportDateFilter } from '@/lib/dialQueue';

// The full eligible set, and the default when no ?categories= is given
// (a plain "⚡ Power Dial" click with no picker used) -- keeps every
// existing bookmark/link behaving exactly as before this filter existed.
const ALL_CATEGORIES = ['fresh', 'working', 'aging_45_90', 'aging_90_plus'] as const;
type Category = (typeof ALL_CATEGORIES)[number];

function parseCategories(raw: string | null): Category[] {
  if (!raw) return [...ALL_CATEGORIES];
  const requested = raw.split(',').map((s) => s.trim()).filter((s): s is Category => (ALL_CATEGORIES as readonly string[]).includes(s));
  return requested.length > 0 ? requested : [...ALL_CATEGORIES];
}

// A lead whose state is closing for the day within this many minutes jumps
// to the front of the queue, ahead of even genuinely never-called leads --
// otherwise it's easy to work through fresher leads all morning and never
// circle back before that window shuts. Deliberately tight: different
// states close at different times in the agent's own timezone, so a wider
// window means several states can be "closing soon" at once throughout the
// day, pulling already-called leads to the front well before it actually
// feels close to closing.
const CLOSING_SOON_MINUTES = 60;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();

  // Behind a reverse proxy (Railway, etc.), req.url's origin can resolve to an
  // internal address like localhost instead of the public domain, which would
  // send the browser to a Location header it can never actually reach. Build
  // the redirect target from the forwarded headers the proxy sets instead.
  const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host;
  const origin = `${proto}://${host}`;

  // A second device tapping Power Dial while a session is already in
  // progress (started from a laptop, say) joins that same session instead
  // of building a competing one — as long as the lead it's parked on is
  // still actually a real, owned lead.
  const existing = db.prepare('SELECT current_lead_id FROM dial_sessions WHERE user_id = ?').get(user.id) as
    | { current_lead_id: string | null }
    | undefined;
  if (existing?.current_lead_id) {
    const stillOwned = db.prepare('SELECT id FROM customers WHERE id = ? AND owner_id = ?').get(existing.current_lead_id, user.id);
    if (stillOwned) {
      return NextResponse.redirect(new URL(`/leads/${existing.current_lead_id}?dialing=1`, origin));
    }
    db.prepare('DELETE FROM dial_sessions WHERE user_id = ?').run(user.id);
  }

  // Status is a snapshot taken at import time (or whenever it was last
  // touched) -- it doesn't advance on its own as a lead sits untouched, so
  // this catches it up to its real age before the query below (or the
  // categories picker's own counts) reads it, same as every other queue
  // build.
  promoteAgingLeads(db, user.id);

  const categories = parseCategories(req.nextUrl.searchParams.get('categories'));
  const importedFrom = req.nextUrl.searchParams.get('importedFrom');
  const importedTo = req.nextUrl.searchParams.get('importedTo');
  const dateFilter = buildImportDateFilter(importedFrom, importedTo);

  // Was `date(occurred_at) = date('now')` -- a UTC calendar day, while the
  // actual per-call cap check (app/api/leads/[id]/calls/route.ts) and every
  // other "today" in this app use the agent's own Mountain-time day. During
  // the ~6 hour gap between UTC midnight and real Mountain midnight, that
  // mismatch let an already-maxed-out lead look freshly eligible again here
  // only to have the real dial rejected by the per-call check moments later.
  const todayStart = agentMidnightUTC(0).toISOString().slice(0, 19).replace('T', ' ');
  const categoryParams = Object.fromEntries(categories.map((c, i) => [`cat${i}`, c]));
  const allRows = db
    .prepare(
      `SELECT id, status, state, first_name, last_name,
         (SELECT COUNT(*) FROM calls WHERE customer_id = customers.id AND occurred_at >= @todayStart) AS calls_today,
         (SELECT COUNT(*) FROM calls WHERE customer_id = customers.id) AS calls_ever
       FROM customers
       WHERE archived = 0 AND owner_id = @ownerId
         AND (
           status IN (${categories.map((_, i) => `@cat${i}`).join(',')})
           -- A Not Interested disposition sets status='lost' with a
           -- 3-day retry_after (lib/audit.ts) instead of dropping the
           -- lead for good like other 'lost' reasons (Broke, Connected
           -- HU) -- once that date passes, it's eligible again same as
           -- any other status, no manual reset needed. Only offered when
           -- 'working' is one of the selected categories -- a lead that
           -- came back from a Not Interested cooldown is exactly a working
           -- lead, not a fresh/aging one.
           OR (@workingSelected = 1 AND status = 'lost' AND retry_after IS NOT NULL AND retry_after <= datetime('now'))
         )
         AND phone IS NOT NULL AND TRIM(phone) != ''
         AND id NOT IN (
           SELECT customer_id FROM calls WHERE occurred_at >= @todayStart
           GROUP BY customer_id HAVING COUNT(*) >= ${MAX_CALLS_PER_DAY}
         )
         ${dateFilter.clause}
       ORDER BY CASE status WHEN 'fresh' THEN 0 WHEN 'working' THEN 1 WHEN 'aging_45_90' THEN 2 ELSE 3 END,
         -- Never-called-at-all (any day, not just today) beats everyone
         -- that's been dialed before, full stop -- without this, a lead
         -- dialed YESTERDAY with no answer resets to calls_today=0 this
         -- morning and competes purely on purchase date against a lead
         -- that's NEVER been called, and wins whenever it happens to have
         -- a newer purchased_at -- exactly the "queue keeps giving me
         -- leads I've already dialed, before I'm through the genuinely new
         -- ones" bug this fixes.
         calls_ever > 0,
         -- Within that: not-yet-dialed-today beats already-dialed-today-
         -- but-under-cap -- outcomes like No Answer/Voicemail/Busy don't
         -- change a lead's status away from 'fresh', so without this a
         -- lead already redialed today would keep competing purely on
         -- purchase date against other previously-dialed (but not today)
         -- leads.
         calls_today > 0,
         -- Within "fresh" specifically: newest purchase first, so a lead
         -- that just got imported (or dripped in live) gets dialed ahead of
         -- ones sitting from an earlier import -- and if an even newer
         -- batch lands after that, IT jumps ahead in turn. The aging tiers
         -- keep the opposite (oldest first) on purpose: those are backlog
         -- to clear before it ages further, not new arrivals to rush to.
         CASE WHEN status = 'fresh' THEN -CAST(strftime('%s', purchased_at) AS INTEGER) ELSE CAST(strftime('%s', purchased_at) AS INTEGER) END`
    )
    .all({ ownerId: user.id, todayStart, workingSelected: categories.includes('working') ? 1 : 0, ...categoryParams, ...dateFilter.params }) as { id: string; status: string; state: string | null; first_name: string; last_name: string; calls_today: number; calls_ever: number }[];

  // Leads whose local time is outside the 8am-9pm calling window get held
  // back rather than queued dead-on-arrival — they'll be picked up again on
  // a later Power Dial run once their state's window opens. Test leads
  // (name contains "fake") skip this so Power Dial/Auto-Dial can be tried
  // out any time of day.
  const callable = allRows.filter((r) => isTestLead(r) || isWithinCallingHours(r.state));

  // Within the callable set, leads whose window closes soon jump ahead of
  // the normal status-based order (stable sort keeps everyone else exactly
  // where they were) — otherwise a lead an hour from closing could sit
  // behind a hundred "fresh" leads and never get reached in time. Test
  // leads are always "open," so there's no closing-soon urgency for them.
  const rows = callable
    .map((r) => ({ ...r, minutesLeft: isTestLead(r) ? Infinity : minutesUntilCallingWindowCloses(r.state) }))
    .sort((a, b) => {
      // Test leads jump straight to the very front — otherwise they'd sort
      // by purchased_at like anything else and end up buried behind a
      // whole day's worth of older real leads, defeating the point of
      // dropping in a few to try Power Dial/Auto-Dial right now.
      const aTest = isTestLead(a);
      const bTest = isTestLead(b);
      if (aTest !== bTest) return aTest ? -1 : 1;
      const aUrgent = a.minutesLeft <= CLOSING_SOON_MINUTES;
      const bUrgent = b.minutesLeft <= CLOSING_SOON_MINUTES;
      if (aUrgent && bUrgent) return a.minutesLeft - b.minutesLeft;
      if (aUrgent) return -1;
      if (bUrgent) return 1;
      return 0;
    });

  if (rows.length === 0) {
    const reason = allRows.length > 0 ? '&closed=1' : '';
    return NextResponse.redirect(new URL(`/leads?empty=1${reason}`, origin));
  }
  const [first, ...rest] = rows;
  // Stored empty (not the literal list) when every category was selected --
  // matches how an absent ?categories= is already read back as "all," and
  // keeps a plain Power Dial click from ever persisting a stale explicit
  // list that a later default-behavior change wouldn't pick up.
  const storedCategories = categories.length === ALL_CATEGORIES.length ? '' : categories.join(',');
  const storedImportedFrom = dateFilter.params.importedFrom || '';
  const storedImportedTo = dateFilter.params.importedTo || '';
  // A brand-new session always starts Auto-Dial off and its stats at zero —
  // even if the user's last session left it on, so Auto-Dial never carries
  // over silently into a session the user hasn't looked at yet.
  db.prepare(
    `INSERT INTO dial_sessions (user_id, current_lead_id, queue, recycle, pass, auto_dial, auto_dial_pace_ms, session_dials, session_connects, consecutive_no_answer, categories, imported_from, imported_to, updated_at)
     VALUES (?, ?, ?, '', 1, 0, 2000, 0, 0, 0, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       current_lead_id = excluded.current_lead_id, queue = excluded.queue,
       recycle = '', pass = 1, auto_dial = 0, auto_dial_pace_ms = 2000,
       session_dials = 0, session_connects = 0, consecutive_no_answer = 0,
       categories = excluded.categories, imported_from = excluded.imported_from, imported_to = excluded.imported_to,
       updated_at = excluded.updated_at`
  ).run(user.id, first.id, rest.map((r) => r.id).join(','), storedCategories, storedImportedFrom, storedImportedTo);

  return NextResponse.redirect(new URL(`/leads/${first.id}?dialing=1`, origin));
}
