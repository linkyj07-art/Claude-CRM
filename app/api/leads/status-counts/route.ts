import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';
import { promoteAgingLeads } from '@/lib/util';

export const dynamic = 'force-dynamic';

// Feeds DialCategoryButton -- pulled into its own endpoint (instead of the
// button requiring a server-computed prop, as it originally did) so the
// same picker can drop into any page (dashboard, Calls, Leads, ...) with a
// single import instead of every page that wants a Power Dial entry point
// having to duplicate this exact query itself.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  // Same "catch status up to real age before it's read" call every other
  // status-counting/queue-building read in the app already makes.
  promoteAgingLeads(db, user.id);

  // Optional vendor scope -- when the picker has a vendor selected, the
  // category counts shown should reflect just that vendor's leads instead
  // of every vendor's, so the agent isn't told "40 fresh" and then only
  // gets the dozen that are actually from the vendor they picked.
  const vendorId = req.nextUrl.searchParams.get('vendor');
  const vendorClause = vendorId ? 'AND lead_vendor_id = ?' : '';
  const args = vendorId ? [user.id, vendorId] : [user.id];

  const counts = db
    .prepare(`SELECT status, COUNT(*) n FROM customers WHERE archived = 0 AND owner_id = ? ${vendorClause} GROUP BY status`)
    .all(...args) as { status: string; n: number }[];
  const countMap = Object.fromEntries(counts.map((c) => [c.status, c.n]));

  // Only vendors this agent actually has leads from -- a full vendor
  // directory (lead_vendors can carry vendors another agent uses, or ones
  // added once and never bought from again) would just be dead options in
  // the picker otherwise.
  const vendors = db
    .prepare(
      `SELECT v.id, v.name FROM lead_vendors v
       WHERE EXISTS (SELECT 1 FROM customers c WHERE c.lead_vendor_id = v.id AND c.archived = 0 AND c.owner_id = ?)
       ORDER BY v.name`
    )
    .all(user.id) as { id: string; name: string }[];

  return NextResponse.json({
    fresh: countMap.fresh || 0,
    working: countMap.working || 0,
    aging_45_90: countMap.aging_45_90 || 0,
    aging_90_plus: countMap.aging_90_plus || 0,
    vendors
  });
}
