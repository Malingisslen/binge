import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// BIN-461 — the genre page ships a resilient "kommer snart" EmptyState (a valid
// indexable 200) instead of notFound() when both discover fetches come back
// empty (build flake on a sitemap-committed URL — the BIN-460 class), and a
// populated page with machine-readable JSON-LD otherwise. Both branches pinned,
// plus the metadata known/unknown fork (BIN-478 pattern).
//
// The page's only data choke points are discoverMovies/discoverTV — mock those
// and the real GENRE_HUBS config, PageHeader, EmptyState and jsonLd escaping
// all run unmocked.

const discoverMoviesMock = vi.fn();
const discoverTVMock = vi.fn();

vi.mock('@/lib/tmdb/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tmdb/client')>();
  return {
    ...actual,
    discoverMovies: (...args: unknown[]) => discoverMoviesMock(...args),
    discoverTV: (...args: unknown[]) => discoverTVMock(...args),
  };
});

import GenrePage, { generateMetadata, generateStaticParams } from './page';
import { GENRE_HUBS } from '@/lib/seo/genreHubs';

// 'komedi' has BOTH media ids (35/35) so the populated branch exercises the
// Filmer + Serier sections; 'thriller' is movie-only.
const SLUG = 'komedi';

async function renderPage(slug = SLUG) {
  const ui = await GenrePage({ params: Promise.resolve({ slug }) });
  render(ui);
}

describe('GenrePage — empty-vs-populated fork (BIN-460 class)', () => {
  beforeEach(() => {
    discoverMoviesMock.mockReset();
    discoverTVMock.mockReset();
  });

  it('renders the resilient "kommer snart" EmptyState (not notFound) on zero rows', async () => {
    discoverMoviesMock.mockResolvedValue({ results: [] });
    discoverTVMock.mockResolvedValue({ results: [] });

    await renderPage();

    expect(screen.getByText('Komedi — listan uppdateras')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Utforska fler streamingguider' })).toBeInTheDocument();
    // Populated sections are NOT rendered.
    expect(screen.queryByText('Filmer')).not.toBeInTheDocument();
    expect(screen.queryByText('Serier')).not.toBeInTheDocument();

    // The empty branch still emits valid CollectionPage JSON-LD — indexable,
    // not a soft-404. JSON.parse proves the escaped payload round-trips.
    const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    expect(ldScripts).toHaveLength(1);
    const ld = JSON.parse(ldScripts[0].textContent ?? '');
    expect(ld['@type']).toBe('CollectionPage');
    expect(ld.url).toBe('https://binge.nu/genre/komedi/');
  });

  it('renders Filmer + Serier sections and ItemList JSON-LD when rows exist', async () => {
    discoverMoviesMock.mockResolvedValue({
      results: [{ id: 1, title: 'Superkomedin', release_date: '2024-01-05', poster_path: '/p.jpg' }],
    });
    discoverTVMock.mockResolvedValue({
      results: [{ id: 2, name: 'Skrattserien', first_air_date: '2023-03-01', poster_path: null }],
    });

    await renderPage();

    expect(screen.getByText('Filmer')).toBeInTheDocument();
    expect(screen.getByText('Serier')).toBeInTheDocument();
    expect(screen.getByText('Superkomedin')).toBeInTheDocument();
    expect(screen.getByText('Skrattserien')).toBeInTheDocument();
    expect(screen.queryByText('Komedi — listan uppdateras')).not.toBeInTheDocument();

    const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    expect(ldScripts).toHaveLength(2);
    const itemList = JSON.parse(ldScripts[1].textContent ?? '');
    expect(itemList['@type']).toBe('ItemList');
    expect(itemList.itemListElement).toEqual([
      expect.objectContaining({ position: 1, name: 'Superkomedin (2024)', url: 'https://binge.nu/movie/1/' }),
      expect.objectContaining({ position: 2, name: 'Skrattserien (2023)', url: 'https://binge.nu/tv/2/' }),
    ]);
  });

  it('movie-only hubs (thriller) never call discoverTV and skip the Serier section', async () => {
    discoverMoviesMock.mockResolvedValue({
      results: [{ id: 3, title: 'Spänningen', release_date: '2022-09-09', poster_path: null }],
    });

    await renderPage('thriller');

    expect(discoverTVMock).not.toHaveBeenCalled();
    expect(screen.getByText('Filmer')).toBeInTheDocument();
    expect(screen.queryByText('Serier')).not.toBeInTheDocument();
  });

  it('discover queries filter on Swedish streamability — the page promise (BIN-461)', async () => {
    // Without with_watch_monetization_types the list is GLOBAL popularity and
    // "att streama i Sverige" doesn't hold for the top entries. Pin the param
    // so an accidental removal fails loudly.
    discoverMoviesMock.mockResolvedValue({ results: [] });
    discoverTVMock.mockResolvedValue({ results: [] });

    await renderPage();

    for (const mock of [discoverMoviesMock, discoverTVMock]) {
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({
          with_watch_monetization_types: 'flatrate|free|ads|rent|buy',
          with_genres: '35',
          sort_by: 'popularity.desc',
        }),
        expect.anything(),
      );
    }
  });
});

describe('GenrePage — metadata + static params', () => {
  it('known slug → indexable metadata with canonical', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'thriller' }) });
    expect(meta.title).toBe('Bästa thrillers att streama i Sverige just nu');
    expect(meta.alternates?.canonical).toBe('https://binge.nu/genre/thriller/');
    expect(meta.robots).toBeUndefined();
  });

  it('unknown slug → noindex,nofollow with canonical (never inherits root index:true)', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'finns-inte' }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates?.canonical).toBe('https://binge.nu/genre/finns-inte/');
  });

  it('generateStaticParams covers exactly the curated slug set', () => {
    expect(generateStaticParams()).toEqual(GENRE_HUBS.map((g) => ({ slug: g.slug })));
  });
});
