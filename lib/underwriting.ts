import { Carrier, CarrierRule } from './types';

export interface CarrierSuggestion {
  carrier: Carrier;
  score: number;
  matchedKeywords: string[];
  tierNotes: string[];
  knockout: boolean;
  knockoutReasons: string[];
  // Context cues (severity/control, how long ago) pulled from right around
  // each genuine keyword match -- e.g. "diabetes" next to "well controlled"
  // or "3 years ago" reads very differently for underwriting than the bare
  // word alone, and this surfaces that instead of throwing it away.
  qualifierNotes: string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Health notes routinely phrase the ABSENCE of a condition using the same
// word as its presence -- "no history of cancer", "denies diabetes",
// "COPD ruled out", "not currently on oxygen". A plain substring match
// can't tell those apart from the condition actually being present, which
// is exactly backwards for underwriting: it would rank a carrier down (or
// knock them out) for a condition the lead explicitly does NOT have.
const NEGATION_CUE = /\b(no|not|denies|denied|never had|never|negative for|ruled out|without|free of|no hx of|no history of)\b/i;

// "non-" (or "non " / "nonsmoker" solid) is a NEGATION PREFIX directly
// glued to the word it negates -- "non-smoker" -- so it can't be caught by
// NEGATION_CUE, which only matches standalone negation words earlier in
// the clause. Checked separately, immediately before each match, since
// "non" as a normal word boundary match (\bno\b) doesn't fire inside
// "non" (no word boundary between the "o" and the following "n").
const NEGATION_PREFIX = /non[\s-]?$/i;

// Splits on sentence/clause boundaries so a negation earlier in the note
// doesn't bleed into an unrelated later clause -- "denies cancer, but has
// diabetes and takes insulin" must still flag diabetes/insulin as present.
function clauseBefore(text: string, index: number): string {
  const start = Math.max(0, index - 60);
  const window = text.slice(start, index);
  const clauses = window.split(/[.!?\n]|,\s*(?:but|however|though)\b|;/i);
  return clauses[clauses.length - 1] || '';
}

// Finds every genuine (non-negated) occurrence of `keyword` as a whole
// word/phrase -- not a bare substring, since e.g. "ms" alone would
// otherwise false-match inside "symptoms", a real false positive for a
// Multiple Sclerosis knockout rule -- and returns their positions so
// callers can both tell whether it matched at all and inspect the text
// immediately around each real occurrence.
function findGenuineOccurrences(text: string, keyword: string): { index: number; length: number }[] {
  if (!keyword) return [];
  const pattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'gi');
  const occurrences: { index: number; length: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const immediatelyBefore = text.slice(Math.max(0, match.index - 6), match.index);
    const negated = NEGATION_CUE.test(clauseBefore(text, match.index)) || NEGATION_PREFIX.test(immediatelyBefore);
    if (!negated) {
      occurrences.push({ index: match.index, length: match[0].length });
    }
    if (match.index === pattern.lastIndex) pattern.lastIndex++; // guard zero-width matches
  }
  return occurrences;
}

// Underwriting cares a lot about HOW a condition is described, not just
// whether the word appears: "controlled"/"in remission"/"5 years ago"
// reads very differently from "uncontrolled"/"active"/"recently diagnosed"
// for essentially every FE carrier, even without knowing that specific
// carrier's actual guide. These are intentionally general, carrier-agnostic
// underwriting cues (not a specific carrier's rule, which this app has no
// way to know without the agent configuring it) — a nudge to the score
// plus, more importantly, surfaced text so the agent sees the actual
// context instead of just a bare keyword hit.
const FAVORABLE_QUALIFIER = /\b(well[\s-]?controlled|controlled|stable|in\s+remission|remission|resolved|mild|managed|under\s+control)\b/i;
const UNFAVORABLE_QUALIFIER = /\b(uncontrolled|poorly\s+controlled|unstable|severe|active|acute|out\s+of\s+control|worsening|advanced)\b/i;
const REMOTE_TIME = /\b(\d{1,2}\+?\s*years?\s*ago|since\s+(19|20)\d{2}|over\s+\d+\s*years?\s*ago|many\s+years\s+ago)\b/i;
const RECENT_TIME = /\b(recently|this\s+year|last\s+month|a\s+few\s+(weeks|months)\s+ago|newly\s+diagnosed|just\s+diagnosed|new\s+diagnosis|this\s+past\s+month)\b/i;

function qualifiersNear(text: string, occ: { index: number; length: number }): { notes: string[]; adjustment: number } {
  const start = Math.max(0, occ.index - 35);
  const end = Math.min(text.length, occ.index + occ.length + 35);
  const context = text.slice(start, end);
  const notes: string[] = [];
  let adjustment = 0;
  if (FAVORABLE_QUALIFIER.test(context)) { notes.push('controlled/stable'); adjustment += 2; }
  if (UNFAVORABLE_QUALIFIER.test(context)) { notes.push('uncontrolled/severe'); adjustment -= 2; }
  if (REMOTE_TIME.test(context)) { notes.push('longstanding'); adjustment += 1; }
  if (RECENT_TIME.test(context)) { notes.push('recent/new'); adjustment -= 1; }
  return { notes, adjustment };
}

