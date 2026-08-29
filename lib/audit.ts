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
