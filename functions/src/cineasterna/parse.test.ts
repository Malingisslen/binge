import { describe, it, expect } from 'vitest';
import { parseTitles, dedupeByImdb, detectRot } from './parse';

const apiResponse = {
  success: true,
  titles: [
    { name: 'Orwell: 2+2=5', imdb_id: 'tt27052428', is_rentable: false, rental_price_amount: null, rental_price_currency: null },
    { name: 'Pillion', imdb_id: 'tt32321317', is_rentable: true, rental_price_amount: 49, rental_price_currency: 'SEK' },
    { name: 'No imdb', imdb_id: '', is_rentable: false, rental_price_amount: null, rental_price_currency: null },
    { name: 'Null imdb', imdb_id: null, is_rentable: false, rental_price_amount: null, rental_price_currency: null },
  ],
};

describe('parseTitles', () => {
  it('keeps only titles with a valid imdb_id', () => {
    const out = parseTitles(apiResponse);
    expect(out.map((t) => t.imdbId)).toEqual(['tt27052428', 'tt32321317']);
  });
  it('captures rental info', () => {
    const pillion = parseTitles(apiResponse).find((t) => t.imdbId === 'tt32321317')!;
    expect(pillion).toMatchObject({ rentable: true, rentalAmount: 49, rentalCurrency: 'SEK' });
  });
  it('returns [] on failure/garbage', () => {
    expect(parseTitles({ success: false })).toEqual([]);
    expect(parseTitles(null)).toEqual([]);
  });
  it('returns [] when titles is not an array', () => {
    expect(parseTitles({ success: true, titles: 'bad' })).toEqual([]);
  });
});

describe('dedupeByImdb', () => {
  it('collapses duplicate imdb ids (union of national + library feeds)', () => {
    const t = (imdbId: string): import('./types').CineasternaTitle => ({ imdbId, name: imdbId, rentable: false, rentalAmount: null, rentalCurrency: null });
    expect(dedupeByImdb([t('tt1'), t('tt1'), t('tt2')]).map((x) => x.imdbId)).toEqual(['tt1', 'tt2']);
  });
});

describe('detectRot', () => {
  it('flags a collapse to zero', () => {
    expect(detectRot(1000, 0)).toBe(true);
  });
  it('flags a >50% drop', () => {
    expect(detectRot(1000, 400)).toBe(true);
  });
  it('allows a normal change', () => {
    expect(detectRot(1000, 1010)).toBe(false);
    expect(detectRot(1000, 600)).toBe(false);
  });
  it('allows the first-ever run (prev 0)', () => {
    expect(detectRot(0, 500)).toBe(false);
  });
  it('exactly 50% is NOT rot (boundary)', () => {
    expect(detectRot(1000, 500)).toBe(false);
  });
  it('just under 50% IS rot (boundary)', () => {
    expect(detectRot(1000, 499)).toBe(true);
  });
});
