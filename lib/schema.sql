-- CRM Insurance schema
-- Core principle: ONE customer row = one permanent ID. Everything else
-- (calls, notes, quotes, appointments, applications, policies, commissions,
-- payments, referrals, audit history) references customers.id and is never
-- duplicated into a second "client" record when a lead sells.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lead_vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  dob TEXT,
  gender TEXT,
  marital_status TEXT,
  military INTEGER DEFAULT 0,
  military_branch TEXT,
  coverage_wanted REAL,
  address TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  timezone TEXT,
  ad_type TEXT,
  platform TEXT,
  lead_vendor_id TEXT REFERENCES lead_vendors(id),
  best_time TEXT,
  lead_cost REAL DEFAULT 0,
  trusted_form_url TEXT,
  status TEXT NOT NULL DEFAULT 'fresh',
    -- fresh | working | aging_45_90 | aging_90_plus | invalid | disputed | dnc | sold | lost | archived
  purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
  sold_at TEXT,
  archived INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- idx_customers_owner is created in db.ts's migrate(), not here: on a
-- pre-existing database (customers table already present without owner_id),
-- this CREATE INDEX would run as part of the initial schema.sql exec, before
-- the ALTER TABLE that actually adds the column ever gets a chance to run —
-- "no such column: owner_id", failing the entire schema exec and preventing
-- migrate() (and the fix) from running at all.
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_state ON customers(state);
CREATE INDEX IF NOT EXISTS idx_customers_vendor ON customers(lead_vendor_id);

-- Notes are append-only "versions" so the full history (original -> call 1
-- -> call 2 -> appointment -> sale) is always retrievable, never overwritten.
CREATE TABLE IF NOT EXISTS note_versions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Note',
  name TEXT,
  note_date TEXT,
  phone TEXT,
  beneficiary TEXT,
  beneficiary_dob TEXT,
  budget TEXT,
  health TEXT,
  discount TEXT,
  bank_name TEXT,
  bank_state TEXT,
  routing_number TEXT,
  account_number TEXT,
  mailing_address TEXT,
  email TEXT,
  born_in TEXT,
  ssn TEXT,
  plan_bronze_coverage TEXT,
  plan_bronze_price TEXT,
  plan_silver_coverage TEXT,
  plan_silver_price TEXT,
  plan_gold_coverage TEXT,
  plan_gold_price TEXT,
  draft_date TEXT,
  code_word TEXT,
  free_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT DEFAULT 'You'
);

CREATE INDEX IF NOT EXISTS idx_notes_customer ON note_versions(customer_id);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  direction TEXT NOT NULL DEFAULT 'outbound',
  attempt_number INTEGER NOT NULL DEFAULT 1,
  outcome TEXT NOT NULL,
    -- no_answer | voicemail | connected | busy | wrong_number | dnc
  disposition TEXT,
    -- interested | not_interested | callback | qualified | unqualified | sold
  duration_seconds INTEGER DEFAULT 0,
  notes TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calls_customer ON calls(customer_id);
CREATE INDEX IF NOT EXISTS idx_calls_occurred ON calls(occurred_at);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  carrier TEXT,
  product TEXT,
  face_amount REAL,
  monthly_premium REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL,
  type TEXT DEFAULT 'phone',
  status TEXT NOT NULL DEFAULT 'scheduled',
    -- scheduled | sat | no_show | cancelled
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_appt_customer ON appointments(customer_id);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  carrier TEXT,
  product TEXT,
  face_amount REAL,
  monthly_premium REAL,
  status TEXT NOT NULL DEFAULT 'submitted',
    -- submitted | pending | approved | declined | issued
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_apps_customer ON applications(customer_id);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  application_id TEXT REFERENCES applications(id),
  carrier TEXT NOT NULL,
  product TEXT,
  policy_type TEXT,
  face_amount REAL,
  monthly_premium REAL,
  annual_premium REAL,
  effective_date TEXT,
  policy_number TEXT,
  agent TEXT,
  status TEXT NOT NULL DEFAULT 'issued',
    -- pending | issued | active | lapsed | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_policies_customer ON policies(customer_id);

