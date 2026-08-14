import { describe, it, expect } from 'vitest';
import { prioritizeRows, describeCompanionAnchors } from './cascadePrioritizer';
import type { CascadeInput, CompanionAnchor, CompanionAnchorReason } from '@/types';

function emptyInput(): CascadeInput {
  return {
    latestFiveStar: null,
    strongSeeds: [],
    weakSeeds: [],
    recurringPeople: [],
    recurringKeywords: [],
    dominantGenres: [],
    hasMyProviders: false,
    upcomingCount: 0,
    companionAnchors: [],
  };
}

function anchor(
  showTitle: string,
  filmId: number,
  reason: CompanionAnchorReason = 'following',
): CompanionAnchor {
  return {
    showTmdbId: filmId + 1,
    showTitle,
    reason,
    films: [{ mediaType: 'movie', id: filmId, label: `${showTitle}: filmen` }],
  };
}

describe('prioritizeRows', () => {
  it('cold-start: free-public + trending get emitted (free-first above trending)', () => {
    const rows = prioritizeRows(emptyInput());
    // BIN-175: the free public-service lane is always emitted, scored above trending.
    expect(rows.map(r => r.id.kind)).toEqual(['free-public', 'trending']);
  });

  it('BIN-175: free-public lane is always emitted, even with full personalisation', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      latestFiveStar: { tmdbId: 603, mediaType: 'movie', title: 'The Matrix', daysSince: 1 },
      strongSeeds: [{ tmdbId: 603, mediaType: 'movie', rating: 5, title: 'The Matrix', ratedAt: null }],
      dominantGenres: [{ id: 18, count: 5 }],
    };
    const rows = prioritizeRows(inp);
    const free = rows.find(r => r.id.kind === 'free-public');
    expect(free).toBeDefined();
    // Free-first within discovery: above genre-canon + trending...
    const idx = (k: string) => rows.findIndex(r => r.id.kind === k);
    expect(idx('free-public')).toBeLessThan(idx('genre-canon'));
    expect(idx('free-public')).toBeLessThan(idx('trending'));
    // ...but below the personalised latest-fav row.
    expect(idx('latest-fav')).toBeLessThan(idx('free-public'));
  });

  it('emits genre-canon when dominant genres exist', () => {
    const inp = { ...emptyInput(), dominantGenres: [{ id: 18, count: 5 }] };
    const rows = prioritizeRows(inp);
    expect(rows.map(r => r.id.kind).sort()).toEqual(['free-public', 'genre-canon', 'trending']);
  });

  it('places latest-fav (5★ within 30d) at the top with recency-decayed score', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      latestFiveStar: { tmdbId: 603, mediaType: 'movie', title: 'The Matrix', daysSince: 3 },
      strongSeeds: [{ tmdbId: 603, mediaType: 'movie', rating: 5, title: 'The Matrix', ratedAt: null }],
    };
    const rows = prioritizeRows(inp);
    expect(rows[0].id.kind).toBe('latest-fav');
    expect(rows[0].score).toBe(97);
    // BIN-106: the latest-fav seed must NOT also produce a duplicate 'similar' row.
    expect(rows.find(r => r.id.kind === 'similar')).toBeUndefined();
  });

  it('BIN-106: latest-fav seed is excluded from similar rows, other seeds still emit', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      latestFiveStar: { tmdbId: 603, mediaType: 'movie', title: 'The Matrix', daysSince: 3 },
      strongSeeds: [
        { tmdbId: 603, mediaType: 'movie', rating: 5, title: 'The Matrix', ratedAt: null },
        { tmdbId: 27205, mediaType: 'movie', rating: 5, title: 'Inception', ratedAt: null },
      ],
    };
    const rows = prioritizeRows(inp);
    const similars = rows.filter(r => r.id.kind === 'similar');
    // The duplicate (603) is dropped; Inception (a different seed) still gets a row.
    expect(similars.map(r => r.id.kind === 'similar' && r.id.tmdbId)).toEqual([27205]);
  });

  it('BIN-106: same tmdbId but different mediaType is NOT treated as a duplicate', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      latestFiveStar: { tmdbId: 42, mediaType: 'movie', title: 'Same Id Movie', daysSince: 1 },
      strongSeeds: [
        { tmdbId: 42, mediaType: 'tv', rating: 5, title: 'Same Id Show', ratedAt: null },
      ],
    };
    const rows = prioritizeRows(inp);
    const similar = rows.find(r => r.id.kind === 'similar');
    expect(similar?.id.kind === 'similar' && similar.id.tmdbId).toBe(42);
  });

  it('person beats similar at high recurrence', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      strongSeeds: [{ tmdbId: 1, mediaType: 'movie', rating: 5, title: 'Seed A', ratedAt: null }],
      recurringPeople: [{ id: 100, name: 'A', recurrence: 6, knownFor: 'director' }],
    };
    const rows = prioritizeRows(inp);
    const personIdx = rows.findIndex(r => r.id.kind === 'person');
    const similarIdx = rows.findIndex(r => r.id.kind === 'similar');
    expect(personIdx).toBeGreaterThanOrEqual(0);
    expect(personIdx).toBeLessThan(similarIdx);
  });

  it('emits up to 3 similar rows for top strong seeds', () => {
    const seeds = Array.from({ length: 5 }, (_, i) => ({
      tmdbId: i + 1, mediaType: 'movie' as const, rating: 5, title: `Seed ${i + 1}`, ratedAt: null,
    }));
    const rows = prioritizeRows({ ...emptyInput(), strongSeeds: seeds });
    expect(rows.filter(r => r.id.kind === 'similar').length).toBeLessThanOrEqual(3);
  });

  it('upcoming requires myProviders', () => {
    const noProv = prioritizeRows({ ...emptyInput(), upcomingCount: 5 });
    expect(noProv.find(r => r.id.kind === 'upcoming')).toBeUndefined();
    const withProv = prioritizeRows({ ...emptyInput(), hasMyProviders: true, upcomingCount: 5 });
    expect(withProv.find(r => r.id.kind === 'upcoming')).toBeDefined();
  });

  it('B-jobs win tie-breaks against C-jobs at same score', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      hasMyProviders: true,
      upcomingCount: 10, // score = 40
      dominantGenres: [{ id: 18, count: 1 }], // score = 40
    };
    const rows = prioritizeRows(inp);
    const upcomingIdx = rows.findIndex(r => r.id.kind === 'upcoming');
    const genreIdx = rows.findIndex(r => r.id.kind === 'genre-canon');
    expect(upcomingIdx).toBeLessThan(genreIdx);
  });

  it('sorts similar rows in seed-rating order (5★ before 4★)', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      strongSeeds: [
        { tmdbId: 1, mediaType: 'movie', rating: 4, title: 'Fyran', ratedAt: null },
        { tmdbId: 2, mediaType: 'movie', rating: 5, title: 'Femman', ratedAt: null },
      ],
    };
    const rows = prioritizeRows(inp);
    const similars = rows.filter(r => r.id.kind === 'similar');
    expect(similars[0].label).toBe('Liknar Femman');
  });

  it('R2: similar-row headings include the seed title (no duplicate headings at same rating)', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      strongSeeds: [
        { tmdbId: 1, mediaType: 'tv', rating: 5, title: 'Off Campus', ratedAt: null },
        { tmdbId: 2, mediaType: 'tv', rating: 5, title: 'Silo', ratedAt: null },
      ],
    };
    const labels = prioritizeRows(inp).filter(r => r.id.kind === 'similar').map(r => r.label);
    expect(labels).toContain('Liknar Off Campus');
    expect(labels).toContain('Liknar Silo');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('BIN-583: no companion row when the curated map has nothing to offer', () => {
    const rows = prioritizeRows(emptyInput());
    expect(rows.find(r => r.id.kind === 'companion')).toBeUndefined();
  });

  it('BIN-583: emits the companion row only when an anchor exists, carrying its films', () => {
    const a = anchor('Breaking Bad', 559969);
    const rows = prioritizeRows({ ...emptyInput(), companionAnchors: [a] });
    const row = rows.find(r => r.id.kind === 'companion');
    expect(row).toBeDefined();
    expect(row?.rowKey).toBe('companion');
    expect(row?.label).toBe('Fortsätter som film');
    expect(row?.description).toBe('Eftersom du följer Breaking Bad.');
    expect(row?.meta?.companions?.[0].films.map(f => f.id)).toEqual([559969]);
  });

  it('BIN-583: the standfirst lists every anchor in Swedish', () => {
    const rows = prioritizeRows({
      ...emptyInput(),
      companionAnchors: [anchor('Breaking Bad', 1), anchor('Firefly', 2), anchor('Deadwood', 3)],
    });
    const row = rows.find(r => r.id.kind === 'companion');
    expect(row?.description).toBe('Eftersom du följer Breaking Bad, Firefly och Deadwood.');
  });

  it('BIN-583: companion is a flat C-job score, between trending and genre-canon', () => {
    const rows = prioritizeRows({
      ...emptyInput(),
      dominantGenres: [{ id: 18, count: 5 }],
      companionAnchors: [anchor('Breaking Bad', 1)],
    });
    const row = rows.find(r => r.id.kind === 'companion');
    // Curated-set membership is binary, so the score carries no strength signal.
    expect(row?.jtbd).toBe('C');
    expect(row?.score).toBe(35);
    const idx = (k: string) => rows.findIndex(r => r.id.kind === k);
    expect(idx('genre-canon')).toBeLessThan(idx('companion'));
    expect(idx('companion')).toBeLessThan(idx('trending'));
  });

  it('BIN-583: the score does not grow with the number of anchors', () => {
    const one = prioritizeRows({ ...emptyInput(), companionAnchors: [anchor('A', 1)] });
    const many = prioritizeRows({
      ...emptyInput(),
      companionAnchors: [anchor('A', 1), anchor('B', 2), anchor('C', 3)],
    });
    const scoreOf = (rows: ReturnType<typeof prioritizeRows>) =>
      rows.find(r => r.id.kind === 'companion')?.score;
    expect(scoreOf(many)).toBe(scoreOf(one));
  });

  it('BIN-583: a personalised B-job row still outranks the companion row', () => {
    const rows = prioritizeRows({
      ...emptyInput(),
      latestFiveStar: { tmdbId: 603, mediaType: 'movie', title: 'The Matrix', daysSince: 1 },
      companionAnchors: [anchor('Breaking Bad', 1)],
    });
    const idx = (k: string) => rows.findIndex(r => r.id.kind === k);
    expect(idx('latest-fav')).toBeLessThan(idx('companion'));
  });

  it('R4: latest-fav heading names the title instead of a cryptic day count', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      latestFiveStar: { tmdbId: 7, mediaType: 'tv', title: 'Off Campus', daysSince: 21 },
    };
    const row = prioritizeRows(inp).find(r => r.id.kind === 'latest-fav');
    expect(row?.label).toBe('Liknar Off Campus — din senaste 5★');
  });
});


