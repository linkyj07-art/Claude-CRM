import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { getDb } from '@/lib/db';
import { newId, normalizeState, parseCoverageRange, stateFromAreaCode, reconcileContactFields } from '@/lib/util';
import { logAudit } from '@/lib/audit';
import { findDncMatch, addToDncRegistry } from '@/lib/dnc';
import { CustomerStatus } from '@/lib/types';
import { getCurrentUser } from '@/lib/currentUser';

const MAX_ROWS = 5000;

// Maps our internal field names to the header text a lead sheet might use.
// Matching is case-insensitive and ignores spaces/underscores/dashes.
// "interested_in" is listed before "ad" for ad_type so a sheet with both
// columns (a product-interest field and a separate ad/creative name field)
// prefers the more specific one.
const FIELD_ALIASES: Record<string, string[]> = {
  first_name: ['first name', 'first', 'fname', 'firstname', 'given name'],
  last_name: ['last name', 'last', 'lname', 'lastname', 'surname', 'family name'],
  // A single combined name column (common on Meta/Google lead-ad exports) —
  // only used when there's no separate first/last match, split on the first
  // space (see splitFullName below).
  full_name: ['full name', 'name', 'contact name', 'lead name', 'customer name'],
  phone: ['phone', 'phone number', 'phone#', 'telephone', 'tel', 'cell', 'cell phone', 'cell number', 'mobile', 'mobile phone', 'mobile number', 'contact number', 'primary phone'],
  email: ['email', 'email address', 'e mail', 'email id'],
  dob: ['dob', 'date of birth', 'birthdate', 'birth date', 'birthday', 'd o b'],
  gender: ['gender', 'sex', 'm f'],
  marital_status: ['marital status', 'marital'],
  military_branch: ['military branch', 'branch'],
  military_status: ['military status', 'veteran status'],
  coverage_wanted: ['how much coverage do you need', 'coverage wanted', 'coverage', 'coverage amount', 'face amount', 'desired coverage', 'coverage requested'],
  address: ['address', 'street address', 'street', 'mailing address', 'home address'],
  city: ['city', 'town'],
  state: ['state', 'st', 'state province', 'province'],
  postal_code: ['postal code', 'zip', 'zip code', 'zipcode', 'postcode'],
  ad_type: ['interested in', 'ad type', 'lead type', 'ad', 'ad name'],
  platform: ['platform', 'source', 'lead source', 'traffic source'],
  lead_vendor: ['lead vendor', 'vendor', 'provider'],
  best_time: ['best time of day to contact you', 'best time', 'best time to call'],
  lead_cost: ['lead cost', 'cost', 'cost per lead', 'price'],
  purchase_date: ['purchase date', 'date bought', 'date purchased', 'day bought', 'bought on', 'date time', 'lead date', 'submitted', 'submitted at', 'created', 'created at', 'created date'],
  age_range: ['age range', 'lead age', 'age bucket'],
  trusted_form_url: ['trusted form certificate', 'trustedform', 'trusted form', 'consent url', 'tcpa certificate'],
  // Not stored on the customer directly — kept only as a fallback source to
  // recover a misplaced DOB (see fixMisalignedContactFields below).
  age: ['age']
};

// "Jane Q Doe" -> { first: "Jane", last: "Q Doe" }; a single-word name has
// nothing to split so it's treated as a first name only.
function splitFullName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] || '', last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function normalize(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildHeaderMap(headers: string[]): Record<string, string> {
  const normalized = headers.map(normalize);
  const map: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const idx = normalized.indexOf(alias);
      if (idx !== -1) {
        map[field] = headers[idx];
        break;
      }
    }
  }
  return map;
}

function parseAgeRange(text: string): CustomerStatus | null {
  const t = normalize(text);
  if (!t) return null;
  if (t.includes('90')) return 'aging_90_plus';
  if (t.includes('45') || (t.includes('60') && t.includes('day'))) return 'aging_45_90';
  if (t.includes('fresh')) return 'fresh';
  return null;
}

// Accepts ISO (YYYY-MM-DD from the date picker), most common US text formats,
// or a JS Date (already-parsed Excel date cell) and returns a SQLite-compatible
// 'YYYY-MM-DD HH:MM:SS' string, or null if unparseable.
function parsePurchaseDate(value: string | Date): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
  const t = value.trim();
  if (!t) return null;
  const d = new Date(t.length <= 10 && !t.includes('T') ? `${t}T12:00:00Z` : t);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeDupeKey(first: string, last: string, phone: string, dob: string): string | null {
  const f = first.trim().toLowerCase();
  const l = last.trim().toLowerCase();
  const p = phone.replace(/\D/g, '');
  const b = dob.trim().toLowerCase();
  if (!f || !l || !p || !b) return null;
  return `${f}|${l}|${p}|${b}`;
}

