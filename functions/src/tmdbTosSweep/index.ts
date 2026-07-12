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
 */

import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import type { DocumentReference, UpdateData, DocumentData } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import {
  buildClearedPayload,
  groupsToClear,
  resolveMutateEnabled,
  resolveStartCursor,
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
    // Dry-run gate + cursor-resume policy (BIN-452 pure helpers): dry-run is the
    // default (only an explicit `true` enables writes) and the cursor resumes
    // ONLY in mutate mode so a stale cursor can't make a dry-run skip docs.
    const mutateEnabled = resolveMutateEnabled(state);
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
      // Persist the cursor per committed page (mutate mode only) so a timeout or
      // budget abort resumes here instead of rescanning from doc 0.
      if (mutateEnabled) {
        await stateRef.set({ cursor }, { merge: true });
      }

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

    // A completed full pass resets the cursor so next month starts fresh.
    if (shouldResetCursor(mutateEnabled, fullPassCompleted)) {
      await stateRef.set({ cursor: null }, { merge: true });
    }

    const lastRun = buildLastRunAudit(
      { mutateEnabled, scanned, clearable, skipped, budgetAbort, fullPassCompleted, wouldClearByGroup },
      FieldValue.serverTimestamp(),
    );
    await stateRef.set({ lastRun }, { merge: true });

    if (budgetAbort || !fullPassCompleted) {
      logger.warn('tmdbFieldsSweep: incomplete run — resumes next invocation', lastRun);
    } else {
      logger.info('tmdbFieldsSweep done', lastRun);
    }
  },
);
