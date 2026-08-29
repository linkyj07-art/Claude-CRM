import Database from 'better-sqlite3';
import { agentDateStr, agentWeekStart } from './util';

export type Period = 'today' | 'week' | 'month' | 'all';

export interface GoalProgress {
  dials: number;
  appointments: number;
  ap: number;
}

// calls/policies.created_at are UTC timestamps; appointments.scheduled_at is a
// naive local-wall-clock string typed straight from a datetime-local input.
// Both need to be bucketed by the agent's own calendar day/week, not a naive
// UTC or string-range comparison, or activity near midnight lands on the
// wrong side of the boundary.
export function getGoalProgress(db: Database.Database, kind: 'daily' | 'weekly', key: string, ownerId: string): GoalProgress {
  const matchesPeriod = (dateStr: string) => (kind === 'daily' ? agentDateStr(new Date(dateStr)) === key : agentWeekStart(new Date(dateStr)) === key);
  const windowDays = kind === 'daily' ? 2 : 9;

  const calls = db
    .prepare(
      `SELECT ca.occurred_at FROM calls ca JOIN customers c ON c.id = ca.customer_id
       WHERE c.owner_id = ? AND ca.occurred_at >= datetime(?, '-2 days') AND ca.occurred_at <= datetime(?, ?)`
    )
    .all(ownerId, key, key, `+${windowDays} days`) as { occurred_at: string }[];
  const dials = calls.filter((c) => matchesPeriod(c.occurred_at.replace(' ', 'T') + 'Z')).length;

  let appointments: number;
  if (kind === 'daily') {
    appointments = (
      db.prepare(`SELECT COUNT(*) n FROM appointments a JOIN customers c ON c.id = a.customer_id WHERE c.owner_id = ? AND a.scheduled_at LIKE ?`).get(ownerId, `${key}%`) as { n: number }
    ).n;
  } else {
    const weekEnd = new Date(new Date(key + 'T00:00:00Z').getTime() + 7 * 86400000).toISOString().slice(0, 10);
    appointments = (
      db.prepare(`SELECT COUNT(*) n FROM appointments a JOIN customers c ON c.id = a.customer_id WHERE c.owner_id = ? AND a.scheduled_at >= ? AND a.scheduled_at < ?`).get(ownerId, key, weekEnd) as { n: number }
    ).n;
  }

  const policies = db
    .prepare(
      `SELECT p.annual_premium, p.created_at FROM policies p JOIN customers c ON c.id = p.customer_id
       WHERE c.owner_id = ? AND p.created_at >= datetime(?, '-2 days') AND p.created_at <= datetime(?, ?)`
    )
    .all(ownerId, key, key, `+${windowDays} days`) as { annual_premium: number | null; created_at: string }[];
  const ap = policies
    .filter((p) => matchesPeriod(p.created_at.replace(' ', 'T') + 'Z'))
    .reduce((sum, p) => sum + (p.annual_premium || 0), 0);

  return { dials, appointments, ap };
}

export function periodStartISO(period: Period): string | null {
  const now = new Date();
  if (period === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 19).replace('T', ' ');
  }
  if (period === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }
  if (period === 'month') {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }
  return null;
}

export interface MoneyTiles {
  today: number;
  week: number;
  month: number;
  pending: number;
  chargebacks: number;
  net: number;
}

export function getMoneyTiles(db: Database.Database, ownerId: string): MoneyTiles {
  const sumSince = (since: string | null) => {
    const row = since
      ? db.prepare(`SELECT COALESCE(SUM(cm.net_commission),0) s FROM commissions cm JOIN customers c ON c.id = cm.customer_id WHERE c.owner_id = ? AND cm.created_at >= ?`).get(ownerId, since)
      : db.prepare(`SELECT COALESCE(SUM(cm.net_commission),0) s FROM commissions cm JOIN customers c ON c.id = cm.customer_id WHERE c.owner_id = ?`).get(ownerId);
    return (row as { s: number }).s;
  };
  const pending = (
    db.prepare(`SELECT COALESCE(SUM(cm.expected_commission - cm.chargeback),0) s FROM commissions cm JOIN customers c ON c.id = cm.customer_id WHERE c.owner_id = ? AND cm.status = 'pending'`).get(ownerId) as { s: number }
  ).s;
  const chargebacks = (
    db.prepare(`SELECT COALESCE(SUM(cm.chargeback),0) s FROM commissions cm JOIN customers c ON c.id = cm.customer_id WHERE c.owner_id = ? AND cm.created_at >= ?`).get(ownerId, periodStartISO('month')) as { s: number }
  ).s;
  const month = sumSince(periodStartISO('month'));
  return {
    today: sumSince(periodStartISO('today')),
    week: sumSince(periodStartISO('week')),
    month,
    pending,
    chargebacks,
    net: month
  };
}

