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

  // BIN-295 fix 1: "max <noun>" collocations must not emit the HBO Max provider.
  it('does not read "max poäng/antal/nivå/betyg/gräns" as the Max service', () => {
    expect(parseSearch('ge mig det med max poäng').providerIds).toBeUndefined();
    expect(parseSearch('filmer med max betyg').providerIds).toBeUndefined();
    expect(parseSearch('max antal avsnitt').providerIds).toBeUndefined();
    expect(parseSearch('max nivå av spänning').providerIds).toBeUndefined();
    expect(parseSearch('inom max gräns').providerIds).toBeUndefined();
    // Regression guard: the real provider still resolves.
    expect(parseSearch('vad finns på hbo max').providerIds).toEqual([384]);
    expect(parseSearch('serier på Max').providerIds).toEqual([384]);
  });

  // BIN-295 fix 2: "nordisk"/"nordic" is a region, not a language — it must NOT
  // narrow to a single with_original_language (that drops da/no/fi/is titles).
  it('does not map "nordisk"/"nordic" to a single language, but keeps "svensk" → sv', () => {
    expect(parseSearch('nordisk film').originalLanguage).toBeUndefined();
    expect(parseSearch('nordic noir').originalLanguage).toBeUndefined();
    expect(parseSearch('svensk deckare').originalLanguage).toBe('sv');
    expect(parseSearch('dansk serie').originalLanguage).toBe('da'); // neighbor untouched
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

  it('understands everyday genre synonyms and slang', () => {
    expect(parseSearch('en rysare').genreIds).toEqual([27]);           // skräck
    expect(parseSearch('typ en zombiefilm').genreIds).toEqual([27]);   // skräck
    expect(parseSearch('en kärleksfilm').genreIds).toEqual([10749]);   // romantik
    expect(parseSearch('mysig kärlekshistoria').genreIds).toEqual([10749]);
    expect(parseSearch('en bra true crime-serie').genreIds).toEqual([80]); // krim
  });

  it('recognizes the mainstream non-Nordic languages on Swedish streaming', () => {
    expect(parseSearch('spansk serie').originalLanguage).toBe('es');
    expect(parseSearch('en tysk film').originalLanguage).toBe('de');
    expect(parseSearch('italiensk deckare').originalLanguage).toBe('it');
    expect(parseSearch('rysk dokumentär').originalLanguage).toBe('ru');
    expect(parseSearch('indisk film').originalLanguage).toBe('hi');
    expect(parseSearch('en bollywood-rulle').originalLanguage).toBe('hi');
  });

  it('does not confuse the new languages with the horror synonym "rysare"', () => {
    // "rysare" must NOT read as Russian ('ru' is "rysk")
    expect(parseSearch('en rysare på Netflix').originalLanguage).toBeUndefined();
  });
});

