import { Carrier, CarrierRule } from './types';

export interface CarrierSuggestion {
  carrier: Carrier;
  score: number;
  matchedKeywords: string[];
  tierNotes: string[];
  knockout: boolean;
  knockoutReasons: string[];
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

// Splits on sentence/clause boundaries so a negation earlier in the note
// doesn't bleed into an unrelated later clause -- "denies cancer, but has
// diabetes and takes insulin" must still flag diabetes/insulin as present.
function clauseBefore(text: string, index: number): string {
  const start = Math.max(0, index - 60);
  const window = text.slice(start, index);
  const clauses = window.split(/[.!?\n]|,\s*(?:but|however|though)\b|;/i);
  return clauses[clauses.length - 1] || '';
}

// Finds every occurrence of `keyword` as a whole word/phrase (not a bare
// substring -- "ms" alone would otherwise false-match inside "symptoms",
// a real false positive for a Multiple Sclerosis knockout rule) and
// returns true only if at least one occurrence isn't immediately preceded,
// in the same clause, by a negation cue.
function hasGenuineMatch(text: string, keyword: string): boolean {
  if (!keyword) return false;
  const pattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (!NEGATION_CUE.test(clauseBefore(text, match.index))) return true;
    if (match.index === pattern.lastIndex) pattern.lastIndex++; // guard zero-width matches
  }
  return false;
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
      knockoutReasons: []
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
      const hits = keywords.filter((k) => hasGenuineMatch(text, k));
      if (hits.length === 0) continue;

      if (rule.is_knockout) {
        entry.knockout = true;
        entry.knockoutReasons.push(...hits);
      } else {
        entry.score += hits.length * 10 + (rule.priority || 0);
        entry.matchedKeywords.push(...hits);
        if (rule.tier_note) entry.tierNotes.push(rule.tier_note);
      }
    }
  }

  const list = Array.from(byCarrier.values());
  const withMatches = list.filter((e) => e.matchedKeywords.length > 0 && !e.knockout);
  const knockouts = list.filter((e) => e.knockout);
  const noMatch = list.filter((e) => e.matchedKeywords.length === 0 && !e.knockout);

  withMatches.sort((a, b) => b.score - a.score);
  noMatch.sort((a, b) => (a.carrier as any).sort_order - (b.carrier as any).sort_order);

  return [...withMatches, ...noMatch, ...knockouts];
}
