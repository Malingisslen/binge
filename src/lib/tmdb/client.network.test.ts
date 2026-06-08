import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { getMovie, getTVShow, searchMulti } from './client';

// tmdbFetch läser NEXT_PUBLIC_TMDB_API_KEY via getApiKey() och kastar utan den.
// Sätt en dummy — MSW interceptar innan något riktigt nätverksanrop sker, så
// nyckelns värde spelar ingen roll, bara att den finns.
process.env.NEXT_PUBLIC_TMDB_API_KEY = 'test-key';

describe('getMovie', () => {
  it('returns parsed movie data from the default handler', async () => {
    const movie = await getMovie(550);
    expect(movie.id).toBe(1);
    expect(movie.title).toBe('Test Movie');
  });

  it('can be overridden per-test', async () => {
    server.use(
      http.get('https://api.themoviedb.org/3/movie/:id', () =>
        HttpResponse.json({
          id: 550,
          title: 'Fight Club',
          original_title: 'Fight Club',
          overview: 'First rule.',
          release_date: '1999-10-15',
          poster_path: '/poster.jpg',
          backdrop_path: '/backdrop.jpg',
          genres: [{ id: 18, name: 'Drama' }],
          vote_average: 8.8,
          vote_count: 25000,
          runtime: 139,
          status: 'Released',
          'watch/providers': { results: { SE: { flatrate: [] } } },
          recommendations: { results: [] },
          credits: { cast: [], crew: [] },
          videos: { results: [] },
        }),
      ),
    );
    const movie = await getMovie(550);
    expect(movie.id).toBe(550);
    expect(movie.runtime).toBe(139);
  });

  it('throws when TMDB returns a 404', async () => {
    server.use(
      http.get('https://api.themoviedb.org/3/movie/:id', () => new HttpResponse(null, { status: 404 })),
    );
    await expect(getMovie(99999)).rejects.toThrow();
  });
});

describe('getTVShow', () => {
  it('returns parsed TV show data from the default handler', async () => {
    const show = await getTVShow(1396);
    expect(show.id).toBe(1);
    expect(show.status).toBe('Returning Series');
  });
});

describe('searchMulti', () => {
  it('passes query param and returns results', async () => {
    const results = await searchMulti('inception');
    expect(results.results[0].title).toBe('Result for inception');
  });
});
