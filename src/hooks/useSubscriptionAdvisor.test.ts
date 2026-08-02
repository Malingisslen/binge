import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  findTopPausable,
  findCatchupCandidate,
  findIdleNextCheckDate,
  getNextAirInfo,
  isWithinDays,
  isUserBehindOnAired,
  isCaughtUpOnEndedShow,
  aggregateAdvisorLoading,
  splitTvByProgress,
  selectBundleSuggestions,
  CATCHUP_THRESHOLD,
} from './useSubscriptionAdvisor.helpers';
import {
  detectBundleArbitrage,
  SWEDISH_BUNDLES,
  type BundleSuggestion,
} from '@/lib/advisor/bundleArbitrage';
import type { CampaignCostSettings } from '@/lib/advisor/effectiveCost';
import type {
  ProviderAdvisory,
  WatchlistItem,
  ActivePause,
  TMDBTVShow,
} from '@/types';

// --- fixtures ---

function makeProvider(overrides: Partial<ProviderAdvisory>): ProviderAdvisory {
  return {
    providerId: 8,
    providerName: 'Netflix',
    shortName: 'Netflix',
    color: '#E50914',
    monthlyCost: 149,
    status: 'active',
    nextAirDate: null,
    shows: [],
    ...overrides,
  };
}

function makePause(overrides: Partial<ActivePause> & Pick<ActivePause, 'providerId' | 'pausedAt'>): ActivePause {
  return {
    providerName: `Provider ${overrides.providerId}`,
    shortName: `P${overrides.providerId}`,
    color: '#000000',
    monthlyCost: 0,
    savingsSoFar: 0,
    resumeAt: null,
    ...overrides,
  };
}

function makeWatchlistItem(overrides: Partial<WatchlistItem>): WatchlistItem {
  return {
    tmdbId: 1,
    mediaType: 'tv',
    status: 'mina',
    rating: null,
    notes: null,
    title: 'A show',
    posterPath: null,
    releaseYear: null,
    totalSeasons: null,
    lastWatchedSeason: null,
    lastWatchedEpisode: null,
    dropped: false,
    rewatchCount: 0,
    providers: [],
    providersCheckedAt: null,
    visibility: null,
    genreIds: [],
    tmdbStatus: null,
    addedAt: new Date(),
    updatedAt: new Date(),
    watchedAt: null,
    ...overrides,
  };
}

// --- splitTvByProgress ---

describe('splitTvByProgress', () => {
  it('delar mina-TV i started (har progress) och unstarted (ej påbörjad)', () => {
    const started = makeWatchlistItem({ tmdbId: 1, lastWatchedSeason: 2, lastWatchedEpisode: 3 });
    const specials = makeWatchlistItem({ tmdbId: 2, lastWatchedSeason: 0, lastWatchedEpisode: 1 });
    const unstarted = makeWatchlistItem({ tmdbId: 3, lastWatchedSeason: null });
    const result = splitTvByProgress([started, specials, unstarted]);
    expect(result.started.map(i => i.tmdbId)).toEqual([1, 2]);
    expect(result.unstarted.map(i => i.tmdbId)).toEqual([3]);
  });

  it('tom lista → två tomma listor', () => {
    expect(splitTvByProgress([])).toEqual({ started: [], unstarted: [] });
  });
});

// --- findTopPausable ---

describe('findTopPausable', () => {
  it('returns nothing when there are no pause candidates', () => {
    const providers = [makeProvider({ status: 'active' })];
    expect(findTopPausable(providers, new Set())).toBeUndefined();
  });

  it('returns the highest-cost pause candidate', () => {
    const providers = [
      makeProvider({ providerId: 8, monthlyCost: 149, status: 'pause' }),
      makeProvider({ providerId: 119, monthlyCost: 69, status: 'pause' }),
      makeProvider({ providerId: 337, monthlyCost: 109, status: 'pause' }),
    ];
    const top = findTopPausable(providers, new Set());
    expect(top?.providerId).toBe(8);
  });

  it('excludes providers the user has already paused', () => {
    const providers = [
      makeProvider({ providerId: 8, monthlyCost: 149, status: 'pause' }),
      makeProvider({ providerId: 119, monthlyCost: 69, status: 'pause' }),
    ];
    const userPaused = new Set([8]);
    const top = findTopPausable(providers, userPaused);
    expect(top?.providerId).toBe(119);
  });

  it('excludes free providers (cost 0)', () => {
    // SVT Play (id 520) is free — shouldn't be suggested for pause.
    const providers = [
      makeProvider({ providerId: 520, monthlyCost: 0, status: 'pause' }),
    ];
    expect(findTopPausable(providers, new Set())).toBeUndefined();
  });

  it('excludes active providers even if they have high cost', () => {
    const providers = [makeProvider({ monthlyCost: 199, status: 'active' })];
    expect(findTopPausable(providers, new Set())).toBeUndefined();
  });
});

