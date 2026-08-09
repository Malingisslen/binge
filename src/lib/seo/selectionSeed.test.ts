import { describe, it, expect } from 'vitest';
import { SEED_MOVIE_IDS, SEED_TV_IDS, SEED_PERSON_IDS } from './selectionSeed';

/**
 * Frö-listorna är HANDSKRAPAD data ur Search Console — de kan inte härledas ur
 * något annat i repot, så inget annat kan upptäcka en klippfel-dubblett eller
 * en avhuggen siffra. Det här testet är den enda kontrollen som finns.
 *
 * Antalen är dessutom påståenden filens egen kommentar gör (74 filmer, 32
 * personer, 10 serier ur GSC:s 117 rader). Ett kommentarspåstående som ingen
 * kontrollerar är exakt den sorts sanning som tyst blir fel.
 */
describe('selectionSeed', () => {
  const lists = [
    ['SEED_MOVIE_IDS', SEED_MOVIE_IDS, 74],
    ['SEED_TV_IDS', SEED_TV_IDS, 10],
    ['SEED_PERSON_IDS', SEED_PERSON_IDS, 32],
  ] as const;

  it.each(lists)('%s har det dokumenterade antalet id', (_name, ids, expected) => {
    expect(ids).toHaveLength(expected);
  });

  it.each(lists)('%s innehåller inga dubbletter', (_name, ids) => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(lists)('%s innehåller bara positiva heltal', (_name, ids) => {
    expect(ids.filter(id => !Number.isInteger(id) || id <= 0)).toEqual([]);
  });

  // 116 id + startsidan = de 117 rader Search Console visade 2026-08-08.
  it('summerar till GSC:s 117 indexerade sidor minus startsidan', () => {
    expect(SEED_MOVIE_IDS.length + SEED_TV_IDS.length + SEED_PERSON_IDS.length).toBe(116);
  });
});
