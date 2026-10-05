// BIN-424 — link data for the /guider hub-of-hubs page. The footer only exposes
// 4 of 24 franchise pages and 4 of 11 "försvinner" pages (Footer.tsx), so the
// rest rely on sitemap discovery alone with ~zero internal links → weak crawl
// equity (same orphaning problem BIN-178 fixed for the /provider pages). This
// hub links EVERY SEO landing page from one indexable page; the footer links to
// the hub, so all of them are one hop from every pre-rendered page's static HTML.
//
// Pure data (no fetching) built straight from the existing constants — kept in a
// helper so hubLinks.test.ts can guard that the hub keeps full coverage when a
// franchise or provider is added.

import { FRANCHISES } from '@/lib/seo/franchises';
import { GENRE_HUBS } from '@/lib/seo/genreHubs';
import { canonicalProviderId, getProvider } from '@/lib/tmdb/providers';
import { SEO_PROVIDER_IDS } from '@/lib/tmdb/seoCoverage';

export interface HubLink {
  href: string;
  label: string;
}

export interface HubSection {
  /** Stable id (for React keys + JSON-LD). */
  id: string;
  heading: string;
  blurb: string;
  links: HubLink[];
}

// Both provider-keyed columns (/provider and /forsvinner) map the same curated
// id set through the same name-resolution — only the path prefix differs. One
// helper keeps them from desyncing (e.g. a future label-fallback change).
function providerKeyedLinks(prefix: 'provider' | 'forsvinner'): HubLink[] {
  return SEO_PROVIDER_IDS.flatMap((pid) => {
    const p = getProvider(pid);
    return p ? [{ href: `/${prefix}/${pid}/`, label: p.shortName || p.name }] : [];
  });
}

/** "Streama på X i Sverige" — one link per curated provider landing page. */
export function providerLinks(): HubLink[] {
  return providerKeyedLinks('provider');
}

/** "Billigaste sättet att se hela X" — one link per curated franchise. */
export function franchiseLinks(): HubLink[] {
  return FRANCHISES.map((f) => ({ href: `/billigaste/${f.slug}/`, label: f.name }));
}

/** "Vad försvinner från X" — one link per curated provider's leaving list. */
export function leavingLinks(): HubLink[] {
  return providerKeyedLinks('forsvinner');
}

/** "Bästa [genre] att streama" (BIN-461) — one link per curated genre hub. */
export function genreLinks(): HubLink[] {
  return GENRE_HUBS.map((g) => ({ href: `/genre/${g.slug}/`, label: g.label }));
}

export function hubSections(): HubSection[] {
  return [
    {
      id: 'streamingtjanster',
      heading: 'Streamingtjänster',
      blurb: 'Vad kan du streama på varje tjänst i Sverige — populära filmer och serier just nu.',
      links: providerLinks(),
    },
    {
      id: 'billigaste',
      heading: 'Billigaste sättet att se',
      blurb: 'Vilken prenumeration som täcker flest filmer i en filmserie — och vad du behöver hyra.',
      links: franchiseLinks(),
    },
    {
      id: 'forsvinner',
      heading: 'Lämnar snart',
      blurb: 'Filmer och serier som snart försvinner från varje tjänst — se dem innan de är borta.',
      links: leavingLinks(),
    },
    {
      id: 'genre',
      heading: 'Bästa per genre',
      blurb: 'Populära filmer och serier genre för genre — och var de streamar i Sverige.',
      links: genreLinks(),
    },
  ];
}

// SEO-4 — links FROM title pages and provider hubs INTO the curated hubs. Each
// returns null for anything outside the pre-rendered set, so a page never links
// to a catch-all URL that serves the noindex shell.

function curatedProviderId(providerId: number): number | null {
  const pid = canonicalProviderId(providerId);
  return SEO_PROVIDER_IDS.includes(pid) ? pid : null;
}

/** `/provider/{id}/` for a curated provider (alias ids resolve), else null. */
export function providerHubHref(providerId: number): string | null {
  const pid = curatedProviderId(providerId);
  return pid === null ? null : `/provider/${pid}/`;
}

/** `/forsvinner/{id}/` for a curated provider (alias ids resolve), else null. */
export function leavingHubHref(providerId: number): string | null {
  const pid = curatedProviderId(providerId);
  return pid === null ? null : `/forsvinner/${pid}/`;
}

/** `/genre/{slug}/` for a TMDB genre id that has a curated hub on this side, else null. */
export function genreHubHref(kind: 'movie' | 'tv', genreId: number): string | null {
  const hub = GENRE_HUBS.find((g) => (kind === 'movie' ? g.movieGenreId : g.tvGenreId) === genreId);
  return hub ? `/genre/${hub.slug}/` : null;
}
