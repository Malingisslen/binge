import { describe, it, expect } from 'vitest';
import { buildContentFloor, type ContentFloorInput } from './contentFloor';

// genreIds: 878 Science Fiction, 28 Action, 18 Drama, 53 Thriller, 80 Kriminal
const movieBase: ContentFloorInput = {
  id: 27205,
  kind: 'movie',
  title: 'Inception',
  year: '2010',
  genreIds: [878, 28],
  runtimeMin: 148,
  seasons: null,
  cast: ['Leonardo DiCaprio', 'Joseph Gordon-Levitt'],
  providers: { stream: ['Netflix'], rent: ['SF Anytime'], buy: ['SF Anytime'] },
  overview: '',
};

describe('buildContentFloor — availability (the Swedish wedge, honest)', () => {
  it('states a streaming service in Sweden when one exists', () => {
    const { paragraph } = buildContentFloor(movieBase);
    expect(paragraph).toContain('streama');
    expect(paragraph).toContain('Netflix');
    expect(paragraph).toContain('i Sverige');
  });

  it('never invents availability when there are no providers', () => {
    const { paragraph } = buildContentFloor({
      ...movieBase,
      providers: { stream: [], rent: [], buy: [] },
    });
    expect(paragraph).toContain('ännu inte');
    expect(paragraph).not.toContain('Netflix');
    expect(paragraph).not.toMatch(/streama.* på/);
  });

  it('offers rent/buy wording when nothing streams', () => {
    const { paragraph } = buildContentFloor({
      ...movieBase,
      providers: { stream: [], rent: ['SF Anytime'], buy: ['Google Play'] },
    });
    expect(paragraph).toContain('hyra');
    expect(paragraph).toContain('SF Anytime');
    expect(paragraph).not.toMatch(/streama.* på/);
  });

  it('honesty: only names providers present in the input', () => {
    const { paragraph, description } = buildContentFloor(movieBase);
    expect(paragraph).not.toContain('Viaplay');
    expect(description).not.toContain('Viaplay');
  });

  it('caps the provider list and appends m.fl. beyond three', () => {
    const { paragraph } = buildContentFloor({
      ...movieBase,
      providers: {
        stream: ['Netflix', 'HBO Max', 'Disney+', 'Viaplay', 'SkyShowtime'],
        rent: [],
        buy: [],
      },
    });
    expect(paragraph).toContain('m.fl.');
    expect(paragraph).toContain('Netflix');
    expect(paragraph).not.toContain('SkyShowtime');
  });
});

describe('buildContentFloor — natural Swedish genre phrasing (Content Strategist condition)', () => {
  it('compounds the genre into the noun, never "i genren X"', () => {
    const { paragraph } = buildContentFloor(movieBase);
    expect(paragraph).toContain('science fiction-film');
    expect(paragraph).not.toContain('i genren');
  });

  it('uses the -serie form for TV', () => {
    const { paragraph } = buildContentFloor({
      ...movieBase,
      id: 1399,
      kind: 'tv',
      title: 'Game of Thrones',
      genreIds: [18],
      runtimeMin: null,
      seasons: 8,
    });
    expect(paragraph).toContain('dramaserie');
  });

  it('falls back to a bare noun when the genre is unknown', () => {
    const { paragraph } = buildContentFloor({ ...movieBase, genreIds: [] });
    expect(paragraph).toMatch(/\ben film\b/i); // "en film" / sentence-start "En film"
    expect(paragraph).not.toContain('science fiction'); // genre genuinely dropped
    expect(paragraph).not.toContain('i genren');
  });
});

describe('buildContentFloor — descriptive sentence from real fields', () => {
  it('omits the runtime clause when runtime is unknown', () => {
    const { paragraph } = buildContentFloor({ ...movieBase, runtimeMin: null });
    expect(paragraph).not.toMatch(/\bmin\b/);
  });

  it('uses seasons for TV rather than runtime', () => {
    const { paragraph } = buildContentFloor({
      ...movieBase,
      id: 1399,
      kind: 'tv',
      title: 'Game of Thrones',
      genreIds: [18],
      runtimeMin: null,
      seasons: 8,
    });
    expect(paragraph).toContain('säsong');
    expect(paragraph).not.toMatch(/\bmin\b/);
  });

  it('drops the cast clause gracefully when no cast is known', () => {
    const { paragraph } = buildContentFloor({ ...movieBase, cast: [] });
    expect(paragraph).not.toContain('Leonardo DiCaprio');
    expect(paragraph.length).toBeGreaterThan(0);
  });
});

describe('buildContentFloor — anti-doorway variety + determinism (Growth Marketer condition)', () => {
  it('is deterministic for the same title', () => {
    expect(buildContentFloor(movieBase)).toEqual(buildContentFloor(movieBase));
  });

  it('varies sentence STRUCTURE across titles (≥3 shapes by id)', () => {
    const p0 = buildContentFloor({ ...movieBase, id: 30 }).paragraph;
    const p1 = buildContentFloor({ ...movieBase, id: 31 }).paragraph;
    const p2 = buildContentFloor({ ...movieBase, id: 32 }).paragraph;
    expect(new Set([p0, p1, p2]).size).toBe(3);
  });
});

describe('buildContentFloor — meta description leads with the wedge', () => {
  it('fronts availability so it survives the 170-char cut', () => {
    const { description } = buildContentFloor(movieBase);
    expect(description.startsWith('Inception streamas just nu på Netflix i Sverige.')).toBe(true);
    expect(description.length).toBeLessThanOrEqual(170);
  });

  it('prefers the real overview when it is substantive', () => {
    const overview =
      'En skicklig tjuv som stjäl företagshemligheter via drömdelningsteknik får en sista chans till upprättelse.';
    const { description } = buildContentFloor({ ...movieBase, overview });
    expect(description.startsWith('En skicklig tjuv')).toBe(true);
    expect(description.length).toBeLessThanOrEqual(170);
  });
});