// Turns a spreadsheet cell's raw value into the plain string our per-row logic
// expects, handling exceljs's richer value shapes for dates/formulas/hyperlinks.
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    // Hyperlink cells nest a further rich-text (or plain) value under `.text`,
    // so this has to recurse rather than String()-coerce it directly.
    if ('result' in value) return cellToString((value as { result: ExcelJS.CellValue }).result);
    if ('text' in value) return cellToString((value as { text: ExcelJS.CellValue }).text);
    if ('richText' in value) return (value as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
  }
  return String(value);
}

// A column with no header text at all -- common on these lead sheets for a
// leading "scratch" column an agent free-types short tags into (3x, Cooked,
// Hung up, DC #, ...) -- used to get silently dropped entirely (its cells
// have no header to key the row object by). Keeping it under a synthetic
// per-column key instead is what lets tagColumnKeys() below actually find
// it, so a "DC" tag scribbled in that column can be detected at all.
const UNLABELED_COL_PREFIX = '__unlabeled_col_';

async function rowsFromXlsx(buffer: Buffer): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's type defs predate @types/node's ArrayBufferLike-generic Buffer;
  // the value itself is a perfectly normal Buffer at runtime.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const text = cellToString(cell.value).trim();
    headers[colNumber - 1] = text || `${UNLABELED_COL_PREFIX}${colNumber}`;
  });

  const rows: Record<string, string>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, string> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (!header) return;
      const v = cellToString(cell.value);
      obj[header] = v;
      if (v) hasValue = true;
    });
    if (hasValue) rows.push(obj);
  });
  return { headers, rows };
}

// Which columns to scan a row for a "DC"/"DNC" tag: any unlabeled column
// (the common pattern above) plus anything explicitly headed like a tag/
// notes/disposition field. Deliberately NOT every column -- a blind
// whole-row text search would misfire on a legitimate "State" value of DC
// (Washington, D.C. is a real state code in this data).
const TAG_HEADER_ALIASES = ['tag', 'tags', 'disposition', 'call notes', 'notes', 'status notes', 'agent notes'];

function tagColumnKeys(headers: string[]): string[] {
  return headers.filter((h) => h.startsWith(UNLABELED_COL_PREFIX) || TAG_HEADER_ALIASES.includes(normalize(h)));
}

const DC_TAG_PATTERN = /\b(DC|DNC)\b/i;

