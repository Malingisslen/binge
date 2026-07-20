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
 * TEST COVERAGE (BIN-520) — read this before flipping `mutateEnabled`.
 * Two of BIN-507's four acceptance criteria are proven at the PURE-HELPER layer
 * only; there is no unit or emulator test that drives this orchestrator itself,
 * and that is an accepted decision, not an oversight:
 *  • #1 "a thrown q.get()/batch.commit() still writes the lastRun audit" — proven
 *    by `buildLastRunAudit(error)` + `errorToMessage` in ./logic.test.ts
 *    ("a thrown run flags the record with error + errorMessage and keeps partial
 *    counts", "errorToMessage (BIN-507 audit error string)"). The try/catch →
 *    write-lastRun → re-throw wiring below is review-gated, not test-gated.
 *  • #2 "a second dry-run invocation resumes where the first stopped" — proven by
 *    `cursorFieldFor` / `resolveStartCursor` / `shouldResetCursor` in
 *    ./logic.test.ts ("mutate and dry-run keep separate cursors", "each mode
 *    resumes its OWN cursor"). No test drives two real invocations.
 * Why accepted — CORRECTED 2026-07-20 (Legal panel; the previous rationale here
 * was factually wrong on both counts and must not be relied on again):
 *  • It claimed "this repo runs NO functions test runner". FALSE — vitest.config.ts
 *    has an include glob covering `functions/src` test files, and ./logic.test.ts
 *    (cited above) runs in exactly that runner.
 *  • It claimed "neither firebase-functions-test nor @firebase/rules-unit-testing
 *    is installed". FALSE — @firebase/rules-unit-testing is a devDependency with
 *    a wired `npm run test:rules` and a large emulator suite.
 * What is ACTUALLY true: this file imports firebase-admin entrypoints the root
 * suite cannot load, so covering the orchestrator means EXTENDING the existing
 * emulator harness — incremental work on infrastructure that already exists, not
 * the net-new build the old note claimed.
 * The decision: Malin's call 2026-07-20 — extend that harness BEFORE `mutateEnabled`
 * is ever flipped (BIN-566). This function writes to EVERY user's watchlist, so
 * "review-gated, not test-gated" is not good enough for the mutating mode.
 * Dry-run (count-only) stays shippable as-is. Recorded dated in
 * .claude/rules/accepted-deviations.md — that file, not this comment, is where
 * the standing decision lives.
 */

import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import type { DocumentReference, UpdateData, DocumentData } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import {
  buildClearedPayload,
  groupsToClear,
  isUserWatchlistDocPath,
  resolveMutateEnabled,
  resolveStartCursor,
  cursorFieldFor,
  budgetExhausted,
  deadlineReached,
  shouldResetCursor,
  buildLastRunAudit,
  ALL_SELECT_KEYS,
  type FieldGroup,
  type GroupClearTally,
} from './logic';

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
    const nowMs = Date.now();
    const stateRef = db.doc(STATE_PATH);

    const stateSnap = await stateRef.get();
    const state = stateSnap.data() ?? {};
    // Dry-run gate + cursor-resume policy (BIN-452/BIN-507 pure helpers): dry-run
    // is the default (only an explicit `true` enables writes) and each mode
    // resumes its OWN cursor (mutate → `cursor`, dry-run → `dryRunCursor`) so the
    // two never resume each other's position.
    const mutateEnabled = resolveMutateEnabled(state);
    const cursorField = cursorFieldFor(mutateEnabled);
    let cursor: string | null = resolveStartCursor(state, mutateEnabled);

    let scanned = 0;
    let clearable = 0; // docs that WOULD be (dry-run) / WERE (mutate) cleared
    let skipped = 0;
    let budgetAbort = false;
    let fullPassCompleted = false;
    // BIN-468 A6: per-group would-clear breakdown for the enable-gate metric.
    // The nextair group propagates only via Calendar visits, so it structurally
    // clears at a higher rate than static/providers; a blended count would hide
    // that. Malin reads these three separately before flipping mutateEnabled.
    const wouldClearByGroup: GroupClearTally = { static: 0, providers: 0, nextair: 0 };
    // BIN-507: capture a thrown error so the `lastRun` audit is still written
    // (with an error flag) below — a throw must never leave a silent gap.
    let runError: unknown = null;

    try {
      for (;;) {
        // orderBy(documentId()) uses Firestore's automatic collection-group index
        // (no firestore.indexes.json entry — same as retentionCleanup's __name__
        // paging). `.select(...)` narrows bandwidth (read count is unchanged) to
        // just the group stamps + clearable fields we need to judge staleness/presence.
        let q = db
          .collectionGroup('watchlist')
          .orderBy(FieldPath.documentId())
          .select(...ALL_SELECT_KEYS)
          .limit(PAGE_SIZE);
        if (cursor) q = q.startAfter(cursor);

        const snap = await q.get();
        if (snap.empty) {
          fullPassCompleted = true;
          break;
        }

        const toClear: { ref: DocumentReference; groups: FieldGroup[] }[] = [];
        for (const d of snap.docs) {
          scanned += 1;
          // BIN-504: collectionGroup('watchlist') also matches groups/{id}/watchlist
          // docs (which likewise carry title/posterPath). Skip anything that isn't a
          // users/{uid}/watchlist doc so a live group's titles are never judged stale
          // and cleared. Still counted in `scanned` (it was a billed read, so the
          // per-run budget must see it) but never classified, tallied, or cleared.
          if (!isUserWatchlistDocPath(d.ref.path)) {
            continue;
          }
          // BIN-468 per-group verdict: which of the doc's field-groups are stale
          // AND still hold data. Empty → nothing to clear (fresh or already-swept).
          const groups = groupsToClear(d.data(), nowMs);
          if (groups.length > 0) {
            toClear.push({ ref: d.ref, groups });
            for (const g of groups) wouldClearByGroup[g.name] += 1;
          } else {
            skipped += 1;
          }
        }

        if (mutateEnabled && toClear.length > 0) {
          for (let i = 0; i < toClear.length; i += BATCH_SIZE) {
            const batch = db.batch();
            for (const { ref, groups } of toClear.slice(i, i + BATCH_SIZE)) {
              // update() (not set-merge): a fixed allowlist payload touching only
              // the stale groups' fields + their own stamps, never a read-modify-
              // write of the existing doc and never a fresh sibling group's fields.
              batch.update(
                ref,
                // Deletes each stale group's fields AND that group's stamp — the
                // cleared group ends absent-stamped so ITS repair path repopulates
                // it on next use (BIN-468). One flat payload → one write per doc.
                buildClearedPayload(groups, FieldValue.delete()) as UpdateData<DocumentData>,
              );
            }
            await batch.commit();
          }
        }
        clearable += toClear.length;

        cursor = snap.docs[snap.docs.length - 1].ref.path;
        // Persist the CURRENT mode's cursor per committed page (BIN-507: mutate →
        // `cursor`, dry-run → `dryRunCursor`) so a timeout or budget abort resumes
        // here next run instead of rescanning from doc 0 and re-hitting the same
        // wall — the reason dry-run needs its own cursor.
        await stateRef.set({ [cursorField]: cursor }, { merge: true });

        if (snap.size < PAGE_SIZE) {
          fullPassCompleted = true;
          break;
        }
        // Per-run scan/clear ceiling, then the wall-clock guard — either breaks
        // with budgetAbort so the cursor resumes next run and the audit still
        // writes below (BIN-452 pure thresholds).
        if (budgetExhausted(scanned, clearable)) {
          budgetAbort = true;
          break;
        }
        if (deadlineReached(nowMs, Date.now())) {
          budgetAbort = true;
          break;
        }
      }

      // A completed full pass resets THIS mode's cursor so its next run starts
      // fresh from doc 0 (BIN-507 — both modes now own a cursor).
      if (shouldResetCursor(fullPassCompleted)) {
        await stateRef.set({ [cursorField]: null }, { merge: true });
      }
    } catch (err) {
      // BIN-507: hold the error so the audit below still writes (with an error
      // flag), then re-throw so the platform records a failed invocation rather
      // than a false success. The cursor was persisted per page, so the next run
      // resumes where this one threw.
      runError = err;
    }

    const lastRun = buildLastRunAudit(
      { mutateEnabled, scanned, clearable, skipped, budgetAbort, fullPassCompleted, wouldClearByGroup },
      FieldValue.serverTimestamp(),
      runError,
    );
    await stateRef.set({ lastRun }, { merge: true });

    if (runError) {
      logger.error('tmdbFieldsSweep: run threw — audit written with error flag', lastRun);
      throw runError;
    }
    if (budgetAbort || !fullPassCompleted) {
      logger.warn('tmdbFieldsSweep: incomplete run — resumes next invocation', lastRun);
    } else {
      logger.info('tmdbFieldsSweep done', lastRun);
    }
  },
);
