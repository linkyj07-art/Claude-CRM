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
