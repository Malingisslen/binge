/**
 * Build-time seed curation for hub-page title grids (SEO internal linking).
 *
 * Hub pages (home guest-landing, /films, /series, /discover) render their
 * grids from client fetches, so the exported static HTML carried zero
 * crawlable <a href> to title pages — the domain's highest-authority pages
 * passed no link equity to the ~25k pre-rendered titles. The fix (proven by
 * /provider/[id], whose build-seeded grid ships 40 crawlable links): fetch
 * one list page at build and seed the client grid's initial state.
 *
 * This helper is the shared curation gate for those seeds (#15 condition:
 * seeds reuse the existing curation pipeline, never a link-count-optimized
 * list):
 *  - stamps `media_type` when the endpoint omits it (/movie|tv/popular)
 *  - drops person results (trending/all includes them)
 *  - drops titles where EITHER display or original title is non-Latin
 *    (`hasNonLatinTitle` — strictly stricter than the SEO pre-render filter
 *    `latinDisplayIds`, so a seeded grid can never link a de-indexed title;
 *    it also matches what home's client-side trending already does)
 *  - caps the list (hubs need ~20 links, not a dump)
 *
 * Pure and network-free on purpose: unit-testable without Firebase/Next.
 */

import type { TMDBSearchResult } from '@/types';
import { isAddableMediaType } from '@/lib/tmdb/client';
import { hasNonLatinTitle } from '@/lib/utils/titleFilter';

const DEFAULT_LIMIT = 20;

export function seedHubItems(
  results: ReadonlyArray<TMDBSearchResult> | undefined,
  opts: { mediaType?: 'movie' | 'tv'; limit?: number } = {},
): TMDBSearchResult[] {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const out: TMDBSearchResult[] = [];
  for (const raw of results ?? []) {
    if (out.length >= limit) break;
    const stamped = opts.mediaType && !raw.media_type ? { ...raw, media_type: opts.mediaType } : raw;
    if (!isAddableMediaType(stamped)) continue;
    if (hasNonLatinTitle(stamped.title ?? stamped.name, stamped.original_title ?? stamped.original_name)) continue;
    out.push(stamped);
  }
  return out;
}