export interface ActivityStats {
  calls: number;
  contacts: number;
  conversations: number;
  appointments: number;
  applications: number;
  issued: number;
  leads: number;
  leadSpend: number;
}

export function getActivityStats(db: Database.Database, period: Period, ownerId: string, vendorId?: string): ActivityStats {
  const since = periodStartISO(period);
  const vendorClause = vendorId ? 'AND c.lead_vendor_id = ?' : '';
  const args = [ownerId, ...(vendorId ? [vendorId] : []), ...(since ? [since] : [])];
  const dateColClause = (alias: string, col: string) => (since ? `AND ${alias}.${col} >= ?` : '');

  const calls = (
    db.prepare(`SELECT COUNT(*) n FROM calls ca JOIN customers c ON c.id = ca.customer_id WHERE c.owner_id = ? ${vendorClause} ${dateColClause('ca', 'occurred_at')}`).get(...args) as { n: number }
  ).n;
  const conversations = (
    db.prepare(`SELECT COUNT(*) n FROM calls ca JOIN customers c ON c.id = ca.customer_id WHERE c.owner_id = ? ${vendorClause} ${dateColClause('ca', 'occurred_at')} AND ca.outcome = 'connected'`).get(...args) as { n: number }
  ).n;
  const contactsRow = db
    .prepare(`SELECT COUNT(DISTINCT ca.customer_id) n FROM calls ca JOIN customers c ON c.id = ca.customer_id WHERE c.owner_id = ? ${vendorClause} ${dateColClause('ca', 'occurred_at')} AND ca.outcome = 'connected'`)
    .get(...args) as { n: number };

  const appointments = (
    db.prepare(`SELECT COUNT(*) n FROM appointments a JOIN customers c ON c.id = a.customer_id WHERE c.owner_id = ? ${vendorClause} ${dateColClause('a', 'created_at')}`).get(...args) as { n: number }
  ).n;
  const applications = (
    db.prepare(`SELECT COUNT(*) n FROM applications ap JOIN customers c ON c.id = ap.customer_id WHERE c.owner_id = ? ${vendorClause} ${dateColClause('ap', 'submitted_at')}`).get(...args) as { n: number }
  ).n;
  const issued = (
    db.prepare(`SELECT COUNT(*) n FROM policies p JOIN customers c ON c.id = p.customer_id WHERE c.owner_id = ? ${vendorClause} ${dateColClause('p', 'created_at')}`).get(...args) as { n: number }
  ).n;
  const leads = (
    db.prepare(`SELECT COUNT(*) n FROM customers c WHERE c.owner_id = ? ${vendorClause} ${dateColClause('c', 'purchased_at')}`).get(...args) as { n: number }
  ).n;
  const leadSpend = (
    db.prepare(`SELECT COALESCE(SUM(c.lead_cost),0) s FROM customers c WHERE c.owner_id = ? ${vendorClause} ${dateColClause('c', 'purchased_at')}`).get(...args) as { s: number }
  ).s;

  return { calls, contacts: contactsRow.n, conversations, appointments, applications, issued, leads, leadSpend };
}

export interface ConversionRates {
  contactRate: number | null;
  appointmentRate: number | null;
  applicationRate: number | null;
  issueRate: number | null;
}

export function getConversionRates(a: ActivityStats): ConversionRates {
  const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : null);
  return {
    contactRate: pct(a.contacts, a.calls),
    appointmentRate: pct(a.appointments, a.contacts),
    applicationRate: pct(a.applications, a.appointments),
    issueRate: pct(a.issued, a.applications)
  };
}

