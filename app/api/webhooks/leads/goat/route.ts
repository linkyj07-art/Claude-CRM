import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId, normalizeState, normalizePhone, parseCoverageRange, stateFromAreaCode } from '@/lib/util';
import { logAudit } from '@/lib/audit';
import { findDncMatch } from '@/lib/dnc';

// Fed by Goat Leads' own webhook delivery (their dashboard POSTs a new lead
// here in real time), not a logged-in browser — middleware.ts lets this one
// path through without a session cookie, same pattern as the Quo incoming-call
// webhook: a shared secret in the URL (?token=) instead of a session.
//
// Goat's exact field names aren't publicly documented, so this maps a wide
// set of common aliases (matching app/api/leads/import/route.ts's CSV header
// aliases) rather than one exact key per field, and every response — success
// or error — echoes back the field names it actually received/mapped so a
// real (or test) lead send can be used to tighten the mapping afterward.

const ALIASES: Record<string, string[]> = {
  first_name: ['first name', 'firstname', 'fname', 'given name'],
  last_name: ['last name', 'lastname', 'lname', 'surname', 'family name'],
  full_name: ['full name', 'name', 'contact name', 'lead name', 'customer name'],
  phone: ['phone', 'phone number', 'phone1', 'telephone', 'cell', 'cell phone', 'mobile', 'mobile phone', 'contact number', 'primary phone'],
  email: ['email', 'email address', 'e mail'],
  dob: ['dob', 'date of birth', 'birthdate', 'birth date', 'birthday'],
  gender: ['gender', 'sex'],
  marital_status: ['marital status', 'marital'],
  military_branch: ['military branch', 'branch'],
  coverage_wanted: ['coverage wanted', 'coverage', 'coverage amount', 'face amount', 'desired coverage', 'coverage requested', 'how much coverage do you need'],
  address: ['address', 'street address', 'street', 'address1', 'address 1'],
  city: ['city', 'town'],
  state: ['state', 'st', 'province'],
  postal_code: ['zip', 'zip code', 'zipcode', 'postal code', 'postcode'],
  ad_type: ['ad type', 'lead type', 'interested in'],
  platform: ['platform', 'source', 'lead source', 'traffic source'],
  best_time: ['best time', 'best time to call', 'best time of day to contact you'],
  lead_cost: ['lead cost', 'cost', 'cost per lead', 'price'],
  trusted_form_url: [
    'trusted form certificate', 'trustedform', 'trusted form', 'consent url', 'tcpa certificate',
    'xx trusted form cert url', 'trusted form cert url'
  ]
};

// "firstName" -> "first Name" (camelCase boundary) so it normalizes the same
// as "first_name" / "First Name" / "FIRST_NAME" below, since Goat's actual
// casing convention is unknown.
function normalizeKey(k: string): string {
  return k
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildFieldMap(body: Record<string, unknown>): Record<string, string> {
  const normalized = Object.keys(body).map((k) => [normalizeKey(k), k] as const);
  const map: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      const hit = normalized.find(([norm]) => norm === alias);
      if (hit) { map[field] = hit[1]; break; }
    }
  }
  return map;
}

