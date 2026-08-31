import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';
import { redirect } from 'next/navigation';
import { isWithinCallingHours, minutesUntilCallingWindowCloses, MAX_CALLS_PER_DAY, isTestLead, agentMidnightUTC } from '@/lib/util';

export const dynamic = 'force-dynamic';

// Temporary diagnostic view -- shows exactly what /dial's queue-build query
// sees and how it would order things right now, so a reported "queue keeps
// giving me leads I've already dialed" can be checked against real numbers
// instead of guessed at. Not linked from anywhere in the nav; visit directly.
export default async function DialDebugPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = getDb();
  const todayStart = agentMidnightUTC(0).toISOString().slice(0, 19).replace('T', ' ');

  const allRows = db
    .prepare(
      `SELECT id, status, state, first_name, last_name, purchased_at,
         (SELECT COUNT(*) FROM calls WHERE customer_id = customers.id AND occurred_at >= @todayStart) AS calls_today,
         (SELECT COUNT(*) FROM calls WHERE customer_id = customers.id) AS calls_ever
       FROM customers
       WHERE archived = 0 AND owner_id = @ownerId
         AND (
           status IN ('fresh','working','aging_45_90','aging_90_plus')
           OR (status = 'lost' AND retry_after IS NOT NULL AND retry_after <= datetime('now'))
         )
         AND phone IS NOT NULL AND TRIM(phone) != ''
         AND id NOT IN (
           SELECT customer_id FROM calls WHERE occurred_at >= @todayStart
           GROUP BY customer_id HAVING COUNT(*) >= ${MAX_CALLS_PER_DAY}
         )
       ORDER BY CASE status WHEN 'fresh' THEN 0 WHEN 'working' THEN 1 WHEN 'aging_45_90' THEN 2 ELSE 3 END,
         calls_ever > 0,
         calls_today > 0,
         CASE WHEN status = 'fresh' THEN -CAST(strftime('%s', purchased_at) AS INTEGER) ELSE CAST(strftime('%s', purchased_at) AS INTEGER) END`
    )
    .all({ ownerId: user.id, todayStart }) as {
      id: string; status: string; state: string | null; first_name: string; last_name: string;
      purchased_at: string; calls_today: number; calls_ever: number;
    }[];

  const callable = allRows.filter((r) => isTestLead(r) || isWithinCallingHours(r.state));
  const CLOSING_SOON_MINUTES = 60;
  const rows = callable
    .map((r) => ({ ...r, minutesLeft: isTestLead(r) ? Infinity : minutesUntilCallingWindowCloses(r.state) }))
    .sort((a, b) => {
      const aTest = isTestLead(a);
      const bTest = isTestLead(b);
      if (aTest !== bTest) return aTest ? -1 : 1;
      const aUrgent = a.minutesLeft <= CLOSING_SOON_MINUTES;
      const bUrgent = b.minutesLeft <= CLOSING_SOON_MINUTES;
      if (aUrgent && bUrgent) return a.minutesLeft - b.minutesLeft;
      if (aUrgent) return -1;
      if (bUrgent) return 1;
      return 0;
    });

  const neverCalled = allRows.filter((r) => r.calls_ever === 0);
  const outOfHours = allRows.filter((r) => !isTestLead(r) && !isWithinCallingHours(r.state));
  const urgent = rows.filter((r) => !isTestLead(r) && r.minutesLeft <= CLOSING_SOON_MINUTES);

  return (
    <div style={{ fontFamily: 'monospace', fontSize: 13, padding: 20, maxWidth: 1100 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700 }}>Dial Queue Debug — {user.username}</h1>
      <p>Run at: {new Date().toISOString()}</p>

      <h2 style={{ marginTop: 20, fontWeight: 700 }}>Summary</h2>
      <ul>
        <li>Total eligible leads (right status, phone, under daily cap): <b>{allRows.length}</b></li>
        <li>Of those, never called at all (calls_ever = 0): <b>{neverCalled.length}</b></li>
        <li>Of those, currently OUTSIDE calling hours (held back): <b>{outOfHours.length}</b></li>
        <li>Callable right now (in hours or test lead): <b>{callable.length}</b></li>
        <li>Currently flagged &quot;closing soon&quot; (jumps the queue, ≤{CLOSING_SOON_MINUTES} min left): <b>{urgent.length}</b></li>
      </ul>

      <h2 style={{ marginTop: 20, fontWeight: 700 }}>First 40 in queue-build order (what a fresh Power Dial session would use)</h2>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
            <th>#</th><th>Name</th><th>Status</th><th>State</th><th>Purchased</th>
            <th>Calls Today</th><th>Calls Ever</th><th>Min Left</th><th>Urgent?</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 40).map((r, i) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #ddd', background: r.calls_ever > 0 ? '#fff3cd' : undefined }}>
              <td>{i + 1}</td>
              <td>{r.first_name} {r.last_name}</td>
              <td>{r.status}</td>
              <td>{r.state}</td>
              <td>{r.purchased_at}</td>
              <td>{r.calls_today}</td>
              <td>{r.calls_ever}</td>
              <td>{r.minutesLeft === Infinity ? '∞' : Math.round(r.minutesLeft)}</td>
              <td>{r.minutesLeft <= CLOSING_SOON_MINUTES ? 'YES' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 10, color: '#666' }}>Rows highlighted yellow have calls_ever &gt; 0 (already called before today or today).</p>
    </div>
  );
}