// --- findCatchupCandidate ---

describe('findCatchupCandidate', () => {
  function makeShow(tmdbId: number) {
    return {
      tmdbId,
      mediaType: 'tv' as const,
      title: `Show ${tmdbId}`,
      posterPath: null,
      nextAirDate: null,
      nextEpisodeCode: null,
      isEnded: false,
      releaseDate: null,
      providerIds: [],
    };
  }

  it('returns undefined when no provider has enough behind shows', () => {
    const providers = [
      makeProvider({
        status: 'active',
        shows: [makeShow(1), makeShow(2)],
      }),
    ];
    expect(findCatchupCandidate(providers, new Set([1, 2]), new Set())).toBeUndefined();
  });

  it('returns a provider with exactly CATCHUP_THRESHOLD behind shows', () => {
    const providers = [
      makeProvider({
        status: 'active',
        shows: [makeShow(1), makeShow(2), makeShow(3)],
      }),
    ];
    const result = findCatchupCandidate(providers, new Set([1, 2, 3]), new Set());
    expect(result?.unfinishedCount).toBe(3);
  });

  it('picks the provider with the most behind shows when several qualify', () => {
    const providers = [
      makeProvider({
        providerId: 8,
        status: 'active',
        shows: [makeShow(1), makeShow(2), makeShow(3)],
      }),
      makeProvider({
        providerId: 119,
        status: 'active',
        shows: [makeShow(4), makeShow(5), makeShow(6), makeShow(7)],
      }),
    ];
    const result = findCatchupCandidate(providers, new Set([1, 2, 3, 4, 5, 6, 7]), new Set());
    expect(result?.provider.providerId).toBe(119);
    expect(result?.unfinishedCount).toBe(4);
  });

  it('only counts shows whose tmdbId is in the unfinished set', () => {
    const providers = [
      makeProvider({
        status: 'active',
        shows: [makeShow(1), makeShow(2), makeShow(3), makeShow(4)],
      }),
    ];
    // Only 2 of 4 are behind — under threshold.
    expect(findCatchupCandidate(providers, new Set([1, 4]), new Set())).toBeUndefined();
  });

  it('includes paid non-active providers with enough backlog (BIN-17)', () => {
    // A paid service the user is paying for, with 3 unfinished shows but nothing
    // airing soon ('pause'), IS a catchup candidate — "you're paying, catch up".
    const providers = [
      makeProvider({
        providerId: 8,
        status: 'pause',
        shows: [makeShow(1), makeShow(2), makeShow(3)],
      }),
    ];
    const result = findCatchupCandidate(providers, new Set([1, 2, 3]), new Set());
    expect(result?.provider.providerId).toBe(8);
    expect(result?.unfinishedCount).toBe(3);
  });

  it('excludes a provider the user has already paused (BIN-51)', () => {
    // Användaren har pausat tjänst 8 OCH ligger efter på 3 av dess serier
    // (inget airar i fönstret → status 'pause'). Att nudga "ta ikapp på 8"
    // när 8 är medvetet pausad är motsägelsefullt — den får inte bli
    // catchup-kandidat.
    const providers = [
      makeProvider({
        providerId: 8,
        status: 'pause',
        shows: [makeShow(1), makeShow(2), makeShow(3)],
      }),
    ];
    expect(findCatchupCandidate(providers, new Set([1, 2, 3]), new Set([8]))).toBeUndefined();
  });

  it('picks a non-paused provider over a paused one even with more backlog (BIN-51)', () => {
    // Pausad 8 har 4 osedda, aktiv 9 har 3. Den pausade skulle vunnit på
    // backlog — men den är utesluten, så 9 väljs.
    const providers = [
      makeProvider({
        providerId: 8,
        status: 'pause',
        shows: [makeShow(1), makeShow(2), makeShow(3), makeShow(4)],
      }),
      makeProvider({
        providerId: 9,
        status: 'pause',
        shows: [makeShow(5), makeShow(6), makeShow(7)],
      }),
    ];
    const result = findCatchupCandidate(providers, new Set([1, 2, 3, 4, 5, 6, 7]), new Set([8]));
    expect(result?.provider.providerId).toBe(9);
    expect(result?.unfinishedCount).toBe(3);
  });

  it('excludes free providers (no cost to justify catching up to save)', () => {
    const providers = [
      makeProvider({
        providerId: 76,
        status: 'free',
        shows: [makeShow(1), makeShow(2), makeShow(3)],
      }),
    ];
    expect(findCatchupCandidate(providers, new Set([1, 2, 3]), new Set())).toBeUndefined();
  });
});

