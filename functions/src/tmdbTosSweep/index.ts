/**
 * Monthly TMDB ToS compliance sweep (BIN-402).
 *
 * onSchedule('every 720 hours' ≈ monthly, europe-west1). TMDB API terms §1.C
 * forbid caching API-derived data > 6 months; watchlist docs denormalize TMDB
 * fields with no TTL. This sweep CLEARS (nulls) the TMDB-derived fields once
 * their freshness stamp (`tmdbFieldsRefreshedAt`) is older than 5 months — or
 * absent. It never re-fetches TMDB (that is unbounded fan-out against the
 * 25 SEK/mo Blaze cap); freshness is restored lazily on the next title-page
 * view. Full rationale + panel must-haves: ADR 0009 +
 * docs/superpowers/plans/2026-07-03-bin-402-tmdb-tos-sweep.md.
 *
 * SAFETY (this is the first scheduled function that writes to EVERY user's
 * watchlist — whole-DB blast radius):
 *  • Dry-run by DEFAULT. Writes nothing to watchlist docs until the control doc
 *    `sweepState/tmdbFieldsSweep.mutateEnabled === true`. Malin flips that in the
 *    Firebase Console after reviewing the dry-run counts — no redeploy needed.
 *  • Hard field-allowlist (buildClearedPayload) — never touches a user-authored
 *    field and NEVER bumps `updatedAt` (drives the continueWatching sort; a
 *    silent bump reads as "user re-engaged" = a data-accuracy bug).
 *  • Cursor-resumable + per-run scan/write budget: a single 300s invocation
 *    can't blow the cap; the next run continues from the persisted __name__.
 *  • Idempotent: skips the write when the target fields are already absent.
 *  • Per-run audit record (`sweepState/tmdbFieldsSweep.lastRun`) — the evidence
 *    the control actually runs against prod month after month; an incomplete or
 *    failed run is flagged there (and logged at warn), never a silent no-op.
 *
 * COST (DBA formula, computed before build): every scanned doc = 1 billed read
 * regardless of `.select()`; every cleared doc = 1 write. Monthly cost ≈
 * N_watchlist_docs reads + (stale-and-non-empty docs) writes. Against the free
 * tier (50k reads / 20k writes per DAY) and the 25 SEK/mo cap, a library of even
 * ~50k docs is a single sub-cent monthly run. If N ever exceeds MAX_DOCS_PER_RUN
 * the cursor throttles it across runs. Fill the live N + SEK line into BIN-402
 * from the first dry-run's `docsScanned` before flipping mutateEnabled.
 */

import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import type { DocumentReference, UpdateData, DocumentData } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import {
  isTmdbFieldsStale,
  allTargetFieldsAbsent,
  buildClearedPayload,
  tsToMillis,
  TMDB_DERIVED_FIELDS,
  TMDB_FIELDS_STAMP,
} from './logic';

/** Firestore's per-commit write ceiling is 500; leave headroom like the client. */
const BATCH_SIZE = 450;

/** Page size for the bounded scan — never load the whole collection group at once. */
const PAGE_SIZE = 2000;

/**
 * Per-run safety ceilings. Generous so a normal-sized DB finishes in one run;
 * they only bite pathologically, at which point the cursor resumes next run.
 * Kept well under a day's free-tier quota (50k reads / 20k writes).
 */
const MAX_DOCS_PER_RUN = 100_000;
const MAX_CLEARS_PER_RUN = 18_000;

/** Durable control + audit doc (also holds the cross-run cursor + the mutate gate). */
const STATE_PATH = 'sweepState/tmdbFieldsSweep';

