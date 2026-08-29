import { Carrier, CarrierRule } from './types';

export interface CarrierSuggestion {
  carrier: Carrier;
  score: number;
  matchedKeywords: string[];
  tierNotes: string[];
  knockout: boolean;
  knockoutReasons: string[];
}

/**
 * Ranks carriers for a given free-text HEALTH note using the user's own
 * keyword rules (set up per carrier under Manage Carriers). This is a
 * simple keyword-match heuristic to help order who to run the app through
 * first/second/third — it is NOT full underwriting and should always be
 * verified against the carrier's actual field/underwriting guide.
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
      const hits = keywords.filter((k) => text.includes(k));
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
