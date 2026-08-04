import { describe, it, expect } from 'vitest';
import {
  buildContentFloor,
  buildPersonDescription,
  hasSubstantialText,
  MIN_SUBSTANTIAL_TEXT,
  type ContentFloorInput,
} from './contentFloor';

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

// BIN-656: the person-page equivalent. The defect was ONE sentence reused across
// every /person page with only the name substituted, so these pin uniqueness.
describe('buildPersonDescription — a real Swedish bio wins', () => {
  const longBio =
    'Alicia Vikander är en svensk skådespelare, född i Göteborg. Hon slog igenom i En kunglig affär och belönades med en Oscar för Den danska flickan.';

  it('uses the Swedish biography when it is substantive', () => {
    const description = buildPersonDescription({ name: 'Alicia Vikander', biography: longBio });
    expect(description.startsWith('Alicia Vikander är en svensk skådespelare')).toBe(true);
    expect(description.length).toBeLessThanOrEqual(170);
  });

  it('collapses the hard line breaks TMDB and Wikipedia bios carry', () => {
    const description = buildPersonDescription({
      name: 'Alicia Vikander',
      biography: `Alicia Vikander är en svensk skådespelare, född i Göteborg.\n\nHon slog igenom i En kunglig affär.`,
    });
    expect(description).not.toMatch(/\n/);
    expect(description).toContain('Göteborg. Hon slog igenom');
  });

  // Boundary: MIN_SUBSTANTIAL_TEXT is 60 and the comparison is `>=`. Every other
  // fixture here sits far from the edge, so `>=` → `>` survives them all. This is
  // the one that fails on that mutant.
  it('treats a biography of exactly MIN_SUBSTANTIAL_TEXT characters as substantive', () => {
    const bio = 'Alicia Vikander är en svensk skådespelare, född i Stockholm.';
    // Pinned: if the threshold ever moves, this fixture must move with it or the
    // boundary stops being tested rather than silently starts testing the inside.
    expect(bio.length).toBe(MIN_SUBSTANTIAL_TEXT);

    const description = buildPersonDescription({
      name: 'Alicia Vikander',
      biography: bio,
      role: 'Skådespelare',
      birthYear: '1988',
    });
    expect(description).toBe(bio);
    expect(description).not.toContain('Filmografi');
  });

  it('falls back when the biography is too thin to say anything', () => {
    const description = buildPersonDescription({
      name: 'Alicia Vikander',
      biography: 'Svensk skådespelare.',
      role: 'Skådespelare',
      birthYear: '1988',
    });
    expect(description).toContain('Filmografi');
    expect(description).toContain('född 1988');
  });
});

describe('buildPersonDescription — the generated line is unique per person', () => {
  it('carries role, birth year and birthplace when they are known', () => {
    const description = buildPersonDescription({
      name: 'Alicia Vikander',
      biography: '',
      role: 'Skådespelare',
      birthYear: '1988',
      birthPlace: 'Göteborg, Sverige',
    });
    expect(description).toBe(
      'Alicia Vikander (Skådespelare), född 1988 i Göteborg, Sverige. Filmografi och var titlarna streamas i Sverige.',
    );
  });

  it('separates two people who share a role and a birth year', () => {
    const a = buildPersonDescription({ name: 'Alicia Vikander', role: 'Skådespelare', birthYear: '1988', birthPlace: 'Göteborg' });
    const b = buildPersonDescription({ name: 'Bill Skarsgård', role: 'Skådespelare', birthYear: '1990', birthPlace: 'Vällingby' });
    expect(a).not.toBe(b);
  });

  it('never invents a birth year or birthplace it was not given', () => {
    const description = buildPersonDescription({ name: 'Okänd Person', role: 'Regi' });
    expect(description).toBe('Okänd Person (Regi). Filmografi och var titlarna streamas i Sverige.');
    expect(description).not.toContain('född');
  });

  it('says only where someone is from when the birth year is unknown', () => {
    const description = buildPersonDescription({ name: 'Okänd Person', birthPlace: 'Malmö' });
    expect(description).toContain('från Malmö');
    expect(description).not.toContain('född');
  });

  it('still names the person when nothing but a name is known', () => {
    const description = buildPersonDescription({ name: 'Okänd Person' });
    expect(description.startsWith('Okänd Person.')).toBe(true);
    expect(description.length).toBeLessThanOrEqual(170);
  });
});

// BIN-688: the substance test is now ONE exported predicate, because the page
// clients ask the same question about the visible paragraph that this module asks
// about the meta description. Before, the clients used bare truthiness — so a
// two-word overview stood as body text while the description used the floor.
describe('hasSubstantialText — the single threshold both surfaces read', () => {
  it('accepts text of exactly the threshold and rejects one character less', () => {
    const exact = 'a'.repeat(MIN_SUBSTANTIAL_TEXT);
    expect(hasSubstantialText(exact)).toBe(true);
    expect(hasSubstantialText(exact.slice(0, -1))).toBe(false);
  });

  it('rejects the empty, whitespace-only and missing cases TMDB actually returns', () => {
    // TMDB's sv-SE answer for an untranslated title is '' — not null, not absent.
    expect(hasSubstantialText('')).toBe(false);
    expect(hasSubstantialText('   \n  ')).toBe(false);
    expect(hasSubstantialText(null)).toBe(false);
    expect(hasSubstantialText(undefined)).toBe(false);
  });

  it('counts words, not padding — collapsed whitespace decides', () => {
    // Padding in the MIDDLE, on purpose. Trailing padding would be removed by
    // `.trim()` alone, so a fixture built that way passes with the collapse
    // deleted — the test would carry a name it does not earn. TMDB prose is
    // full of internal double spaces and hard line breaks, which is the case
    // this is actually about.
    const padded = `${'a'.repeat(30)}${' '.repeat(20)}\n\n${'a'.repeat(25)}`;
    expect(padded.length).toBeGreaterThan(MIN_SUBSTANTIAL_TEXT);
    expect(padded.replace(/\s+/g, ' ').length).toBeLessThan(MIN_SUBSTANTIAL_TEXT);
    expect(hasSubstantialText(padded)).toBe(false);
  });

  it('governs the meta description too, so the two halves cannot disagree', () => {
    const thin = 'En kort text.';
    expect(hasSubstantialText(thin)).toBe(false);
    // Same input, same verdict: the generated availability line, not the overview.
    const { description } = buildContentFloor({ ...movieBase, overview: thin });
    expect(description).not.toContain(thin);
    expect(description.startsWith('Inception streamas just nu på Netflix i Sverige.')).toBe(true);
  });

  it('keeps a real overview on one line for the snippet', () => {
    const overview =
      'En skicklig tjuv stjäl företagshemligheter via drömdelningsteknik.\n\nHan får en sista chans.';
    const { description } = buildContentFloor({ ...movieBase, overview });
    expect(description).not.toMatch(/\n/);
    expect(description).toContain('drömdelningsteknik. Han får');
  });
});
