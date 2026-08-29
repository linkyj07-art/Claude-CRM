import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';
import { logAudit } from '@/lib/audit';

const STATUS_LABEL: Record<string, string> = {
  open: 'Dispute opened',
  submitted: 'Dispute submitted to vendor',
  resolved: 'Dispute resolved — credited',
  denied: 'Dispute denied by vendor'
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const dispute = db
    .prepare(`SELECT d.id, d.customer_id FROM disputes d JOIN customers c ON c.id = d.customer_id WHERE d.id = ? AND c.owner_id = ?`)
    .get(params.id, user.id) as { id: string; customer_id: string } | undefined;
  if (!dispute) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (body.status && ['open', 'submitted', 'resolved', 'denied'].includes(body.status)) {
    fields.push('status = ?');
    values.push(body.status);
  }
  if ('credit_amount' in body) {
    fields.push('credit_amount = ?');
    values.push(body.credit_amount === '' || body.credit_amount === null ? null : Number(body.credit_amount));
  }
  if ('notes' in body) {
    fields.push('notes = ?');
    values.push(body.notes || null);
  }
  if (fields.length === 0) return NextResponse.json({ ok: true });

  fields.push(`updated_at = datetime('now')`);
  values.push(params.id);
  db.prepare(`UPDATE disputes SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  if (body.status) {
    logAudit(dispute.customer_id, 'status_change', STATUS_LABEL[body.status] || `Dispute status: ${body.status}`);
    if (body.status === 'resolved' || body.status === 'denied') {
      // Resolved either way — the lead itself isn't necessarily worth calling
      // again (a credited/disconnected number), but shouldn't keep sitting
      // parked as "disputed" once the vendor conversation is actually done.
      db.prepare(`UPDATE customers SET status = 'invalid' WHERE id = ? AND status = 'disputed'`).run(dispute.customer_id);
    }
  }

  return NextResponse.json({ ok: true });
}