// --- isUserBehindOnAired ---

describe('isUserBehindOnAired', () => {
  function makeShow(overrides: Partial<TMDBTVShow>): TMDBTVShow {
    return {
      id: 1,
      name: 'Show',
      original_name: 'Show',
      overview: '',
      poster_path: null,
      backdrop_path: null,
      first_air_date: '',
      last_air_date: '',
      vote_average: 0,
      vote_count: 0,
      genres: [],
      number_of_seasons: 1,
      number_of_episodes: 1,
      status: 'Returning Series',
      seasons: [],
      next_episode_to_air: null,
      last_episode_to_air: null,
      ...overrides,
    };
  }
  function makeEpisode(season: number, episode: number) {
    return { id: 1, episode_number: episode, season_number: season, name: '', overview: '', air_date: '2024-01-01', still_path: null, vote_average: 0, runtime: 0 };
  }

  it('returns false when user has never started the show', () => {
    const item = makeWatchlistItem({ lastWatchedSeason: null });
    const show = makeShow({ last_episode_to_air: makeEpisode(2, 5) });
    expect(isUserBehindOnAired(item, show)).toBe(false);
  });

  it('returns false when no episodes have aired yet', () => {
    const item = makeWatchlistItem({ lastWatchedSeason: 1, lastWatchedEpisode: 1 });
    const show = makeShow({ last_episode_to_air: null });
    expect(isUserBehindOnAired(item, show)).toBe(false);
  });

  it('returns true when user is behind on a previous season', () => {
    const item = makeWatchlistItem({ lastWatchedSeason: 1, lastWatchedEpisode: 8 });
    const show = makeShow({ last_episode_to_air: makeEpisode(2, 3) });
    expect(isUserBehindOnAired(item, show)).toBe(true);
  });

  it('returns true when user is behind within the same season', () => {
    const item = makeWatchlistItem({ lastWatchedSeason: 2, lastWatchedEpisode: 1 });
    const show = makeShow({ last_episode_to_air: makeEpisode(2, 5) });
    expect(isUserBehindOnAired(item, show)).toBe(true);
  });

  it('returns false when user has watched up to the latest aired episode', () => {
    const item = makeWatchlistItem({ lastWatchedSeason: 2, lastWatchedEpisode: 5 });
    const show = makeShow({ last_episode_to_air: makeEpisode(2, 5) });
    expect(isUserBehindOnAired(item, show)).toBe(false);
  });

  it('returns false when user is ahead of the latest aired (data anomaly, treat as caught up)', () => {
    const item = makeWatchlistItem({ lastWatchedSeason: 3, lastWatchedEpisode: 1 });
    const show = makeShow({ last_episode_to_air: makeEpisode(2, 5) });
    expect(isUserBehindOnAired(item, show)).toBe(false);
  });

  it('treats season 0 (Specials) progress as started, not "never started" (L3)', () => {
    // lastWatchedSeason === 0 är giltig progress (Specials) och får inte
    // kollapsas med null/"ej börjat". Användaren har sett S0E1 men S1E1 finns.
    const item = makeWatchlistItem({ lastWatchedSeason: 0, lastWatchedEpisode: 1 });
    const show = makeShow({ last_episode_to_air: makeEpisode(1, 1) });
    expect(isUserBehindOnAired(item, show)).toBe(true);
  });

  // BIN-589: TMDB lägger specials i säsong 0 oavsett sändningsdatum, så
  // last_episode_to_air kan peka på ett special som airade EFTER finalen. Rå
  // numerisk jämförelse (`3 < 0`) gjorde då bägge grenarna onåbara → "ikapp".
  it('returns true when the newest aired episode is a Specials the marker cannot prove was seen (BIN-589)', () => {
    const item = makeWatchlistItem({ lastWatchedSeason: 3, lastWatchedEpisode: 10 });
    const show = makeShow({ last_episode_to_air: makeEpisode(0, 4) });
    expect(isUserBehindOnAired(item, show)).toBe(true);
  });

  // Samma spår på båda sidor → vanlig avsnittsjämförelse, oförändrad. Pinnar
  // att BIN-589-fixen inte gjorde "bakom" till ett permanent svar för specials.
  it('compares episodes normally when BOTH the marker and the aired frontier are Specials (BIN-589)', () => {
    const show = makeShow({ last_episode_to_air: makeEpisode(0, 4) });
    const caughtUp = makeWatchlistItem({ lastWatchedSeason: 0, lastWatchedEpisode: 4 });
    const behind = makeWatchlistItem({ lastWatchedSeason: 0, lastWatchedEpisode: 2 });
    expect(isUserBehindOnAired(caughtUp, show)).toBe(false);
    expect(isUserBehindOnAired(behind, show)).toBe(true);
  });

  // BIN-615 — hålet BIN-589 lämnade: bägge sidor på specials-spåret. Frontiern
  // (makeEpisode) sände 2024-01-01, så en säsong med air_date <= det datumet har
  // bevisligen sänts. Setet nedan driver HELA grenen: har numrerat sänt → bakom,
  // har det inte sänt (eller saknar datum/avsnitt) → oförändrat ikapp.
  function makeSeason(seasonNumber: number, airDate: string, episodeCount = 8) {
    return {
      id: 100 + seasonNumber,
      season_number: seasonNumber,
      name: `Säsong ${seasonNumber}`,
      overview: '',
      poster_path: null,
      air_date: airDate,
      episode_count: episodeCount,
    };
  }

  it('returns true for a specials-only viewer once a numbered season has aired (BIN-615)', () => {
    // Sett S0E4 (senaste julspecialen) — men säsong 1 och 2 har sänts och inte
    // ett enda numrerat avsnitt är bockat. "Ikapp" här kan få rådgivaren att
    // föreslå att säga upp tjänsten.
    const item = makeWatchlistItem({ lastWatchedSeason: 0, lastWatchedEpisode: 4 });
    const show = makeShow({
      last_episode_to_air: makeEpisode(0, 4),
      seasons: [makeSeason(0, '2020-12-24', 4), makeSeason(1, '2021-01-05'), makeSeason(2, '2022-01-05')],
    });
    expect(isUserBehindOnAired(item, show)).toBe(true);
  });

  // Boundary: hasAiredNumberedSeason compares `air_date <= airedFrontierDate`, and
  // the frontier here is last_episode_to_air's own date (2024-01-01). The two
  // fixtures either side of it both survive `<=` → `<`; this one does not. Same-day
  // counts as aired, which is what the function's own comment promises.
  it('counts a numbered season that aired ON the frontier date as aired (BIN-615)', () => {
    const item = makeWatchlistItem({ lastWatchedSeason: 0, lastWatchedEpisode: 4 });
    const show = makeShow({
      last_episode_to_air: makeEpisode(0, 4), // air_date 2024-01-01
      seasons: [makeSeason(0, '2023-12-24', 4), makeSeason(1, '2024-01-01')],
    });
    expect(isUserBehindOnAired(item, show)).toBe(true);
  });

  it('keeps "caught up" for a specials viewer when the numbered season has not aired yet (BIN-615)', () => {
    // Försmaks-special före premiären: säsong 1 är annonserad men sänder efter
    // den senaste aireade episoden → inget numrerat att ligga efter på.
    const item = makeWatchlistItem({ lastWatchedSeason: 0, lastWatchedEpisode: 4 });
    const show = makeShow({
      last_episode_to_air: makeEpisode(0, 4), // air_date 2024-01-01
      seasons: [makeSeason(0, '2023-12-24', 4), makeSeason(1, '2024-06-01')],
    });
    expect(isUserBehindOnAired(item, show)).toBe(false);
  });

  it('does not claim "behind" from a numbered season with no air date or no episodes (BIN-615)', () => {
    const item = makeWatchlistItem({ lastWatchedSeason: 0, lastWatchedEpisode: 4 });
    const noDate = makeShow({
      last_episode_to_air: makeEpisode(0, 4),
      seasons: [makeSeason(1, '', 8)],
    });
    const noEpisodes = makeShow({
      last_episode_to_air: makeEpisode(0, 4),
      seasons: [makeSeason(1, '2020-01-01', 0)],
    });
    expect(isUserBehindOnAired(item, noDate)).toBe(false);
    expect(isUserBehindOnAired(item, noEpisodes)).toBe(false);
  });

  it('leaves the numbered track untouched — an aired season 1 does not flip a numbered marker (BIN-615)', () => {
    // Regressionsvakt: BIN-615-grenen får bara gälla när markören ligger på S0.
    const item = makeWatchlistItem({ lastWatchedSeason: 2, lastWatchedEpisode: 5 });
    const show = makeShow({
      last_episode_to_air: makeEpisode(2, 5),
      seasons: [makeSeason(1, '2021-01-05'), makeSeason(2, '2022-01-05')],
    });
    expect(isUserBehindOnAired(item, show)).toBe(false);
  });
});

