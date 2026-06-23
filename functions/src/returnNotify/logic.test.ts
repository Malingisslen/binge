import { describe, it, expect } from 'vitest';
import { isCaughtUp, shouldNotifyReturn, type NextEpisode } from './logic';
import type { WatchlistLite, LastEpisode } from '../episodeNotify/logic';

const item = (o: Partial<WatchlistLite>): WatchlistLite => ({
  uid: 'u1', tmdbId: 100, mediaType: 'tv', status: 'mina', title: 'Severance',
  lastWatchedSeason: 1, lastWatchedEpisode: 9, tmdbStatus: 'Returning Series', ...o,
});
const last = (s: number, e: number): LastEpisode => ({ id: s * 100 + e, season_number: s, episode_number: e });
const next = (o: Partial<NextEpisode>): NextEpisode => ({ id: 201, season_number: 2, episode_number: 1, air_date: '2026-01-17', ...o });

describe('isCaughtUp', () => {
  it("true for 'ikapp' — caught up on a returning show", () => {
    // caught up to S1E9, returning series, last aired S1E9 → ikapp
    expect(isCaughtUp(item({}), 'Returning Series', last(1, 9))).toBe(true);
  });
  it("true for 'avslutad' — caught up on an ended show", () => {
    expect(isCaughtUp(item({}), 'Ended', last(1, 9))).toBe(true);
  });
  it("false for 'aktiv' — behind on aired episodes", () => {
    // last aired S1E10 but user only saw S1E9 → behind → aktiv
    expect(isCaughtUp(item({}), 'Returning Series', last(1, 10))).toBe(false);
  });
  it('false when the user never started (no progress)', () => {
    expect(isCaughtUp(item({ lastWatchedSeason: null, lastWatchedEpisode: null }), 'Returning Series', last(1, 9))).toBe(false);
  });
  it('true between seasons (progress but no aired episode pending — last=null)', () => {
    // caught up to S1E9, nothing currently aired-and-pending → ikapp
    expect(isCaughtUp(item({}), 'Returning Series', null)).toBe(true);
  });
});

describe('shouldNotifyReturn', () => {
  it('true for an unseen season premiere (episode 1)', () => {
    expect(shouldNotifyReturn(next({ id: 201, episode_number: 1 }), null)).toBe(true);
  });
  it('false for a mid-season episode (episode > 1) — episodeReleaseNotify handles those', () => {
    expect(shouldNotifyReturn(next({ id: 205, episode_number: 5 }), null)).toBe(false);
  });
  it('false for a first-ever S1E1 premiere — a never-aired show cannot "return"', () => {
    expect(shouldNotifyReturn(next({ id: 101, season_number: 1, episode_number: 1 }), null)).toBe(false);
  });
  it('false when this premiere was already notified (id dedupe)', () => {
    expect(shouldNotifyReturn(next({ id: 201, episode_number: 1 }), 201)).toBe(false);
  });
  it('true again when a LATER premiere is announced (new id)', () => {
    expect(shouldNotifyReturn(next({ id: 301, season_number: 3, episode_number: 1 }), 201)).toBe(true);
  });
  it('false when there is no next episode', () => {
    expect(shouldNotifyReturn(null, null)).toBe(false);
  });
});
