import { describe, it, expect } from 'vitest';
import { buildBackfillUpdate, needsBackfill, STALE_AFTER_MS } from './backfill.helpers';

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

// BIN-814. The backfill used to call extractSEProviders, which returned `[]` for a
// TMDB response carrying no SE block at all — so a fetch that learned nothing about
// Swedish availability wrote an empty array over a good one. Both provider fields now
// arrive as `undefined` in that case and must be left alone.
describe('buildBackfillUpdate — an absent SE block must never blank a good array', () => {
  it('undefined providers → the field is not written, and the existing array survives', () => {
    const { update, contentChanged } = buildBackfillUpdate([28], [8, 9], [28], undefined, TS);
    expect('providers' in update).toBe(false);
    expect(contentChanged).toBe(false);
  });

  it('but providersCheckedAt is STILL stamped — not stamping re-fetches it every run', () => {
    // The array is already protected by the line above, so stamping costs nothing in
    // correctness; skipping the stamp would burn TMDB budget on a title whose missing
    // SE block rarely changes between runs (#28's explicit recommendation).
    const { update } = buildBackfillUpdate([28], [8, 9], [28], undefined, TS);
    expect(update.providersCheckedAt).toBe(TS);
  });

  it('an empty-but-present SE block ([]) IS written — that is a real "nowhere in Sweden"', () => {
    const { update, contentChanged } = buildBackfillUpdate([28], [8], [28], [], TS);
    expect(update.providers).toEqual([]);
    expect(contentChanged).toBe(true);
  });
});

describe('buildBackfillUpdate — subscriptionProviders travels with providers (BIN-814)', () => {
  const VIAPLAY = 76;

  it('writes both fields from one TMDB response', () => {
    // The title just became rentable on Viaplay AND lost Netflix from every
    // subscription — both fields move, and both must land in the same write.
    const { update, contentChanged } = buildBackfillUpdate(
      [28], [8], [28], [VIAPLAY, 8], TS, [8], [],
    );
    expect(update.providers).toEqual([VIAPLAY, 8]);
    expect(update.subscriptionProviders).toEqual([]);
    expect(contentChanged).toBe(true);
  });

  it('a doc written before the split (null) gets the field even when providers are unchanged', () => {
    // This is the migration path: `providers` matches, so the old code wrote nothing
    // and the advisor would have stayed on the broad fallback forever.
    const { update, wroteSubscriptionProviders } = buildBackfillUpdate(
      [28], [VIAPLAY], [28], [VIAPLAY], TS, null, [],
    );
    expect('providers' in update).toBe(false);
    expect(update.subscriptionProviders).toEqual([]);
    expect(wroteSubscriptionProviders).toBe(true);
  });

  // The migration touches EVERY pre-split row, so whether it bumps `updatedAt`
  // decides whether the whole library re-dates itself in one run. Four readers fall
  // back to that timestamp: "Fortsätt titta" sorts on it, taste/stats and the
  // "din senaste 5★" anchor use it for rows rated before `ratedAt` existed, and a
  // row with no stored `addedAt` resolves to it — after which the repair effect
  // PERSISTS the value, freezing "tillagd idag". Filling a derived field is a system
  // write, not something the user did.
  it('filling in the subset does NOT bump updatedAt, and is not contentChanged', () => {
    const { update, contentChanged } = buildBackfillUpdate(
      [28], [VIAPLAY], [28], [VIAPLAY], TS, null, [],
    );
    expect('updatedAt' in update).toBe(false);
    expect(contentChanged).toBe(false);
  });

  it('a REAL provider change alongside it still bumps updatedAt', () => {
    // The bump is not disabled — only decoupled from the migration.
    const { update, contentChanged } = buildBackfillUpdate(
      [28], [VIAPLAY], [28], [VIAPLAY, 8], TS, null, [8],
    );
    expect(update.updatedAt).toBe(TS);
    expect(contentChanged).toBe(true);
  });

  it('undefined subscriptionProviders leaves the stored value alone', () => {
    const { update, contentChanged } = buildBackfillUpdate(
      [28], [8], [28], undefined, TS, [8], undefined,
    );
    expect('subscriptionProviders' in update).toBe(false);
    expect(contentChanged).toBe(false);
  });

  it('an unchanged subscription list is not rewritten', () => {
    const { update, contentChanged } = buildBackfillUpdate(
      [28], [8], [28], [8], TS, [8], [8],
    );
    expect('subscriptionProviders' in update).toBe(false);
    expect(contentChanged).toBe(false);
    expect(update.providersCheckedAt).toBe(TS);
  });
});

// BIN-814. The selection predicate has to CONVERGE. Since the derivation returns
// `undefined` for a detail carrying no SE block, neither provider field is written
// for such a title — so a predicate that selects on field ABSENCE re-fetches it on
// every run, forever, and the settings button can never say "nothing to update".
// Only the stamp is written unconditionally, so only the stamp can end the loop.
describe('needsBackfill — the run must terminate for a title with no SE block', () => {
  const NOW = Date.parse('2026-08-09T12:00:00Z');
  const cutoff = NOW - STALE_AFTER_MS;
  const freshStamp = new Date(NOW - 1000);
  const oldStamp = new Date(NOW - STALE_AFTER_MS - 1000);

  it('selects a row that has never been checked', () => {
    expect(needsBackfill({ genreIds: [28], providersCheckedAt: null }, cutoff)).toBe(true);
  });

  it('selects a row whose 60-day window has lapsed', () => {
    expect(needsBackfill({ genreIds: [28], providersCheckedAt: oldStamp }, cutoff)).toBe(true);
  });

  it('does NOT re-select a freshly stamped row that still has no provider fields', () => {
    // The whole convergence property: this is a title whose TMDB detail carries no
    // SE block. The previous run wrote nothing but the stamp — and that has to be
    // enough, or the next run fetches it again, and so does every run after that.
    expect(needsBackfill({ genreIds: [28], providersCheckedAt: freshStamp }, cutoff)).toBe(false);
  });

  it('still selects on missing genres regardless of the stamp', () => {
    expect(needsBackfill({ genreIds: [], providersCheckedAt: freshStamp }, cutoff)).toBe(true);
    expect(needsBackfill({ providersCheckedAt: freshStamp }, cutoff)).toBe(true);
  });

  it('accepts a Firestore Timestamp, not just a Date', () => {
    const asTimestamp = { toMillis: () => freshStamp.getTime() };
    expect(needsBackfill({ genreIds: [28], providersCheckedAt: asTimestamp }, cutoff)).toBe(false);
  });
});
