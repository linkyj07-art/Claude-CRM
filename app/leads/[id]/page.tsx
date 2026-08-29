import { getDb } from '@/lib/db';
import { notFound } from 'next/navigation';
import LeadWorkspace from '@/components/LeadWorkspace';
import {
  Customer, NoteVersion, CallRecord, Policy, Commission, Carrier, CarrierRule, LeadVendor
} from '@/lib/types';

export const dynamic = 'force-dynamic';

export default function LeadPage({ params }: { params: { id: string } }) {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(params.id) as Customer | undefined;
  if (!customer) notFound();

  const notes = db.prepare('SELECT * FROM note_versions WHERE customer_id = ? ORDER BY created_at DESC').all(params.id) as NoteVersion[];
  const calls = db.prepare('SELECT * FROM calls WHERE customer_id = ? ORDER BY occurred_at DESC').all(params.id) as CallRecord[];
  const quotes = db.prepare('SELECT * FROM quotes WHERE customer_id = ? ORDER BY created_at DESC').all(params.id);
  const appointments = db.prepare('SELECT * FROM appointments WHERE customer_id = ? ORDER BY scheduled_at DESC').all(params.id);
  const applications = db.prepare('SELECT * FROM applications WHERE customer_id = ? ORDER BY submitted_at DESC').all(params.id);
  const policies = db.prepare('SELECT * FROM policies WHERE customer_id = ? ORDER BY created_at DESC').all(params.id) as Policy[];
  const commissions = db.prepare('SELECT * FROM commissions WHERE customer_id = ? ORDER BY created_at DESC').all(params.id) as Commission[];
  const payments = db.prepare('SELECT * FROM payments WHERE customer_id = ? ORDER BY paid_at DESC').all(params.id);
  const vendors = db.prepare('SELECT * FROM lead_vendors ORDER BY name').all() as LeadVendor[];
  const carriers = db.prepare('SELECT * FROM carriers ORDER BY sort_order, name').all() as Carrier[];
  const rules = db.prepare('SELECT * FROM carrier_underwriting_rules').all() as CarrierRule[];

  return (
    <LeadWorkspace
      customer={customer}
      notes={notes}
      calls={calls}
      quotes={quotes as any}
      appointments={appointments as any}
      applications={applications as any}
      policies={policies}
      commissions={commissions}
      payments={payments as any}
      vendors={vendors}
      carriers={carriers}
      rules={rules}
      quoteToken={process.env.INSURANCE_TOOLKIT_TOKEN || ''}
    />
  );
}
