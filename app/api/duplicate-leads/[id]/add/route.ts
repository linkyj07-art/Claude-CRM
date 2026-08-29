import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId } from '@/lib/util';
import { logAudit } from '@/lib/audit';
import { DuplicateLead } from '@/lib/types';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const dupe = db.prepare('SELECT * FROM duplicate_leads WHERE id = ?').get(params.id) as DuplicateLead | undefined;
  if (!dupe) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const data = JSON.parse(dupe.raw_data);
  const id = newId();
  db.prepare(
    `INSERT INTO customers (id, first_name, last_name, phone, email, dob, gender, marital_status,
      military, military_branch, coverage_wanted, address, city, state, postal_code, timezone,
      ad_type, platform, lead_vendor_id, best_time, lead_cost, trusted_form_url, status, purchased_at, created_at, updated_at)
     VALUES (@id, @first_name, @last_name, @phone, @email, @dob, @gender, @marital_status,
      @military, @military_branch, @coverage_wanted, @address, @city, @state, @postal_code, NULL,
      @ad_type, @platform, @lead_vendor_id, @best_time, @lead_cost, @trusted_form_url, @status, @purchased_at, datetime('now'), datetime('now'))`
  ).run({ ...data, id });

  logAudit(id, 'lead_purchased', `Lead added — confirmed not a duplicate (was flagged against ${dupe.customer_id})`);
  db.prepare('DELETE FROM duplicate_leads WHERE id = ?').run(params.id);
  return NextResponse.json({ id });
}
