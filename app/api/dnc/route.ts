import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';
import { addToDncRegistry } from '@/lib/dnc';
import { normalizePhone } from '@/lib/util';

// The DNC registry is company-wide (see schema.sql's comment on dnc_numbers)
// rather than scoped to the logged-in user — every teammate needs to see
// and add to the same list, since a DNC request binds whoever calls that
// number next, not just whoever answered the phone when it came in.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const rows = getDb().prepare('SELECT * FROM dnc_numbers ORDER BY created_at DESC').all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const digits = normalizePhone(body.phone);
  if (!digits) return NextResponse.json({ error: 'Enter a valid phone number.' }, { status: 400 });

  addToDncRegistry(body.phone, body.first_name || null, body.last_name || null, body.reason || 'Manually added', user.id);
  return NextResponse.json({ ok: true });
}