// --- isCaughtUpOnEndedShow ---
// Settet endedCaughtUpTmdbIds måste betyda EXAKT vad namnet säger: påbörjad,
// ikapp på aireade avsnitt, OCH avslutad serie. Annars flyttar librarySubState
// fel serier till "Avslutade" (collapsed → göms).
describe('isCaughtUpOnEndedShow', () => {
  function makeShow(overrides: Partial<TMDBTVShow>): TMDBTVShow {
    return {
      id: 1, name: 'Show', original_name: 'Show', overview: '', poster_path: null,
      backdrop_path: null, first_air_date: '', last_air_date: '', vote_average: 0,
      vote_count: 0, genres: [], number_of_seasons: 5, number_of_episodes: 50,
      status: 'Ended', seasons: [], next_episode_to_air: null, last_episode_to_air: null,
      ...overrides,
    };
  }
  function makeEpisode(season: number, episode: number) {
    return { id: 1, episode_number: episode, season_number: season, name: '', overview: '', air_date: '2024-01-01', still_path: null, vote_average: 0, runtime: 0 };
  }

  it('returns true when started, caught up to the finale, and the show has ended', () => {
    const item = makeWatchlistItem({ lastWatchedSeason: 5, lastWatchedEpisode: 10 });
    const show = makeShow({ status: 'Ended', last_episode_to_air: makeEpisode(5, 10) });
    expect(isCaughtUpOnEndedShow(item, show)).toBe(true);
  });

  it('returns true for Canceled shows the user is caught up on', () => {
    const item = makeWatchlistItem({ lastWatchedSeason: 2, lastWatchedEpisode: 6 });
    const show = makeShow({ status: 'Canceled', last_episode_to_air: makeEpisode(2, 6) });
    expect(isCaughtUpOnEndedShow(item, show)).toBe(true);
  });

  it('returns false when the user is still behind aired episodes (belongs in Ligger efter, not Avslutade)', () => {
    const item = makeWatchlistItem({ lastWatchedSeason: 1, lastWatchedEpisode: 3 });
    const show = makeShow({ status: 'Ended', last_episode_to_air: makeEpisode(5, 10) });
    expect(isCaughtUpOnEndedShow(item, show)).toBe(false);
  });

  it('returns false when the show has not ended (Returning Series)', () => {
    const item = makeWatchlistItem({ lastWatchedSeason: 2, lastWatchedEpisode: 5 });
    const show = makeShow({ status: 'Returning Series', last_episode_to_air: makeEpisode(2, 5) });
    expect(isCaughtUpOnEndedShow(item, show)).toBe(false);
  });

  it('returns false when last_episode_to_air is missing — no aired-data means caught-up is unprovable (the regression guard)', () => {
    // Ended show utan last_episode_to_air: isUserBehindOnAired returnerar false
    // (saknad aired-data), men vi VET inte att användaren är ikapp. Får inte
    // klassas som avslutad — annars göms en serie man ligger 4 säsonger efter på.
    const item = makeWatchlistItem({ lastWatchedSeason: 1, lastWatchedEpisode: 3 });
    const show = makeShow({ status: 'Ended', last_episode_to_air: null });
    expect(isCaughtUpOnEndedShow(item, show)).toBe(false);
  });

  it('returns false for an Ended show whose newest aired episode is an unproven Specials (BIN-589)', () => {
    // Följdeffekten av BIN-589: utan fixen läste "S3E10 sedd, sist airade = S0E4"
    // som ikapp → serien göms under collapsed "Avslutade" trots ett osett special.
    const item = makeWatchlistItem({ lastWatchedSeason: 3, lastWatchedEpisode: 10 });
    const show = makeShow({ status: 'Ended', last_episode_to_air: makeEpisode(0, 4) });
    expect(isCaughtUpOnEndedShow(item, show)).toBe(false);
  });

  it('returns false for an unstarted show even if ended (belongs in Ej påbörjade)', () => {
    const item = makeWatchlistItem({ lastWatchedSeason: null });
    const show = makeShow({ status: 'Ended', last_episode_to_air: makeEpisode(5, 10) });
    expect(isCaughtUpOnEndedShow(item, show)).toBe(false);
  });

  it('returns false for a specials-only viewer of an ended show whose numbered seasons aired (BIN-615)', () => {
    // Produkteffekten: utan BIN-615 göms en serie där bara julspecialarna är
    // sedda under collapsed "Avslutade" — samma bortgömningsfel som BIN-589.
    const item = makeWatchlistItem({ lastWatchedSeason: 0, lastWatchedEpisode: 4 });
    const show = makeShow({
      status: 'Ended',
      last_episode_to_air: makeEpisode(0, 4), // air_date 2024-01-01
      seasons: [
        { id: 100, season_number: 0, name: 'Specials', overview: '', poster_path: null, air_date: '2020-12-24', episode_count: 4 },
        { id: 101, season_number: 1, name: 'Säsong 1', overview: '', poster_path: null, air_date: '2021-01-05', episode_count: 8 },
      ],
    });
    expect(isCaughtUpOnEndedShow(item, show)).toBe(false);
  });
});