describe('describeCompanionAnchors — the row says WHICH (BIN-811)', () => {
  // If the reason does not change what the user reads, `CompanionAnchor.reason`
  // has no consumer and Malin's option (c) is option (b) with extra steps. These
  // are the four shapes that copy can take. Where it renders is pinned separately
  // in RecRow.whyForRow's own test — `description` reaches the screen in TWO
  // places and an earlier version of this comment claimed one.

  it('all followed — the sentence the row has always had', () => {
    expect(describeCompanionAnchors([anchor('Breaking Bad', 1), anchor('Firefly', 2)]))
      .toBe('Eftersom du följer Breaking Bad och Firefly.');
  });

  it('all finished — a different verb, not the same sentence', () => {
    expect(
      describeCompanionAnchors([
        anchor('Breaking Bad', 1, 'finished'),
        anchor('Firefly', 2, 'finished'),
      ]),
    ).toBe('Eftersom du har sett klart Breaking Bad och Firefly.');
  });

  it('mixed — both groups named, neither absorbed into the other', () => {
    // The case that decides whether the field reached the copy at all: a row that
    // printed one verb for a mixed set would be telling the user something false
    // about one of the two shows.
    expect(
      describeCompanionAnchors([
        anchor('Arkiv X', 1),
        anchor('Breaking Bad', 2, 'finished'),
        anchor('Firefly', 3),
      ]),
    ).toBe('Eftersom du följer Arkiv X och Firefly, och har sett klart Breaking Bad.');
  });

  it('no anchors — empty, because the row is not emitted at all in that case', () => {
    expect(describeCompanionAnchors([])).toBe('');
  });

  it('the emitted row USES it — not just the exported function', () => {
    // Without this the whole thing is dead code: prioritizeRows could keep the old
    // hardcoded "du följer" string and every test above would still pass.
    const rows = prioritizeRows({
      ...emptyInput(),
      companionAnchors: [anchor('Breaking Bad', 1, 'finished')],
    });
    const row = rows.find(r => r.id.kind === 'companion');
    expect(row?.description).toBe('Eftersom du har sett klart Breaking Bad.');
  });
});
