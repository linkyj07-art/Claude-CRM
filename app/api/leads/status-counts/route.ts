import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';
import { promoteAgingLeads } from '@/lib/util';

export const dynamic = 'force-dynamic';

// Feeds DialCategoryButton -- pulled into its own endpoint (instead of the
// button requiring a server-computed prop, as it originally did) so the
// same picker can drop into any page (dashboard, Calls, Leads, ...) with a
// single import instead of every page that wants a Power Dial entry point
// having to duplicate this exact query itself.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  // Same "catch status up to real age before it's read" call every other
  // status-counting/queue-building read in the app already makes.
  promoteAgingLeads(db, user.id);

  const counts = db.prepare(`SELECT status, COUNT(*) n FROM customers WHERE archived = 0 AND owner_id = ? GROUP BY status`).all(user.id) as { status: string; n: number }[];
  const countMap = Object.fromEntries(counts.map((c) => [c.status, c.n]));

  return NextResponse.json({
    fresh: countMap.fresh || 0,
    working: countMap.working || 0,
    aging_45_90: countMap.aging_45_90 || 0,
    aging_90_plus: countMap.aging_90_plus || 0
  });
}
