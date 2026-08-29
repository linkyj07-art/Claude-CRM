import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId } from '@/lib/util';
import { logAudit, touchCustomer } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const db = getDb();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const applicationId = newId();
  db.prepare(
    `INSERT INTO applications (id, customer_id, carrier, product, face_amount, monthly_premium, status, submitted_at, decided_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)`
  ).run(applicationId, params.id, body.carrier, body.product || null, body.face_amount || null, body.monthly_premium || null, now, now, 'Auto-created from SOLD flow');

  const policyId = newId();
  db.prepare(
    `INSERT INTO policies (id, customer_id, application_id, carrier, product, policy_type, face_amount,
      monthly_premium, annual_premium, effective_date, policy_number, agent, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
  ).run(
    policyId, params.id, applicationId, body.carrier, body.product || null, body.policy_type || null,
    body.face_amount || null, body.monthly_premium || null, body.annual_premium || null,
    body.effective_date || null, body.policy_number || null, body.agent || 'You', now
  );

  const commissionId = newId();
  db.prepare(
    `INSERT INTO commissions (id, policy_id, customer_id, commission_pct, expected_commission, commission_type,
      expected_pay_date, actual_pay_date, chargeback, net_commission, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    commissionId, policyId, params.id, body.commission_pct || null, body.expected_commission || null,
    body.commission_type || 'advance', body.expected_pay_date || null, body.actual_pay_date || null,
    body.chargeback || 0, body.net_commission ?? body.expected_commission ?? null,
    body.actual_pay_date ? 'paid' : 'pending', now
  );

  if (body.actual_pay_date && body.net_commission) {
    db.prepare(
      `INSERT INTO payments (id, customer_id, policy_id, amount, type, paid_at, notes)
       VALUES (?, ?, ?, ?, 'initial', ?, 'Initial commission payment')`
    ).run(newId(), params.id, policyId, body.net_commission, body.actual_pay_date);
  }

  db.prepare(`UPDATE customers SET status = 'sold', sold_at = ?, updated_at = ? WHERE id = ?`).run(now, now, params.id);

  logAudit(params.id, 'policy_issued', `Policy issued — ${body.carrier} ($${(body.annual_premium || 0).toFixed ? body.annual_premium : body.annual_premium}/yr)`);
  logAudit(params.id, 'commission', `Commission recorded — $${body.net_commission ?? body.expected_commission ?? 0} net`);

  return NextResponse.json({ policyId, commissionId, applicationId });
}
