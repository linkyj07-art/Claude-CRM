import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';
import { isWithinCallingHours, minutesUntilCallingWindowCloses, MAX_CALLS_PER_DAY } from '@/lib/util';

// A lead whose state is closing for the day within this many minutes jumps
// to the front of the queue — otherwise it's easy to work through fresher
// leads all morning and never circle back before that window shuts, even
// though the lead has only been dialed once or twice.
const CLOSING_SOON_MINUTES = 90;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();

  // Behind a reverse proxy (Railway, etc.), req.url's origin can resolve to an
  // internal address like localhost instead of the public domain, which would
  // send the browser to a Location header it can never actually reach. Build
  // the redirect target from the forwarded headers the proxy sets instead.
  const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host;
  const origin = `${proto}://${host}`;

  // A second device tapping Power Dial while a session is already in
  // progress (started from a laptop, say) joins that same session instead
  // of building a competing one — as long as the lead it's parked on is
  // still actually a real, owned lead.
  const existing = db.prepare('SELECT current_lead_id FROM dial_sessions WHERE user_id = ?').get(user.id) as
    | { current_lead_id: string | null }
    | undefined;
  if (existing?.current_lead_id) {
    const stillOwned = db.prepare('SELECT id FROM customers WHERE id = ? AND owner_id = ?').get(existing.current_lead_id, user.id);
    if (stillOwned) {
      return NextResponse.redirect(new URL(`/leads/${existing.current_lead_id}?dialing=1`, origin));
    }
    db.prepare('DELETE FROM dial_sessions WHERE user_id = ?').run(user.id);
  }

  const allRows = db
    .prepare(
      `SELECT id, status, state FROM customers
       WHERE archived = 0 AND owner_id = ? AND status IN ('fresh','working','aging_45_90','aging_90_plus')
         AND phone IS NOT NULL AND TRIM(phone) != ''
         AND id NOT IN (
           SELECT customer_id FROM calls WHERE date(occurred_at) = date('now')
           GROUP BY customer_id HAVING COUNT(*) >= ${MAX_CALLS_PER_DAY}
         )
       ORDER BY CASE status WHEN 'fresh' THEN 0 WHEN 'working' THEN 1 WHEN 'aging_45_90' THEN 2 ELSE 3 END, purchased_at ASC`
    )
    .all(user.id) as { id: string; status: string; state: string | null }[];

  // Leads whose local time is outside the 8am-9pm calling window get held
  // back rather than queued dead-on-arrival — they'll be picked up again on
  // a later Power Dial run once their state's window opens.
  const callable = allRows.filter((r) => isWithinCallingHours(r.state));

  // Within the callable set, leads whose window closes soon jump ahead of
  // the normal status-based order (stable sort keeps everyone else exactly
  // where they were) — otherwise a lead an hour from closing could sit
  // behind a hundred "fresh" leads and never get reached in time.
  const rows = callable
    .map((r) => ({ ...r, minutesLeft: minutesUntilCallingWindowCloses(r.state) }))
    .sort((a, b) => {
      const aUrgent = a.minutesLeft <= CLOSING_SOON_MINUTES;
      const bUrgent = b.minutesLeft <= CLOSING_SOON_MINUTES;
      if (aUrgent && bUrgent) return a.minutesLeft - b.minutesLeft;
      if (aUrgent) return -1;
      if (bUrgent) return 1;
      return 0;
    });

  if (rows.length === 0) {
    const reason = allRows.length > 0 ? '&closed=1' : '';
    return NextResponse.redirect(new URL(`/leads?empty=1${reason}`, origin));
  }
  const [first, ...rest] = rows;
  db.prepare(
    `INSERT INTO dial_sessions (user_id, current_lead_id, queue, recycle, pass, updated_at)
     VALUES (?, ?, ?, '', 1, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       current_lead_id = excluded.current_lead_id, queue = excluded.queue,
       recycle = '', pass = 1, updated_at = excluded.updated_at`
  ).run(user.id, first.id, rest.map((r) => r.id).join(','));

  return NextResponse.redirect(new URL(`/leads/${first.id}?dialing=1`, origin));
}