// --- findIdleNextCheckDate ---

describe('findIdleNextCheckDate', () => {
  it('returns the earliest nextAirDate among providers', () => {
    const providers = [
      makeProvider({ providerId: 8, nextAirDate: '2026-06-01' }),
      makeProvider({ providerId: 119, nextAirDate: '2026-05-15' }),
      makeProvider({ providerId: 337, nextAirDate: '2026-07-20' }),
    ];
    expect(findIdleNextCheckDate(providers, [])).toBe('2026-05-15');
  });

  it('returns the earliest resumeAt from active pauses', () => {
    const providers: ProviderAdvisory[] = [];
    const pauses: ActivePause[] = [
      makePause({ providerId: 8, resumeAt: '2026-09-01', pausedAt: '2026-04-01' }),
      makePause({ providerId: 119, resumeAt: '2026-06-15', pausedAt: '2026-04-01' }),
    ];
    expect(findIdleNextCheckDate(providers, pauses)).toBe('2026-06-15');
  });

  it('combines provider dates + pause resumeAt and picks earliest', () => {
    const providers = [makeProvider({ nextAirDate: '2026-07-01' })];
    const pauses: ActivePause[] = [
      makePause({ providerId: 8, resumeAt: '2026-05-01', pausedAt: '2026-04-01' }),
    ];
    expect(findIdleNextCheckDate(providers, pauses)).toBe('2026-05-01');
  });

  it('returns null when there are no dates', () => {
    expect(findIdleNextCheckDate([], [])).toBe(null);
  });

  it('ignores null resumeAt values', () => {
    const pauses: ActivePause[] = [
      makePause({ providerId: 8, resumeAt: null, pausedAt: '2026-04-01' }),
    ];
    expect(findIdleNextCheckDate([], pauses)).toBe(null);
  });
});

