import { describe, it, expect } from 'vitest';
import { summarizeCollectionStreaming, seFlatrateProviderIds, type UnseenFilmProviders } from './streamingSummary';
import type { TMDBMovie } from '@/types';

const film = (tmdbId: number, providerIds: number[]): UnseenFilmProviders => ({ tmdbId, providerIds });

describe('seFlatrateProviderIds', () => {
  it('extracts + canonicalises SE flatrate provider ids, deduped', () => {
    const movie = {
      'watch/providers': { results: { SE: { flatrate: [
        { provider_id: 8, provider_name: 'Netflix', logo_path: '' },
        { provider_id: 1899, provider_name: 'Max', logo_path: '' }, // alias of 384
      ] } } },
    } as unknown as TMDBMovie;
    const ids = seFlatrateProviderIds(movie);
    expect(ids).toContain(8);
    expect(ids).toContain(384); // 1899 canonicalised → 384
    expect(ids).not.toContain(1899);
  });

  it('returns [] when there is no SE flatrate data', () => {
    expect(seFlatrateProviderIds(undefined)).toEqual([]);
    expect(seFlatrateProviderIds({ 'watch/providers': { results: {} } } as unknown as TMDBMovie)).toEqual([]);
  });

  it('dedups two aliases of the same provider to one canonical id', () => {
    const movie = {
      'watch/providers': { results: { SE: { flatrate: [
        { provider_id: 1899, provider_name: 'Max', logo_path: '' }, // alias → 384
        { provider_id: 384, provider_name: 'Max', logo_path: '' },  // canonical
      ] } } },
    } as unknown as TMDBMovie;
    expect(seFlatrateProviderIds(movie)).toEqual([384]);
  });
});

describe('summarizeCollectionStreaming', () => {
  it('finds a common provider when one covers every unseen film', () => {
    const s = summarizeCollectionStreaming([film(1, [337]), film(2, [337, 8]), film(3, [337])], []);
    expect(s.commonProviderId).toBe(337); // Disney+ on all three
    expect(s.withAnyProvider).toBe(3);
  });

  it('reports no common provider when any unseen film lacks it', () => {
    const s = summarizeCollectionStreaming([film(1, [337]), film(2, [8])], []);
    expect(s.commonProviderId).toBeNull();
    expect(s.topProviderCount).toBe(1); // 337 and 8 each cover one; top count is 1
  });

  it('treats a film with no providers as breaking "alla på X"', () => {
    const s = summarizeCollectionStreaming([film(1, [337]), film(2, [])], []);
    expect(s.commonProviderId).toBeNull();
    expect(s.withAnyProvider).toBe(1);
  });

  it('counts how many unseen are on a service the user already has + flags owned top provider', () => {
    const s = summarizeCollectionStreaming([film(1, [337]), film(2, [8]), film(3, [76])], [337, 8]);
    expect(s.onYourServices).toBe(2); // films on 337 and 8; 76 not owned
    expect(s.considered).toBe(3);     // pins the documented count field
  });

  it('returns a covering provider when several cover every unseen film (multi-element intersection)', () => {
    // Both 337 and 8 are on every film → intersection {337,8}. With deduped
    // provider lists their counts tie, so either is a valid "alla på X" — assert
    // it returns one of them (not null), exercising the multi-element branch.
    const s = summarizeCollectionStreaming([film(1, [337, 8]), film(2, [337, 8])], []);
    expect([337, 8]).toContain(s.commonProviderId);
  });

  it('marks the top provider as owned when the user has it', () => {
    const owned = summarizeCollectionStreaming([film(1, [8]), film(2, [8])], [8]);
    expect(owned.topProviderIsOwned).toBe(true);
    const notOwned = summarizeCollectionStreaming([film(1, [8]), film(2, [8])], [337]);
    expect(notOwned.topProviderIsOwned).toBe(false);
  });

  it('picks the provider covering the most unseen as top', () => {
    const s = summarizeCollectionStreaming([film(1, [8]), film(2, [8]), film(3, [337])], []);
    expect(s.topProviderId).toBe(8);
    expect(s.topProviderCount).toBe(2);
  });

  it('handles an empty input', () => {
    const s = summarizeCollectionStreaming([], [8]);
    expect(s).toMatchObject({ considered: 0, withAnyProvider: 0, onYourServices: 0, commonProviderId: null, topProviderId: null, topProviderCount: 0 });
  });
});
