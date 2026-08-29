/* Seed script: wipes and repopulates data/crm.sqlite3 with realistic demo
 * data so every dashboard/report in the CRM has something to show.
 * Run with: npm run seed
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'crm.sqlite3');
const SCHEMA_PATH = path.join(__dirname, '..', 'lib', 'schema.sql');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
for (const ext of ['-wal', '-shm']) {
  const p = DB_PATH + ext;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(SCHEMA_PATH, 'utf-8'));

const id = () => crypto.randomUUID();

// ---- deterministic RNG so re-seeding gives stable demo numbers ----
let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}
function randInt(min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function daysAgoISO(days, hourJitter = true) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  if (hourJitter) d.setUTCHours(randInt(0, 23), randInt(0, 59), 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// ---------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------
const vendors = [
  { id: id(), name: 'Vendor A - Final Expense Direct', notes: 'Facebook & Google FEX leads' },
  { id: id(), name: 'Vendor B - Senior Leads Co', notes: 'Aged + live transfer leads' },
  { id: id(), name: 'Vendor C - TikTok Ads Pro', notes: 'Social media FEX leads' }
];
const insVendor = db.prepare(
  'INSERT INTO lead_vendors (id, name, notes) VALUES (@id, @name, @notes)'
);
vendors.forEach((v) => insVendor.run(v));

const carriers = [
  { name: 'Mutual of Omaha', agent_portal_url: 'https://www.mutualofomaha.com/agent-login', application_url: 'https://eapp.mutualofomaha.com', claims_url: 'https://www.mutualofomaha.com/claims', support_phone: '(800) 693-6083' },
  { name: 'Americo', agent_portal_url: 'https://www.americo.com/agents', application_url: 'https://eapp.americo.com', claims_url: 'https://www.americo.com/claims', support_phone: '(800) 231-0801' },
  { name: 'American Amicable', agent_portal_url: 'https://www.amamgrp.com/agent-login', application_url: 'https://eapp.amamgrp.com', claims_url: 'https://www.amamgrp.com/claims', support_phone: '(800) 736-7311' },
  { name: 'Foresters Financial', agent_portal_url: 'https://www.foresters.com/agent', application_url: 'https://eapp.foresters.com', claims_url: 'https://www.foresters.com/claims', support_phone: '(800) 828-1540' },
  { name: 'Transamerica', agent_portal_url: 'https://www.transamerica.com/agent-login', application_url: 'https://eapp.transamerica.com', claims_url: 'https://www.transamerica.com/claims', support_phone: '(800) 797-2643' },
  { name: 'Corebridge Financial', agent_portal_url: 'https://www.corebridgefinancial.com/agent', application_url: 'https://eapp.corebridgefinancial.com', claims_url: 'https://www.corebridgefinancial.com/claims', support_phone: '(800) 677-8494' },
  { name: 'National Life Group', agent_portal_url: 'https://www.nationallife.com/agent-login', application_url: 'https://eapp.nationallife.com', claims_url: 'https://www.nationallife.com/claims', support_phone: '(800) 906-3310' }
];
const insCarrier = db.prepare(
  `INSERT INTO carriers (id, name, agent_portal_url, application_url, claims_url, support_phone, notes, sort_order)
   VALUES (@id, @name, @agent_portal_url, @application_url, @claims_url, @support_phone, @notes, @sort_order)`
);
carriers.forEach((c, i) =>
  insCarrier.run({ id: id(), notes: null, sort_order: i, ...c })
);

// Starter/example underwriting keyword rules — NOT real carrier field guides.
// The whole point of this table is that the user replaces/extends these
// from the Manage Carriers screen with their own carrier list and rules.
const carrierByName = Object.fromEntries(
  db.prepare('SELECT id, name FROM carriers').all().map((c) => [c.name, c.id])
);
const insRule = db.prepare(
  `INSERT INTO carrier_underwriting_rules (id, carrier_id, keywords, tier_note, priority, is_knockout)
   VALUES (@id, @carrier_id, @keywords, @tier_note, @priority, @is_knockout)`
);
const starterRules = [
  { carrier: 'Mutual of Omaha', keywords: 'non-smoker, no major conditions, controlled diabetes, high blood pressure', tier_note: 'Level Benefit — strong first look for clean/controlled health', priority: 5, is_knockout: 0 },
  { carrier: 'Americo', keywords: 'copd, oxygen, smoker, high cholesterol', tier_note: 'Graded/Modified — good fallback for respiratory or tobacco use', priority: 2, is_knockout: 0 },
  { carrier: 'American Amicable', keywords: 'heart attack, stroke, afib, bypass, stent', tier_note: 'Immediate/Graded options for cardiac history', priority: 3, is_knockout: 0 },
  { carrier: 'Foresters Financial', keywords: 'cancer, remission, chemotherapy', tier_note: 'Case-by-case on cancer history — check time-since-treatment', priority: 1, is_knockout: 0 },
  { carrier: 'Transamerica', keywords: 'controlled diabetes, insulin, a1c', tier_note: 'Competitive on managed diabetes', priority: 3, is_knockout: 0 },
  { carrier: 'National Life Group', keywords: 'kidney dialysis, nursing home, hospice, terminal', tier_note: 'Typically decline/GI only — verify before quoting level', priority: 0, is_knockout: 1 },
  { carrier: 'Corebridge Financial', keywords: 'dementia, alzheimer', tier_note: 'Guaranteed issue only — do not run as level/graded', priority: 0, is_knockout: 1 }
];
starterRules.forEach((r) => {
  const carrierId = carrierByName[r.carrier];
  if (!carrierId) return;
  insRule.run({ id: id(), carrier_id: carrierId, keywords: r.keywords, tier_note: r.tier_note, priority: r.priority, is_knockout: r.is_knockout });
});

const quickLinks = [
  { category: 'quoter', label: 'FEX Lite Quoter (Insurance Toolkits)', url: 'https://insurancetoolkits.com/fex-quoter', sort_order: 0 },
  { category: 'resource', label: 'FFL Agent Resources', url: 'https://www.familyfirstlife.com/agent-resources', sort_order: 0 },
  { category: 'resource', label: 'NIPR License Lookup', url: 'https://nipr.com/licensing-center/look-up-your-license', sort_order: 1 }
];
const insLink = db.prepare(
  'INSERT INTO quick_links (id, category, label, url, sort_order) VALUES (@id, @category, @label, @url, @sort_order)'
);
quickLinks.forEach((l) => insLink.run({ id: id(), ...l }));

// Small SAMPLE routing-number reference set (publicly published by the
// institutions themselves) — intentionally NOT a copy of the Federal
// Reserve's full directory. Always paired with "verify" + manual override
// in the UI.
const routingSample = [
  { bank_name: 'U.S. Bank', state: 'ID', routing_number: '123103729', institution_type: 'bank' },
  { bank_name: 'U.S. Bank', state: 'CO', routing_number: '102000021', institution_type: 'bank' },
  { bank_name: 'U.S. Bank', state: 'CA', routing_number: '122235821', institution_type: 'bank' },
  { bank_name: 'Wells Fargo', state: 'ID', routing_number: '124103799', institution_type: 'bank' },
  { bank_name: 'Wells Fargo', state: 'TX', routing_number: '111900659', institution_type: 'bank' },
  { bank_name: 'Wells Fargo', state: 'CA', routing_number: '121042882', institution_type: 'bank' },
  { bank_name: 'Bank of America', state: 'TX', routing_number: '111000025', institution_type: 'bank' },
  { bank_name: 'Bank of America', state: 'FL', routing_number: '063100277', institution_type: 'bank' },
  { bank_name: 'Bank of America', state: 'CA', routing_number: '121000358', institution_type: 'bank' },
  { bank_name: 'Chase Bank', state: 'TX', routing_number: '111000614', institution_type: 'bank' },
  { bank_name: 'Chase Bank', state: 'FL', routing_number: '267084131', institution_type: 'bank' },
  { bank_name: 'Chase Bank', state: 'CO', routing_number: '102001017', institution_type: 'bank' },
  { bank_name: 'Navy Federal Credit Union', state: 'VA', routing_number: '256074974', institution_type: 'credit_union' },
  { bank_name: 'Idaho Central Credit Union', state: 'ID', routing_number: '324377516', institution_type: 'credit_union' },
  { bank_name: 'Regions Bank', state: 'FL', routing_number: '063104668', institution_type: 'bank' },
  { bank_name: 'PNC Bank', state: 'TX', routing_number: '043000096', institution_type: 'bank' },
  { bank_name: 'TD Bank', state: 'FL', routing_number: '067014822', institution_type: 'bank' },
  { bank_name: 'Truist Bank', state: 'FL', routing_number: '061000104', institution_type: 'bank' }
];
const insRouting = db.prepare(
  `INSERT INTO routing_lookup (id, bank_name, state, routing_number, institution_type, source_note)
   VALUES (@id, @bank_name, @state, @routing_number, @institution_type, @source_note)`
);
routingSample.forEach((r) =>
  insRouting.run({
    id: id(),
    source_note: 'Sample reference only — confirm with the client\'s check or online banking before drafting.',
    ...r
  })
);

// ---------------------------------------------------------------------
// Demo leads / customers
// ---------------------------------------------------------------------
const firstNames = ['John', 'Mary', 'Robert', 'Linda', 'James', 'Patricia', 'Michael', 'Barbara', 'William', 'Susan', 'David', 'Jessica', 'Charles', 'Karen', 'Joseph', 'Nancy', 'Thomas', 'Betty', 'Richard', 'Sandra', 'Donald', 'Ruth', 'George', 'Sharon', 'Kenneth', 'Carol', 'Larry', 'Deborah', 'Paul', 'Dorothy'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson'];
const states = ['CO', 'TX', 'FL', 'ID', 'OH', 'GA', 'NC', 'TN', 'AZ', 'MO'];
const adTypes = ['Final Expense'];
const platforms = ['Facebook', 'Google', 'TikTok', 'Direct Mail'];
const bestTimes = ['Morning', 'Afternoon', 'Evening'];
const dispositions = ['interested', 'interested', 'qualified', 'qualified', 'callback', 'not_interested', 'unqualified'];
const products = ['Whole Life - Final Expense', 'Guaranteed Issue Whole Life', 'Simplified Issue Whole Life'];

const insCustomer = db.prepare(`
  INSERT INTO customers (id, first_name, last_name, phone, email, dob, gender, marital_status,
    military, military_branch, coverage_wanted, address, city, state, postal_code, timezone,
    ad_type, platform, lead_vendor_id, best_time, lead_cost, status, purchased_at, sold_at,
    created_at, updated_at)
  VALUES (@id, @first_name, @last_name, @phone, @email, @dob, @gender, @marital_status,
    @military, @military_branch, @coverage_wanted, @address, @city, @state, @postal_code, @timezone,
    @ad_type, @platform, @lead_vendor_id, @best_time, @lead_cost, @status, @purchased_at, @sold_at,
    @purchased_at, @purchased_at)
`);
const insNote = db.prepare(`
  INSERT INTO note_versions (id, customer_id, label, name, note_date, phone, beneficiary, budget,
    health, discount, bank_name, bank_state, routing_number, account_number, mailing_address, email,
    born_in, ssn, plan_bronze, plan_silver, plan_gold, draft_date, code_word, free_text, created_at, created_by)
  VALUES (@id, @customer_id, @label, @name, @note_date, @phone, @beneficiary, @budget,
    @health, @discount, @bank_name, @bank_state, @routing_number, @account_number, @mailing_address, @email,
    @born_in, @ssn, @plan_bronze, @plan_silver, @plan_gold, @draft_date, @code_word, @free_text, @created_at, @created_by)
`);
const insCall = db.prepare(`
  INSERT INTO calls (id, customer_id, direction, attempt_number, outcome, disposition, duration_seconds, notes, occurred_at)
  VALUES (@id, @customer_id, @direction, @attempt_number, @outcome, @disposition, @duration_seconds, @notes, @occurred_at)
`);
const insQuote = db.prepare(`
  INSERT INTO quotes (id, customer_id, carrier, product, face_amount, monthly_premium, notes, created_at)
  VALUES (@id, @customer_id, @carrier, @product, @face_amount, @monthly_premium, @notes, @created_at)
`);
const insAppt = db.prepare(`
  INSERT INTO appointments (id, customer_id, scheduled_at, type, status, notes, created_at)
  VALUES (@id, @customer_id, @scheduled_at, @type, @status, @notes, @created_at)
`);
const insApp = db.prepare(`
  INSERT INTO applications (id, customer_id, carrier, product, face_amount, monthly_premium, status, submitted_at, decided_at, notes)
  VALUES (@id, @customer_id, @carrier, @product, @face_amount, @monthly_premium, @status, @submitted_at, @decided_at, @notes)
`);
const insPolicy = db.prepare(`
  INSERT INTO policies (id, customer_id, application_id, carrier, product, policy_type, face_amount,
    monthly_premium, annual_premium, effective_date, policy_number, agent, status, created_at)
  VALUES (@id, @customer_id, @application_id, @carrier, @product, @policy_type, @face_amount,
    @monthly_premium, @annual_premium, @effective_date, @policy_number, @agent, @status, @created_at)
`);
const insComm = db.prepare(`
  INSERT INTO commissions (id, policy_id, customer_id, commission_pct, expected_commission, commission_type,
    expected_pay_date, actual_pay_date, chargeback, net_commission, status, created_at)
  VALUES (@id, @policy_id, @customer_id, @commission_pct, @expected_commission, @commission_type,
    @expected_pay_date, @actual_pay_date, @chargeback, @net_commission, @status, @created_at)
`);
const insPayment = db.prepare(`
  INSERT INTO payments (id, customer_id, policy_id, amount, type, paid_at, notes)
  VALUES (@id, @customer_id, @policy_id, @amount, @type, @paid_at, @notes)
`);
const insAudit = db.prepare(`
  INSERT INTO audit_history (id, customer_id, event_type, summary, meta, occurred_at)
  VALUES (@id, @customer_id, @event_type, @summary, @meta, @occurred_at)
`);

const STATE_TZ = {
  CO: 'America/Denver', TX: 'America/Chicago', FL: 'America/New_York', ID: 'America/Boise',
  OH: 'America/New_York', GA: 'America/New_York', NC: 'America/New_York', TN: 'America/Chicago',
  AZ: 'America/Phoenix', MO: 'America/Chicago'
};

function audit(customerId, type, summary, occurredAt, meta) {
  insAudit.run({ id: id(), customer_id: customerId, event_type: type, summary, meta: meta ? JSON.stringify(meta) : null, occurred_at: occurredAt });
}

const TOTAL_LEADS = 140;
const customers = [];

for (let i = 0; i < TOTAL_LEADS; i++) {
  const first = pick(firstNames);
  const last = pick(lastNames);
  const state = pick(states);
  const vendor = pick(vendors);
  const platform = pick(platforms);
  const ageDays = pick([0, 0, 1, 1, 2, 5, 10, 20, 30, 45, 60, 75, 100, 120, 150]);
  const purchasedAt = daysAgoISO(ageDays);
  const leadCost = Math.round((randInt(1200, 2400) / 100) * 100) / 100; // $12-$24
  const coverage = pick([5000, 8000, 10000, 12000, 15000, 20000, 25000]);
  const cust = {
    id: id(),
    first_name: first,
    last_name: last,
    phone: `(${randInt(200, 989)}) ${randInt(200, 989)}-${String(randInt(0, 9999)).padStart(4, '0')}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${randInt(1, 99)}@example.com`,
    dob: `19${randInt(35, 65)}-${String(randInt(1, 12)).padStart(2, '0')}-${String(randInt(1, 28)).padStart(2, '0')}`,
    gender: pick(['M', 'F']),
    marital_status: pick(['Single', 'Married', 'Widowed', 'Divorced']),
    military: rand() < 0.22 ? 1 : 0,
    military_branch: null,
    coverage_wanted: coverage,
    address: `${randInt(100, 9999)} ${pick(['Main St', 'Oak Ave', 'Pine Rd', 'Maple Dr', 'Cedar Ln'])}`,
    city: pick(['Springfield', 'Franklin', 'Greenville', 'Fairview', 'Clinton', 'Salem']),
    state,
    postal_code: String(randInt(10000, 99999)),
    timezone: STATE_TZ[state] || 'America/New_York',
    ad_type: pick(adTypes),
    platform,
    lead_vendor_id: vendor.id,
    best_time: pick(bestTimes),
    lead_cost: leadCost,
    status: 'fresh', // finalized below
    purchased_at: purchasedAt,
    sold_at: null
  };
  if (cust.military) cust.military_branch = pick(['Army', 'Navy', 'Air Force', 'Marines', 'Coast Guard']);
  customers.push(cust);
}

// Assign funnel outcomes: everyone gets 1-4 calls; a subset qualifies,
// a subset of those gets an appointment, a subset of those applies,
// a subset of those is issued as a policy.
let soldCount = 0;
customers.forEach((cust, idx) => {
  insCustomer.run(cust);
  const numCalls = randInt(1, 4);
  let reachedContact = false;
  let qualified = false;
  for (let a = 1; a <= numCalls; a++) {
    const occurredAt = daysAgoISO(Math.max(0, Math.floor((idx % 10) / 3)), true);
    const roll = rand();
    let outcome, disposition = null;
    if (a < numCalls) {
      outcome = pick(['no_answer', 'voicemail', 'no_answer', 'busy']);
    } else {
      if (roll < 0.24) {
        outcome = 'no_answer';
      } else if (roll < 0.32) {
        outcome = 'voicemail';
      } else if (roll < 0.37) {
        outcome = 'wrong_number';
      } else {
        outcome = 'connected';
        reachedContact = true;
        disposition = pick(dispositions);
        if (disposition === 'qualified') qualified = true;
        else if (disposition === 'interested') qualified = rand() < 0.8;
      }
    }
    insCall.run({
      id: id(), customer_id: cust.id, direction: 'outbound', attempt_number: a,
      outcome, disposition, duration_seconds: outcome === 'connected' ? randInt(90, 900) : 0,
      notes: outcome === 'connected' ? 'Spoke with lead about coverage needs.' : null,
      occurred_at: occurredAt
    });
    audit(cust.id, 'call', `Call attempt #${a} — ${outcome.replace('_', ' ')}`, occurredAt);
  }

  // starting note (always present, template pre-filled from lead)
  insNote.run({
    id: id(), customer_id: cust.id, label: 'Original Lead Note',
    name: `${cust.first_name} ${cust.last_name}`, note_date: cust.purchased_at.slice(0, 10),
    phone: cust.phone, beneficiary: null, budget: null, health: null, discount: null,
    bank_name: null, bank_state: null, routing_number: null, account_number: null,
    mailing_address: `${cust.address}, ${cust.city}, ${cust.state} ${cust.postal_code}`,
    email: cust.email, born_in: null, ssn: null, plan_bronze: null, plan_silver: null, plan_gold: null,
    draft_date: null, code_word: null, free_text: `Lead purchased from ${vendors.find(v => v.id === cust.lead_vendor_id).name}. Wants $${cust.coverage_wanted.toLocaleString()} coverage.`,
    created_at: cust.purchased_at, created_by: 'System'
  });
  audit(cust.id, 'lead_purchased', `Lead purchased — ${cust.ad_type} / ${cust.platform}`, cust.purchased_at);

  let status = 'working';
  const ageBucketDays = Math.floor((Date.now() - new Date(cust.purchased_at + 'Z').getTime()) / 86400000);

  if (!reachedContact) {
    status = ageBucketDays > 90 ? 'aging_90_plus' : ageBucketDays > 2 ? 'aging_45_90' : 'fresh';
    if (rand() < 0.06) status = 'invalid';
    if (rand() < 0.03) status = 'dnc';
  } else if (!qualified) {
    status = 'lost';
  } else {
    // qualified -> quote -> appointment -> maybe application -> maybe issued
    const quoteAt = daysAgoISO(Math.max(0, ageBucketDays - 1));
    insQuote.run({
      id: id(), customer_id: cust.id, carrier: pick(carriers).name, product: pick(products),
      face_amount: cust.coverage_wanted, monthly_premium: Math.round((cust.coverage_wanted / 1000) * randInt(4, 8) * 100) / 100,
      notes: 'Ran FEX quote during call.', created_at: quoteAt
    });
    audit(cust.id, 'quote', 'Quote run', quoteAt);
    status = 'working';

    if (rand() < 0.82) {
      const apptAt = daysAgoISO(Math.max(0, ageBucketDays - 2));
      const apptStatus = rand() < 0.82 ? 'sat' : rand() < 0.5 ? 'no_show' : 'scheduled';
      insAppt.run({ id: id(), customer_id: cust.id, scheduled_at: apptAt, type: 'phone', status: apptStatus, notes: null, created_at: apptAt });
      audit(cust.id, 'appointment', `Appointment ${apptStatus.replace('_', ' ')}`, apptAt);

      if (apptStatus === 'sat' && rand() < 0.72) {
        const carrier = pick(carriers);
        const monthlyPremium = Math.round((cust.coverage_wanted / 1000) * randInt(5, 9) * 100) / 100;
        const submittedAt = daysAgoISO(Math.max(0, ageBucketDays - 3));
        const appStatus = rand() < 0.82 ? 'approved' : rand() < 0.6 ? 'declined' : 'pending';
        const decidedAt = appStatus !== 'pending' ? daysAgoISO(Math.max(0, ageBucketDays - 5)) : null;
        const applicationId = id();
        insApp.run({
          id: applicationId, customer_id: cust.id, carrier: carrier.name, product: pick(products),
          face_amount: cust.coverage_wanted, monthly_premium: monthlyPremium, status: appStatus,
          submitted_at: submittedAt, decided_at: decidedAt, notes: null
        });
        audit(cust.id, 'application', `Application submitted — ${carrier.name}`, submittedAt);

        if (appStatus === 'approved') {
          const issuedAt = daysAgoISO(Math.max(0, ageBucketDays - 6));
          const annualPremium = Math.round(monthlyPremium * 12 * 100) / 100;
          const policyId = id();
          insPolicy.run({
            id: policyId, customer_id: cust.id, application_id: applicationId, carrier: carrier.name,
            product: pick(products), policy_type: 'Whole Life', face_amount: cust.coverage_wanted,
            monthly_premium: monthlyPremium, annual_premium: annualPremium, effective_date: issuedAt.slice(0, 10),
            policy_number: `POL-${randInt(100000, 999999)}`, agent: 'You', status: 'active', created_at: issuedAt
          });
          audit(cust.id, 'policy_issued', `Policy issued — ${carrier.name} ($${annualPremium.toFixed(0)}/yr)`, issuedAt);

          const commissionPct = randInt(85, 110); // FEX advance comp is often >100% of annual premium
          const expectedCommission = Math.round(annualPremium * (commissionPct / 100) * 100) / 100;
          const chargeback = rand() < 0.1 ? Math.round(expectedCommission * 0.2 * 100) / 100 : 0;
          const netCommission = Math.round((expectedCommission - chargeback) * 100) / 100;
          const commType = rand() < 0.8 ? 'advance' : 'as_earned';
          const payStatus = rand() < 0.85 ? 'paid' : 'pending';
          const payDate = payStatus === 'paid' ? daysAgoISO(Math.max(0, ageBucketDays - 8)) : null;
          insComm.run({
            id: id(), policy_id: policyId, customer_id: cust.id, commission_pct: commissionPct,
            expected_commission: expectedCommission, commission_type: commType,
            expected_pay_date: daysAgoISO(Math.max(0, ageBucketDays - 7)).slice(0, 10),
            actual_pay_date: payDate ? payDate.slice(0, 10) : null, chargeback,
            net_commission: netCommission, status: chargeback > 0 ? 'charged_back' : payStatus, created_at: issuedAt
          });
          audit(cust.id, 'commission', `Commission ${payStatus} — $${netCommission.toFixed(0)} net`, issuedAt);

          if (payStatus === 'paid') {
            insPayment.run({ id: id(), customer_id: cust.id, policy_id: policyId, amount: netCommission, type: 'initial', paid_at: payDate, notes: 'Initial commission payment' });
          }

          status = 'sold';
          cust.sold_at = issuedAt;
          soldCount++;

          // sale note snapshot with financials filled in (some sample masked data)
          insNote.run({
            id: id(), customer_id: cust.id, label: 'Sale Note', name: `${cust.first_name} ${cust.last_name}`,
            note_date: issuedAt.slice(0, 10), phone: cust.phone, beneficiary: pick(['Spouse', 'Adult Child', 'Estate']),
            budget: `$${monthlyPremium.toFixed(0)}/mo`, health: pick(['Good - no major conditions disclosed', 'Fair - takes daily medication', 'Good - non-smoker']),
            discount: rand() < 0.6 ? 'Non-Smoker' : null,
            bank_name: pick(['U.S. Bank', 'Wells Fargo', 'Chase Bank', 'Bank of America', 'Regions Bank']),
            bank_state: cust.state, routing_number: (() => { const m = routingSample.filter(r => r.state === cust.state); return m.length ? pick(m).routing_number : null; })(),
            account_number: `${randInt(100000000, 999999999)}`, mailing_address: `${cust.address}, ${cust.city}, ${cust.state} ${cust.postal_code}`,
            email: cust.email, born_in: pick(['Texas', 'Ohio', 'Georgia', 'Colorado', 'Florida']),
            ssn: `${randInt(100, 899)}-${randInt(10, 99)}-${randInt(1000, 9999)}`,
            plan_bronze: null, plan_silver: `$${monthlyPremium.toFixed(0)}/mo`, plan_gold: null,
            draft_date: String(randInt(1, 28)), code_word: pick(['Sunshine', 'Blue Sky', 'River', 'Maple', 'Compass']),
            free_text: `Sold ${carrier.name} policy. Draft date the ${randInt(1, 28)}th of each month.`,
            created_at: issuedAt, created_by: 'You'
          });
        } else if (appStatus === 'declined') {
          status = 'lost';
        }
      } else if (apptStatus === 'no_show') {
        status = 'lost';
      }
    }
  }

  db.prepare('UPDATE customers SET status = ?, sold_at = ?, updated_at = ? WHERE id = ?')
    .run(status, cust.sold_at, new Date().toISOString().slice(0, 19).replace('T', ' '), cust.id);
});

console.log(`Seeded ${TOTAL_LEADS} leads (${soldCount} sold), ${vendors.length} vendors, ${carriers.length} carriers, ${routingSample.length} routing entries.`);
db.close();
