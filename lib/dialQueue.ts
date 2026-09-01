import Database from 'better-sqlite3';
import { isWithinCallingHours, isTestLead, MAX_CALLS_PER_DAY, agentMidnightUTC, promoteAgingLeads } from './util';

const ALL_CATEGORIES = ['fresh', 'working', 'aging_45_90', 'aging_90_plus'] as const;

export type EligibleLead = {
  id: string;
  status: string;
  state: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
  calls_today: number;
  calls_ever: number;
};

// The same "is this lead actually dialable right now" rule /dial uses to
// build a fresh queue (right status, has a phone, under today's call cap,
// within calling hours or a test lead) — pulled out so the live-queue check
// in /api/dial-session (does a lead exist that isn't in this session yet?)
// can't drift out of sync with what a rebuilt queue would actually contain.
// categories mirrors the same categories a session was built with
// (dial_sessions.categories) -- undefined/empty means all four, same "empty
// = all" convention /dial's own queue-build uses, so the live "new lead
// ready" banner never offers a category the agent deliberately excluded
// when they started this Power Dial session.
export function fetchEligibleLeads(db: Database.Database, ownerId: string, categories?: string[]): EligibleLead[] {
  promoteAgingLeads(db, ownerId);
  const cats = categories && categories.length > 0 ? categories : [...ALL_CATEGORIES];
  const workingSelected = cats.includes('working');

  // Was `date(occurred_at) = date('now')` -- a UTC calendar day, while the
  // actual per-call cap check (app/api/leads/[id]/calls/route.ts) and every
  // other "today" in this app use the agent's own Mountain-time day. During
  // the ~6 hour gap between UTC midnight and real Mountain midnight, that
  // mismatch let an already-maxed-out lead look freshly eligible again here
  // only to have the real dial rejected by the per-call check moments later.
  const todayStart = agentMidnightUTC(0).toISOString().slice(0, 19).replace('T', ' ');
  const categoryParams = Object.fromEntries(cats.map((c, i) => [`cat${i}`, c]));
  const allRows = db
    .prepare(
      `SELECT id, status, state, first_name, last_name, phone,
         (SELECT COUNT(*) FROM calls WHERE customer_id = customers.id AND occurred_at >= @todayStart) AS calls_today,
         (SELECT COUNT(*) FROM calls WHERE customer_id = customers.id) AS calls_ever
       FROM customers
       WHERE archived = 0 AND owner_id = @ownerId
         AND (
           status IN (${cats.map((_, i) => `@cat${i}`).join(',')})
           -- A Not Interested disposition sets status='lost' with a
           -- 3-day retry_after (lib/audit.ts) instead of dropping the
           -- lead for good -- eligible again once that date passes. Only
           -- when 'working' is one of the selected categories, same as
           -- /dial's own queue-build.
           OR (@workingSelected = 1 AND status = 'lost' AND retry_after IS NOT NULL AND retry_after <= datetime('now'))
         )
         AND phone IS NOT NULL AND TRIM(phone) != ''
         AND id NOT IN (
           SELECT customer_id FROM calls WHERE occurred_at >= @todayStart
           GROUP BY customer_id HAVING COUNT(*) >= ${MAX_CALLS_PER_DAY}
         )
       ORDER BY CASE status WHEN 'fresh' THEN 0 WHEN 'working' THEN 1 WHEN 'aging_45_90' THEN 2 ELSE 3 END,
         -- Same never-called-at-all/not-dialed-today priority /dial's own
         -- queue-build uses -- see the comment there for why this matters
         -- (No Answer/Voicemail/Busy don't move a lead out of 'fresh', so
         -- without this a lead dialed on a PRIOR day resets to
         -- calls_today=0 and competes purely on purchase date against a
         -- lead that's never been touched at all).
         calls_ever > 0,
         calls_today > 0,
         -- Same newest-first-within-fresh rule /dial's own queue-build uses,
         -- so when several new leads surface at once in the live-queue
         -- banner, the freshest of them is the one offered/queued first.
         CASE WHEN status = 'fresh' THEN -CAST(strftime('%s', purchased_at) AS INTEGER) ELSE CAST(strftime('%s', purchased_at) AS INTEGER) END`
    )
    .all({ ownerId, todayStart, workingSelected: workingSelected ? 1 : 0, ...categoryParams }) as EligibleLead[];

  return allRows.filter((r) => isTestLead(r) || isWithinCallingHours(r.state));
}
