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

export interface BuildInfo {
  heightInches: number;
  weightLbs: number;
  bmi: number;
}

// "5'9 220", "5'9\" 220 lbs", "5 ft 9 in, 220 pounds", "height 69in weight
// 220lbs" -- height/weight (and the resulting build/BMI) is one of the
// single biggest knockout factors in FE underwriting, and agents often
// jot it straight into the free-text health note rather than a dedicated
// field. Surfacing it (not scoring against it -- this app has no
// per-carrier build chart data) at least puts it in front of the agent
// instead of it sitting unused in a paragraph of prose.
const HEIGHT_FEET_INCHES = /\b(\d)\s*(?:'|feet|ft\.?)\s*(\d{1,2})\s*(?:"|in\.?|inch(?:es)?)?\b/i;
const HEIGHT_INCHES_ONLY = /\bheight[:\s]*(\d{2,3})\s*(?:in\.?|inch(?:es)?)\b/i;
const WEIGHT_LBS = /\b(\d{2,3})\s*(?:lbs?\.?|pounds?)\b/i;

export function extractBuild(healthText: string): BuildInfo | null {
  const text = (healthText || '').toLowerCase();
  if (!text.trim()) return null;

  let heightInches: number | null = null;
  const feetInches = HEIGHT_FEET_INCHES.exec(text);
  if (feetInches) {
    const feet = Number(feetInches[1]);
    const inches = Number(feetInches[2]);
    // A bare "5'9" is almost always height -- but a bare N'M pattern can
    // also just be two unrelated numbers separated by an apostrophe in
    // some other context, so keep this to plausible adult human ranges
    // (4'0"-7'11") rather than accepting anything the regex happens to find.
    if (feet >= 4 && feet <= 7 && inches >= 0 && inches <= 11) heightInches = feet * 12 + inches;
  }
  if (heightInches === null) {
    const inchesOnly = HEIGHT_INCHES_ONLY.exec(text);
    if (inchesOnly) {
      const inches = Number(inchesOnly[1]);
      if (inches >= 48 && inches <= 95) heightInches = inches;
    }
  }

  const weightMatch = WEIGHT_LBS.exec(text);
  const weightLbs = weightMatch ? Number(weightMatch[1]) : null;
  // Plausible adult weight range -- guards against matching an unrelated
  // 2-3 digit number (a dosage, a date fragment) that happens to sit next
  // to "lbs" by coincidence in messy free text.
  if (heightInches === null || weightLbs === null || weightLbs < 70 || weightLbs > 600) return null;

  const bmi = (weightLbs / (heightInches * heightInches)) * 703;
  return { heightInches, weightLbs, bmi: Math.round(bmi * 10) / 10 };
}

// A rule's keywords field can join terms with "+" to require ALL of them
// to genuinely appear (not just any one) -- e.g. "diabetes+neuropathy"
// alongside a separate plain "cancer" entry in the same comma-separated
// list. Existing simple keyword lists ("diabetes, cancer, copd") are
// untouched by this -- a single term with no "+" behaves exactly as
// before. This is the one way this app can express "this specific
// COMBINATION is what actually matters to this carrier," since the
// per-condition rules alone can only ever say "any of these," and real FE
// underwriting very often cares specifically about combinations (a
// standalone condition treated very differently than the same condition
// plus a second one) in a way this app has no way to know generically —
// only the agent configuring their own carrier rules does.
function parseKeywordEntry(entry: string): string[] {
  return entry.split('+').map((p) => p.trim()).filter(Boolean);
}

// A lead with several distinct conditions mentioned can be a materially
// different underwriting case than any one of them alone, even when every
// individual carrier's own rules would each accept it fine on its own --
// this app has no way to know which SPECIFIC combinations any given
// carrier actually treats differently (that's carrier-specific
// underwriting knowledge this data model doesn't capture), so rather than
// guess at that, this just counts how many distinct conditions were
// mentioned at all, as a general "this is a more complex case, look
// closer" signal alongside the ranked list. Dedupes by base keyword (a
// "+"-compound entry's parts each count individually) across every
// carrier's rules combined, since the same real condition is often
// configured under near-identical keywords by more than one carrier.
export function countDistinctConditions(healthText: string, rules: CarrierRule[]): number {
  const text = (healthText || '').toLowerCase();
  if (!text.trim()) return 0;
  const seen = new Set<string>();
  for (const rule of rules) {
    if (rule.is_knockout) continue;
    for (const entry of rule.keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)) {
      for (const part of parseKeywordEntry(entry)) {
        if (findGenuineOccurrences(text, part).length > 0) seen.add(part);
      }
    }
  }
  return seen.size;
}

/**
 * Ranks carriers for a given free-text HEALTH note using the user's own
 * keyword rules (set up per carrier under Manage Carriers). Word-boundary
 * and negation aware ("no history of X" won't count as X being present),
 * pulls severity/timing context from around each match ("controlled" vs
 * "uncontrolled", "years ago" vs "recently"), supports "+"-joined
 * compound keywords for combination-specific rules, and uses
 * diminishing-returns scoring so a verbose synonym list doesn't
 * outweigh a precise one for the same real condition. This is a
 * heuristic to help order who to run the app through first/second/third
 * — it is NOT full underwriting and should always be verified against the
 * carrier's actual field/underwriting guide. See also detectTobaccoUse,
 * extractBuild, and countDistinctConditions for signals surfaced
 * alongside the ranked list rather than folded into any one carrier's score.
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
      const keywordEntries = rule.keywords
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      // Each comma-separated entry can itself be a "+"-joined compound
      // ("diabetes+neuropathy") requiring ALL its parts to genuinely
      // match, not just one -- everything else behaves exactly as a
      // single plain keyword always has. occurrences (not just a boolean)
      // are kept per entry to pull qualifier/timing context from right
      // around the match.
      const hitEntries = keywordEntries
        .map((entry) => {
          const parts = parseKeywordEntry(entry);
          const occurrencesByPart = parts.map((p) => findGenuineOccurrences(text, p));
          if (occurrencesByPart.some((occs) => occs.length === 0)) return null;
          return { keyword: entry, occurrences: occurrencesByPart.map((occs) => occs[0]) };
        })
        .filter((h): h is { keyword: string; occurrences: { index: number; length: number }[] } => h !== null);
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
          for (const occ of h.occurrences) {
            const { notes } = qualifiersNear(text, occ);
            entry.qualifierNotes.push(...notes.map((n) => `${h.keyword}: ${n}`));
          }
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
          // A compound entry ("diabetes+neuropathy") matching all its
          // required parts is much more specific evidence than any single
          // condition alone -- worth extra weight per additional required
          // part, on top of the base diminishing-returns amount.
          const compoundBonus = (h.occurrences.length - 1) * 5;
          ruleScore += (i === 0 ? 10 : 3) + compoundBonus;
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
