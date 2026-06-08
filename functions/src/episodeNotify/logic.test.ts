import { describe, it, expect } from 'vitest';
import {
  airingState, isEndedStatus, isUserBehindOnAired, deriveSubState, shouldNotify,
  type WatchlistLite, type LastEpisode,
} from './logic';

const baseItem: WatchlistLite = {
  uid: 'u1', tmdbId: 100, mediaType: 'tv', status: 'mina', title: 'Show',
  lastWatchedSeason: 2, lastWatchedEpisode: 8, tmdbStatus: 'Returning Series',
};
const lastEp = (id: number, s: number, e: number): LastEpisode => ({ id, season_number: s, episode_number: e });

describe('airingState / isEndedStatus', () => {
  it('ongoing for Returning Series / In Production / Planned', () => {
    expect(airingState('Returning Series')).toBe('ongoing');
    expect(isEndedStatus('Returning Series')).toBe(false);
  });
  it('ended for Ended / Canceled / Cancelled', () => {
    expect(isEndedStatus('Ended')).toBe(true);
    expect(isEndedStatus('Canceled')).toBe(true);
    expect(isEndedStatus('Cancelled')).toBe(true);
  });
  it('not-ended for null', () => { expect(isEndedStatus(null)).toBe(false); });
});
describe('isUserBehindOnAired', () => {
  it('not behind when not started', () => { expect(isUserBehindOnAired({ ...baseItem, lastWatchedSeason: null }, lastEp(1, 2, 8))).toBe(false); });
  it('not behind when no aired episode', () => { expect(isUserBehindOnAired(baseItem, null)).toBe(false); });
  it('behind when season < aired season', () => { expect(isUserBehindOnAired({ ...baseItem, lastWatchedSeason: 1, lastWatchedEpisode: 99 }, lastEp(5, 2, 1))).toBe(true); });
  it('behind when same season, episode < aired', () => { expect(isUserBehindOnAired({ ...baseItem, lastWatchedSeason: 2, lastWatchedEpisode: 7 }, lastEp(5, 2, 8))).toBe(true); });
  it('caught up at the aired episode', () => { expect(isUserBehindOnAired({ ...baseItem, lastWatchedSeason: 2, lastWatchedEpisode: 8 }, lastEp(5, 2, 8))).toBe(false); });
});
describe('deriveSubState', () => {
  it("'ikapp' = caught up + airing", () => { expect(deriveSubState({ ...baseItem, lastWatchedSeason: 2, lastWatchedEpisode: 8 }, 'Returning Series', lastEp(5, 2, 8))).toBe('ikapp'); });
  it("'aktiv' = behind", () => { expect(deriveSubState({ ...baseItem, lastWatchedSeason: 1, lastWatchedEpisode: 1 }, 'Returning Series', lastEp(5, 2, 8))).toBe('aktiv'); });
  it("'avslutad' = caught up + ended", () => { expect(deriveSubState({ ...baseItem, lastWatchedSeason: 2, lastWatchedEpisode: 8 }, 'Ended', lastEp(5, 2, 8))).toBe('avslutad'); });
  it("'none' = not 'mina' or not started", () => {
    expect(deriveSubState({ ...baseItem, status: 'vill_se' }, 'Returning Series', lastEp(5, 2, 8))).toBe('none');
    expect(deriveSubState({ ...baseItem, lastWatchedSeason: null }, 'Returning Series', lastEp(5, 2, 8))).toBe('none');
  });
});
describe('shouldNotify', () => {
  it('true for a new aired episode id', () => { expect(shouldNotify(lastEp(900, 3, 1), 850)).toBe(true); });
  it('false when id equals stored (idempotent)', () => { expect(shouldNotify(lastEp(900, 3, 1), 900)).toBe(false); });
  it('true on first run (no stored id)', () => { expect(shouldNotify(lastEp(900, 3, 1), null)).toBe(true); });
  it('false when no aired episode', () => { expect(shouldNotify(null, 850)).toBe(false); });
});
