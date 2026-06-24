import { describe, it, expect } from 'vitest';
import {
  normalizeQuery,
  validateAndClampFilter,
  extractFilterJson,
  buildGeminiBody,
} from './parseLogic';

describe('normalizeQuery', () => {
  it('lowercases (sv) and collapses whitespace', () => {
    expect(normalizeQuery('  Mysig   KOMEDI \n under 90 ')).toBe('mysig komedi under 90');
  });
});

describe('validateAndClampFilter — trust boundary', () => {
  it('keeps only known fields with valid values', () => {
    expect(validateAndClampFilter({
      mediaType: 'movie', genreIds: [27, 18], mood: 'mysig', runtimeMax: 90,
      providerIds: [8], myProvidersOnly: true, excludeSeen: true, voteAverageMin: 7.5,
      decade: '1980', originalLanguage: 'sv', sortBy: 'vote_average.desc',
    })).toEqual({
      mediaType: 'movie', genreIds: [27, 18], mood: 'mysig', runtimeMax: 90,
      providerIds: [8], myProvidersOnly: true, excludeSeen: true, voteAverageMin: 7.5,
      decade: '1980', originalLanguage: 'sv', sortBy: 'vote_average.desc',
    });
  });

  it('drops unknown fields and invalid enum/id values the model might hallucinate', () => {
    expect(validateAndClampFilter({
      mediaType: 'documentary',          // not movie/tv
      genreIds: [27, 99999, 'x'],        // 99999 not a TMDB id, 'x' not a number
      mood: 'angry',                     // not a real mood
      runtimeMax: 75,                    // not a budget
      providerIds: [8, 12345],           // 12345 unknown provider
      myProvidersOnly: false,            // false = no constraint → dropped
      excludeSeen: 'yes',                // not boolean true
      decade: '1985',                    // not a decade start
      originalLanguage: 'en',            // intentionally unsupported (too broad)
      sortBy: 'popularity.desc',         // default → dropped
      injected: 'evil',                  // unknown key
    })).toEqual({ genreIds: [27], providerIds: [8] });
  });

  it('snaps voteAverageMin to 0.5 steps and drops 0 / sub-0.25 / out-of-range', () => {
    expect(validateAndClampFilter({ voteAverageMin: 7.7 }).voteAverageMin).toBe(7.5);
    expect(validateAndClampFilter({ voteAverageMin: 0 }).voteAverageMin).toBeUndefined();
    expect(validateAndClampFilter({ voteAverageMin: 0.1 }).voteAverageMin).toBeUndefined(); // snaps to 0 → dropped
    expect(validateAndClampFilter({ voteAverageMin: -3 }).voteAverageMin).toBeUndefined();
    expect(validateAndClampFilter({ voteAverageMin: 99 }).voteAverageMin).toBeUndefined();
  });

  it('caps oversized arrays and dedupes', () => {
    const out = validateAndClampFilter({ genreIds: [27, 27, 18, 35, 80, 53, 99, 16] });
    expect(out.genreIds).toHaveLength(5);
    expect(new Set(out.genreIds).size).toBe(5);
  });

  it('returns {} for non-objects', () => {
    expect(validateAndClampFilter(null)).toEqual({});
    expect(validateAndClampFilter('hax')).toEqual({});
    expect(validateAndClampFilter(42)).toEqual({});
  });
});

describe('extractFilterJson', () => {
  it('parses + clamps the model JSON from a generateContent response', () => {
    const api = { candidates: [{ content: { parts: [{ text: '{"genreIds":[27],"mood":"bogus"}' }] } }] };
    expect(extractFilterJson(api)).toEqual({ genreIds: [27] });
  });
  it('returns null on missing text or invalid JSON', () => {
    expect(extractFilterJson({})).toBeNull();
    expect(extractFilterJson({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] })).toBeNull();
  });
});

describe('buildGeminiBody', () => {
  it('includes the system prompt, the user query, and a JSON response schema', () => {
    const body = buildGeminiBody('rolig film');
    const contents = body.contents as { parts: { text: string }[] }[];
    const gen = body.generationConfig as { responseMimeType: string; temperature: number; responseSchema: unknown };
    const sys = body.systemInstruction as { parts: { text: string }[] };
    expect(contents[0].parts[0].text).toBe('rolig film');
    expect(gen.responseMimeType).toBe('application/json');
    expect(gen.temperature).toBe(0);
    expect(gen.responseSchema).toBeDefined(); // without it the model returns free-form JSON
    expect(sys.parts[0].text).toContain('sököversättare');
  });
});
