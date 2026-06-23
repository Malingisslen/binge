import { describe, it, expect } from 'vitest';
import { parseSearch, isLowConfidence } from './parseSearch';

describe('parseSearch — dimension extraction', () => {
  it('maps named genres + decade + provider + media type', () => {
    expect(parseSearch('skräckfilm från 80-talet på Netflix')).toEqual({
      mediaType: 'movie', genreIds: [27], decade: '1980', providerIds: [8],
    });
  });

  it('detects exclude-seen across phrasings', () => {
    expect(parseSearch('en serie jag inte sett').excludeSeen).toBe(true);
    expect(parseSearch("a thriller I haven't started").excludeSeen).toBe(true);
    expect(parseSearch('något jag inte börjat på').excludeSeen).toBe(true);
  });

  it('does NOT read "nya filmer" (new releases) as exclude-seen', () => {
    expect(parseSearch('visa nya filmer').excludeSeen).toBeUndefined();
  });

  it('sets a rating floor only on explicit quality words, never on bare "bra"', () => {
    expect(parseSearch('en riktigt bra svensk deckare').voteAverageMin).toBe(8);
    expect(parseSearch('hyllade sci-fi-serier').voteAverageMin).toBe(7.5);
    expect(parseSearch('en bra film ikväll').voteAverageMin).toBeUndefined();
  });

  it('does not treat "max två timmar" / "max 30 min" as the Max service', () => {
    expect(parseSearch('feelgood-film max två timmar').providerIds).toBeUndefined();
    expect(parseSearch('komedi på max 30 min').providerIds).toBeUndefined();
    expect(parseSearch('vad kan jag se på Max ikväll').providerIds).toEqual([384]);
  });

  it('does not read "animerad" as Japanese, but does read "anime"', () => {
    const animerad = parseSearch('en mysig animerad film');
    expect(animerad.originalLanguage).toBeUndefined();
    expect(animerad.genreIds).toEqual([16]);
    expect(parseSearch('japansk anime jag inte börjat på').originalLanguage).toBe('ja');
  });

  it('resolves action/sci-fi genre by media type', () => {
    expect(parseSearch('visa actionfilmer på Netflix').genreIds).toEqual([28]);
    expect(parseSearch('actionäventyr-serie').genreIds).toEqual([10759]); // not [12, 10759]
    expect(parseSearch('hyllade sci-fi-serier').genreIds).toEqual([10765]);
    expect(parseSearch('sci-fi-film från 2010-talet').genreIds).toEqual([878]);
  });

  it('uses mood for feeling words but suppresses spanning when an action-ish genre is named', () => {
    expect(parseSearch('något mysigt att se ikväll')).toEqual({ mood: 'mysig' });
    expect(parseSearch('spänning på TV4 Play')).toEqual({ mood: 'spanning', providerIds: [489] });
    // "spännande äventyr" → adventure genre present → no spanning mood
    expect(parseSearch('spännande äventyr för hela familjen').mood).toBeUndefined();
  });

  it('parses decades incl. 2010-talet and word forms', () => {
    expect(parseSearch('kriminalserie från 90-talet').decade).toBe('1990');
    expect(parseSearch('sci-fi-film från 2010-talet').decade).toBe('2010');
    expect(parseSearch('västern från 70-talet').decade).toBe('1970');
  });

  it('detects ranking intent (sortBy) separately from a rating floor', () => {
    expect(parseSearch('de bäst betygsatta serierna').sortBy).toBe('vote_average.desc');
    expect(parseSearch('bästa dokumentärerna på SVT Play').sortBy).toBe('vote_average.desc');
  });

  it('flags an empty parse as low-confidence (LLM-fallback signal)', () => {
    expect(isLowConfidence(parseSearch('asdf qwerty'))).toBe(true);
    expect(isLowConfidence(parseSearch('skräckfilm'))).toBe(false);
  });
});
