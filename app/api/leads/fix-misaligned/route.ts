import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';
import { reconcileContactFields, normalizeState, stateFromAreaCode } from '@/lib/util';

type CustomerRow = {
  id: string; first_name: string; last_name: string;
  phone: string | null; dob: string | null; email: string | null; gender: string | null; state: string | null;
};

// One-time (repeatable, and safe to re-run) sweep over every lead this user
// owns, applying the same shape-based phone/dob/email/gender/state reconciler
// the import route uses on fresh uploads — for leads that got shuffled by a
// bad import before that logic existed (or improved), instead of only fixing
// it going forward. Rows that are already aligned are left untouched.
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const customers = db
    .prepare(`SELECT id, first_name, last_name, phone, dob, email, gender, state FROM customers WHERE owner_id = ?`)
    .all(user.id) as CustomerRow[];

  const update = db.prepare(
    `UPDATE customers SET phone = ?, dob = ?, email = ?, gender = ?, state = ?, updated_at = datetime('now') WHERE id = ?`
  );

  const fixed: { id: string; name: string; before: Partial<CustomerRow>; after: Partial<CustomerRow> }[] = [];

  const applyFixes = db.transaction(() => {
    for (const c of customers) {
      const reconciled = reconcileContactFields({
        phone: c.phone || '', dob: c.dob || '', age: '', email: c.email || '', gender: c.gender || '', state: c.state || ''
      });
      // Deliberately NOT falling back to the old column value when reconcile
      // comes up empty — an empty result means nothing in the whole row
      // matched that field's shape, so the old value was definitely wrong
      // (that's the entire reason it's being fixed). Blank is strictly safer
      // than keeping a value that, e.g., breaks the Call button.
      const newPhone = reconciled.phone || null;
      const newDob = reconciled.dob || null;
      const newEmail = reconciled.email || null;
      const newGender = reconciled.gender || null;
      const newState = normalizeState(reconciled.state) || stateFromAreaCode(newPhone) || null;

      const changed =
        (newPhone || '') !== (c.phone || '') ||
        (newDob || '') !== (c.dob || '') ||
        (newEmail || '') !== (c.email || '') ||
        (newGender || '') !== (c.gender || '') ||
        (newState || '') !== (c.state || '');

      if (!changed) continue;

      update.run(newPhone, newDob, newEmail, newGender, newState, c.id);
      fixed.push({
        id: c.id,
        name: `${c.first_name} ${c.last_name}`,
        before: { phone: c.phone, dob: c.dob, email: c.email, gender: c.gender, state: c.state },
        after: { phone: newPhone, dob: newDob, email: newEmail, gender: newGender, state: newState }
      });
    }
  });
  applyFixes();

  return NextResponse.json({ scanned: customers.length, fixedCount: fixed.length, fixed });
}
