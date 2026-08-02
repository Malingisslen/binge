import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { mapWatchlistDoc } from './usePublicProfile';
import { computeProfileStats } from '@/lib/taste/stats';

// This is the PUBLIC read path — what someone ELSE sees on a profile. BIN-640 was
// visible here in a way it was not in the owner's own library: a title added
// while the owner's listener was dead had no stored `addedAt`, `toDate()` reported
// it as the current moment, and `computeProfileStats`' 30-day "Tillagda" counter
// therefore kept counting it forever, on a page the owner does not control.
vi.mock('@/lib/firebase/db', () => ({ fsdb: async () => ({}) }));
vi.mock('@/lib/firebase/publicProfile', () => ({ getPublicProfileCard: async () => null }));

const NOW = new Date('2026-08-02T12:00:00Z');
// Comfortably outside the 30-day window, so "counted" can only mean the bug.
const LONG_AGO = new Date('2025-01-15T10:00:00Z');

function ts(d: Date) {
  return { toDate: () => d };
}

function publicDoc(fields: Record<string, unknown>): QueryDocumentSnapshot<DocumentData> {
  return {
    id: 'tv_7',
    data: () => ({ tmdbId: 7, mediaType: 'tv', status: 'mina', title: 'Title 7', ...fields }),
  } as unknown as QueryDocumentSnapshot<DocumentData>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('mapWatchlistDoc — the public profile never reads a missing addedAt as today (BIN-640)', () => {
  it('resolves a missing addedAt to the doc\'s own updatedAt', () => {
    const item = mapWatchlistDoc(publicDoc({ updatedAt: ts(LONG_AGO) }));
    expect(item.addedAt).toEqual(LONG_AGO);
    expect(item.addedAt).not.toEqual(NOW);
  });

  it('uses the stored addedAt when the doc has one', () => {
    const added = new Date('2024-03-01T09:00:00Z');
    const item = mapWatchlistDoc(publicDoc({ addedAt: ts(added), updatedAt: ts(LONG_AGO) }));
    expect(item.addedAt).toEqual(added);
  });

  it('keeps an addedAt-less title OUT of the public 30-day "Tillagda" counter', () => {
    // The user-visible symptom, asserted end to end through the real stats
    // function rather than restated: ProfileStatsPanel renders recent30.added.
    const item = mapWatchlistDoc(publicDoc({ updatedAt: ts(LONG_AGO) }));
    expect(computeProfileStats([item]).recent30.added).toBe(0);
  });

  it('still counts a title genuinely added inside the window', () => {
    // Positive control: the fix must not silence the counter altogether.
    const recent = new Date('2026-07-25T10:00:00Z');
    const item = mapWatchlistDoc(publicDoc({ addedAt: ts(recent), updatedAt: ts(recent) }));
    expect(computeProfileStats([item]).recent30.added).toBe(1);
  });
});