// Tobacco/nicotine status is close to universal across FE carriers'
// rate classes regardless of which carrier ends up written, so it's worth
// surfacing on its own rather than requiring the agent to configure it as
// a per-carrier rule. Negation-aware for the same reason keyword matching
// is above -- "denies tobacco use" is the opposite signal of "smoker".
const TOBACCO_KEYWORDS = ['smoker', 'smoking', 'tobacco', 'nicotine', 'vaping', 'vape', 'cigarettes', 'cigars', 'chewing tobacco', 'snuff'];
export function detectTobaccoUse(healthText: string): boolean {
  const text = (healthText || '').toLowerCase();
  if (!text.trim()) return false;
  return TOBACCO_KEYWORDS.some((k) => findGenuineOccurrences(text, k).length > 0);
}

/**
 * Ranks carriers for a given free-text HEALTH note using the user's own
 * keyword rules (set up per carrier under Manage Carriers). This is a
 * keyword-match heuristic (word-boundary aware, with basic negation
 * detection) to help order who to run the app through first/second/third
 * — it is NOT full underwriting and should always be verified against the
 * carrier's actual field/underwriting guide.
 */
export function suggestCarriers(
  healthText: string,
  carriers: Carrier[],
  rules: CarrierRule[]
): CarrierSuggestion[] {
  const text = (healthText || '').toLowerCase();
  const byCarrier = new Map<string, CarrierSuggestion>();

  for (const carrier of carriers) {
    byCarrier.set(carrier.id, {
      carrier,
      score: 0,
      matchedKeywords: [],
      tierNotes: [],
      knockout: false,
      knockoutReasons: [],
      qualifierNotes: []
    });
  }

  if (text.trim().length > 0) {
    for (const rule of rules) {
      const entry = byCarrier.get(rule.carrier_id);
      if (!entry) continue;
      const keywords = rule.keywords
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      // occurrences (not just a boolean) per keyword -- needed to pull
      // qualifier/timing context from right around each real match.
      const hitEntries = keywords
        .map((k) => ({ keyword: k, occurrences: findGenuineOccurrences(text, k) }))
        .filter((h) => h.occurrences.length > 0);
      if (hitEntries.length === 0) continue;
      const hits = hitEntries.map((h) => h.keyword);

      if (rule.is_knockout) {
        entry.knockout = true;
        entry.knockoutReasons.push(...hits);
        // Never silently downgrade a knockout based on qualifiers like
        // "in remission" or "5 years ago" -- too compliance-sensitive to
        // auto-decide. Still surface the context so the agent can see it
        // and judge for themselves whether it's worth double-checking
        // with the carrier directly, instead of just seeing a bare
        // keyword with no context at all.
        for (const h of hitEntries) {
          const { notes } = qualifiersNear(text, h.occurrences[0]);
          entry.qualifierNotes.push(...notes.map((n) => `${h.keyword}: ${n}`));
        }
      } else {
        // Diminishing returns per additional synonym within the SAME
        // rule -- e.g. keywords "diabetes, diabetic, type 2 diabetes, dm"
        // all matching is one real condition, not 4x the evidence a
        // carrier with a single precise keyword would get for the exact
        // same lead. First hit counts fully; each additional one adds a
        // much smaller amount instead of scaling linearly with how many
        // synonyms happened to be listed.
        let ruleScore = rule.priority || 0;
        hitEntries.forEach((h, i) => {
          ruleScore += i === 0 ? 10 : 3;
          const { notes, adjustment } = qualifiersNear(text, h.occurrences[0]);
          ruleScore += adjustment;
          entry.qualifierNotes.push(...notes.map((n) => `${h.keyword}: ${n}`));
        });
        entry.score += ruleScore;
        entry.matchedKeywords.push(...hits);
        if (rule.tier_note) entry.tierNotes.push(rule.tier_note);
      }
    }
  }

  const list = Array.from(byCarrier.values());
  for (const entry of list) entry.qualifierNotes = Array.from(new Set(entry.qualifierNotes));
  const withMatches = list.filter((e) => e.matchedKeywords.length > 0 && !e.knockout);
  const knockouts = list.filter((e) => e.knockout);
  const noMatch = list.filter((e) => e.matchedKeywords.length === 0 && !e.knockout);

  withMatches.sort((a, b) => b.score - a.score);
  noMatch.sort((a, b) => (a.carrier as any).sort_order - (b.carrier as any).sort_order);

  return [...withMatches, ...noMatch, ...knockouts];
}
