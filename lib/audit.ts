import { getDb } from './db';
import { newId } from './util';
import { addToDncRegistry } from './dnc';

export function logAudit(customerId: string, eventType: string, summary: string, meta?: unknown) {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_history (id, customer_id, event_type, summary, meta, occurred_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(newId(), customerId, eventType, summary, meta ? JSON.stringify(meta) : null);
}

export function touchCustomer(customerId: string) {
  getDb().prepare(`UPDATE customers SET updated_at = datetime('now') WHERE id = ?`).run(customerId);
}

const CALL_OUTCOME_LABEL: Record<string, string> = {
  pending: 'Dial started',
  no_answer: 'No Answer',
  voicemail: 'Voicemail',
  google_voice: 'Google Voice',
  connected: 'Connected',
  busy: 'Busy',
  wrong_number: 'Wrong Number',
  disconnected: 'Disconnected Number',
  dnc: 'Requested DNC'
};

// Opens (or reuses, if one's already open) a vendor dispute for this lead —
// called automatically off certain call outcomes (a disconnected number is
// the vendor's fault, not a dead lead the agent should keep dialing) so it
// shows up on the Dispute Log immediately instead of only living as a
// status flag with no record of why or what's been done about it.
export function openDispute(customerId: string, reason: string): void {
  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM disputes WHERE customer_id = ? AND status IN ('open','submitted') LIMIT 1`)
    .get(customerId);
  if (existing) return;
  db.prepare(
    `INSERT INTO disputes (id, customer_id, reason, status, created_at, updated_at)
     VALUES (?, ?, ?, 'open', datetime('now'), datetime('now'))`
  ).run(newId(), customerId, reason);
}

// Shared between logging a fresh call and completing a pending one, so both
// paths nudge status and write the audit trail the same way.
export function applyCallOutcome(customerId: string, outcome: string, disposition: string | null | undefined, attempt: number, userId: string | null = null) {
  const db = getDb();
  const outcomeLabel = CALL_OUTCOME_LABEL[outcome] || outcome;
  logAudit(customerId, 'call', `Call attempt #${attempt} — ${outcomeLabel}${disposition ? ` (${disposition})` : ''}`);

  if (outcome === 'dnc') {
    db.prepare(`UPDATE customers SET status = 'dnc' WHERE id = ?`).run(customerId);
    const customer = db.prepare('SELECT phone, first_name, last_name FROM customers WHERE id = ?').get(customerId) as
      { phone: string | null; first_name: string; last_name: string } | undefined;
    if (customer) addToDncRegistry(customer.phone, customer.first_name, customer.last_name, 'Requested DNC on a call', userId);
  } else if (outcome === 'disconnected') {
    db.prepare(`UPDATE customers SET status = 'disputed' WHERE id = ?`).run(customerId);
    openDispute(customerId, 'Disconnected number');
  } else if (outcome === 'wrong_number' && attempt >= 2) {
    db.prepare(`UPDATE customers SET status = 'invalid' WHERE id = ?`).run(customerId);
  } else if (outcome === 'connected' && disposition) {
    const map: Record<string, string> = {
      // hung_up ("Connected (HU)") means they picked up and hung up on the
      // agent -- a rejection, not a sign of interest, same bucket as Not
      // Interested. Previously missing from this map entirely, which left
      // status untouched rather than actually marking it lost.
      // broke ("Broke") means the prospect can't afford coverage -- same
      // 'lost' bucket, which is what actually drops a lead out of Power
      // Dial eligibility (fetchEligibleLeads/the /dial queue build only
      // pull 'fresh'/'working'/'aging_45_90'/'aging_90_plus').
      not_interested: 'lost', unqualified: 'lost', hung_up: 'lost', broke: 'lost', qualified: 'working',
      interested: 'working', callback: 'working', sold: 'sold'
    };
    if (map[disposition]) {
      db.prepare(`UPDATE customers SET status = ? WHERE id = ?`).run(map[disposition], customerId);
    }
  }
  touchCustomer(customerId);
}