// --- getNextAirInfo ---

describe('getNextAirInfo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeShow(overrides: Partial<TMDBTVShow>): TMDBTVShow {
    return {
      id: 1,
      name: 'Show',
      original_name: 'Show',
      overview: '',
      poster_path: null,
      backdrop_path: null,
      first_air_date: '2020-01-01',
      last_air_date: '2025-01-01',
      vote_average: 0,
      vote_count: 0,
      genres: [],
      number_of_seasons: 0,
      number_of_episodes: 0,
      status: 'Returning Series',
      seasons: [],
      next_episode_to_air: null,
      last_episode_to_air: null,
      ...overrides,
    };
  }

  it('returns next_episode_to_air date + code when present', () => {
    const show = makeShow({
      next_episode_to_air: {
        id: 1,
        name: 'Next',
        season_number: 3,
        episode_number: 7,
        air_date: '2026-06-01',
        overview: '',
        still_path: null,
        vote_average: 0,
        runtime: 45,
      },
    });
    const info = getNextAirInfo(show);
    expect(info.date).toBe('2026-06-01');
    expect(info.code).toBe('S03E07');
  });

  it('falls back to future-season premiere when next_episode_to_air is null', () => {
    const show = makeShow({
      next_episode_to_air: null,
      seasons: [
        { id: 1, name: 'S1', season_number: 1, air_date: '2020-01-01', episode_count: 10, overview: '', poster_path: null },
        { id: 2, name: 'S2', season_number: 2, air_date: '2026-09-01', episode_count: 10, overview: '', poster_path: null },
      ],
    });
    const info = getNextAirInfo(show);
    expect(info.date).toBe('2026-09-01');
    expect(info.code).toBe('S02E01');
  });

  it('ignores season 0 (specials) in fallback', () => {
    const show = makeShow({
      next_episode_to_air: null,
      seasons: [
        { id: 0, name: 'Specials', season_number: 0, air_date: '2026-05-01', episode_count: 1, overview: '', poster_path: null },
        { id: 1, name: 'S1', season_number: 1, air_date: '2026-06-01', episode_count: 10, overview: '', poster_path: null },
      ],
    });
    const info = getNextAirInfo(show);
    expect(info.date).toBe('2026-06-01');
    expect(info.code).toBe('S01E01');
  });

  it('returns null/null when nothing is upcoming', () => {
    const show = makeShow({
      next_episode_to_air: null,
      seasons: [
        { id: 1, name: 'S1', season_number: 1, air_date: '2020-01-01', episode_count: 10, overview: '', poster_path: null },
      ],
    });
    const info = getNextAirInfo(show);
    expect(info.date).toBe(null);
    expect(info.code).toBe(null);
  });
});

