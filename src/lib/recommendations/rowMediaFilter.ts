import type { RowSpec, MediaTypeFilter } from '@/types';

/**
 * Filtrera bort medie-låsta rader (similar, latest-fav, companion) vars
 * payload-medietyp inte matchar aktivt mediatyp-filter. Andra rad-typer hanterar
 * sin egen mediatyp inifrån (genre-canon/thematic/upcoming gör parallel-fetch;
 * trending/person filtrerar per titel klient-sidigt).
 *
 * Extracted out of RecommendationsHub so each branch is unit-testable without
 * mounting the page (see .claude/rules/code-style.md, test-extraction pattern).
 */
export function rowMatchesMediaFilter(
  spec: RowSpec,
  mediaType: MediaTypeFilter,
  latestFiveStar: { mediaType: 'movie' | 'tv' } | null,
): boolean {
  if (mediaType === 'all') return true;
  if (spec.id.kind === 'similar') return spec.id.mediaType === mediaType;
  if (spec.id.kind === 'latest-fav') return latestFiveStar?.mediaType === mediaType;
  // BIN-583, binding condition from the #28 panel critique: the companion row's
  // PAYLOAD is always a film, even though its anchor is a TV show. Filter on the
  // payload, never the anchor — otherwise "Fortsätter som film" would list films
  // under the "Serier" tab. Explicit branch on purpose: the `return true`
  // fallthrough below would have shown it under both tabs.
  if (spec.id.kind === 'companion') return mediaType === 'movie';
  return true;
}
