import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId } from '@/lib/util';
import { logAudit, touchCustomer } from '@/lib/audit';
import { getCurrentUser } from '@/lib/currentUser';
import { ownsCustomer } from '@/lib/ownership';

const FIELDS = [
  'label', 'name', 'note_date', 'phone', 'beneficiary', 'beneficiary_dob', 'budget', 'health', 'discount',
  'bank_name', 'bank_state', 'routing_number', 'account_number', 'mailing_address', 'email',
  'born_in', 'ssn', 'plan_bronze_coverage', 'plan_bronze_price', 'plan_silver_coverage', 'plan_silver_price',
  'plan_gold_coverage', 'plan_gold_price', 'selected_plan', 'draft_date', 'code_word', 'free_text'
];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  if (!ownsCustomer(db, params.id, user.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const id = newId();
  const row: Record<string, unknown> = { id, customer_id: params.id, created_by: 'You' };
  for (const f of FIELDS) row[f] = body[f] ?? null;
  if (!row.label) row.label = 'Note';

  db.prepare(
    `INSERT INTO note_versions (id, customer_id, label, name, note_date, phone, beneficiary, beneficiary_dob, budget,
      health, discount, bank_name, bank_state, routing_number, account_number, mailing_address, email,
      born_in, ssn, plan_bronze_coverage, plan_bronze_price, plan_silver_coverage, plan_silver_price,
      plan_gold_coverage, plan_gold_price, selected_plan, draft_date, code_word, free_text, created_by)
     VALUES (@id, @customer_id, @label, @name, @note_date, @phone, @beneficiary, @beneficiary_dob, @budget,
      @health, @discount, @bank_name, @bank_state, @routing_number, @account_number, @mailing_address, @email,
      @born_in, @ssn, @plan_bronze_coverage, @plan_bronze_price, @plan_silver_coverage, @plan_silver_price,
      @plan_gold_coverage, @plan_gold_price, @selected_plan, @draft_date, @code_word, @free_text, @created_by)`
  ).run(row);

  logAudit(params.id, 'note', `Note saved — ${row.label}`);
  touchCustomer(params.id);
  return NextResponse.json({ id });
}
