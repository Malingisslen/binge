import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// BIN-460 / BIN-473 — the billigaste page ships a resilient "kommer snart"
// EmptyState (a valid indexable 200) instead of notFound() when zero released
// rows survive the build — a flaked TMDB fetch or an unmapped franchise would
// otherwise advertise a soft-404 on a URL that's already in the sitemap +
// generateStaticParams. This test pins BOTH branches: the empty-vs-populated
// fork on `rows.length === 0`.
//
// The page is a build-time async server component; its only data choke point is
// fetchForBuild (both the collection fetch and each movie-lite fetch go through
// it). Mock that and we control the row count without touching the real TMDB
// client, the on-disk build cache, or the network. Everything else — the real
// franchise catalog, the real provider table, the real franchisePlan verdict —
// runs unmocked so the populated branch exercises the actual render.

const fetchForBuildMock = vi.fn();
vi.mock('@/lib/tmdb/buildFetch', () => ({
  fetchForBuild: (...args: unknown[]) => fetchForBuildMock(...args),
}));

import BilligastePage from './page';

// 'avengers' is a real slug in the curated FRANCHISES catalog, so
// franchiseBySlug resolves and the page never calls notFound() — both branches
// under test are downstream of a valid franchise.
const SLUG = 'avengers';

async function renderPage() {
  const ui = await BilligastePage({ params: Promise.resolve({ slug: SLUG }) });
  render(ui);
}

describe('BilligastePage — empty-vs-populated fork (BIN-460)', () => {
  beforeEach(() => {
    fetchForBuildMock.mockReset();
  });

  it('renders the resilient "kommer snart" EmptyState (not notFound) when zero rows', async () => {
    // Collection resolves but has no parts → no released films → rows.length === 0.
    fetchForBuildMock.mockImplementation(async (kind: string) => {
      if (kind === 'collection') return { parts: [] };
      return {};
    });

    await renderPage();

    // The designed empty state is shown…
    expect(
      screen.getByText('Avengers — streamingläget uppdateras'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Utforska fler streamingguider' }),
    ).toBeInTheDocument();
    // …and the populated verdict block is NOT (this line is unique to it).
    expect(screen.queryByText(/Exakta hyrpriser varierar/)).not.toBeInTheDocument();
  });

  it('renders the populated happy path (verdict + film row) when rows exist', async () => {
    fetchForBuildMock.mockImplementation(async (kind: string, _fetcher: unknown, id: number) => {
      if (kind === 'collection') {
        return {
          parts: [
            {
              id: 24428,
              title: 'The Avengers',
              release_date: '2012-05-04',
              poster_path: '/avengers.jpg',
            },
          ],
        };
      }
      if (kind === 'movie-lite') {
        // Film 24428 streams on Netflix (id 8) in SE → franchisePlan picks it.
        return id === 24428
          ? { 'watch/providers': { results: { SE: { flatrate: [{ provider_id: 8 }] } } } }
          : {};
      }
      return {};
    });

    await renderPage();

    // The real franchisePlan verdict renders Netflix as the single best sub.
    expect(screen.getByText('Netflix (169 kr/mån) täcker 1 av 1 film')).toBeInTheDocument();
    // The film row links to its title page.
    expect(screen.getByText('The Avengers')).toBeInTheDocument();
    // …and the empty branch is NOT taken.
    expect(
      screen.queryByText('Avengers — streamingläget uppdateras'),
    ).not.toBeInTheDocument();
  });
});
