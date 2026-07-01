import type { WatchStatus } from '@/types';

// BIN-164 — pure tag normalization for the owner-only watchlistTags store.
// Firebase-free so it can be unit-tested; the rules cap array size server-side
// (<= MAX_TAGS_PER_ITEM) but can't iterate elements, so per-tag length + dedup
// + reserved-word rejection are enforced here (client-side, defense-in-depth).
export const MAX_TAGS_PER_ITEM = 15;
export const MAX_TAG_LENGTH = 24;

/**
 * Clean a raw tag list into the canonical stored form:
 *  - trim + collapse internal whitespace, drop empties
 *  - truncate each tag to MAX_TAG_LENGTH chars
 *  - case-fold (sv-SE) for dedup + reserved-collision checks, but keep the
 *    first-seen DISPLAY casing ("Mysrys" and "mysrys" collapse to one)
 *  - drop tags whose folded form is in `reserved` (genre/rating chip labels —
 *    caller passes them folded — so a user tag can't masquerade as a real facet)
 *  - cap the list to MAX_TAGS_PER_ITEM
 */
export function normalizeTags(raw: string[], reserved: Set<string> = new Set()): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawTag of raw) {
    const value = rawTag.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim();
    if (!value) continue;
    const fold = value.toLocaleLowerCase('sv-SE');
    if (reserved.has(fold) || seen.has(fold)) continue;
    seen.add(fold);
    out.push(value);
    if (out.length >= MAX_TAGS_PER_ITEM) break;
  }
  return out;
}

// Pure builder for the Firestore merge-payload written by
// WatchlistContext.updateStatus. Extracted so the field-inclusion logic can be
// unit-tested without Firebase — the hook injects the serverTimestamp() sentinel
// and visibility fields, this function only decides which keys end up in the doc.
// (Same extract-then-test pattern as sessionTiming.ts / *.helpers.ts.)

export interface StatusUpdateContext {
  /** serverTimestamp() sentinel — injected by the caller so this stays pure. */
  now: unknown;
  /** Visibility fields to merge (empty when the item already has explicit visibility). */
  visFields: Record<string, unknown>;
  /** The item's current status, for rewatch detection. */
  currentStatus?: WatchStatus;
  /** The item's current rewatch count, for the rewatch increment. */
  currentRewatchCount?: number;
  /**
   * BIN-91: optional backdated watch time for a 'sedd'-write (a Timestamp/Date
   * sentinel from the caller). When absent, `watchedAt` falls back to `now`.
   * `updatedAt` always stays `now` — that's the real write time, only the
   * *watched* moment is user-overridable.
   */
  watchedAtOverride?: unknown;
}

export function buildStatusUpdate(
  status: WatchStatus,
  ctx: StatusUpdateContext,
): Record<string, unknown> {
  const isRewatch = status === 'sedd' && ctx.currentStatus === 'sedd';
  return {
    status,
    ...ctx.visFields,
    updatedAt: ctx.now,
    ...(status === 'sedd' ? { watchedAt: ctx.watchedAtOverride ?? ctx.now } : {}),
    ...(isRewatch ? { rewatchCount: (ctx.currentRewatchCount ?? 0) + 1 } : {}),
    // BIN-35: clear the legacy v1/v2 `dropped` flag on any non-avbruten status.
    // migrateStatus lets `dropped:true` win unconditionally, so without this a
    // legacy doc would snap back to 'avbruten' on the next snapshot — making
    // abandoned titles impossible to revive from the UI.
    ...(status !== 'avbruten' ? { dropped: false } : {}),
  };
}
