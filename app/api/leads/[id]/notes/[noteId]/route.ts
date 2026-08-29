import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logAudit, touchCustomer } from '@/lib/audit';

const FIELDS = [
  'label', 'name', 'note_date', 'phone', 'beneficiary', 'beneficiary_dob', 'budget', 'health', 'discount',
  'bank_name', 'bank_state', 'routing_number', 'account_number', 'mailing_address', 'email',
  'born_in', 'ssn', 'plan_bronze_coverage', 'plan_bronze_price', 'plan_silver_coverage', 'plan_silver_price',
  'plan_gold_coverage', 'plan_gold_price', 'draft_date', 'code_word', 'free_text'
];

export async function PATCH(req: NextRequest, { params }: { params: { id: string; noteId: string } }) {
  const body = await req.json();
  const db = getDb();
  const set = FIELDS.map((f) => `${f} = @${f}`).join(', ');
  const row: Record<string, unknown> = { id: params.noteId, customer_id: params.id };
  for (const f of FIELDS) row[f] = body[f] ?? null;
  if (!row.label) row.label = 'Note';

  const result = db
    .prepare(`UPDATE note_versions SET ${set} WHERE id = @id AND customer_id = @customer_id`)
    .run(row);
  if (result.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  logAudit(params.id, 'note', `Note updated — ${row.label}`);
  touchCustomer(params.id);
  return NextResponse.json({ ok: true });
}
