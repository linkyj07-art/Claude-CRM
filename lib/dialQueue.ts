import Database from 'better-sqlite3';
import { isWithinCallingHours, isTestLead, MAX_CALLS_PER_DAY } from './util';

export type EligibleLead = {
  id: string;
  status: string;
  state: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
};

// The same "is this lead actually dialable right now" rule /dial uses to
// build a fresh queue (right status, has a phone, under today's call cap,
// within calling hours or a test lead) — pulled out so the live-queue check
// in /api/dial-session (does a lead exist that isn't in this session yet?)
// can't drift out of sync with what a rebuilt queue would actually contain.
export function fetchEligibleLeads(db: Database.Database, ownerId: string): EligibleLead[] {
  const allRows = db
    .prepare(
      `SELECT id, status, state, first_name, last_name, phone FROM customers
       WHERE archived = 0 AND owner_id = ? AND status IN ('fresh','working','aging_45_90','aging_90_plus')
         AND phone IS NOT NULL AND TRIM(phone) != ''
         AND id NOT IN (
           SELECT customer_id FROM calls WHERE date(occurred_at) = date('now')
           GROUP BY customer_id HAVING COUNT(*) >= ${MAX_CALLS_PER_DAY}
         )
       ORDER BY CASE status WHEN 'fresh' THEN 0 WHEN 'working' THEN 1 WHEN 'aging_45_90' THEN 2 ELSE 3 END,
         -- Same newest-first-within-fresh rule /dial's own queue-build uses,
         -- so when several new leads surface at once in the live-queue
         -- banner, the freshest of them is the one offered/queued first.
         CASE WHEN status = 'fresh' THEN -CAST(strftime('%s', purchased_at) AS INTEGER) ELSE CAST(strftime('%s', purchased_at) AS INTEGER) END`
    )
    .all(ownerId) as EligibleLead[];

  return allRows.filter((r) => isTestLead(r) || isWithinCallingHours(r.state));
}
