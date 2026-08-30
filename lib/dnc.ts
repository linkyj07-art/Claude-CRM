import { getDb } from './db';
import { newId, normalizePhone } from './util';

export type DncMatch = {
  id: string;
  phone_display: string | null;
  first_name: string | null;
  last_name: string | null;
  reason: string | null;
  created_at: string;
};

// Called from every place a lead's status actually becomes 'dnc' — logging a
// DNC call outcome, or manually setting status to dnc — so the number stays
// remembered even if the lead record it came from is deleted afterward.
// First entry for a given number wins (ON CONFLICT DO NOTHING): re-marking
// an already-registered number shouldn't overwrite the original reason/date.
export function addToDncRegistry(
  phone: string | null | undefined,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  reason: string,
  addedByUserId: string | null
): void {
  const digits = normalizePhone(phone);
  if (!digits) return;
  getDb()
    .prepare(
      `INSERT INTO dnc_numbers (id, phone, phone_display, first_name, last_name, reason, added_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(phone) DO NOTHING`
    )
    .run(newId(), digits, phone || null, firstName || null, lastName || null, reason, addedByUserId);
}

export function findDncMatch(phone: string | null | undefined): DncMatch | null {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  const row = getDb()
    .prepare('SELECT id, phone_display, first_name, last_name, reason, created_at FROM dnc_numbers WHERE phone = ?')
    .get(digits) as DncMatch | undefined;
  return row || null;
}
