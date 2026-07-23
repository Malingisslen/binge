/**
 * BIN-135 — per-samling "var streamar de osedda"-sammanfattning.
 *
 * Ren aggregering (testbar). Hämtningen sker lat i CollectionSection (bara när
 * användaren expanderar), capad, och via den delade ['movie-lite', id]-cachen
 * så varje titel hämtas högst en gång per session och återanvänds av
 * kalender/rådgivare. Här bara: ta osedda filmers SE-flatrate-providers +
 * användarens egna tjänster → en sammanfattning UI:t kan formulera.
 */

import { canonicalProviderId, getProvider } from '@/lib/tmdb/providers';
import type { TMDBMovie } from '@/types';

/** Kanoniska SE-abonnemangsleverantörer (flatrate) för en film-lite-detalj. */
export function seFlatrateProviderIds(movie: TMDBMovie | undefined | null): number[] {
  const fr = movie?.['watch/providers']?.results?.SE?.flatrate ?? [];
  return [...new Set(fr.map(p => canonicalProviderId(p.provider_id)))];
}

export interface UnseenFilmProviders {
  tmdbId: number;
  /** Kanoniska SE-flatrate-provider-ids. Tom = finns inte på abonnemang (hyr/köp/saknas). */
  providerIds: number[];
}

export interface CollectionStreamingSummary {
  /** Antal osedda filmer vi faktiskt hämtade providers för (efter cap). */
  considered: number;
  /** Hur många av dem finns på minst en abonnemangstjänst. */
  withAnyProvider: number;
  /** Hur många finns på en tjänst användaren redan har. */
  onYourServices: number;
  /** En tjänst som täcker ALLA osedda (null om ingen enskild gör det). */
  commonProviderId: number | null;
  /** Tjänsten som täcker flest osedda + antalet. */
  topProviderId: number | null;
  topProviderCount: number;
  /** Om top-tjänsten är en användaren redan har (då dubbelräknar UI:t inte). */
  topProviderIsOwned: boolean;
}

export function summarizeCollectionStreaming(
  films: UnseenFilmProviders[],
  myProviderIds: number[],
): CollectionStreamingSummary {
  const considered = films.length;
  const mine = new Set(myProviderIds);
  const counts = new Map<number, number>();
  let withAnyProvider = 0;
  let onYourServices = 0;

  for (const f of films) {
    if (f.providerIds.length > 0) withAnyProvider++;
    if (f.providerIds.some(id => mine.has(id))) onYourServices++;
    for (const id of f.providerIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  // "alla på X" gäller bara om X finns på VARJE osedd film. En film utan
  // providers → tom intersektion → ingen gemensam tjänst (ärligt: inte "alla").
  let commonProviderId: number | null = null;
  if (considered > 0) {
    const intersection = films
      .map(f => new Set(f.providerIds))
      .reduce((acc, s) => new Set([...acc].filter(id => s.has(id))));
    commonProviderId = [...intersection].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0] ?? null;
  }

  let topProviderId: number | null = null;
  let topProviderCount = 0;
  for (const [id, c] of counts) {
    if (c > topProviderCount) { topProviderCount = c; topProviderId = id; }
  }

  return {
    considered,
    withAnyProvider,
    onYourServices,
    commonProviderId,
    topProviderId,
    topProviderCount,
    topProviderIsOwned: topProviderId != null && mine.has(topProviderId),
  };
}

/** Human label for a provider id (short name preferred, then full name). */
export function providerLabel(id: number): string {
  const p = getProvider(id);
  return p?.shortName ?? p?.name ?? 'okänd tjänst';
}

/**
 * One-line Swedish rendering of a CollectionStreamingSummary. Shared by
 * CollectionSection and CompanionSection so the wording (incl. the singular
 * "Finns på X" case) stays in one place. Empty string when nothing considered.
 */
export function streamingSummaryText(s: CollectionStreamingSummary): string {
  if (s.considered === 0) return '';
  if (s.commonProviderId != null) {
    return s.considered === 1
      ? `Finns på ${providerLabel(s.commonProviderId)}`
      : `${s.considered} osedda — alla på ${providerLabel(s.commonProviderId)}`;
  }
  const bits: string[] = [];
  if (s.onYourServices > 0) bits.push(`${s.onYourServices} på tjänster du har`);
  // Visa bara topp-tjänsten om den INTE redan ingår i "tjänster du har" —
  // annars dubbelräknas samma filmer i meningen.
  if (s.topProviderId != null && s.topProviderCount > 0 && !s.topProviderIsOwned) {
    bits.push(`${s.topProviderCount} på ${providerLabel(s.topProviderId)}`);
  }
  const noProv = s.considered - s.withAnyProvider;
  if (noProv > 0) bits.push(`${noProv} att hyra eller saknas`);
  return `${s.considered} osedda — ${bits.join(' · ')}`;
}
