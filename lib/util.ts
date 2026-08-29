import { randomUUID } from 'crypto';

export function newId(): string {
  return randomUUID();
}

export function fmtMoney(n: number | null | undefined): string {
  const v = n ?? 0;
  const negative = v < 0;
  const abs = Math.abs(v);
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${negative ? '-' : ''}$${s}`;
}

export function fmtMoney0(n: number | null | undefined): string {
  const v = Math.round(n ?? 0);
  return `$${v.toLocaleString('en-US')}`;
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

export function daysSince(dateStr: string): number {
  const then = new Date(dateStr.replace(' ', 'T') + (dateStr.includes('Z') ? '' : 'Z'));
  const now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}

export function hoursSince(dateStr: string): number {
  const then = new Date(dateStr.replace(' ', 'T') + (dateStr.includes('Z') ? '' : 'Z'));
  const now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60));
}

export function leadAgeBucket(dateStr: string): 'fresh' | 'aging_45_90' | 'aging_90_plus' {
  const d = daysSince(dateStr);
  if (d <= 2) return 'fresh';
  if (d <= 90) return 'aging_45_90';
  return 'aging_90_plus';
}

export function leadAgeLabel(dateStr: string): string {
  const d = daysSince(dateStr);
  const h = hoursSince(dateStr);
  if (d < 1) return h <= 1 ? `${h || 1} HOUR OLD` : `${h} HOURS OLD`;
  if (d <= 2) return `${d} DAY${d === 1 ? '' : 'S'} OLD`;
  if (d <= 90) return `${d} DAYS OLD (45-90)`;
  return `${d} DAYS OLD (90+)`;
}

export function statusBadge(status: string, purchasedAt: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    fresh: { label: 'FRESH', color: 'good' },
    working: { label: 'WORKING', color: 'brand' },
    aging_45_90: { label: '45-90 DAY', color: 'warn' },
    aging_90_plus: { label: '90+ DAY', color: 'bad' },
    invalid: { label: 'INVALID', color: 'bad' },
    disputed: { label: 'DISPUTED', color: 'warn' },
    dnc: { label: 'DNC', color: 'bad' },
    sold: { label: 'SOLD', color: 'good' },
    lost: { label: 'LOST', color: 'bad' },
    archived: { label: 'ARCHIVED', color: 'bad' }
  };
  if (status === 'fresh') {
    const h = hoursSince(purchasedAt);
    if (h > 48) return map.aging_45_90;
  }
  return map[status] || { label: status.toUpperCase(), color: 'brand' };
}

// Rough state -> IANA timezone mapping (final-expense book is US-only).
export const STATE_TIMEZONES: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Boise',
  IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago', KS: 'America/Chicago',
  KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York', MD: 'America/New_York',
  MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles',
  NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York',
  NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York', OK: 'America/Chicago',
  OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York',
  SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York',
  WI: 'America/Chicago', WY: 'America/Denver', DC: 'America/New_York'
};

export const US_STATES = Object.keys(STATE_TIMEZONES).sort();

const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC', 'washington dc': 'DC', 'washington d.c.': 'DC'
};

// NANPA area code -> primary state, for the common (non-split, non-overlay)
// codes. This is a best-effort fallback only — cell numbers move with people
// and some codes are shared across state lines — never a substitute for a
// real state value when one is present.
const AREA_CODE_TO_STATE: Record<string, string> = {
  '205': 'AL', '251': 'AL', '256': 'AL', '334': 'AL', '938': 'AL',
  '907': 'AK',
  '480': 'AZ', '520': 'AZ', '602': 'AZ', '623': 'AZ', '928': 'AZ',
  '479': 'AR', '501': 'AR', '870': 'AR',
  '209': 'CA', '213': 'CA', '279': 'CA', '310': 'CA', '323': 'CA', '341': 'CA', '408': 'CA', '415': 'CA',
  '424': 'CA', '442': 'CA', '510': 'CA', '530': 'CA', '559': 'CA', '562': 'CA', '619': 'CA', '626': 'CA',
  '628': 'CA', '650': 'CA', '657': 'CA', '661': 'CA', '669': 'CA', '707': 'CA', '714': 'CA', '747': 'CA',
  '760': 'CA', '805': 'CA', '818': 'CA', '820': 'CA', '831': 'CA', '858': 'CA', '909': 'CA', '916': 'CA',
  '925': 'CA', '949': 'CA', '951': 'CA',
  '303': 'CO', '719': 'CO', '720': 'CO', '970': 'CO', '983': 'CO',
  '203': 'CT', '475': 'CT', '860': 'CT', '959': 'CT',
  '302': 'DE',
  '202': 'DC',
  '239': 'FL', '305': 'FL', '321': 'FL', '352': 'FL', '386': 'FL', '407': 'FL', '561': 'FL', '656': 'FL',
  '689': 'FL', '727': 'FL', '754': 'FL', '772': 'FL', '786': 'FL', '813': 'FL', '850': 'FL', '863': 'FL',
  '904': 'FL', '941': 'FL', '954': 'FL',
  '229': 'GA', '404': 'GA', '470': 'GA', '478': 'GA', '678': 'GA', '706': 'GA', '762': 'GA', '770': 'GA',
  '912': 'GA', '943': 'GA',
  '808': 'HI',
  '208': 'ID', '986': 'ID',
  '217': 'IL', '224': 'IL', '309': 'IL', '312': 'IL', '331': 'IL', '447': 'IL', '464': 'IL', '618': 'IL',
  '630': 'IL', '708': 'IL', '730': 'IL', '773': 'IL', '779': 'IL', '815': 'IL', '847': 'IL', '872': 'IL',
  '219': 'IN', '260': 'IN', '317': 'IN', '463': 'IN', '574': 'IN', '765': 'IN', '812': 'IN', '930': 'IN',
  '319': 'IA', '515': 'IA', '563': 'IA', '641': 'IA', '712': 'IA',
  '316': 'KS', '620': 'KS', '785': 'KS', '913': 'KS',
  '270': 'KY', '364': 'KY', '502': 'KY', '606': 'KY', '859': 'KY',
  '225': 'LA', '318': 'LA', '337': 'LA', '504': 'LA', '985': 'LA',
  '207': 'ME',
  '240': 'MD', '301': 'MD', '410': 'MD', '443': 'MD', '667': 'MD',
  '339': 'MA', '351': 'MA', '413': 'MA', '508': 'MA', '617': 'MA', '774': 'MA', '781': 'MA', '857': 'MA', '978': 'MA',
  '231': 'MI', '248': 'MI', '269': 'MI', '313': 'MI', '517': 'MI', '586': 'MI', '616': 'MI', '734': 'MI',
  '810': 'MI', '906': 'MI', '947': 'MI', '989': 'MI',
  '218': 'MN', '320': 'MN', '507': 'MN', '612': 'MN', '651': 'MN', '763': 'MN', '952': 'MN',
  '228': 'MS', '601': 'MS', '662': 'MS', '769': 'MS',
  '314': 'MO', '417': 'MO', '573': 'MO', '636': 'MO', '660': 'MO', '816': 'MO',
  '406': 'MT',
  '308': 'NE', '402': 'NE', '531': 'NE',
  '702': 'NV', '725': 'NV', '775': 'NV',
  '603': 'NH',
  '201': 'NJ', '551': 'NJ', '609': 'NJ', '640': 'NJ', '732': 'NJ', '848': 'NJ', '856': 'NJ', '862': 'NJ', '908': 'NJ', '973': 'NJ',
  '505': 'NM', '575': 'NM',
  '212': 'NY', '315': 'NY', '332': 'NY', '347': 'NY', '516': 'NY', '518': 'NY', '585': 'NY', '607': 'NY',
  '631': 'NY', '646': 'NY', '680': 'NY', '716': 'NY', '718': 'NY', '838': 'NY', '845': 'NY', '914': 'NY',
  '917': 'NY', '929': 'NY', '934': 'NY',
  '252': 'NC', '336': 'NC', '704': 'NC', '743': 'NC', '828': 'NC', '910': 'NC', '919': 'NC', '980': 'NC', '984': 'NC',
  '701': 'ND',
  '216': 'OH', '220': 'OH', '234': 'OH', '330': 'OH', '380': 'OH', '419': 'OH', '440': 'OH', '513': 'OH',
  '567': 'OH', '614': 'OH', '740': 'OH', '937': 'OH',
  '405': 'OK', '539': 'OK', '580': 'OK', '918': 'OK',
  '458': 'OR', '503': 'OR', '541': 'OR', '971': 'OR',
  '215': 'PA', '223': 'PA', '267': 'PA', '272': 'PA', '412': 'PA', '445': 'PA', '484': 'PA', '570': 'PA',
  '610': 'PA', '717': 'PA', '724': 'PA', '814': 'PA', '878': 'PA',
  '401': 'RI',
  '803': 'SC', '839': 'SC', '843': 'SC', '854': 'SC', '864': 'SC',
  '605': 'SD',
  '423': 'TN', '615': 'TN', '629': 'TN', '731': 'TN', '865': 'TN', '901': 'TN', '931': 'TN',
  '210': 'TX', '214': 'TX', '254': 'TX', '281': 'TX', '325': 'TX', '346': 'TX', '361': 'TX', '409': 'TX',
  '430': 'TX', '432': 'TX', '469': 'TX', '512': 'TX', '682': 'TX', '713': 'TX', '726': 'TX', '737': 'TX',
  '806': 'TX', '817': 'TX', '830': 'TX', '832': 'TX', '903': 'TX', '915': 'TX', '936': 'TX', '940': 'TX',
  '956': 'TX', '972': 'TX', '979': 'TX',
  '385': 'UT', '435': 'UT', '801': 'UT',
  '802': 'VT',
  '276': 'VA', '434': 'VA', '540': 'VA', '571': 'VA', '703': 'VA', '757': 'VA', '804': 'VA',
  '206': 'WA', '253': 'WA', '360': 'WA', '425': 'WA', '509': 'WA', '564': 'WA',
  '304': 'WV', '681': 'WV',
  '262': 'WI', '414': 'WI', '534': 'WI', '608': 'WI', '715': 'WI', '920': 'WI',
  '307': 'WY'
};

// Best-effort state guess from a phone number's area code. Only meant as a
// fallback when the sheet's own state field is missing or unusable — never
// overrides a real value, and is not reliable for a ported/moved cell number.
export function stateFromAreaCode(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '').replace(/^1/, '');
  const areaCode = digits.slice(0, 3);
  return AREA_CODE_TO_STATE[areaCode] || null;
}

// Last 10 digits only, formatting and country code stripped — good enough to
// match a caller ID against a lead's saved phone number regardless of how
// either one is formatted ((555) 123-4567 vs +15551234567 vs 555-123-4567).
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '').slice(-10);
}

// Accepts either a 2-letter code or a full state name (any case) and returns the
// USPS abbreviation, or null if it isn't recognized. Never guess from the first
// two letters of a full name — "Alaska"/"Arizona" would silently collide with
// Alabama/Arkansas's real abbreviations.
export function normalizeState(value: string | null | undefined): string | null {
  const v = (value || '').trim();
  if (!v) return null;
  if (v.length === 2 && US_STATES.includes(v.toUpperCase())) return v.toUpperCase();
  return STATE_NAME_TO_ABBR[v.toLowerCase()] || null;
}

export function looksLikePhone(s: string | null | undefined): boolean {
  const digits = (s || '').replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11;
}

export function looksLikeEmail(s: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim());
}

export function looksLikeDob(s: string | null | undefined): boolean {
  const t = (s || '').trim();
  if (!t) return false;
  // Require an actual date shape (separators or a month name, in either
  // Month-Day-Year or Day-Month-Year order — "12-Apr-1957" is a common
  // Excel export format) before even trying Date parsing — JS treats a bare
  // 1-2 digit number as a two-digit year ("62" -> 1962), which would
  // otherwise make every "age" column value look like a valid DOB.
  const hasDateShape =
    /\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}/.test(t) ||
    /[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}/.test(t) ||
    /\d{1,2}[\s\-\/.]+[A-Za-z]{3,9}\.?[\s\-\/.]+\d{2,4}/.test(t);
  if (!hasDateShape) return false;
  const d = new Date(t);
  if (isNaN(d.getTime())) return false;
  const year = d.getFullYear();
  return year >= 1900 && year <= new Date().getFullYear();
}

export function looksLikeGender(s: string | null | undefined): boolean {
  return ['male', 'female', 'm', 'f'].includes((s || '').trim().toLowerCase());
}

export interface ContactFieldInputs {
  phone: string;
  dob: string;
  age: string;
  email: string;
  gender: string;
  state: string;
}

// Vendor sheets — and, in practice, leads already sitting in the database
// from a bad past import — are inconsistent about which of these columns
// end up where, not just one known shift pattern but any shuffle across
// phone/dob/email/gender/state (sometimes with the real DOB hiding in an
// "age" slot instead). Rather than trust column position, or only recognize
// one specific known shift, this treats every one of these values as an
// unlabeled bag: anything that already matches its own field's shape stays
// put; anything that doesn't gets pooled together with the other misfits
// (age included, since it's never itself stored — only mined for a
// misplaced DOB) and handed to whichever field actually needs a value
// matching its shape. If a field's own value doesn't fit anywhere AND
// nothing claims it away to another field, it's left exactly as it was
// rather than guessed blank — an odd-shaped value (e.g. a gender entry
// outside male/female/m/f) might still be real data, not corruption; it's
// only cleared when something else in the row actually takes its slot.
// Rows that are already aligned correctly pass through completely
// untouched, which is what makes it safe to re-run against every existing
// lead, not just fresh imports.
export function reconcileContactFields(fields: ContactFieldInputs) {
  const { phone, dob, age, email, gender, state } = fields;

  const ownValid = {
    phone: looksLikePhone(phone),
    dob: looksLikeDob(dob),
    email: looksLikeEmail(email),
    gender: looksLikeGender(gender),
    state: !!normalizeState(state)
  };

  const pool: string[] = [];
  if (phone && !ownValid.phone) pool.push(phone);
  if (dob && !ownValid.dob) pool.push(dob);
  if (email && !ownValid.email) pool.push(email);
  if (gender && !ownValid.gender) pool.push(gender);
  if (state && !ownValid.state) pool.push(state);
  if (age) pool.push(age);

  function claim(matches: (v: string) => boolean): string | null {
    const idx = pool.findIndex(matches);
    if (idx === -1) return null;
    return pool.splice(idx, 1)[0];
  }

  function resolve(valid: boolean, original: string, matches: (v: string) => boolean): string {
    if (valid) return original;
    const claimed = claim(matches);
    if (claimed !== null) return claimed;
    // Nothing else fits either. If our own (shape-mismatched) value is
    // still sitting unclaimed in the pool, nobody else needed it — keep it.
    // If it's already gone (another field just claimed it out from under
    // us), returning it here would duplicate it into two fields.
    const idx = pool.indexOf(original);
    if (idx !== -1) {
      pool.splice(idx, 1);
      return original;
    }
    return '';
  }

  return {
    phone: resolve(ownValid.phone, phone, looksLikePhone),
    dob: resolve(ownValid.dob, dob, looksLikeDob),
    email: resolve(ownValid.email, email, looksLikeEmail),
    gender: resolve(ownValid.gender, gender, looksLikeGender),
    state: resolve(ownValid.state, state, (v) => !!normalizeState(v))
  };
}

// Lead sheets often give coverage as a range or a bound ("$10k - $25k",
// "$25,001 - $50,000", "Less than $250,000") rather than a single number.
// Returns the average of every number found (a single number if there's only
// one), with "k" suffixes expanded, or null if nothing numeric is present.
export function parseCoverageRange(text: string | null | undefined): number | null {
  if (!text) return null;
  const matches = text.match(/[\d,]+(\.\d+)?\s*[kK]?/g);
  if (!matches) return null;
  const numbers = matches
    .map((m) => {
      const isK = /[kK]\s*$/.test(m);
      const digits = parseFloat(m.replace(/[,kK\s]/g, ''));
      return isNaN(digits) ? null : digits * (isK ? 1000 : 1);
    })
    .filter((n): n is number => n !== null && n > 0);
  if (numbers.length === 0) return null;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

export function localTimeForState(state: string | null): string {
  const tz = (state && STATE_TIMEZONES[state]) || 'America/New_York';
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz
    }).format(new Date());
  } catch {
    return '—';
  }
}

// Federal TCPA/TSR floor: 8am-9pm in the called party's local time, every
// day. A number of states impose their own narrower "mini-TCPA" windows on
// top of that floor — those live in CALL_WINDOW_OVERRIDES below. Sourced
// from each state's telemarketing statute as of 2026; holiday-specific bans
// (e.g. Rhode Island) aren't modeled here, only day-of-week + hour.
export const CALL_WINDOW_START_HOUR = 8;
export const CALL_WINDOW_END_HOUR = 21;

interface CallWindowRule {
  start: number;
  end: number;
  saturdayStart?: number;
  saturdayEnd?: number;
  sundayStart?: number;
  sundayEnd?: number;
  sundayClosed?: boolean;
}

const CALL_WINDOW_OVERRIDES: Record<string, CallWindowRule> = {
  FL: { start: 8, end: 20, sundayClosed: true }, // Fla. Stat. 501.616
  AL: { start: 8, end: 20, sundayClosed: true },
  MD: { start: 8, end: 20 }, // Md. Com. Law 14-4502(c)
  OK: { start: 8, end: 20 }, // Okla. Stat. tit. 15 Section 775A.6
  CT: { start: 9, end: 20 }, // Conn. Gen. Stat., SB 1058 (2023)
  NV: { start: 9, end: 20 },
  NJ: { start: 9, end: 20 }, // N.J.S.A. 56:8-130
  TX: { start: 9, end: 21, sundayStart: 12, sundayEnd: 21 }, // Tex. Bus. & Com. Code 301.051
  RI: { start: 9, end: 18, saturdayStart: 10, saturdayEnd: 17, sundayClosed: true }
};

const WEEKDAY_FMT_CACHE = new Map<string, Intl.DateTimeFormat>();
function weekdayHourMinute(tz: string, reference: Date): { weekday: string; hour: number; minute: number } {
  let fmt = WEEKDAY_FMT_CACHE.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short', timeZone: tz });
    WEEKDAY_FMT_CACHE.set(tz, fmt);
  }
  const parts = fmt.formatToParts(reference);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  const weekday = parts.find((p) => p.type === 'weekday')?.value || '';
  return { weekday, hour, minute };
}

// Resolves a state's rule down to "today's" actual start/end/closed, since
// several states carry different Saturday or Sunday hours.
function todaysWindow(rule: CallWindowRule, weekday: string): { start: number; end: number; closed: boolean } {
  if (weekday === 'Sun') {
    if (rule.sundayClosed) return { start: 0, end: 0, closed: true };
    return { start: rule.sundayStart ?? rule.start, end: rule.sundayEnd ?? rule.end, closed: false };
  }
  if (weekday === 'Sat' && (rule.saturdayStart !== undefined || rule.saturdayEnd !== undefined)) {
    return { start: rule.saturdayStart ?? rule.start, end: rule.saturdayEnd ?? rule.end, closed: false };
  }
  return { start: rule.start, end: rule.end, closed: false };
}

function callWindowRuleFor(state: string | null): CallWindowRule {
  return (state && CALL_WINDOW_OVERRIDES[state]) || { start: CALL_WINDOW_START_HOUR, end: CALL_WINDOW_END_HOUR };
}

export function isWithinCallingHours(state: string | null, reference: Date = new Date()): boolean {
  const tz = (state && STATE_TIMEZONES[state]) || 'America/New_York';
  try {
    const { weekday, hour } = weekdayHourMinute(tz, reference);
    const { start, end, closed } = todaysWindow(callWindowRuleFor(state), weekday);
    if (closed) return false;
    return hour >= start && hour < end;
  } catch {
    return true;
  }
}

// How many minutes remain before this lead's state stops being callable
// today (Infinity if it isn't currently within its window at all — that
// case is handled separately by isWithinCallingHours). Powers Power Dial's
// "closing soon" prioritization: a lead in a state whose window shuts in 20
// minutes is worth calling before one that's open until 9pm, even if the
// latter would otherwise sort first by status.
export function minutesUntilCallingWindowCloses(state: string | null, reference: Date = new Date()): number {
  const tz = (state && STATE_TIMEZONES[state]) || 'America/New_York';
  try {
    const { weekday, hour, minute } = weekdayHourMinute(tz, reference);
    const { end, closed } = todaysWindow(callWindowRuleFor(state), weekday);
    if (closed) return Infinity;
    return (end - hour) * 60 - minute;
  } catch {
    return Infinity;
  }
}

const WEEKDAY_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_FULL: Record<string, string> = {
  Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday'
};

export interface CallingWindowStatus {
  isOpen: boolean;
  label: string;
}

// Tells the agent, in their OWN clock (not the lead's), whether this lead's
// state is callable right now and when that changes — "Open until 6:42 PM
// your time" or "Closed — opens 10:00 AM your time (Monday)". Converts by
// shifting the reference instant by the difference between the lead's local
// hour and the target hour, then formatting that instant in AGENT_TIMEZONE;
// accurate for same-day/next-few-days lookups, which is all this needs.
export function callingWindowStatus(state: string | null, reference: Date = new Date()): CallingWindowStatus {
  const tz = (state && STATE_TIMEZONES[state]) || 'America/New_York';
  try {
    const { weekday, hour, minute } = weekdayHourMinute(tz, reference);
    const rule = callWindowRuleFor(state);
    const today = todaysWindow(rule, weekday);

    function instantAtLeadHour(targetHour: number, dayOffset: number): Date {
      const deltaMinutes = (targetHour - hour) * 60 - minute + dayOffset * 24 * 60;
      return new Date(reference.getTime() + deltaMinutes * 60000);
    }
    function formatAgentTime(d: Date): string {
      return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: AGENT_TIMEZONE }).format(d);
    }

    const isOpenNow = !today.closed && hour >= today.start && hour < today.end;
    if (isOpenNow) {
      return { isOpen: true, label: `Open until ${formatAgentTime(instantAtLeadHour(today.end, 0))} your time` };
    }
    if (!today.closed && hour < today.start) {
      return { isOpen: false, label: `Closed — opens ${formatAgentTime(instantAtLeadHour(today.start, 0))} your time (today)` };
    }

    const todayIdx = WEEKDAY_ORDER.indexOf(weekday);
    for (let i = 1; i <= 7; i++) {
      const nextWeekday = WEEKDAY_ORDER[(todayIdx + i) % 7];
      const nextWindow = todaysWindow(rule, nextWeekday);
      if (!nextWindow.closed) {
        const dayLabel = i === 1 ? 'tomorrow' : WEEKDAY_FULL[nextWeekday];
        return { isOpen: false, label: `Closed — opens ${formatAgentTime(instantAtLeadHour(nextWindow.start, i))} your time (${dayLabel})` };
      }
    }
    return { isOpen: false, label: 'Closed' };
  } catch {
    return { isOpen: true, label: '' };
  }
}

export const AGENT_TIMEZONE = 'America/Boise';

export function agentLocalTime(): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: AGENT_TIMEZONE
  }).format(new Date());
}

const agentDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: AGENT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export function isSameAgentDay(dateStr: string, reference: Date = new Date()): boolean {
  const then = new Date(dateStr.replace(' ', 'T') + (dateStr.includes('Z') ? '' : 'Z'));
  return agentDayFmt.format(then) === agentDayFmt.format(reference);
}

function agentDateParts(reference: Date): { y: number; m: number; d: number } {
  const parts = agentDayFmt.formatToParts(reference);
  return {
    y: Number(parts.find((p) => p.type === 'year')!.value),
    m: Number(parts.find((p) => p.type === 'month')!.value),
    d: Number(parts.find((p) => p.type === 'day')!.value)
  };
}

// Today's calendar date in the agent's timezone, as YYYY-MM-DD.
export function agentDateStr(reference: Date = new Date()): string {
  const { y, m, d } = agentDateParts(reference);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// The Monday (in the agent's timezone) of the week containing `reference`.
export function agentWeekStart(reference: Date = new Date()): string {
  const { y, m, d } = agentDateParts(reference);
  const asUTC = new Date(Date.UTC(y, m - 1, d));
  const weekday = asUTC.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = weekday === 0 ? 6 : weekday - 1;
  asUTC.setUTCDate(asUTC.getUTCDate() - diffToMonday);
  return asUTC.toISOString().slice(0, 10);
}

// 0 (midnight) - 23, in the agent's timezone.
export function agentHour(reference: Date = new Date()): number {
  const hourStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: AGENT_TIMEZONE }).format(reference);
  const hour = Number(hourStr);
  return hour === 24 ? 0 : hour;
}

// 0 (Sunday) - 6 (Saturday), in the agent's timezone.
export function agentWeekday(reference: Date = new Date()): number {
  const { y, m, d } = agentDateParts(reference);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const MAX_CALLS_PER_DAY = 4;

export function callsToday(calls: { occurred_at: string }[]): number {
  return calls.filter((c) => isSameAgentDay(c.occurred_at)).length;
}

export function maskSSN(ssn: string | null | undefined): string {
  if (!ssn) return '';
  const digits = ssn.replace(/\D/g, '');
  if (digits.length < 4) return '•••-••-••••';
  return `•••-••-${digits.slice(-4)}`;
}

export function maskAccount(acct: string | null | undefined): string {
  if (!acct) return '';
  if (acct.length <= 4) return '••••';
  return `••••${acct.slice(-4)}`;
}

export function isValidRoutingNumber(routing: string): boolean {
  const digits = routing.replace(/\D/g, '');
  if (digits.length !== 9) return false;
  // ABA routing number checksum
  const d = digits.split('').map(Number);
  const checksum =
    3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + 1 * (d[2] + d[5] + d[8]);
  return checksum % 10 === 0;
}
