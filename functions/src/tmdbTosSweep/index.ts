/**
 * Monthly TMDB ToS compliance sweep (BIN-402).
 *
 * onSchedule('every 720 hours' ≈ monthly, europe-west1). TMDB API terms §1.C
 * forbid caching API-derived data > 6 months; watchlist docs denormalize TMDB
 * fields with no TTL. This sweep CLEARS (nulls) the TMDB-derived fields once
 * stale. BIN-468 — PER-GROUP: the block is split into three field-groups (static
 * / providers / nextair), each judged against its OWN stamp (tmdbFieldsRefreshedAt
 * / providersCheckedAt / nextAirUpdatedAt) and cleared independently at 5 months
 * or when its stamp is absent. It never re-fetches TMDB (that is unbounded fan-out
 * against the 25 SEK/mo Blaze cap); each group's freshness is restored lazily by
 * its own repair path. Full rationale + panel must-haves: ADR 0009 +
 * ~/.claude/plans/binge-bin468-stage2.md.
 *
 * STRUCTURE (BIN-566). This file is now ONLY the Firestore glue: the schedule
 * registration plus an Admin-SDK implementation of the `SweepIo` port. Every
 * decision the sweep makes lives in ./runSweep.ts (the loop) and ./logic.ts (the
 * predicates), both firebase-admin-free so the root/emulator test toolchain can
 * import them. Do not move logic back up here — it becomes untestable the moment
 * it sits next to a firebase-admin import.
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
 *
 * TEST COVERAGE (BIN-566 — read this before flipping `mutateEnabled`).
 * The orchestrator is now covered against a real Firestore emulator in
 * `src/test/rules/tmdb-sweep-orchestrator.test.ts` (`npm run test:rules`), which
 * drives ./runSweep.ts through a client-SDK port and proves BIN-507's two
 * previously helper-only criteria end to end:
 *  • #1 a thrown scan-get / clear-commit still writes the `lastRun` audit with
 *    `error: true` + the partial counts, THEN re-throws.
 *  • #2 a second invocation resumes from the persisted cursor instead of
 *    rescanning from doc 0.
 * It additionally proves the mutating path itself: a stale group's fields + its
 * own stamp are deleted, a FRESH sibling group and every user-authored field
 * survive, and `groups/{id}/watchlist` docs are never touched (BIN-504).
 * What is still NOT covered: this file's own Admin-SDK port — the collection-group
 * query, `.select()` narrowing and 450-write batch chunking below. That surface is
 * type-checked against the structural port and review-gated; the emulator harness
 * cannot load firebase-admin (CI's rules job installs root deps only).
 */

import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import type { UpdateData, DocumentData } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { ALL_SELECT_KEYS } from './logic';
import { runTmdbFieldsSweep, type SweepIo, type SweepScanDoc, type SweepClearTarget } from './runSweep';

/** Firestore's per-commit write ceiling is 500; leave headroom like the client. */
const BATCH_SIZE = 450;

/** Page size for the bounded scan — never load the whole collection group at once. */
const PAGE_SIZE = 2000;

/** Durable control + audit doc (also holds the cross-run cursor + the mutate gate). */
const STATE_PATH = 'sweepState/tmdbFieldsSweep';

export const tmdbFieldsSweep = onSchedule(
  { schedule: 'every 720 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const db = getFirestore();
    const stateRef = db.doc(STATE_PATH);

    const io: SweepIo = {
      pageSize: PAGE_SIZE,
      deleteSentinel: FieldValue.delete(),
      serverTimestamp: FieldValue.serverTimestamp(),
      log: logger,
      now: () => Date.now(),

      readState: async () => (await stateRef.get()).data(),
      mergeState: async (patch) => {
        await stateRef.set(patch, { merge: true });
      },

      scanPage: async (cursor, pageSize): Promise<SweepScanDoc[]> => {
        // orderBy(documentId()) uses Firestore's automatic collection-group index
        // (no firestore.indexes.json entry — same as retentionCleanup's __name__
        // paging). `.select(...)` narrows bandwidth (read count is unchanged) to
        // just the group stamps + clearable fields we need to judge
        // staleness/presence.
        let q = db
          .collectionGroup('watchlist')
          .orderBy(FieldPath.documentId())
          .select(...ALL_SELECT_KEYS)
          .limit(pageSize);
        if (cursor) q = q.startAfter(cursor);
        const snap = await q.get();
        return snap.docs.map((d) => ({ path: d.ref.path, data: d.data() }));
      },

      commitClears: async (
        targets: readonly SweepClearTarget[],
        onCommitted: (count: number) => void,
      ) => {
        for (let i = 0; i < targets.length; i += BATCH_SIZE) {
          const chunk = targets.slice(i, i + BATCH_SIZE);
          const batch = db.batch();
          for (const { path, payload } of chunk) {
            // update() (not set-merge): the payload is runSweep's fixed allowlist
            // of the stale groups' fields + their own stamps, so this is never a
            // read-modify-write and never touches a fresh sibling group.
            batch.update(db.doc(path), payload as UpdateData<DocumentData>);
          }
          await batch.commit();
          // Report only AFTER the commit resolves, so the audit counts durable
          // writes — a later chunk throwing leaves this chunk correctly counted.
          onCommitted(chunk.length);
        }
      },
    };

    await runTmdbFieldsSweep(io);
  },
);
