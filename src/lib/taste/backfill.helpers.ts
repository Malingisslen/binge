// Pure backfill logic, extracted so it unit-tests without pulling the Firebase
// SDK (backfill.ts imports @/lib/firebase/db → config → getAuth, which needs
// env in the test runner). Mirrors the *.helpers.ts pattern (sessionTiming,
// useSubscriptionAdvisor.helpers).

export interface BackfillUpdate {
  update: Record<string, unknown>;
  /** A change the USER would recognise — the only thing that may bump `updatedAt`. */
  contentChanged: boolean;
  /** BIN-814: the subscription subset was filled in. A system write, never a bump. */
  wroteSubscriptionProviders: boolean;
}

// Items där TMDB redan bekräftat samma SE-providers nyligare än så här hoppas över
// i nästa backfill-körning. SE-katalogerna rör sig ofta nog att 60 dagar är en bra
// balans mellan färskhet och TMDB-rate-limit-budget.
export const STALE_AFTER_MS = 60 * 24 * 60 * 60 * 1000;

// Firestore Timestamp duck-typas på toMillis() — instanceof skulle kräva en
// statisk firebase/firestore-import (se lazy-laddningen i lib/firebase/db.ts).
export function timestampToMs(val: unknown): number | null {
  if (val instanceof Date) return val.getTime();
  if (
    typeof val === 'object' && val !== null &&
    typeof (val as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return (val as { toMillis(): number }).toMillis();
  }
  return null;
}

/**
 * Whether a watchlist row is worth spending a TMDB detail fetch on this run.
 *
 * BIN-814 — the stamp, not field presence, decides the providers side, and that is a
 * CHANGE. This used to also select on `!Array.isArray(data.providers)`, which was
 * safe only while the old extractor wrote `[]` for a detail carrying no SE block. The
 * derivation now returns `undefined` there and NEITHER provider field is written,
 * deliberately, so a fetch that learned nothing cannot blank a good array. Selecting
 * on absence would therefore re-select and re-fetch such a title on EVERY run,
 * forever: the write never lands, so the field never appears. `providersCheckedAt` is
 * stamped regardless, which makes it the only durable record that we looked and came
 * back empty.
 *
 * The cost is that a row written before the split — fresh stamp, no
 * `subscriptionProviders` — waits out its 60 days before the field lands. Acceptable,
 * but not for the reason it first looks like: a title-page VIEW does not rescue it,
 * because the providers group is gated on the same stamp. What lands immediately is a
 * re-mark or a new add, which write the pair directly. Until then the advisor falls
 * back to the broad array — today's behaviour, not a regression.
 *
 * Extracted so the convergence property is testable without Firebase.
 */
export function needsBackfill(
  data: { genreIds?: unknown; providersCheckedAt?: unknown },
  cutoffMs: number,
): boolean {
  const g = data.genreIds;
  const missingGenres = !Array.isArray(g) || g.length === 0;
  const checkedAtMs = timestampToMs(data.providersCheckedAt);
  const isStale = checkedAtMs == null || checkedAtMs < cutoffMs;
  return missingGenres || isStale;
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
  tmdbProviders: number[] | undefined,
  stamp: unknown,
  existingSubscriptionProviders: number[] | null = null,
  tmdbSubscriptionProviders: number[] | undefined = undefined,
): BackfillUpdate {
  const update: Record<string, unknown> = { providersCheckedAt: stamp };
  let contentChanged = false;
  if (existingGenres.length === 0 && tmdbGenreIds.length > 0) {
    update.genreIds = tmdbGenreIds;
    contentChanged = true;
  }
  // BIN-814: `undefined` means the detail came back with no SE block at all — this
  // fetch learned nothing, so neither provider field may be touched. Writing `[]`
  // here (what the old extractSEProviders did) blanks a good array on every TMDB
  // response that happens to omit the SE block. `providersCheckedAt` is still
  // stamped above: the array is already protected, and NOT stamping would re-fetch
  // the same title every run for a block whose absence rarely changes.
  //
  // Written when the field is absent entirely (null = never checked → write even an
  // empty list) or the list differs from TMDB's current SE offer.
  if (
    tmdbProviders !== undefined &&
    (existingProviders === null || !arraysEqualAsSets(existingProviders, tmdbProviders))
  ) {
    update.providers = tmdbProviders;
    contentChanged = true;
  }
  // BIN-814: this branch writes the field but must NOT flip `contentChanged`, and
  // that is load-bearing rather than fussy. `existingSubscriptionProviders` is null
  // on EVERY row written before the split, so treating "the field appeared" as a
  // content change would bump `updatedAt` across the whole library on the first
  // backfill run — against the house rule stated above and in
  // `lib/watchlist/addedAt.ts` ("never bump updatedAt in a system write"). Four
  // readers would take the hit at once: "Fortsätt titta" sorts on `updatedAt` and
  // would collapse to one timestamp; `taste/stats` and the "din senaste 5★" anchor
  // both fall back to it for rows rated before `ratedAt` existed, so every legacy
  // rating would read as this month's; and a row with no stored `addedAt` resolves
  // to `updatedAt` and the repair effect then PERSISTS it, freezing "tillagd idag".
  //
  // Filling in a derived denormalization for the first time is a system write, not
  // something the user did. It is reported separately so the settings button's
  // "uppdaterade"/"kontrollerade" counter still tells the truth.
  //
  // Be honest about the limit of this protection: it covers the pair-fill, not the
  // whole first run. That same run also widens `providers` from flatrate/free/ads to
  // include rent/buy, so a stale pre-split row whose stored array came from the old
  // narrow extractor genuinely differs now → `contentChanged` → `updatedAt` bumped.
  // That is not suppressible: a definition change and a real new rent offer produce
  // the identical diff, and refusing to bump would mean refusing to record real
  // provider changes. It is bounded (one run, only rows that actually differ, and
  // only after their 60-day window lapses) and user-initiated from a settings button,
  // which is why it is accepted rather than worked around.
  let wroteSubscriptionProviders = false;
  if (
    tmdbSubscriptionProviders !== undefined &&
    (existingSubscriptionProviders === null
      || !arraysEqualAsSets(existingSubscriptionProviders, tmdbSubscriptionProviders))
  ) {
    update.subscriptionProviders = tmdbSubscriptionProviders;
    wroteSubscriptionProviders = true;
  }
  if (contentChanged) update.updatedAt = stamp;
  return { update, contentChanged, wroteSubscriptionProviders };
}
