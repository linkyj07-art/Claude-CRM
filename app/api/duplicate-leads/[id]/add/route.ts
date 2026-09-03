import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId } from '@/lib/util';
import { logAudit } from '@/lib/audit';
import { DuplicateLead } from '@/lib/types';
import { getCurrentUser } from '@/lib/currentUser';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const dupe = db
    .prepare(`SELECT d.* FROM duplicate_leads d JOIN customers c ON c.id = d.customer_id WHERE d.id = ? AND c.owner_id = ?`)
    .get(params.id, user.id) as DuplicateLead | undefined;
  if (!dupe) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const data = JSON.parse(dupe.raw_data);
  const id = newId();
  db.prepare(
    `INSERT INTO customers (id, owner_id, first_name, last_name, phone, email, dob, gender, marital_status,
      military, military_branch, coverage_wanted, address, city, state, postal_code, timezone,
      ad_type, platform, lead_vendor_id, best_time, lead_cost, trusted_form_url, status, purchased_at, lead_date,
      was_import_duplicate, duplicate_of_customer_id, created_at, updated_at)
     VALUES (@id, @owner_id, @first_name, @last_name, @phone, @email, @dob, @gender, @marital_status,
      @military, @military_branch, @coverage_wanted, @address, @city, @state, @postal_code, NULL,
      @ad_type, @platform, @lead_vendor_id, @best_time, @lead_cost, @trusted_form_url, @status, @purchased_at, @lead_date,
      1, @duplicate_of_customer_id, datetime('now'), datetime('now'))`
  ).run({ ...data, id, owner_id: user.id, duplicate_of_customer_id: dupe.customer_id, lead_date: data.lead_date || null });

  logAudit(id, 'lead_purchased', `Lead added — confirmed not a duplicate (was flagged against ${dupe.customer_id})`);
  db.prepare('DELETE FROM duplicate_leads WHERE id = ?').run(params.id);
  return NextResponse.json({ id });
}
