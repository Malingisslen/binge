import { describe, it, expect } from 'vitest';
import { computeSessionProviders } from './candidates';

describe('computeSessionProviders', () => {
  describe('intersect', () => {
    it('returnerar snittet av allas providers', () => {
      const result = computeSessionProviders(
        [{ providers: [8, 337, 119] }, { providers: [337, 119, 9] }],
        'intersect',
      );
      expect(result.sort((a, b) => a - b)).toEqual([119, 337]);
    });

    it('nollas av en deltagare utan providers (M3)', () => {
      // En deltagare som inte konfigurerat providers gör att inget är tittbart
      // för alla — snittet ska bli tomt, inte partnerns hela lista.
      expect(
        computeSessionProviders([{ providers: [8, 337] }, { providers: [] }], 'intersect'),
      ).toEqual([]);
    });

    it('en enda deltagare → den deltagarens providers', () => {
      expect(
        computeSessionProviders([{ providers: [8, 337] }], 'intersect').sort((a, b) => a - b),
      ).toEqual([8, 337]);
    });

    it('tom deltagarlista → tomt', () => {
      expect(computeSessionProviders([], 'intersect')).toEqual([]);
    });
  });

  describe('union', () => {
    it('slår ihop allas providers utan dubbletter', () => {
      const result = computeSessionProviders(
        [{ providers: [8, 337] }, { providers: [337, 9] }],
        'union',
      );
      expect(result.sort((a, b) => a - b)).toEqual([8, 9, 337]);
    });

    it('ignorerar tomma listor', () => {
      expect(
        computeSessionProviders([{ providers: [8] }, { providers: [] }], 'union').sort((a, b) => a - b),
      ).toEqual([8]);
    });
  });
});
