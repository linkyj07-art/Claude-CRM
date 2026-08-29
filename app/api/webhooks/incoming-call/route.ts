import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId, normalizePhone } from '@/lib/util';

// Fed by an outside automation (Zapier/Make watching Quo's "new incoming
// call" event), not a logged-in browser — middleware.ts lets this one path
// through without a session cookie, so auth here is a shared secret in the
// URL instead: ?token=<QUO_WEBHOOK_TOKEN>. Anyone who has that token can
// post a fake "incoming call" for a lead they already know the phone number
// of, which isn't a meaningful exposure — there's no PII in the response,
// only a notification popping up in the owning agent's own browser.
export async function POST(req: NextRequest) {
  const expectedToken = process.env.QUO_WEBHOOK_TOKEN;
  if (!expectedToken) {
    return NextResponse.json({ error: 'QUO_WEBHOOK_TOKEN is not configured on the server' }, { status: 500 });
  }
  if (req.nextUrl.searchParams.get('token') !== expectedToken) {
    return NextResponse.json({ error: 'Invalid or missing token' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  // Zapier's "Webhooks" action lets you name the body fields yourself, so
  // accept a couple of the obvious choices rather than forcing one exact key.
  const rawPhone = body.phone || body.caller || body.from || body.caller_phone || '';
  const phone = normalizePhone(String(rawPhone));
  if (!phone) {
    return NextResponse.json({ error: 'No usable phone number in the request body' }, { status: 400 });
  }

  const db = getDb();
  const customers = db.prepare('SELECT id, phone FROM customers WHERE phone IS NOT NULL').all() as { id: string; phone: string }[];
  const match = customers.find((c) => normalizePhone(c.phone) === phone);

  if (!match) {
    return NextResponse.json({ ok: true, matched: false });
  }

  db.prepare('INSERT INTO incoming_calls (id, customer_id, phone) VALUES (?, ?, ?)').run(newId(), match.id, String(rawPhone));
  return NextResponse.json({ ok: true, matched: true, customer_id: match.id });
}