export const tmdbFieldsSweep = onSchedule(
  { schedule: 'every 720 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const db = getFirestore();
    const nowMs = Date.now();
    const stateRef = db.doc(STATE_PATH);

    const stateSnap = await stateRef.get();
    const state = stateSnap.data() ?? {};
    // Dry-run is the default: ONLY an explicit `true` enables writes.
    const mutateEnabled = state.mutateEnabled === true;
    // Resume the cursor only in mutate mode — a dry-run always scans from the
    // start for a clean full count (and never persists a cursor of its own),
    // so a stale cursor left by a prior mutate run can't make it skip docs.
    let cursor: string | null = mutateEnabled && typeof state.cursor === 'string' ? state.cursor : null;

    let scanned = 0;
    let clearable = 0; // docs that WOULD be (dry-run) / WERE (mutate) cleared
    let skipped = 0;
    let budgetAbort = false;
    let fullPassCompleted = false;

    for (;;) {
      // orderBy(documentId()) uses Firestore's automatic collection-group index
      // (no firestore.indexes.json entry — same as retentionCleanup's __name__
      // paging). `.select(...)` narrows bandwidth (read count is unchanged) to
      // just the stamp + clearable fields we need to judge staleness/presence.
      let q = db
        .collectionGroup('watchlist')
        .orderBy(FieldPath.documentId())
        .select(TMDB_FIELDS_STAMP, ...TMDB_DERIVED_FIELDS)
        .limit(PAGE_SIZE);
      if (cursor) q = q.startAfter(cursor);

      const snap = await q.get();
      if (snap.empty) {
        fullPassCompleted = true;
        break;
      }

      const toClear: DocumentReference[] = [];
      for (const d of snap.docs) {
        scanned += 1;
        const data = d.data();
        const stampMs = tsToMillis(data[TMDB_FIELDS_STAMP]);
        if (!isTmdbFieldsStale(stampMs, nowMs)) {
          skipped += 1; // fresh — leave it
          continue;
        }
        if (allTargetFieldsAbsent(data)) {
          skipped += 1; // stale stamp but nothing left to clear — skip the write
          continue;
        }
        toClear.push(d.ref);
      }

      if (mutateEnabled && toClear.length > 0) {
        for (let i = 0; i < toClear.length; i += BATCH_SIZE) {
          const batch = db.batch();
          for (const ref of toClear.slice(i, i + BATCH_SIZE)) {
            // update() (not set-merge): a fixed allowlist payload touching only
            // the named fields, never a read-modify-write of the existing doc.
            batch.update(
              ref,
              buildClearedPayload(
                FieldValue.delete(),
                FieldValue.serverTimestamp(),
              ) as UpdateData<DocumentData>,
            );
          }
          await batch.commit();
        }
      }
      clearable += toClear.length;

      cursor = snap.docs[snap.docs.length - 1].ref.path;
      // Persist the cursor per committed page (mutate mode only) so a timeout or
      // budget abort resumes here instead of rescanning from doc 0.
      if (mutateEnabled) {
        await stateRef.set({ cursor }, { merge: true });
      }

      if (snap.size < PAGE_SIZE) {
        fullPassCompleted = true;
        break;
      }
      if (scanned >= MAX_DOCS_PER_RUN || clearable >= MAX_CLEARS_PER_RUN) {
        budgetAbort = true;
        break;
      }
    }

    // A completed full pass resets the cursor so next month starts fresh.
    if (mutateEnabled && fullPassCompleted) {
      await stateRef.set({ cursor: null }, { merge: true });
    }

    const lastRun = {
      at: FieldValue.serverTimestamp(),
      dryRun: !mutateEnabled,
      docsScanned: scanned,
      docsCleared: mutateEnabled ? clearable : 0,
      docsWouldClear: clearable,
      docsSkipped: skipped,
      budgetAbort,
      fullPassCompleted,
    };
    await stateRef.set({ lastRun }, { merge: true });

    if (budgetAbort || !fullPassCompleted) {
      logger.warn('tmdbFieldsSweep: incomplete run — resumes next invocation', lastRun);
    } else {
      logger.info('tmdbFieldsSweep done', lastRun);
    }
  },
);
