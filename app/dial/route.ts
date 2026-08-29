import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';
import { isWithinCallingHours } from '@/lib/util';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const allRows = db
    .prepare(
      `SELECT id, status, state FROM customers
       WHERE archived = 0 AND owner_id = ? AND status IN ('fresh','working','aging_45_90','aging_90_plus')
       ORDER BY CASE status WHEN 'fresh' THEN 0 WHEN 'working' THEN 1 WHEN 'aging_45_90' THEN 2 ELSE 3 END, purchased_at ASC`
    )
    .all(user.id) as { id: string; status: string; state: string | null }[];

  // Leads whose local time is outside the 8am-9pm calling window get held
  // back rather than queued dead-on-arrival — they'll be picked up again on
  // a later Power Dial run once their state's window opens.
  const rows = allRows.filter((r) => isWithinCallingHours(r.state));

  // Behind a reverse proxy (Railway, etc.), req.url's origin can resolve to an
  // internal address like localhost instead of the public domain, which would
  // send the browser to a Location header it can never actually reach. Build
  // the redirect target from the forwarded headers the proxy sets instead.
  const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host;
  const origin = `${proto}://${host}`;

  if (rows.length === 0) {
    const reason = allRows.length > 0 ? '&closed=1' : '';
    return NextResponse.redirect(new URL(`/leads?empty=1${reason}`, origin));
  }
  const [first, ...rest] = rows;
  const queue = rest.map((r) => r.id).join(',');
  const dest = new URL(`/leads/${first.id}`, origin);
  if (queue) dest.searchParams.set('queue', queue);
  dest.searchParams.set('dialing', '1');
  return NextResponse.redirect(dest);
}
