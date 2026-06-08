import { http, HttpResponse } from 'msw';

// Real TMDB base URL — mirrors `BASE_URL` in `src/lib/tmdb/client.ts`.
const TMDB_BASE = 'https://api.themoviedb.org/3';

// Default handlers cover the three fetch wrappers exercised in the network
// tests: getMovie (`/movie/:id`), getTVShow (`/tv/:id`) och searchMulti
// (`/search/multi`). Stub-fälten speglar TMDBMovie/TMDBTVShow/TMDBSearchResponse
// så att klientens cast inte tappar fält som callsites läser. Extend per test
// via `server.use()`.
export const defaultHandlers = [
  http.get(`${TMDB_BASE}/movie/:id`, () =>
    HttpResponse.json({
      id: 1,
      title: 'Test Movie',
      original_title: 'Test Movie',
      overview: 'A test film.',
      release_date: '2024-01-01',
      poster_path: '/poster.jpg',
      backdrop_path: '/backdrop.jpg',
      genres: [],
      vote_average: 7.5,
      vote_count: 100,
      runtime: 120,
      status: 'Released',
      'watch/providers': { results: { SE: { flatrate: [] } } },
      recommendations: { results: [] },
      credits: { cast: [], crew: [] },
      videos: { results: [] },
    }),
  ),
  http.get(`${TMDB_BASE}/tv/:id`, () =>
    HttpResponse.json({
      id: 1,
      name: 'Test Show',
      original_name: 'Test Show',
      overview: 'A test series.',
      first_air_date: '2024-01-01',
      poster_path: '/poster.jpg',
      backdrop_path: '/backdrop.jpg',
      genres: [],
      vote_average: 7.8,
      vote_count: 200,
      number_of_seasons: 2,
      status: 'Returning Series',
      last_episode_to_air: null,
      next_episode_to_air: null,
      seasons: [],
      'watch/providers': { results: { SE: { flatrate: [] } } },
      recommendations: { results: [] },
      credits: { cast: [], crew: [] },
      videos: { results: [] },
      external_ids: {},
    }),
  ),
  http.get(`${TMDB_BASE}/search/multi`, ({ request }) => {
    const query = new URL(request.url).searchParams.get('query') ?? '';
    return HttpResponse.json({
      page: 1,
      total_pages: 1,
      total_results: 1,
      results: [
        {
          id: 42,
          media_type: 'movie',
          title: `Result for ${query}`,
          original_title: `Result for ${query}`,
          poster_path: null,
          backdrop_path: null,
          overview: '',
          vote_average: 6.0,
          genre_ids: [],
          release_date: '2023-05-01',
        },
      ],
    });
  }),
];
