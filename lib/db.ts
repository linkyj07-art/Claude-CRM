import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

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

// schema.sql only uses CREATE TABLE/INDEX IF NOT EXISTS, so it never alters a
// table that already exists on a live database. Column additions to existing
// tables have to be migrated by hand here, guarded by checking the table's
// current columns first since SQLite has no "ADD COLUMN IF NOT EXISTS".
function migrate(db: Database.Database) {
  const noteColumns = (db.pragma('table_info(note_versions)') as { name: string }[]).map((c) => c.name);
  if (noteColumns.includes('plan_bronze') && !noteColumns.includes('plan_bronze_coverage')) {
    db.exec(`
      ALTER TABLE note_versions ADD COLUMN plan_bronze_coverage TEXT;
      ALTER TABLE note_versions ADD COLUMN plan_bronze_price TEXT;
      ALTER TABLE note_versions ADD COLUMN plan_silver_coverage TEXT;
      ALTER TABLE note_versions ADD COLUMN plan_silver_price TEXT;
      ALTER TABLE note_versions ADD COLUMN plan_gold_coverage TEXT;
      ALTER TABLE note_versions ADD COLUMN plan_gold_price TEXT;
    `);
    // Best-effort carry-over: the old fields were free text like "$50/mo",
    // which reads naturally as the price half of the new pair.
    db.exec(`
      UPDATE note_versions SET plan_bronze_price = plan_bronze WHERE plan_bronze IS NOT NULL;
      UPDATE note_versions SET plan_silver_price = plan_silver WHERE plan_silver IS NOT NULL;
      UPDATE note_versions SET plan_gold_price = plan_gold WHERE plan_gold IS NOT NULL;
    `);
  }
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
