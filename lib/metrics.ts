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

export function getActivityStats(db: Database.Database, period: Period, ownerId: string): ActivityStats {
  const since = periodStartISO(period);
  const args = since ? [ownerId, since] : [ownerId];
  const dateOp = since ? 'AND' : '';
  const dateColClause = (alias: string, col: string) => (since ? `${dateOp} ${alias}.${col} >= ?` : '');

  const calls = (
    db.prepare(`SELECT COUNT(*) n FROM calls ca JOIN customers c ON c.id = ca.customer_id WHERE c.owner_id = ? ${dateColClause('ca', 'occurred_at')}`).get(...args) as { n: number }
  ).n;
  const conversations = (
    db.prepare(`SELECT COUNT(*) n FROM calls ca JOIN customers c ON c.id = ca.customer_id WHERE c.owner_id = ? ${dateColClause('ca', 'occurred_at')} AND ca.outcome = 'connected'`).get(...args) as { n: number }
  ).n;
  const contactsRow = db
    .prepare(`SELECT COUNT(DISTINCT ca.customer_id) n FROM calls ca JOIN customers c ON c.id = ca.customer_id WHERE c.owner_id = ? ${dateColClause('ca', 'occurred_at')} AND ca.outcome = 'connected'`)
    .get(...args) as { n: number };

  const appointments = (
    db.prepare(`SELECT COUNT(*) n FROM appointments a JOIN customers c ON c.id = a.customer_id WHERE c.owner_id = ? ${dateColClause('a', 'created_at')}`).get(...args) as { n: number }
  ).n;
  const applications = (
    db.prepare(`SELECT COUNT(*) n FROM applications ap JOIN customers c ON c.id = ap.customer_id WHERE c.owner_id = ? ${dateColClause('ap', 'submitted_at')}`).get(...args) as { n: number }
  ).n;
  const issued = (
    db.prepare(`SELECT COUNT(*) n FROM policies p JOIN customers c ON c.id = p.customer_id WHERE c.owner_id = ? ${dateColClause('p', 'created_at')}`).get(...args) as { n: number }
  ).n;
  const leads = (
    db.prepare(`SELECT COUNT(*) n FROM customers c WHERE c.owner_id = ? ${dateColClause('c', 'purchased_at')}`).get(...args) as { n: number }
  ).n;
  const leadSpend = (
    db.prepare(`SELECT COALESCE(SUM(c.lead_cost),0) s FROM customers c WHERE c.owner_id = ? ${dateColClause('c', 'purchased_at')}`).get(...args) as { s: number }
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

export function getLeadEconomics(db: Database.Database, activity: ActivityStats, period: Period, ownerId: string): LeadEconomics {
  const since = periodStartISO(period);
  const netCommission = since
    ? (db.prepare(`SELECT COALESCE(SUM(cm.net_commission),0) s FROM commissions cm JOIN customers c ON c.id = cm.customer_id WHERE c.owner_id = ? AND cm.created_at >= ?`).get(ownerId, since) as { s: number }).s
    : (db.prepare(`SELECT COALESCE(SUM(cm.net_commission),0) s FROM commissions cm JOIN customers c ON c.id = cm.customer_id WHERE c.owner_id = ?`).get(ownerId) as { s: number }).s;
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
