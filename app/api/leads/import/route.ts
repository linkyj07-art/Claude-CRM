import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { getDb } from '@/lib/db';
import { newId } from '@/lib/util';
import { logAudit } from '@/lib/audit';
import { CustomerStatus } from '@/lib/types';

const MAX_ROWS = 5000;

// Maps our internal field names to the header text a lead sheet might use.
// Matching is case-insensitive and ignores spaces/underscores/dashes.
const FIELD_ALIASES: Record<string, string[]> = {
  first_name: ['first name', 'first', 'fname', 'firstname'],
  last_name: ['last name', 'last', 'lname', 'lastname'],
  phone: ['phone', 'phone number', 'cell', 'cell phone', 'mobile', 'mobile phone'],
  email: ['email', 'email address'],
  dob: ['dob', 'date of birth', 'birthdate', 'birth date'],
  gender: ['gender', 'sex'],
  marital_status: ['marital status', 'marital'],
  military_branch: ['military branch', 'branch'],
  coverage_wanted: ['coverage wanted', 'coverage', 'coverage amount', 'face amount'],
  address: ['address', 'street address', 'street'],
  city: ['city'],
  state: ['state', 'st'],
  postal_code: ['postal code', 'zip', 'zip code', 'zipcode'],
  ad_type: ['ad type', 'lead type'],
  platform: ['platform', 'source', 'lead source'],
  lead_vendor: ['lead vendor', 'vendor'],
  best_time: ['best time', 'best time to call'],
  lead_cost: ['lead cost', 'cost'],
  purchase_date: ['purchase date', 'date bought', 'date purchased', 'day bought', 'bought on'],
  age_range: ['age range', 'lead age', 'age bucket']
};

function normalize(h: string): string {
  return h.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
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

// Accepts ISO (YYYY-MM-DD from the date picker) or most common US formats and
// returns a SQLite-compatible 'YYYY-MM-DD HH:MM:SS' string, or null if unparseable.
function parsePurchaseDate(text: string): string | null {
  const t = text.trim();
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

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }
  const batchPurchaseDate = String(formData.get('purchaseDate') || '');
  const batchLeadCost = String(formData.get('leadCost') || '');
  const batchAgeRange = String(formData.get('ageRange') || '');
  const batchVendorName = String(formData.get('vendorName') || '').trim();

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true
  });

  if (parsed.errors.length > 0 && (!parsed.data || parsed.data.length === 0)) {
    return NextResponse.json(
      { error: 'Could not read that file as a CSV. Export your sheet as .csv (File → Download → Comma Separated Values) and try again.' },
      { status: 400 }
    );
  }

  const rows = parsed.data.filter((r) => Object.keys(r).length > 0);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'That file has no rows to import.' }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `That file has ${rows.length} rows — please split it into batches of ${MAX_ROWS} or fewer.` }, { status: 400 });
  }

  const headerMap = buildHeaderMap(parsed.meta.fields || []);
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

  const existingCustomers = db.prepare('SELECT id, first_name, last_name, phone, dob FROM customers').all() as
    { id: string; first_name: string; last_name: string; phone: string | null; dob: string | null }[];
  const dupeIndex = new Map<string, string>();
  for (const c of existingCustomers) {
    const key = normalizeDupeKey(c.first_name || '', c.last_name || '', c.phone || '', c.dob || '');
    if (key) dupeIndex.set(key, c.id);
  }

  const insertCustomer = db.prepare(
    `INSERT INTO customers (id, first_name, last_name, phone, email, dob, gender, marital_status,
      military, military_branch, coverage_wanted, address, city, state, postal_code, timezone,
      ad_type, platform, lead_vendor_id, best_time, lead_cost, status, purchased_at, created_at, updated_at)
     VALUES (@id, @first_name, @last_name, @phone, @email, @dob, @gender, @marital_status,
      0, @military_branch, @coverage_wanted, @address, @city, @state, @postal_code, NULL,
      @ad_type, @platform, @lead_vendor_id, @best_time, @lead_cost, @status, @purchased_at, datetime('now'), datetime('now'))`
  );
  const insertDupe = db.prepare(
    `INSERT INTO duplicate_leads (id, customer_id, first_name, last_name, phone, email, dob, state, raw_data, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  );

  const skipped: { row: number; reason: string }[] = [];
  const importedIds: string[] = [];
  let duplicateCount = 0;
  const fileName = file instanceof File ? file.name : 'spreadsheet';
  const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const runImport = db.transaction((rows: Record<string, string>[]) => {
    rows.forEach((row, i) => {
      const get = (field: string): string => {
        const header = headerMap[field];
        if (!header) return '';
        const v = row[header];
        return v === undefined || v === null ? '' : String(v).trim();
      };

      const first_name = get('first_name');
      const last_name = get('last_name');
      const phone = get('phone');
      const dob = get('dob');
      if (!first_name && !last_name && !phone) {
        skipped.push({ row: i + 2, reason: 'No name or phone found on this row' });
        return;
      }

      const coverageDigits = get('coverage_wanted').replace(/[^0-9.]/g, '');
      const rowCostDigits = get('lead_cost').replace(/[^0-9.]/g, '');
      const batchCostDigits = batchLeadCost.replace(/[^0-9.]/g, '');
      const state = get('state').toUpperCase().slice(0, 2) || null;

      const rowPurchasedAt = parsePurchaseDate(get('purchase_date'));
      const rowStatus = parseAgeRange(get('age_range'));
      const rowVendorId = resolveVendorId(get('lead_vendor'));

      const data = {
        first_name: first_name || 'New',
        last_name: last_name || 'Lead',
        phone: phone || null,
        email: get('email') || null,
        dob: dob || null,
        gender: get('gender') || null,
        marital_status: get('marital_status') || null,
        military_branch: get('military_branch') || null,
        coverage_wanted: coverageDigits ? Number(coverageDigits) : null,
        address: get('address') || null,
        city: get('city') || null,
        state,
        postal_code: get('postal_code') || null,
        ad_type: get('ad_type') || 'Final Expense',
        platform: get('platform') || null,
        lead_vendor_id: rowVendorId || batchVendorId || null,
        best_time: get('best_time') || null,
        lead_cost: rowCostDigits ? Number(rowCostDigits) : (batchCostDigits ? Number(batchCostDigits) : 0),
        status: rowStatus || batchStatus || 'fresh',
        purchased_at: rowPurchasedAt || batchPurchasedAt || nowStr
      };

      const dupeKey = normalizeDupeKey(first_name, last_name, phone, dob);
      const matchId = dupeKey ? dupeIndex.get(dupeKey) : undefined;
      if (matchId) {
        const dupeId = newId();
        insertDupe.run(dupeId, matchId, first_name || null, last_name || null, phone || null, get('email') || null, dob || null, state, JSON.stringify(data), fileName);
        duplicateCount++;
        return;
      }

      const id = newId();
      insertCustomer.run({ id, ...data });
      importedIds.push(id);
      if (dupeKey) dupeIndex.set(dupeKey, id);
    });
  });

  runImport(rows);

  for (const id of importedIds) {
    logAudit(id, 'lead_purchased', `Lead added — bulk import (${fileName})`);
  }

  return NextResponse.json({ imported: importedIds.length, duplicates: duplicateCount, skipped, total: rows.length });
}