// --- isWithinDays ---

describe('isWithinDays', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for a date exactly today', () => {
    expect(isWithinDays('2026-04-20', 7)).toBe(true);
  });

  it('returns true for a date within the window', () => {
    expect(isWithinDays('2026-04-25', 7)).toBe(true);
  });

  it('returns true for a date exactly at window end', () => {
    expect(isWithinDays('2026-04-27', 7)).toBe(true);
  });

  it('returns false for a date past the window', () => {
    expect(isWithinDays('2026-04-28', 7)).toBe(false);
  });

  it('returns false for a date in the past', () => {
    expect(isWithinDays('2026-04-19', 7)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isWithinDays(null, 7)).toBe(false);
  });
});

// --- constant sanity ---

describe('CATCHUP_THRESHOLD', () => {
  it('is documented as 3', () => {
    // Locking this in: Changing the threshold is a product decision, not
    // a refactor. The test exists to catch an accidental change.
    expect(CATCHUP_THRESHOLD).toBe(3);
  });
});

// --- aggregateAdvisorLoading (A1/X1: "allt laddat?"-gate) ---

describe('aggregateAdvisorLoading', () => {
  it('is loading while the watchlist snapshot has not arrived (even with zero queries)', () => {
    // useQueries([]) rapporterar "klar" innan watchlist-items hunnit
    // registrera sina TV-detaljqueries — utan watchlist-gaten skulle
    // rådgivaren rendera definitiv rådgivning på noll data.
    expect(aggregateAdvisorLoading(true, [])).toBe(true);
  });

  it('is loading while any detail query is still fetching its first data', () => {
    const queries = [
      { isPending: false, isFetching: false },
      { isPending: true, isFetching: true },
    ];
    expect(aggregateAdvisorLoading(false, queries)).toBe(true);
  });

  it('settles when watchlist is loaded and every query has data', () => {
    const queries = [
      { isPending: false, isFetching: false },
      { isPending: false, isFetching: false },
    ];
    expect(aggregateAdvisorLoading(false, queries)).toBe(false);
  });

  it('settles with no queries once the watchlist is loaded (user without TV-titlar)', () => {
    expect(aggregateAdvisorLoading(false, [])).toBe(false);
  });

  it('treats errored queries as settled (error-state renderas, inte spinner)', () => {
    // En query i error-state är inte pending — den ska inte hålla kvar
    // LoadingView; hasError-flödet tar över.
    const queries = [{ isPending: false, isFetching: false }];
    expect(aggregateAdvisorLoading(false, queries)).toBe(false);
  });

  it('does not block on background refetch of already-cached data (stale-while-revalidate)', () => {
    const queries = [{ isPending: false, isFetching: true }];
    expect(aggregateAdvisorLoading(false, queries)).toBe(false);
  });
});

