import { describe, it, expect } from 'vitest';
import { buildBackfillUpdate } from './backfill.helpers';

// A test sentinel standing in for serverTimestamp()'s FieldValue — pure logic,
// so we only care WHICH fields carry a stamp, not its resolved value.
const TS = 'STAMP';

describe('buildBackfillUpdate — BIN-319: updatedAt only on real content change', () => {
  it('genres changed only → updatedAt + genreIds + providersCheckedAt, contentChanged', () => {
    const { update, contentChanged } = buildBackfillUpdate([], [8], [28], [8], TS);
    expect(contentChanged).toBe(true);
    expect(update.genreIds).toEqual([28]);
    expect(update.updatedAt).toBe(TS);
    expect(update.providersCheckedAt).toBe(TS);
    expect('providers' in update).toBe(false); // providers unchanged → not written
  });

  it('providers changed only → updatedAt + providers + providersCheckedAt, contentChanged', () => {
    // existingGenres non-empty → genres branch skipped (only backfilled when missing).
    const { update, contentChanged } = buildBackfillUpdate([28], [8], [28], [8, 9], TS);
    expect(contentChanged).toBe(true);
    expect(update.providers).toEqual([8, 9]);
    expect(update.updatedAt).toBe(TS);
    expect(update.providersCheckedAt).toBe(TS);
    expect('genreIds' in update).toBe(false);
  });

  it('nothing changed → ONLY providersCheckedAt, NO updatedAt (the whole ticket)', () => {
    const { update, contentChanged } = buildBackfillUpdate([28], [8], [28], [8], TS);
    expect(contentChanged).toBe(false);
    expect('updatedAt' in update).toBe(false); // <- recency anchor must NOT be clobbered
    expect('genreIds' in update).toBe(false);
    expect('providers' in update).toBe(false);
    expect(update.providersCheckedAt).toBe(TS); // <- still stamped so 60-day skip advances
  });

  it('providersCheckedAt is always written, even on a pure no-op recheck', () => {
    const { update } = buildBackfillUpdate([28], [8], [28], [8], TS);
    expect(update.providersCheckedAt).toBe(TS);
  });

  it('never-checked providers (null) → writes providers even when equal to TMDB (incl. empty)', () => {
    // null = field absent; we must write `providers: []` so a never-checked title
    // stops re-fetching every cycle. A `[] !== null` regression would re-break BIN-319.
    const { update, contentChanged } = buildBackfillUpdate([28], null, [28], [], TS);
    expect(contentChanged).toBe(true);
    expect(update.providers).toEqual([]);
    expect(update.updatedAt).toBe(TS);
  });
});
