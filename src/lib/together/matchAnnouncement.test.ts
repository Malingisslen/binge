import { describe, it, expect } from 'vitest';
import { nextMatchAnnouncement, INITIAL_MATCH_ANNOUNCEMENT_STATE } from './matchAnnouncement';

const m = (tmdbId: number, title: string) => ({ candidate: { tmdbId, mediaType: 'movie', title } });

describe('nextMatchAnnouncement', () => {
  it('är tyst vid första körningen även med matcher och svepningar', () => {
    const r = nextMatchAnnouncement(INITIAL_MATCH_ANNOUNCEMENT_STATE, [m(1, 'A')], 3);
    expect(r.announcement).toBeNull();
    expect(r.state.baselineSet).toBe(true);
  });

  it('sätter inte baslinjen så länge svepningarna är tomma', () => {
    const r = nextMatchAnnouncement(INITIAL_MATCH_ANNOUNCEMENT_STATE, [], 0);
    expect(r.announcement).toBeNull();
    expect(r.state.baselineSet).toBe(false);
  });

  it('räknar matcher som finns när svepningarna anländer som baslinje, inte som nyheter', () => {
    const empty = nextMatchAnnouncement(INITIAL_MATCH_ANNOUNCEMENT_STATE, [], 0);
    const loaded = nextMatchAnnouncement(empty.state, [m(1, 'A')], 2);
    expect(loaded.announcement).toBeNull();
    const again = nextMatchAnnouncement(loaded.state, [m(1, 'A')], 2);
    expect(again.announcement).toBeNull();
  });

  it('läser upp bara färska matcher', () => {
    const base = nextMatchAnnouncement(INITIAL_MATCH_ANNOUNCEMENT_STATE, [m(1, 'A')], 2).state;
    const r = nextMatchAnnouncement(base, [m(1, 'A'), m(2, 'B')], 3);
    expect(r.announcement).toBe('Ny match: B');
  });

  it('listar flera färska matcher kommaseparerat', () => {
    const base = nextMatchAnnouncement(INITIAL_MATCH_ANNOUNCEMENT_STATE, [], 1).state;
    const first = nextMatchAnnouncement(base, [], 1).state;
    const r = nextMatchAnnouncement(first, [m(1, 'A'), m(2, 'B')], 4);
    expect(r.announcement).toBe('Ny match: A, B');
  });

  it('läser inte upp igen när inget nytt tillkommit', () => {
    const base = nextMatchAnnouncement(INITIAL_MATCH_ANNOUNCEMENT_STATE, [m(1, 'A')], 2).state;
    const r1 = nextMatchAnnouncement(base, [m(1, 'A'), m(2, 'B')], 3);
    const r2 = nextMatchAnnouncement(r1.state, [m(1, 'A'), m(2, 'B')], 4);
    expect(r2.announcement).toBeNull();
  });

  it('skiljer film och serie med samma id', () => {
    const base = nextMatchAnnouncement(INITIAL_MATCH_ANNOUNCEMENT_STATE, [m(1, 'Film')], 2).state;
    const tv = { candidate: { tmdbId: 1, mediaType: 'tv', title: 'Serie' } };
    expect(nextMatchAnnouncement(base, [m(1, 'Film'), tv], 3).announcement).toBe('Ny match: Serie');
  });
});
