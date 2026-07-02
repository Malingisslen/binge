// Pure backfill logic, extracted so it unit-tests without pulling the Firebase
// SDK (backfill.ts imports @/lib/firebase/db → config → getAuth, which needs
// env in the test runner). Mirrors the *.helpers.ts pattern (sessionTiming,
// useSubscriptionAdvisor.helpers).

export interface BackfillUpdate {
  update: Record<string, unknown>;
  contentChanged: boolean;
}

export function arraysEqualAsSets(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const v of b) if (!setA.has(v)) return false;
  return true;
}

// Decides which fields a backfill iteration should write.
// `providersCheckedAt` is written ALWAYS — it stamps that we checked and drives
// the 60-day STALE_AFTER_MS skip (else an unchanged title re-fetches every
// cycle). But `updatedAt` is bumped ONLY on real content change (BIN-319): a
// pure provider-recheck must not clobber `updatedAt`, which the "din senaste
// 5★" recency anchor (seedAnalysis.detectLatestFiveStar, now `ratedAt ??
// updatedAt` per BIN-349) still falls back to for items rated before ratedAt.
// `stamp` is injected (serverTimestamp() in prod, a sentinel in tests) — a
// FieldValue can't be compared in a pure unit test.
export function buildBackfillUpdate(
  existingGenres: number[],
  existingProviders: number[] | null,
  tmdbGenreIds: number[],
  tmdbProviders: number[],
  stamp: unknown,
): BackfillUpdate {
  const update: Record<string, unknown> = { providersCheckedAt: stamp };
  let contentChanged = false;
  if (existingGenres.length === 0 && tmdbGenreIds.length > 0) {
    update.genreIds = tmdbGenreIds;
    contentChanged = true;
  }
  // Write providers when the field is absent entirely (null = never checked →
  // write even an empty list) or the list differs from TMDB's current SE offer.
  if (existingProviders === null || !arraysEqualAsSets(existingProviders, tmdbProviders)) {
    update.providers = tmdbProviders;
    contentChanged = true;
  }
  if (contentChanged) update.updatedAt = stamp;
  return { update, contentChanged };
}
