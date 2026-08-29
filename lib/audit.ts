import { getDb } from './db';
import { newId } from './util';

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
  dnc: 'Requested DNC'
};

// Shared between logging a fresh call and completing a pending one, so both
// paths nudge status and write the audit trail the same way.
export function applyCallOutcome(customerId: string, outcome: string, disposition: string | null | undefined, attempt: number) {
  const db = getDb();
  const outcomeLabel = CALL_OUTCOME_LABEL[outcome] || outcome;
  logAudit(customerId, 'call', `Call attempt #${attempt} — ${outcomeLabel}${disposition ? ` (${disposition})` : ''}`);

  if (outcome === 'dnc') {
    db.prepare(`UPDATE customers SET status = 'dnc' WHERE id = ?`).run(customerId);
  } else if (outcome === 'wrong_number' && attempt >= 2) {
    db.prepare(`UPDATE customers SET status = 'invalid' WHERE id = ?`).run(customerId);
  } else if (outcome === 'connected' && disposition) {
    const map: Record<string, string> = {
      not_interested: 'lost', unqualified: 'lost', qualified: 'working',
      interested: 'working', callback: 'working', sold: 'sold'
    };
    if (map[disposition]) {
      db.prepare(`UPDATE customers SET status = ? WHERE id = ?`).run(map[disposition], customerId);
    }
  }
  touchCustomer(customerId);
}