export interface LeadEconomics {
  leadSpend: number;
  costPerLead: number | null;
  costPerIssued: number | null;
  netCommission: number;
  roi: number | null;
}

export function getLeadEconomics(db: Database.Database, activity: ActivityStats, period: Period, ownerId: string, vendorId?: string): LeadEconomics {
  const since = periodStartISO(period);
  const vendorClause = vendorId ? 'AND c.lead_vendor_id = ?' : '';
  const args = [ownerId, ...(vendorId ? [vendorId] : []), ...(since ? [since] : [])];
  const netCommission = (
    db.prepare(`SELECT COALESCE(SUM(cm.net_commission),0) s FROM commissions cm JOIN customers c ON c.id = cm.customer_id WHERE c.owner_id = ? ${vendorClause} ${since ? 'AND cm.created_at >= ?' : ''}`).get(...args) as { s: number }
  ).s;
  const { leadSpend, leads, issued } = activity;
  return {
    leadSpend,
    costPerLead: leads > 0 ? leadSpend / leads : null,
    costPerIssued: issued > 0 ? leadSpend / issued : null,
    netCommission,
    roi: leadSpend > 0 ? ((netCommission - leadSpend) / leadSpend) * 100 : null
  };
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

export function getFunnel(db: Database.Database, ownerId: string): FunnelStage[] {
  const leads = (db.prepare(`SELECT COUNT(*) n FROM customers c WHERE c.owner_id = ?`).get(ownerId) as { n: number }).n;
  const calls = (db.prepare(`SELECT COUNT(*) n FROM calls ca JOIN customers c ON c.id = ca.customer_id WHERE c.owner_id = ?`).get(ownerId) as { n: number }).n;
  const contacts = (
    db.prepare(`SELECT COUNT(DISTINCT ca.customer_id) n FROM calls ca JOIN customers c ON c.id = ca.customer_id WHERE c.owner_id = ? AND ca.outcome = 'connected'`).get(ownerId) as { n: number }
  ).n;
  const qualified = (
    db.prepare(`SELECT COUNT(DISTINCT ca.customer_id) n FROM calls ca JOIN customers c ON c.id = ca.customer_id WHERE c.owner_id = ? AND ca.disposition IN ('qualified','interested')`).get(ownerId) as { n: number }
  ).n;
  const appointments = (db.prepare(`SELECT COUNT(*) n FROM appointments a JOIN customers c ON c.id = a.customer_id WHERE c.owner_id = ?`).get(ownerId) as { n: number }).n;
  const sat = (db.prepare(`SELECT COUNT(*) n FROM appointments a JOIN customers c ON c.id = a.customer_id WHERE c.owner_id = ? AND a.status = 'sat'`).get(ownerId) as { n: number }).n;
  const applications = (db.prepare(`SELECT COUNT(*) n FROM applications ap JOIN customers c ON c.id = ap.customer_id WHERE c.owner_id = ?`).get(ownerId) as { n: number }).n;
  const approved = (db.prepare(`SELECT COUNT(*) n FROM applications ap JOIN customers c ON c.id = ap.customer_id WHERE c.owner_id = ? AND ap.status IN ('approved','issued')`).get(ownerId) as { n: number }).n;
  const issued = (db.prepare(`SELECT COUNT(*) n FROM policies p JOIN customers c ON c.id = p.customer_id WHERE c.owner_id = ?`).get(ownerId) as { n: number }).n;

  return [
    { key: 'leads', label: 'Leads', count: leads },
    { key: 'calls', label: 'Calls', count: calls },
    { key: 'contacts', label: 'Contacts', count: contacts },
    { key: 'qualified', label: 'Qualified', count: qualified },
    { key: 'appointments', label: 'Appointments', count: appointments },
    { key: 'sat', label: 'Appointments Sat', count: sat },
    { key: 'applications', label: 'Applications', count: applications },
    { key: 'approved', label: 'Approved', count: approved },
    { key: 'issued', label: 'Issued', count: issued }
  ];
}

export interface VendorRoi {
  vendor: string;
  spend: number;
  leads: number;
  issued: number;
  commission: number;
  roi: number | null;
}

export function getRoiByVendor(db: Database.Database, ownerId: string): VendorRoi[] {
  const rows = db
    .prepare(
      `SELECT COALESCE(v.name, 'Unassigned') as vendor,
              COUNT(c.id) as leads,
              COALESCE(SUM(c.lead_cost),0) as spend
       FROM customers c
       LEFT JOIN lead_vendors v ON v.id = c.lead_vendor_id
       WHERE c.owner_id = ?
       GROUP BY vendor`
    )
    .all(ownerId) as { vendor: string; leads: number; spend: number }[];

  const issuedRows = db
    .prepare(
      `SELECT COALESCE(v.name, 'Unassigned') as vendor, COUNT(p.id) as issued, COALESCE(SUM(cm.net_commission),0) as commission
       FROM policies p
       JOIN customers c ON c.id = p.customer_id
       LEFT JOIN lead_vendors v ON v.id = c.lead_vendor_id
       LEFT JOIN commissions cm ON cm.policy_id = p.id
       WHERE c.owner_id = ?
       GROUP BY vendor`
    )
    .all(ownerId) as { vendor: string; issued: number; commission: number }[];
  const issuedMap = Object.fromEntries(issuedRows.map((r) => [r.vendor, r]));

  return rows.map((r) => {
    const iss = issuedMap[r.vendor] || { issued: 0, commission: 0 };
    return {
      vendor: r.vendor,
      spend: r.spend,
      leads: r.leads,
      issued: iss.issued,
      commission: iss.commission,
      roi: r.spend > 0 ? ((iss.commission - r.spend) / r.spend) * 100 : null
    };
  }).sort((a, b) => b.spend - a.spend);
}

export interface AgeBucketRoi {
  bucket: string;
  leads: number;
  spend: number;
  issued: number;
  commission: number;
  roi: number | null;
}

export function getRoiByAge(db: Database.Database, ownerId: string): AgeBucketRoi[] {
  const customers = db.prepare(`SELECT id, lead_cost, purchased_at FROM customers WHERE owner_id = ?`).all(ownerId) as { id: string; lead_cost: number; purchased_at: string }[];
  const policies = db
    .prepare(`SELECT p.customer_id, p.id FROM policies p JOIN customers c ON c.id = p.customer_id WHERE c.owner_id = ?`)
    .all(ownerId) as { customer_id: string; id: string }[];
  const commissions = db
    .prepare(`SELECT cm.policy_id, cm.net_commission FROM commissions cm JOIN customers c ON c.id = cm.customer_id WHERE c.owner_id = ?`)
    .all(ownerId) as { policy_id: string; net_commission: number }[];
  const commByPolicy = Object.fromEntries(commissions.map((c) => [c.policy_id, c.net_commission]));
  const policyByCustomer: Record<string, string[]> = {};
  for (const p of policies) {
    (policyByCustomer[p.customer_id] ||= []).push(p.id);
  }

  const buckets: Record<string, AgeBucketRoi> = {
    fresh: { bucket: 'Fresh (0-2 days)', leads: 0, spend: 0, issued: 0, commission: 0, roi: null },
    aging_45_90: { bucket: '45-90 Days', leads: 0, spend: 0, issued: 0, commission: 0, roi: null },
    aging_90_plus: { bucket: '90+ Days', leads: 0, spend: 0, issued: 0, commission: 0, roi: null }
  };

  const now = Date.now();
  for (const c of customers) {
    const days = Math.floor((now - new Date(c.purchased_at.replace(' ', 'T') + 'Z').getTime()) / 86400000);
    const key = days <= 2 ? 'fresh' : days <= 90 ? 'aging_45_90' : 'aging_90_plus';
    buckets[key].leads += 1;
    buckets[key].spend += c.lead_cost || 0;
    const pols = policyByCustomer[c.id] || [];
    buckets[key].issued += pols.length;
    for (const pid of pols) buckets[key].commission += commByPolicy[pid] || 0;
  }
  for (const b of Object.values(buckets)) {
    b.roi = b.spend > 0 ? ((b.commission - b.spend) / b.spend) * 100 : null;
  }
  return Object.values(buckets);
}

export interface StateRoi {
  state: string;
  leads: number;
  issued: number;
  closeRate: number | null;
  spend: number;
  commission: number;
  roi: number | null;
}

export function getRoiByState(db: Database.Database, ownerId: string): StateRoi[] {
  const rows = db
    .prepare(
      `SELECT c.state as state, COUNT(DISTINCT c.id) as leads, COALESCE(SUM(c.lead_cost),0) as spend
       FROM customers c WHERE c.owner_id = ? GROUP BY c.state`
    )
    .all(ownerId) as { state: string; leads: number; spend: number }[];
  const issuedRows = db
    .prepare(
      `SELECT c.state as state, COUNT(p.id) as issued, COALESCE(SUM(cm.net_commission),0) as commission
       FROM policies p JOIN customers c ON c.id = p.customer_id
       LEFT JOIN commissions cm ON cm.policy_id = p.id
       WHERE c.owner_id = ?
       GROUP BY c.state`
    )
    .all(ownerId) as { state: string; issued: number; commission: number }[];
  const issuedMap = Object.fromEntries(issuedRows.map((r) => [r.state, r]));
  return rows
    .map((r) => {
      const iss = issuedMap[r.state] || { issued: 0, commission: 0 };
      return {
        state: r.state || 'Unknown',
        leads: r.leads,
        issued: iss.issued,
        closeRate: r.leads > 0 ? (iss.issued / r.leads) * 100 : null,
        spend: r.spend,
        commission: iss.commission,
        roi: r.spend > 0 ? ((iss.commission - r.spend) / r.spend) * 100 : null
      };
    })
    .sort((a, b) => b.leads - a.leads);
}

export interface SourceRoi {
  key: string;
  platform: string;
  adType: string;
  vendor: string;
  leads: number;
  spend: number;
  issued: number;
  commission: number;
  roi: number | null;
}

export function getRoiBySource(db: Database.Database, ownerId: string): SourceRoi[] {
  const rows = db
    .prepare(
      `SELECT c.platform as platform, c.ad_type as adType, COALESCE(v.name,'Unassigned') as vendor,
              COUNT(DISTINCT c.id) as leads, COALESCE(SUM(c.lead_cost),0) as spend
       FROM customers c LEFT JOIN lead_vendors v ON v.id = c.lead_vendor_id
       WHERE c.owner_id = ?
       GROUP BY c.platform, c.ad_type, vendor`
    )
    .all(ownerId) as { platform: string; adType: string; vendor: string; leads: number; spend: number }[];
  const issuedRows = db
    .prepare(
      `SELECT c.platform as platform, c.ad_type as adType, COALESCE(v.name,'Unassigned') as vendor,
              COUNT(p.id) as issued, COALESCE(SUM(cm.net_commission),0) as commission
       FROM policies p JOIN customers c ON c.id = p.customer_id
       LEFT JOIN lead_vendors v ON v.id = c.lead_vendor_id
       LEFT JOIN commissions cm ON cm.policy_id = p.id
       WHERE c.owner_id = ?
       GROUP BY c.platform, c.ad_type, vendor`
    )
    .all(ownerId) as { platform: string; adType: string; vendor: string; issued: number; commission: number }[];
  const keyOf = (p: string, a: string, v: string) => `${p}||${a}||${v}`;
  const issuedMap = Object.fromEntries(issuedRows.map((r) => [keyOf(r.platform, r.adType, r.vendor), r]));

  return rows
    .map((r) => {
      const k = keyOf(r.platform, r.adType, r.vendor);
      const iss = issuedMap[k] || { issued: 0, commission: 0 };
      return {
        key: k,
        platform: r.platform || 'Unknown',
        adType: r.adType || 'Unknown',
        vendor: r.vendor,
        leads: r.leads,
        spend: r.spend,
        issued: iss.issued,
        commission: iss.commission,
        roi: r.spend > 0 ? ((iss.commission - r.spend) / r.spend) * 100 : null
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

export interface ClientLtv {
  customerId: string;
  name: string;
  initialCommission: number;
  renewals: number;
  additionalPolicies: number;
  referralValue: number;
  ltv: number;
}

export function getTopLifetimeValue(db: Database.Database, ownerId: string, limit = 10): ClientLtv[] {
  const customers = db
    .prepare(`SELECT id, first_name, last_name FROM customers WHERE status = 'sold' AND owner_id = ?`)
    .all(ownerId) as { id: string; first_name: string; last_name: string }[];

  const results: ClientLtv[] = customers.map((c) => {
    const policies = db.prepare(`SELECT id FROM policies WHERE customer_id = ?`).all(c.id) as { id: string }[];
    const commissions = db
      .prepare(`SELECT net_commission, created_at FROM commissions WHERE customer_id = ? ORDER BY created_at ASC`)
      .all(c.id) as { net_commission: number; created_at: string }[];
    const initialCommission = commissions[0]?.net_commission || 0;
    const renewalPayments = db
      .prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE customer_id = ? AND type = 'renewal'`)
      .get(c.id) as { s: number };
    const referralValue = db
      .prepare(`SELECT COALESCE(SUM(value),0) s FROM referrals WHERE referrer_customer_id = ?`)
      .get(c.id) as { s: number };
    const additionalPolicies = Math.max(0, policies.length - 1);
    const totalCommission = commissions.reduce((s, c2) => s + (c2.net_commission || 0), 0);
    const ltv = totalCommission + renewalPayments.s + referralValue.s;
    return {
      customerId: c.id,
      name: `${c.first_name} ${c.last_name}`,
      initialCommission,
      renewals: renewalPayments.s,
      additionalPolicies,
      referralValue: referralValue.s,
      ltv
    };
  });

  return results.sort((a, b) => b.ltv - a.ltv).slice(0, limit);
}

export interface TrendPoint {
  label: string;
  value: number;
}

// Day-by-day series for the last `days` calendar days (agent-local), always
// including days with zero activity so a chart doesn't silently skip gaps.
export function getDailyTrend(db: Database.Database, ownerId: string, days = 30): { commission: TrendPoint[]; dials: TrendPoint[] } {
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  const sinceStr = agentDateStr(since);

  const commissionRows = db
    .prepare(
      `SELECT cm.created_at, cm.net_commission FROM commissions cm
       JOIN customers c ON c.id = cm.customer_id
       WHERE c.owner_id = ? AND cm.created_at >= datetime(?, '-1 days')`
    )
    .all(ownerId, sinceStr) as { created_at: string; net_commission: number | null }[];
  const callRows = db
    .prepare(
      `SELECT ca.occurred_at FROM calls ca
       JOIN customers c ON c.id = ca.customer_id
       WHERE c.owner_id = ? AND ca.occurred_at >= datetime(?, '-1 days')`
    )
    .all(ownerId, sinceStr) as { occurred_at: string }[];

  const commissionByDay = new Map<string, number>();
  for (const r of commissionRows) {
    const day = agentDateStr(new Date(r.created_at.replace(' ', 'T') + 'Z'));
    commissionByDay.set(day, (commissionByDay.get(day) || 0) + (r.net_commission || 0));
  }
  const dialsByDay = new Map<string, number>();
  for (const r of callRows) {
    const day = agentDateStr(new Date(r.occurred_at.replace(' ', 'T') + 'Z'));
    dialsByDay.set(day, (dialsByDay.get(day) || 0) + 1);
  }

  const commission: TrendPoint[] = [];
  const dials: TrendPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const key = agentDateStr(d);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    commission.push({ label, value: commissionByDay.get(key) || 0 });
    dials.push({ label, value: dialsByDay.get(key) || 0 });
  }
  return { commission, dials };
}

export interface StatusSlice {
  status: string;
  label: string;
  count: number;
}

const STATUS_LABELS: Record<string, string> = {
  fresh: 'Fresh', working: 'Working', aging_45_90: '45-90 Day', aging_90_plus: '90+ Day',
  invalid: 'Invalid', disputed: 'Disputed', dnc: 'DNC', sold: 'Sold', lost: 'Lost', archived: 'Archived'
};

export function getStatusBreakdown(db: Database.Database, ownerId: string): StatusSlice[] {
  const rows = db
    .prepare(`SELECT status, COUNT(*) n FROM customers WHERE owner_id = ? AND archived = 0 GROUP BY status`)
    .all(ownerId) as { status: string; n: number }[];
  return rows
    .map((r) => ({ status: r.status, label: STATUS_LABELS[r.status] || r.status, count: r.n }))
    .sort((a, b) => b.count - a.count);
}

export interface OutcomeSlice {
  outcome: string;
  label: string;
  count: number;
}

const OUTCOME_LABELS: Record<string, string> = {
  no_answer: 'No Answer', voicemail: 'Voicemail', busy: 'Busy', wrong_number: 'Wrong #',
  connected: 'Connected', dnc: 'DNC', pending: 'In Progress'
};

// What's actually happening when the agent dials, all-time — pending rows
// (a call started but not yet dispositioned) are excluded since they're not
// a real outcome yet.
export function getCallOutcomeBreakdown(db: Database.Database, ownerId: string): OutcomeSlice[] {
  const rows = db
    .prepare(
      `SELECT ca.outcome, COUNT(*) n FROM calls ca JOIN customers c ON c.id = ca.customer_id
       WHERE c.owner_id = ? AND ca.outcome != 'pending' GROUP BY ca.outcome`
    )
    .all(ownerId) as { outcome: string; n: number }[];
  return rows
    .map((r) => ({ outcome: r.outcome, label: OUTCOME_LABELS[r.outcome] || r.outcome, count: r.n }))
    .sort((a, b) => b.count - a.count);
}

export interface MoneyComparison {
  todayChangePct: number | null;
  weekChangePct: number | null;
  monthChangePct: number | null;
}

function sumCommissionBetween(db: Database.Database, ownerId: string, sinceISO: string, untilISO: string): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(cm.net_commission),0) s FROM commissions cm JOIN customers c ON c.id = cm.customer_id WHERE c.owner_id = ? AND cm.created_at >= ? AND cm.created_at < ?`)
    .get(ownerId, sinceISO, untilISO) as { s: number };
  return row.s;
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr > 0 ? 100 : null;
  return ((curr - prev) / prev) * 100;
}

// "This Month"/"This Week" on the dashboard are rolling 30/7-day windows
// (see periodStartISO), not calendar boundaries, so the fair prior-period
// comparison is the equal-length window immediately before each one.
export function getMoneyComparison(db: Database.Database, ownerId: string): MoneyComparison {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  const daysAgo = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return d; };
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const todayVal = sumCommissionBetween(db, ownerId, iso(todayStart), iso(now));
  const yesterdayVal = sumCommissionBetween(db, ownerId, iso(yesterdayStart), iso(todayStart));
  const weekVal = sumCommissionBetween(db, ownerId, iso(daysAgo(7)), iso(now));
  const prevWeekVal = sumCommissionBetween(db, ownerId, iso(daysAgo(14)), iso(daysAgo(7)));
  const monthVal = sumCommissionBetween(db, ownerId, iso(daysAgo(30)), iso(now));
  const prevMonthVal = sumCommissionBetween(db, ownerId, iso(daysAgo(60)), iso(daysAgo(30)));

  return {
    todayChangePct: pctChange(todayVal, yesterdayVal),
    weekChangePct: pctChange(weekVal, prevWeekVal),
    monthChangePct: pctChange(monthVal, prevMonthVal)
  };
}

export interface ActivityItem {
  id: string;
  customerId: string;
  customerName: string;
  eventType: string;
  summary: string;
  occurredAt: string;
}

export function getRecentActivity(db: Database.Database, ownerId: string, limit = 8): ActivityItem[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.customer_id, c.first_name, c.last_name, a.event_type, a.summary, a.occurred_at
       FROM audit_history a JOIN customers c ON c.id = a.customer_id
       WHERE c.owner_id = ?
       ORDER BY a.occurred_at DESC LIMIT ?`
    )
    .all(ownerId, limit) as { id: string; customer_id: string; first_name: string; last_name: string; event_type: string; summary: string; occurred_at: string }[];
  return rows.map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    customerName: `${r.first_name} ${r.last_name}`,
    eventType: r.event_type,
    summary: r.summary,
    occurredAt: r.occurred_at
  }));
}
