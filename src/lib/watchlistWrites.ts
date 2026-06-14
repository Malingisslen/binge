import type { WatchStatus } from '@/types';

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
    ...(status === 'sedd' ? { watchedAt: ctx.now } : {}),
    ...(isRewatch ? { rewatchCount: (ctx.currentRewatchCount ?? 0) + 1 } : {}),
    // BIN-35: clear the legacy v1/v2 `dropped` flag on any non-avbruten status.
    // migrateStatus lets `dropped:true` win unconditionally, so without this a
    // legacy doc would snap back to 'avbruten' on the next snapshot — making
    // abandoned titles impossible to revive from the UI.
    ...(status !== 'avbruten' ? { dropped: false } : {}),
  };
}