// BIN-439 — hook-wiring coverage for the advisor's bundleSuggestions memo. The
// engine (detectBundleArbitrage) is exhaustively tested in bundleArbitrage.test.ts;
// these pin the HOOK's two responsibilities that the memo owns and that were
// previously untested: the enabled=false gate, and passing the correct owned-
// provider / cost-settings / bundles / now args into the engine.
describe('selectBundleSuggestions — advisor bundle-arbitrage wiring (BIN-439)', () => {
  const NOW = new Date(2026, 6, 4); // 2026-07-04 local
  const SETTINGS: CampaignCostSettings = {
    providerTiers: { 8: 'standard' },
    providerCosts: { 337: 129 },
    providerCampaigns: {},
  };
  const OWNED = [8, 337, 384];

  // A typed spy standing in for the engine — lets us assert the EXACT args the
  // hook forwards without coupling to catalog tier prices. Typed via the engine's
  // own signature (no `any`) so the CI no-explicit-any gate stays green.
  function makeDetectSpy(ret: BundleSuggestion[] = []) {
    const spy = vi.fn<typeof detectBundleArbitrage>();
    spy.mockReturnValue(ret);
    return spy;
  }

  it('enabled=false → returns [] and never calls the engine (gated library surfaces)', () => {
    const detect = makeDetectSpy();
    const out = selectBundleSuggestions(false, OWNED, SETTINGS, SWEDISH_BUNDLES, NOW, detect);
    expect(out).toEqual([]);
    expect(detect).not.toHaveBeenCalled();
  });

  it('enabled=true → forwards owned providers + cost settings + bundles + now verbatim', () => {
    const detect = makeDetectSpy();
    selectBundleSuggestions(true, OWNED, SETTINGS, SWEDISH_BUNDLES, NOW, detect);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(detect).toHaveBeenCalledWith(OWNED, SETTINGS, SWEDISH_BUNDLES, NOW);
  });

  it('enabled=true → returns the engine result unchanged (no post-processing)', () => {
    const sentinel = [{ bundle: { id: 'x' } }] as unknown as BundleSuggestion[];
    const detect = makeDetectSpy(sentinel);
    expect(selectBundleSuggestions(true, OWNED, SETTINGS, SWEDISH_BUNDLES, NOW, detect)).toBe(sentinel);
  });

  it('default detector IS the real engine — output equals a direct engine call on the same args', () => {
    // Proves the production default param wires to detectBundleArbitrage (not a
    // stub) and that the helper delegates faithfully, without hardcoding catalog
    // prices: whatever the engine returns for these args, the helper must match.
    expect(selectBundleSuggestions(true, OWNED, SETTINGS, SWEDISH_BUNDLES, NOW)).toEqual(
      detectBundleArbitrage(OWNED, SETTINGS, SWEDISH_BUNDLES, NOW),
    );
    // Empty owned set is deterministic (no ≥2 replacements possible → no suggestion).
    expect(selectBundleSuggestions(true, [], {}, SWEDISH_BUNDLES, NOW)).toEqual([]);
  });
});
