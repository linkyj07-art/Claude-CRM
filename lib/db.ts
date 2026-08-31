import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { newId } from './util';
import { hashPassword } from './auth';

const ROUTING_SEED_PATH = path.join(process.cwd(), 'seed', 'routing_numbers.csv');

// DATA_DIR can be pointed at a mounted persistent volume in production
// (e.g. Railway/Fly.io) via the DATA_DIR env var. Defaults to ./data for
// local development, where it's gitignored.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'crm.sqlite3');
const SCHEMA_PATH = path.join(process.cwd(), 'lib', 'schema.sql');

declare global {
  // eslint-disable-next-line no-var
  var __crmDb: Database.Database | undefined;
  // eslint-disable-next-line no-var
  var __crmDbShutdownRegistered: boolean | undefined;
}

function tableColumns(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

// Next.js's build spawns several worker processes that each open their own
// connection to the same on-disk database and run this migration concurrently,
// so a plain "check then ALTER" can race: two workers both see the column
// missing and both try to add it, and the loser gets "duplicate column name".
// Swallowing that specific error makes the add idempotent across processes.
function addColumnIfMissing(db: Database.Database, table: string, column: string, ddl: string) {
  if (tableColumns(db, table).includes(column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`);
  } catch (err) {
    if (!(err instanceof Error) || !/duplicate column name/i.test(err.message)) throw err;
  }
}

// schema.sql only uses CREATE TABLE/INDEX IF NOT EXISTS, so it never alters a
// table that already exists on a live database. Column additions to existing
// tables have to be migrated by hand here, guarded by checking the table's
// current columns first since SQLite has no "ADD COLUMN IF NOT EXISTS".
function migrate(db: Database.Database) {
  const noteColumns = tableColumns(db, 'note_versions');
  if (noteColumns.includes('plan_bronze') && !noteColumns.includes('plan_bronze_coverage')) {
    for (const col of ['plan_bronze_coverage', 'plan_bronze_price', 'plan_silver_coverage', 'plan_silver_price', 'plan_gold_coverage', 'plan_gold_price']) {
      addColumnIfMissing(db, 'note_versions', col, 'TEXT');
    }
    // Best-effort carry-over: the old fields were free text like "$50/mo",
    // which reads naturally as the price half of the new pair.
    db.exec(`
      UPDATE note_versions SET plan_bronze_price = plan_bronze WHERE plan_bronze IS NOT NULL AND plan_bronze_price IS NULL;
      UPDATE note_versions SET plan_silver_price = plan_silver WHERE plan_silver IS NOT NULL AND plan_silver_price IS NULL;
      UPDATE note_versions SET plan_gold_price = plan_gold WHERE plan_gold IS NOT NULL AND plan_gold_price IS NULL;
    `);
  }

  addColumnIfMissing(db, 'customers', 'trusted_form_url', 'TEXT');
  addColumnIfMissing(db, 'note_versions', 'beneficiary_dob', 'TEXT');
  addColumnIfMissing(db, 'customers', 'owner_id', 'TEXT REFERENCES users(id)');
  addColumnIfMissing(db, 'customers', 'last_followed_up_at', 'TEXT');
  addColumnIfMissing(db, 'note_versions', 'selected_plan', 'TEXT'); // bronze | silver | gold
  addColumnIfMissing(db, 'dial_sessions', 'auto_dial', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'dial_sessions', 'auto_dial_pace_ms', 'INTEGER NOT NULL DEFAULT 2000');
  addColumnIfMissing(db, 'dial_sessions', 'session_dials', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'dial_sessions', 'session_connects', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'dial_sessions', 'consecutive_no_answer', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'users', 'role', "TEXT NOT NULL DEFAULT 'agent'");
  addColumnIfMissing(db, 'users', 'helper_connected', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'users', 'helper_last_seen', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner_id);');

  const defaultUserId = seedDefaultUser(db);
  db.prepare('UPDATE customers SET owner_id = ? WHERE owner_id IS NULL').run(defaultUserId);
  migrateGoalsTables(db, defaultUserId);
  ensureAdminRole(db);

  seedStarterUnderwriting(db);
  ensureRecoveryAccount(db);
  seedRoutingNumbers(db);
}

// User-supplied bank routing-number directory (FDIC bank name matched
// against the Federal Reserve's FedACH routing directory, by state) — a real
// sourced dataset the user provided, not fabricated. Rows the source
// couldn't confidently match ("NOT FOUND") are skipped; everything else is
// shown in the app as a suggestion to confirm with the client, never
// auto-filled blindly, same "verify before use" posture as the rest of
// routing_lookup. Guarded by the same one-time atomic claim pattern used
// elsewhere in this file so re-deploys don't re-import or duplicate rows.
function seedRoutingNumbers(db: Database.Database) {
  if (!fs.existsSync(ROUTING_SEED_PATH)) return;

  const claimed = db.prepare(`INSERT INTO app_settings (key, value) VALUES ('routing_numbers_seeded_v1', '1') ON CONFLICT(key) DO NOTHING`).run();
  if (claimed.changes === 0) return;

  const text = fs.readFileSync(ROUTING_SEED_PATH, 'utf-8');
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });

  const insert = db.prepare(
    `INSERT INTO routing_lookup (id, bank_name, state, routing_number, institution_type, source_note) VALUES (?, ?, ?, ?, ?, ?)`
  );

  const isCreditUnion = (name: string) => /credit union|\bfcu\b/i.test(name);

  const runSeed = db.transaction((rows: Record<string, string>[]) => {
    for (const row of rows) {
      const bankName = (row['Bank Name (FDIC)'] || '').trim();
      const state = (row['State Code'] || '').trim().toUpperCase();
      const routingNumber = (row['Routing Number'] || '').trim();
      if (!bankName || !state || !/^\d{9}$/.test(routingNumber)) continue;

      const matchType = (row['Match Type'] || '').trim();
      const fedOffice = (row['Routing Office City/State'] || '').trim();
      const note = (row['Note'] || '').trim();
      const sourceNote = [
        fedOffice ? `Fed directory match: ${fedOffice}${matchType ? ` (${matchType})` : ''}` : null,
        note || null
      ].filter(Boolean).join(' — ');

      insert.run(newId(), bankName, state, routingNumber, isCreditUnion(bankName) ? 'credit_union' : 'bank', sourceNote || null);
    }
  });

  runSeed(parsed.data);
}

// One-time password/username reset for the account that owns all
// pre-existing leads (the same id seedDefaultUser returns), requested
// directly by the user after being locked out by the login rollout. Also
// folds every other account down into this one (reassigning any leads they
// own first, so nothing is lost) and removes them, per the user's explicit
// follow-up request to keep only this single account.
// Updates the primary row in place rather than inserting a new user, so
// every lead it already owns stays visible — a brand-new row would show up
// with zero leads and look like data loss. Guarded by the same one-time
// atomic claim used elsewhere in this file so it never overwrites a
// password or deletes a teammate the user adds afterward through
// Settings -> Team.
const RECOVERY_CLAIM_KEY = 'recovery_admin_2026_08_29';

function ensureRecoveryAccount(db: Database.Database) {
  const claimed = db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO NOTHING`).run(RECOVERY_CLAIM_KEY);
  if (claimed.changes === 0) return;

  const username = 'Admin';
  const password = '#1726Love-';
  try {
    const runRecovery = db.transaction(() => {
      const primary = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
      let primaryId: string;
      if (primary) {
        primaryId = primary.id;
        db.prepare('UPDATE users SET username = ?, password_hash = ?, name = ? WHERE id = ?').run(username, hashPassword(password), 'Admin', primaryId);
      } else {
        primaryId = newId();
        db.prepare('INSERT INTO users (id, username, password_hash, name) VALUES (?, ?, ?, ?)').run(primaryId, username, hashPassword(password), 'Admin');
      }
      db.prepare('UPDATE customers SET owner_id = ? WHERE owner_id IS NULL OR owner_id != ?').run(primaryId, primaryId);
      db.prepare('DELETE FROM users WHERE id != ?').run(primaryId);
    });
    runRecovery();
  } catch (err) {
    // The whole thing failed atomically (transaction rolled back), so nothing
    // is half-changed — but the claim above was still consumed. Un-claim it
    // so the NEXT boot retries instead of silently staying broken forever.
    console.error('[recovery-account] Could not reset the primary account — will retry on next start.', err);
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(RECOVERY_CLAIM_KEY);
  }
}

// Every deployment needs at least one login. If no users exist yet, create
// one from ADMIN_USERNAME/ADMIN_PASSWORD (falling back to the old
// BASIC_AUTH_USER/PASSWORD so the same credentials people already use keep
// working), so real-account login replaces the shared Basic Auth gate
// without locking anyone out. Race-safe across Next.js's multiple build
// workers via the UNIQUE(username) constraint + ON CONFLICT DO NOTHING,
// same pattern as seedStarterUnderwriting below.
function seedDefaultUser(db: Database.Database): string {
  const existing = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
  if (existing) return existing.id;

  const username = process.env.ADMIN_USERNAME || process.env.BASIC_AUTH_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || process.env.BASIC_AUTH_PASSWORD || 'changeme';
  db.prepare(
    `INSERT INTO users (id, username, password_hash, name) VALUES (?, ?, ?, ?) ON CONFLICT(username) DO NOTHING`
  ).run(newId(), username, hashPassword(password), 'Admin');

  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string };
  return row.id;
}

// First run after the `role` column lands: whoever's the oldest account
// (the same "primary account" every other one-time migration here already
// treats as canonical — see seedDefaultUser/ensureRecoveryAccount) becomes
// admin. Never touches role again after that — a teammate added later via
// Settings -> Team stays a plain agent, and an existing admin's role isn't
// reset back by a later deploy.
function ensureAdminRole(db: Database.Database) {
  const hasAdmin = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();
  if (hasAdmin) return;
  db.prepare(
    `UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)`
  ).run();
}

// daily_goals/weekly_goals originally shipped with a single-column primary
// key (date / week_start) before becoming per-user tables. SQLite can't
// ALTER a primary key, so an existing table with the old shape has to be
// rebuilt rather than column-patched. Guarded by an atomic claim (like
// seedStarterUnderwriting) since a plain column-check-then-rebuild would
// race across Next.js's concurrent build workers.
function migrateGoalsTables(db: Database.Database, defaultUserId: string) {
  if (tableColumns(db, 'daily_goals').includes('user_id')) return;

  const claimed = db.prepare(`INSERT INTO app_settings (key, value) VALUES ('goals_v2_migrated', '1') ON CONFLICT(key) DO NOTHING`).run();
  if (claimed.changes === 0) return;

  const specs = [
    { table: 'daily_goals', keyCol: 'date' },
    { table: 'weekly_goals', keyCol: 'week_start' }
  ] as const;

  for (const spec of specs) {
    if (tableColumns(db, spec.table).includes('user_id')) continue;
    const oldRows = db.prepare(`SELECT * FROM ${spec.table}`).all() as Record<string, unknown>[];
    db.exec(`DROP TABLE ${spec.table};`);
    db.exec(`
      CREATE TABLE ${spec.table} (
        ${spec.keyCol} TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_dials INTEGER,
        target_appointments INTEGER,
        target_ap REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (${spec.keyCol}, user_id)
      );
    `);
    const insert = db.prepare(
      `INSERT INTO ${spec.table} (${spec.keyCol}, user_id, target_dials, target_appointments, target_ap, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const row of oldRows) {
      insert.run(row[spec.keyCol], defaultUserId, row.target_dials ?? null, row.target_appointments ?? null, row.target_ap ?? null, row.created_at);
    }
  }
}

// One-time starter set of well-known, generally-taught final-expense
// underwriting patterns, so the Suggested Carrier Order isn't empty out of
// the box. This is explicitly NOT authoritative — every carrier's real field
// guide varies by state and changes over time; the tier_note/notes fields say
// so, matching the disclaimer already shown on the Underwriting Rules tab.
// Guarded by an atomic flag in app_settings (not "is carriers empty?") because
// Next.js's build spawns multiple worker processes that could otherwise both
// see an empty table and both insert a full duplicate set.
function seedStarterUnderwriting(db: Database.Database) {
  const claimed = db
    .prepare(`INSERT INTO app_settings (key, value) VALUES ('underwriting_seeded', '1') ON CONFLICT(key) DO NOTHING`)
    .run();
  if (claimed.changes === 0) return;

  const insertCarrier = db.prepare(
    `INSERT INTO carriers (id, name, notes, sort_order) VALUES (?, ?, ?, ?)`
  );
  const insertRule = db.prepare(
    `INSERT INTO carrier_underwriting_rules (id, carrier_id, keywords, tier_note, priority, is_knockout)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const STARTER_NOTE = 'Starter data — general FEX practice, not this carrier\'s actual current field guide. Verify before quoting.';

  const carriers: { name: string; rules: { keywords: string; tier_note: string; priority: number; knockout: boolean }[] }[] = [
    {
      name: 'Mutual of Omaha',
      rules: [
        { keywords: 'oxygen, copd, emphysema', tier_note: 'Typically declined/knockout on home oxygen', priority: 0, knockout: true },
        { keywords: 'dialysis, kidney failure, renal failure', tier_note: 'Typically declined/knockout', priority: 0, knockout: true },
        { keywords: 'hospice, terminal, terminally ill', tier_note: 'Typically declined/knockout', priority: 0, knockout: true },
        { keywords: 'als, lou gehrig', tier_note: 'Typically declined/knockout', priority: 0, knockout: true },
        { keywords: 'nursing home, bedridden, hospitalized', tier_note: 'Typically declined/knockout if currently confined', priority: 0, knockout: true },
        { keywords: 'cancer, tumor, chemo, chemotherapy', tier_note: 'Often graded/declined if within last 2 years — verify', priority: 5, knockout: false },
        { keywords: 'diabetes, insulin', tier_note: 'Often level if controlled without complications', priority: 3, knockout: false },
        { keywords: 'non-smoker, no tobacco', tier_note: 'Best rate class', priority: 2, knockout: false }
      ]
    },
    {
      name: 'Americo',
      rules: [
        { keywords: 'oxygen, copd, emphysema', tier_note: 'Typically declined/knockout on home oxygen', priority: 0, knockout: true },
        { keywords: 'dialysis, kidney failure, renal failure', tier_note: 'Typically declined/knockout', priority: 0, knockout: true },
        { keywords: 'hospice, terminal, terminally ill', tier_note: 'Typically declined/knockout', priority: 0, knockout: true },
        { keywords: 'als, lou gehrig', tier_note: 'Typically declined/knockout', priority: 0, knockout: true },
        { keywords: 'cancer, tumor, chemo, chemotherapy', tier_note: 'Often graded/declined if within last 2 years — verify', priority: 5, knockout: false },
        { keywords: 'diabetes, insulin', tier_note: 'Known for more lenient diabetes underwriting — verify current guide', priority: 4, knockout: false }
      ]
    },
    {
      name: 'Foresters Financial',
      rules: [
        { keywords: 'oxygen, copd, emphysema', tier_note: 'Typically declined/knockout on home oxygen', priority: 0, knockout: true },
        { keywords: 'dialysis, kidney failure, renal failure', tier_note: 'Typically declined/knockout', priority: 0, knockout: true },
        { keywords: 'hospice, terminal, terminally ill', tier_note: 'Typically declined/knockout', priority: 0, knockout: true },
        { keywords: 'als, lou gehrig', tier_note: 'Typically declined/knockout', priority: 0, knockout: true },
        { keywords: 'cancer, tumor, chemo, chemotherapy', tier_note: 'Often graded/declined if within last 2 years — verify', priority: 5, knockout: false },
        { keywords: 'diabetes, insulin', tier_note: 'Often graded if insulin-dependent — verify', priority: 3, knockout: false }
      ]
    },
    {
      name: 'Royal Neighbors of America',
      rules: [
        { keywords: 'oxygen, copd, emphysema', tier_note: 'Typically declined/knockout on home oxygen', priority: 0, knockout: true },
        { keywords: 'dialysis, kidney failure, renal failure', tier_note: 'Typically declined/knockout', priority: 0, knockout: true },
        { keywords: 'hospice, terminal, terminally ill', tier_note: 'Typically declined/knockout', priority: 0, knockout: true },
        { keywords: 'als, lou gehrig', tier_note: 'Typically declined/knockout', priority: 0, knockout: true },
        { keywords: 'cancer, tumor, chemo, chemotherapy', tier_note: 'Often graded/declined if within last 2 years — verify', priority: 5, knockout: false },
        { keywords: 'diabetes, insulin', tier_note: 'Often graded if insulin-dependent — verify', priority: 3, knockout: false }
      ]
    },
    {
      name: 'Liberty Bankers Life',
      rules: [
        { keywords: 'hospice, terminal, terminally ill', tier_note: 'Typically declined/knockout even on guaranteed-issue tiers', priority: 0, knockout: true },
        { keywords: 'oxygen, copd, emphysema, dialysis, kidney failure, als, cancer, chemo', tier_note: 'Often still eligible on a guaranteed-issue tier at higher premium — verify', priority: 6, knockout: false },
        { keywords: 'diabetes, insulin', tier_note: 'Often eligible — verify current tier', priority: 4, knockout: false }
      ]
    },
    {
      name: 'Corebridge Financial (American General)',
      rules: [
        { keywords: 'oxygen, copd, emphysema', tier_note: 'Typically declined/knockout on home oxygen', priority: 0, knockout: true },
        { keywords: 'dialysis, kidney failure, renal failure', tier_note: 'Typically declined/knockout', priority: 0, knockout: true },
        { keywords: 'hospice, terminal, terminally ill', tier_note: 'Typically declined/knockout', priority: 0, knockout: true },
        { keywords: 'als, lou gehrig', tier_note: 'Typically declined/knockout', priority: 0, knockout: true },
        { keywords: 'cancer, tumor, chemo, chemotherapy', tier_note: 'Often graded/declined if within last 2 years — verify', priority: 5, knockout: false },
        { keywords: 'diabetes, insulin', tier_note: 'Often graded if insulin-dependent — verify', priority: 3, knockout: false }
      ]
    }
  ];

  const existingNames = new Set(
    (db.prepare('SELECT name FROM carriers').all() as { name: string }[]).map((c) => c.name.trim().toLowerCase())
  );

  carriers.forEach((carrier, i) => {
    // Don't duplicate a carrier the user already added themselves before this ran.
    if (existingNames.has(carrier.name.toLowerCase())) return;
    const carrierId = newId();
    insertCarrier.run(carrierId, carrier.name, STARTER_NOTE, i);
    for (const rule of carrier.rules) {
      insertRule.run(newId(), carrierId, rule.keywords, rule.tier_note, rule.priority, rule.knockout ? 1 : 0);
    }
  });
}

function createConnection(): Database.Database {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);
  migrate(db);
  return db;
}

// better-sqlite3 aborts the process (`Assertion failed: (env) != nullptr`)
// if its native handles are still open when the Node process tears down its
// N-API environment. Hosts like Railway send SIGTERM on every redeploy/restart,
// so the connection must be closed explicitly before that teardown runs,
// rather than relying on native finalizers to run afterwards.
function registerShutdownHandlers(db: Database.Database) {
  if (global.__crmDbShutdownRegistered) return;
  global.__crmDbShutdownRegistered = true;

  const closeAndExit = (code: number) => {
    try {
      if (db.open) db.close();
    } finally {
      process.exit(code);
    }
  };

  process.once('SIGTERM', () => closeAndExit(0));
  process.once('SIGINT', () => closeAndExit(0));
  process.once('exit', () => {
    if (db.open) db.close();
  });
}

export function getDb(): Database.Database {
  if (!global.__crmDb) {
    global.__crmDb = createConnection();
    registerShutdownHandlers(global.__crmDb);
  }
  return global.__crmDb;
}