function rowHasDcTag(row: Record<string, string>, tagKeys: string[]): boolean {
  return tagKeys.some((k) => DC_TAG_PATTERN.test(row[k] || ''));
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }
  const batchPurchaseDate = String(formData.get('purchaseDate') || '');
  const batchLeadCost = String(formData.get('leadCost') || '');
  const batchAgeRange = String(formData.get('ageRange') || '');
  const batchVendorName = String(formData.get('vendorName') || '').trim();

  const fileName = file instanceof File ? file.name : 'spreadsheet';
  const isExcel = /\.xlsx$/i.test(fileName);
  const isOldExcel = /\.xls$/i.test(fileName);
  if (isOldExcel) {
    return NextResponse.json(
      { error: 'That looks like an old .xls file — please re-save it as .xlsx or .csv and try again.' },
      { status: 400 }
    );
  }

  let headers: string[];
  let rows: Record<string, string>[];
  if (isExcel) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = await rowsFromXlsx(buffer);
      headers = parsed.headers;
      rows = parsed.rows;
    } catch {
      return NextResponse.json({ error: 'Could not read that .xlsx file — make sure it isn\'t corrupted or password-protected.' }, { status: 400 });
    }
  } else {
    const text = await file.text();
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    if (parsed.errors.length > 0 && (!parsed.data || parsed.data.length === 0)) {
      return NextResponse.json(
        { error: 'Could not read that file as a CSV. Export your sheet as .csv (or upload the .xlsx directly) and try again.' },
        { status: 400 }
      );
    }
    const rawHeaders = parsed.meta.fields || [];
    // Same treatment as the xlsx path: Papaparse keys a blank-header column
    // as '' (and collapses more than one of them onto the same '' key), so
    // give each one its own synthetic key rather than leave it undetectable.
    let blankSeen = 0;
    headers = rawHeaders.map((h) => (h.trim() ? h : `${UNLABELED_COL_PREFIX}${++blankSeen}`));
    rows = parsed.data
      .filter((r) => Object.keys(r).length > 0)
      .map((r) => {
        if (!('' in r)) return r;
        const { '': blank, ...rest } = r;
        return { ...rest, [`${UNLABELED_COL_PREFIX}1`]: blank };
      });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'That file has no rows to import.' }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `That file has ${rows.length} rows — please split it into batches of ${MAX_ROWS} or fewer.` }, { status: 400 });
  }

  const headerMap = buildHeaderMap(headers);
  const dcTagKeys = tagColumnKeys(headers);
  const db = getDb();

  const vendors = db.prepare('SELECT id, name FROM lead_vendors').all() as { id: string; name: string }[];
  const vendorByName = new Map(vendors.map((v) => [v.name.trim().toLowerCase(), v.id]));
  const insertVendor = db.prepare(`INSERT INTO lead_vendors (id, name) VALUES (?, ?)`);
  function resolveVendorId(name: string): string | null {
    const key = name.trim().toLowerCase();
    if (!key) return null;
    let vendorId = vendorByName.get(key);
    if (!vendorId) {
      vendorId = newId();
      insertVendor.run(vendorId, name.trim());
      vendorByName.set(key, vendorId);
    }
    return vendorId;
  }
  const batchVendorId = resolveVendorId(batchVendorName);
  const batchPurchasedAt = parsePurchaseDate(batchPurchaseDate);
  const batchStatus = parseAgeRange(batchAgeRange);

  const existingCustomers = db.prepare(
    'SELECT id, first_name, last_name, phone, dob, email, gender, state FROM customers WHERE owner_id = ?'
  ).all(user.id) as
    { id: string; first_name: string; last_name: string; phone: string | null; dob: string | null; email: string | null; gender: string | null; state: string | null }[];
  const dupeIndex = new Map<string, string>();
  // Phone-only index, separate from the full dupe key above (which also
  // requires a matching DOB): lets a re-upload of the same sheet backfill a
  // lead whose DOB/email/gender/state got nulled out by some earlier import
  // bug, instead of failing to match on DOB and creating a duplicate lead.
  const existingByPhone = new Map<string, typeof existingCustomers[number]>();
  for (const c of existingCustomers) {
    const key = normalizeDupeKey(c.first_name || '', c.last_name || '', c.phone || '', c.dob || '');
    if (key) dupeIndex.set(key, c.id);
    const digits = (c.phone || '').replace(/\D/g, '');
    if (digits.length >= 10) existingByPhone.set(digits.slice(-10), c);
  }
  const updateBackfill = db.prepare(
    `UPDATE customers SET dob = COALESCE(dob, @dob), email = COALESCE(email, @email),
       gender = COALESCE(gender, @gender), state = COALESCE(state, @state), updated_at = datetime('now')
     WHERE id = @id`
  );

  const insertCustomer = db.prepare(
    `INSERT INTO customers (id, owner_id, first_name, last_name, phone, email, dob, gender, marital_status,
      military, military_branch, coverage_wanted, address, city, state, postal_code, timezone,
      ad_type, platform, lead_vendor_id, best_time, lead_cost, trusted_form_url, status, purchased_at, created_at, updated_at)
     VALUES (@id, @owner_id, @first_name, @last_name, @phone, @email, @dob, @gender, @marital_status,
      @military, @military_branch, @coverage_wanted, @address, @city, @state, @postal_code, NULL,
      @ad_type, @platform, @lead_vendor_id, @best_time, @lead_cost, @trusted_form_url, @status, @purchased_at, datetime('now'), datetime('now'))`
  );
  const insertDupe = db.prepare(
    `INSERT INTO duplicate_leads (id, customer_id, first_name, last_name, phone, email, dob, state, raw_data, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  );

  const skipped: { row: number; reason: string }[] = [];
  const importedIds: string[] = [];
  let duplicateCount = 0;
  let backfilledCount = 0;
  let dncCount = 0;
  const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const runImport = db.transaction((rows: Record<string, string>[]) => {
    rows.forEach((row, i) => {
      const get = (field: string): string => {
        const header = headerMap[field];
        if (!header) return '';
        const v = row[header];
        return v === undefined || v === null ? '' : String(v).trim();
      };

      let first_name = get('first_name');
      let last_name = get('last_name');
      if (!first_name && !last_name) {
        const fullName = get('full_name');
        if (fullName) {
          const split = splitFullName(fullName);
          first_name = split.first;
          last_name = split.last;
        }
      }
      const rawPhone = get('phone');
      const rawDob = get('dob');
      if (!first_name && !last_name && !rawPhone) {
        skipped.push({ row: i + 2, reason: 'No name or phone found on this row' });
        return;
      }

      const { phone, dob, email, gender, state: fixedState } = reconcileContactFields({
        phone: rawPhone, dob: rawDob, age: get('age'), email: get('email'), gender: get('gender'), state: get('state')
      });

      const rowPurchasedAt = parsePurchaseDate(get('purchase_date'));
      const rowStatus = parseAgeRange(get('age_range'));
      const rowVendorId = resolveVendorId(get('lead_vendor'));
      const militaryBranch = get('military_branch');
      const militaryStatus = get('military_status');
      const rowCostDigits = get('lead_cost').replace(/[^0-9.]/g, '');
      const batchCostDigits = batchLeadCost.replace(/[^0-9.]/g, '');

      const data = {
        first_name: first_name || 'New',
        last_name: last_name || 'Lead',
        phone: phone || null,
        email: email || null,
        dob: dob || null,
        gender: gender || null,
        marital_status: get('marital_status') || null,
        military: militaryBranch || militaryStatus ? 1 : 0,
        military_branch: militaryBranch || null,
        coverage_wanted: parseCoverageRange(get('coverage_wanted')),
        address: get('address') || null,
        city: get('city') || null,
        state: normalizeState(fixedState) || stateFromAreaCode(phone),
        postal_code: get('postal_code') || null,
        ad_type: get('ad_type') || 'Final Expense',
        platform: get('platform') || null,
        lead_vendor_id: rowVendorId || batchVendorId || null,
        best_time: get('best_time') || null,
        lead_cost: rowCostDigits ? Number(rowCostDigits) : (batchCostDigits ? Number(batchCostDigits) : 0),
        trusted_form_url: get('trusted_form_url') || null,
        status: rowStatus || batchStatus || 'fresh',
        purchased_at: rowPurchasedAt || batchPurchasedAt || nowStr
      };

      if (findDncMatch(phone)) {
        data.status = 'dnc';
        dncCount++;
      } else if (rowHasDcTag(row, dcTagKeys)) {
        // The sheet itself carries a "DC"/"DNC" tag for this lead (an
        // agent's own scratch note from working it before, not yet in our
        // registry) -- honor it the same as an already-registered number:
        // import as dnc, and register the number now so it's caught on
        // every future import/webhook from here on, not just this one.
        data.status = 'dnc';
        dncCount++;
        addToDncRegistry(phone, first_name, last_name, 'Tagged "DC" on import', user.id);
      }

      const dupeKey = normalizeDupeKey(first_name, last_name, phone, dob);
      const matchId = dupeKey ? dupeIndex.get(dupeKey) : undefined;
      if (matchId) {
        const dupeId = newId();
        insertDupe.run(dupeId, matchId, first_name || null, last_name || null, phone || null, email || null, dob || null, data.state, JSON.stringify(data), fileName);
        duplicateCount++;
        return;
      }

      // No exact (name+phone+DOB) match, but the same phone number already
      // belongs to a lead here — most likely this exact lead, re-uploaded,
      // with a DOB/email/gender/state this sheet actually has correctly.
      // Fill in whatever that existing lead is missing rather than either
      // silently dropping the row or creating a second copy of the same
      // person.
      const phoneDigits = phone.replace(/\D/g, '');
      const existingByPhoneMatch = phoneDigits.length >= 10 ? existingByPhone.get(phoneDigits.slice(-10)) : undefined;
      if (existingByPhoneMatch) {
        const missingSomething =
          (!existingByPhoneMatch.dob && dob) ||
          (!existingByPhoneMatch.email && email) ||
          (!existingByPhoneMatch.gender && gender) ||
          (!existingByPhoneMatch.state && data.state);
        if (missingSomething) {
          updateBackfill.run({ id: existingByPhoneMatch.id, dob: dob || null, email: email || null, gender: gender || null, state: data.state || null });
          backfilledCount++;
        } else {
          duplicateCount++;
        }
        return;
      }

      const id = newId();
      insertCustomer.run({ id, owner_id: user.id, ...data });
      importedIds.push(id);
      if (dupeKey) dupeIndex.set(dupeKey, id);
      if (phoneDigits.length >= 10) existingByPhone.set(phoneDigits.slice(-10), { id, first_name, last_name, phone, dob, email, gender, state: data.state });
    });
  });

  runImport(rows);

  for (const id of importedIds) {
    logAudit(id, 'lead_purchased', `Lead added — bulk import (${fileName})`);
  }

  return NextResponse.json({ imported: importedIds.length, duplicates: duplicateCount, backfilled: backfilledCount, dncMatched: dncCount, skipped, total: rows.length });
}