CREATE TABLE IF NOT EXISTS commissions (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  commission_pct REAL,
  expected_commission REAL,
  commission_type TEXT DEFAULT 'advance', -- advance | as_earned
  expected_pay_date TEXT,
  actual_pay_date TEXT,
  chargeback REAL DEFAULT 0,
  net_commission REAL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | charged_back
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comm_customer ON commissions(customer_id);
CREATE INDEX IF NOT EXISTS idx_comm_policy ON commissions(policy_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  policy_id TEXT REFERENCES policies(id),
  amount REAL NOT NULL,
  type TEXT DEFAULT 'renewal', -- initial | renewal | bonus
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  referrer_customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  referred_customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  referred_name TEXT,
  value REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_history (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  meta TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_customer ON audit_history(customer_id);

-- A vendor dispute (bad lead — disconnected number, wrong number, invalid
-- data, etc.) tracked from open through resolution, so it isn't just a
-- status flag on the lead with no record of where it stands with the vendor.
CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | submitted | resolved | denied
  credit_amount REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_disputes_customer ON disputes(customer_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);

CREATE TABLE IF NOT EXISTS carriers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  agent_portal_url TEXT,
  application_url TEXT,
  claims_url TEXT,
  support_phone TEXT,
  notes TEXT,
  sort_order INTEGER DEFAULT 0
);

-- User-editable health-keyword rules that drive the "which carrier should I
-- run this through first" suggestion on the lead's HEALTH note field.
CREATE TABLE IF NOT EXISTS carrier_underwriting_rules (
  id TEXT PRIMARY KEY,
  carrier_id TEXT NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  keywords TEXT NOT NULL,       -- comma-separated match terms, e.g. "diabetes, insulin, a1c"
  tier_note TEXT,               -- e.g. "Level Benefit / Graded - up to $15k"
  priority INTEGER DEFAULT 0,   -- higher = preferred when scores tie
  is_knockout INTEGER DEFAULT 0,-- 1 = flag as "avoid" instead of ranking it up
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rules_carrier ON carrier_underwriting_rules(carrier_id);

CREATE TABLE IF NOT EXISTS quick_links (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'general', -- quoter | resource | general
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- Sample routing-number reference set only (NOT the Federal Reserve's full
-- directory, which may not be redistributed commercially). Always shown
-- with a "verify before use" flag and a manual-override field alongside it.
CREATE TABLE IF NOT EXISTS routing_lookup (
  id TEXT PRIMARY KEY,
  bank_name TEXT NOT NULL,
  state TEXT NOT NULL,
  routing_number TEXT NOT NULL,
  institution_type TEXT DEFAULT 'bank', -- bank | credit_union
  source_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_routing_bank ON routing_lookup(bank_name);
CREATE INDEX IF NOT EXISTS idx_routing_state ON routing_lookup(state);

-- Small generic key/value store for app-wide settings (e.g. licensed_states)
-- that don't warrant their own table.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Leads caught by import-time duplicate detection (same name + phone + dob
-- as an existing customer) are held here for manual review instead of being
-- silently dropped or double-inserted into customers.
CREATE TABLE IF NOT EXISTS duplicate_leads (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  email TEXT,
  dob TEXT,
  state TEXT,
  raw_data TEXT NOT NULL, -- JSON snapshot of the imported row, for "add anyway"
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dupe_customer ON duplicate_leads(customer_id);

-- Fed by the /api/webhooks/incoming-call endpoint (Zapier/Make -> Quo's
-- "new incoming call" event), one row per call that matched an existing
-- lead by phone number. Only matched calls are recorded — an unknown number
-- has no customer_id to attach to, so there's nothing useful to pop up.
CREATE TABLE IF NOT EXISTS incoming_calls (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_incoming_calls_customer ON incoming_calls(customer_id);
CREATE INDEX IF NOT EXISTS idx_incoming_calls_created ON incoming_calls(created_at);

-- One row per user per day/week they've set goals for. Missing rows just
-- mean "never set a goal for that period" — there's no default target.
CREATE TABLE IF NOT EXISTS daily_goals (
  date TEXT NOT NULL, -- YYYY-MM-DD, agent's local (Mountain) day
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_dials INTEGER,
  target_appointments INTEGER,
  target_ap REAL, -- target annual premium written
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, user_id)
);

CREATE TABLE IF NOT EXISTS weekly_goals (
  week_start TEXT NOT NULL, -- YYYY-MM-DD of that week's Monday, Mountain time
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_dials INTEGER,
  target_appointments INTEGER,
  target_ap REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (week_start, user_id)
);

-- One live Power Dial session per user, so opening the dialer on a second
-- device (phone alongside laptop) follows the same queue instead of each
-- device building its own independent one. current_lead_id is whichever
-- lead the queue is presently on; other devices poll this row and jump to
-- match it when it changes.
CREATE TABLE IF NOT EXISTS dial_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_lead_id TEXT,
  queue TEXT NOT NULL DEFAULT '', -- comma-separated customer ids, in order
  recycle TEXT NOT NULL DEFAULT '', -- comma-separated ids held for a 2nd pass
  pass INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