describe('parseSearch — broadened coverage', () => {
  it('maps more genre synonyms/slang', () => {
    expect(parseSearch('en bra spökhistoria').genreIds).toEqual([27]);          // spök → horror
    expect(parseSearch('en slasher').genreIds).toEqual([27]);
    expect(parseSearch('maffiafilm').genreIds).toEqual([80]);                   // maffia → crime
    expect(parseSearch('en polisserie').genreIds).toEqual([80]);
    expect(parseSearch('en spionthriller').genreIds).toEqual([53]);            // spion + thriller → 53 (deduped)
    expect(new Set(parseSearch('en biopic om en musiker').genreIds)).toEqual(new Set([18, 10402])); // biopic→drama, musiker→musik
    expect(parseSearch('en musikal').genreIds).toEqual([10402]);
    expect(parseSearch('superhjältefilm').genreIds).toEqual([28]);             // superhero → action (movie)
    expect(parseSearch('en dystopisk rymdfilm').genreIds).toEqual([878]);      // dystopi/rymd → sci-fi (movie)
    expect(parseSearch('en standup-special').genreIds).toEqual([35]);
  });

  it('combines genres that co-occur', () => {
    expect(new Set(parseSearch('en actionkomedi').genreIds)).toEqual(new Set([28, 35]));
    expect(new Set(parseSearch('en romantisk komedi').genreIds)).toEqual(new Set([10749, 35]));
    expect(new Set(parseSearch('en skräckkomedi').genreIds)).toEqual(new Set([27, 35]));
  });

  it('recognizes more streaming services + aliases', () => {
    expect(parseSearch('finns det på C More?').providerIds).toEqual([489]);     // C More → TV4
    expect(parseSearch('något på dplay').providerIds).toEqual([510]);
  });

  it('recognizes more languages (and labels exist for them)', () => {
    expect(parseSearch('en finsk deckare').originalLanguage).toBe('fi');
    expect(parseSearch('kinesisk actionfilm').originalLanguage).toBe('zh');
    expect(parseSearch('turkisk dramaserie').originalLanguage).toBe('tr');
    expect(parseSearch('en brasiliansk film').originalLanguage).toBe('pt');
    expect(parseSearch('nederländsk thriller').originalLanguage).toBe('nl');
  });

  it('parses more decade forms', () => {
    expect(parseSearch('en film från femtiotalet').decade).toBe('1950');
    expect(parseSearch('serier från 00-talet').decade).toBe('2000');
    expect(parseSearch('20-talet').decade).toBe('2020');
  });

  it('parses more runtime phrasings', () => {
    expect(parseSearch('en halvtimme bara').runtimeMax).toBe(30);
    expect(parseSearch('en och en halv timme').runtimeMax).toBe(90);
    expect(parseSearch('ett par timmar').runtimeMax).toBe(120);
  });

  it('detects more exclude-seen phrasings', () => {
    expect(parseSearch('en osedd pärla').excludeSeen).toBe(true);
    expect(parseSearch('något jag aldrig sett').excludeSeen).toBe(true);
    expect(parseSearch('en film jag missat').excludeSeen).toBe(true);
  });

  it('sets a rating floor for more quality words', () => {
    expect(parseSearch('en oscarsbelönad film').voteAverageMin).toBe(8);
    expect(parseSearch('ett mästerverk').voteAverageMin).toBe(8);
    expect(parseSearch('kritikerrosad serie').voteAverageMin).toBe(8);
  });

  it('detects more mood words and still suppresses spanning when a genre is named', () => {
    expect(parseSearch('något gosigt').mood).toBe('mysig');
    expect(parseSearch('en rolig kväll').mood).toBe('skratta');
    expect(parseSearch('något gripande').mood).toBe('tankvard');
    expect(parseSearch('en nagelbitare').mood).toBe('spanning');
    expect(parseSearch('en intensiv thriller').mood).toBeUndefined(); // thriller genre → spanning suppressed
  });

  it('reads säsong/avsnitt as a series signal', () => {
    expect(parseSearch('en serie med många säsonger').mediaType).toBe('tv');
    expect(parseSearch('korta avsnitt').mediaType).toBe('tv');
  });

  it('avoids known false positives from the tightened patterns', () => {
    // "oscar" as an actor name must NOT impose a rating floor (only "oscars…" does)
    expect(parseSearch('film med oscar isaac').voteAverageMin).toBeUndefined();
    expect(parseSearch('en oscarsbelönad film').voteAverageMin).toBe(8);
    // "alienation" must NOT read as sci-fi (only whole-word alien/aliens)
    expect(parseSearch('en film om alienation').genreIds).toBeUndefined();
    expect(parseSearch('en film om aliens').genreIds).toEqual([878]);
    // "max" as a number cap (incl. higher cardinals) is not the Max service
    expect(parseSearch('max sju avsnitt').providerIds).toBeUndefined();
    // "c more" only as the service, not the "c more" substring inside "music more"
    expect(parseSearch('music more please').providerIds).toBeUndefined();
  });
});