function str(body: Record<string, unknown>, key: string | undefined): string {
  if (!key) return '';
  const v = body[key];
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

// "Jane Q Doe" -> { first: "Jane", last: "Q Doe" } — same split rule as the
// CSV import path, for the (common on lead-gen forms) single "name" field.
function splitFullName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] || '', last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export async function POST(req: NextRequest) {
  const expectedToken = process.env.GOAT_LEADS_WEBHOOK_TOKEN;
  if (!expectedToken) {
    return NextResponse.json({ error: 'GOAT_LEADS_WEBHOOK_TOKEN is not configured on the server' }, { status: 500 });
  }
  if (req.nextUrl.searchParams.get('token') !== expectedToken) {
    return NextResponse.json({ error: 'Invalid or missing token' }, { status: 401 });
  }

  const ownerUsername = process.env.GOAT_LEADS_OWNER_USERNAME;
  if (!ownerUsername) {
    return NextResponse.json({ error: 'GOAT_LEADS_OWNER_USERNAME is not configured on the server' }, { status: 500 });
  }

  const db = getDb();
  const owner = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(ownerUsername) as { id: string } | undefined;
  if (!owner) {
    return NextResponse.json({ error: `No user found with username "${ownerUsername}" (check GOAT_LEADS_OWNER_USERNAME)` }, { status: 500 });
  }

  // Goat may send JSON or a form-encoded post — accept either rather than
  // guessing wrong and silently getting an empty body.
  const contentType = req.headers.get('content-type') || '';
  let body: Record<string, unknown> = {};
  if (contentType.includes('application/json')) {
    body = await req.json().catch(() => ({}));
  } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null);
    if (form) for (const [k, v] of form.entries()) body[k] = typeof v === 'string' ? v : '';
  } else {
    // Unknown/missing content-type — try JSON first (most webhook senders
    // default to it even when the header is a little off), then fall back.
    body = await req.json().catch(() => ({}));
  }

  const map = buildFieldMap(body);
  const receivedFields = Object.keys(body);

  const fullName = str(body, map.full_name);
  let firstName = str(body, map.first_name);
  let lastName = str(body, map.last_name);
  if (!firstName && !lastName && fullName) {
    const split = splitFullName(fullName);
    firstName = split.first;
    lastName = split.last;
  }

  const rawPhone = str(body, map.phone);
  const state = normalizeState(str(body, map.state)) || stateFromAreaCode(rawPhone);

  if (!firstName && !lastName) {
    return NextResponse.json({ error: 'No usable name in the payload', receivedFields, mappedFields: map }, { status: 400 });
  }
  if (!rawPhone) {
    return NextResponse.json({ error: 'No usable phone number in the payload', receivedFields, mappedFields: map }, { status: 400 });
  }

  // Always tag these as a "Goat Leads" vendor so the existing per-vendor
  // cost/ROI reporting groups them without any extra setup.
  let vendor = db.prepare(`SELECT id FROM lead_vendors WHERE name = 'Goat Leads' COLLATE NOCASE`).get() as { id: string } | undefined;
  const vendorId = vendor ? vendor.id : newId();
  if (!vendor) db.prepare('INSERT INTO lead_vendors (id, name) VALUES (?, ?)').run(vendorId, 'Goat Leads');

  const leadCostRaw = str(body, map.lead_cost).replace(/[^0-9.]/g, '');
  const leadCost = leadCostRaw ? parseFloat(leadCostRaw) || 0 : 0;

  const dncMatch = findDncMatch(rawPhone);

  const customerData = {
    owner_id: owner.id,
    first_name: firstName || 'New',
    last_name: lastName || 'Lead',
    phone: rawPhone,
    email: str(body, map.email) || null,
    dob: str(body, map.dob) || null,
    gender: str(body, map.gender) || null,
    marital_status: str(body, map.marital_status) || null,
    military: 0,
    military_branch: str(body, map.military_branch) || null,
    coverage_wanted: parseCoverageRange(str(body, map.coverage_wanted)),
    address: str(body, map.address) || null,
    city: str(body, map.city) || null,
    state,
    postal_code: str(body, map.postal_code) || null,
    ad_type: str(body, map.ad_type) || 'Final Expense',
    platform: str(body, map.platform) || 'Goat Leads',
    lead_vendor_id: vendorId,
    best_time: str(body, map.best_time) || null,
    lead_cost: leadCost,
    trusted_form_url: str(body, map.trusted_form_url) || null,
    status: dncMatch ? 'dnc' : 'fresh',
    purchased_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
  };

  // Same phone-based duplicate check as the CSV import path: route an
  // obvious repeat to the Review Queue instead of creating a second customer
  // record outright, but keep the full payload so "Not a duplicate — Add"
  // can still create it with one click.
  const phoneDigits = normalizePhone(rawPhone);
  const existingCustomers = db
    .prepare('SELECT id, phone FROM customers WHERE owner_id = ? AND phone IS NOT NULL')
    .all(owner.id) as { id: string; phone: string }[];
  const dupeMatch = existingCustomers.find((c) => normalizePhone(c.phone) === phoneDigits);

  if (dupeMatch) {
    const dupeId = newId();
    db.prepare(
      `INSERT INTO duplicate_leads (id, customer_id, first_name, last_name, phone, email, dob, state, raw_data, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      dupeId, dupeMatch.id, customerData.first_name, customerData.last_name, customerData.phone,
      customerData.email, customerData.dob, customerData.state, JSON.stringify(customerData), 'Goat Leads webhook'
    );
    return NextResponse.json({ ok: true, duplicate: true, matchedCustomerId: dupeMatch.id, duplicateId: dupeId, receivedFields, mappedFields: map });
  }

  const id = newId();
  db.prepare(
    `INSERT INTO customers (id, owner_id, first_name, last_name, phone, email, dob, gender, marital_status,
      military, military_branch, coverage_wanted, address, city, state, postal_code, timezone,
      ad_type, platform, lead_vendor_id, best_time, lead_cost, trusted_form_url, status, purchased_at, created_at, updated_at)
     VALUES (@id, @owner_id, @first_name, @last_name, @phone, @email, @dob, @gender, @marital_status,
      @military, @military_branch, @coverage_wanted, @address, @city, @state, @postal_code, NULL,
      @ad_type, @platform, @lead_vendor_id, @best_time, @lead_cost, @trusted_form_url, @status, @purchased_at, datetime('now'), datetime('now'))`
  ).run({ ...customerData, id });

  logAudit(id, 'lead_purchased', 'Lead added — Goat Leads webhook');
  return NextResponse.json({ ok: true, id, dncMatch: !!dncMatch, receivedFields, mappedFields: map });
}
