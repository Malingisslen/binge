import { describe, it, expect } from 'vitest';
import { shouldRetryQuery, STREAMING_OFFERS_TIMEOUT_MESSAGE } from './queryClient';

describe('shouldRetryQuery', () => {
  it('gör om ett vanligt nätverksfel en gång', () => {
    expect(shouldRetryQuery(0, new Error('network request failed'))).toBe(true);
    expect(shouldRetryQuery(1, new Error('network request failed'))).toBe(true);
  });

  it('slutar efter två försök', () => {
    expect(shouldRetryQuery(2, new Error('network request failed'))).toBe(false);
    expect(shouldRetryQuery(5, new Error('network request failed'))).toBe(false);
  });

  it('gör aldrig om Firestore-fel som inte blir bättre', () => {
    expect(shouldRetryQuery(0, new Error('permission-denied'))).toBe(false);
    expect(shouldRetryQuery(0, new Error('FirebaseError: unauthenticated'))).toBe(false);
    expect(shouldRetryQuery(0, new Error('not-found'))).toBe(false);
  });

  it('BIN-733: gör aldrig om en läsning som redan slagit i sin tidsgräns', () => {
    // Utan detta blev streamingrutans väntan 10s + 1s backoff + 10s ≈ 22s.
    expect(shouldRetryQuery(0, new Error(STREAMING_OFFERS_TIMEOUT_MESSAGE))).toBe(false);
    expect(shouldRetryQuery(1, new Error(STREAMING_OFFERS_TIMEOUT_MESSAGE))).toBe(false);
  });

  it('pinnar timeout-meddelandet hooken faktiskt kastar', () => {
    // Konstanten är kontraktet mellan useStreamingOffers och retry-predikatet;
    // ändras strängen på ena sidan ska detta test falla, inte tystna.
    expect(STREAMING_OFFERS_TIMEOUT_MESSAGE).toBe('streamingOffers timeout');
  });

  it('gör om icke-Error-fel (inget meddelande att bedöma)', () => {
    expect(shouldRetryQuery(0, 'boom')).toBe(true);
    expect(shouldRetryQuery(0, undefined)).toBe(true);
  });
});
