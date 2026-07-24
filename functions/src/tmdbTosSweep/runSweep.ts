/**
 * The tmdbFieldsSweep ORCHESTRATOR — the page/classify/clear/cursor/audit loop,
 * lifted out of index.ts so it can be driven by a test (BIN-566).
 *
 * Why it lives here and not in index.ts: index.ts imports firebase-admin +
 * firebase-functions entrypoints, and NEITHER is installed in the root toolchain
 * (`npm ci` at the repo root, which is all CI's `rules-tests` job installs — see
 * .github/workflows/ci.yml). So any file the emulator harness must import has to
 * be admin-free, exactly like ./logic.ts. This module therefore takes its
 * Firestore access as an injected PORT (`SweepIo`) and imports nothing but
 * ./logic — index.ts implements the port with the Admin SDK, the emulator test
 * implements it with the client SDK against a real Firestore emulator.
 *
 * Everything Firestore-SHAPED (collection-group query, `.select()`, batching at
 * 450, doc refs) stays in index.ts's port implementation. Everything the sweep
 * DECIDES (dry-run gate, paging, per-doc verdict, budget/deadline aborts, cursor
 * persistence + resume, the error→audit→re-throw contract) lives here, under test.
 *
 * BIN-566 supersedes the old "review-gated, not test-gated" note that used to sit
 * at the top of index.ts: the orchestrator's error path and cursor resume are now
 * proven against the emulator in src/test/rules/tmdb-sweep-orchestrator.test.ts.
 */

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
  type GroupClearTally,
} from './logic';

/** One scanned watchlist doc, flattened to the two things the loop judges on. */
export interface SweepScanDoc {
  /** Full Firestore path, e.g. `users/{uid}/watchlist/{docId}` (BIN-504 scope guard). */
  readonly path: string;
  /** The `.select()`-narrowed field map (stamps + clearable fields). */
  readonly data: Record<string, unknown>;
}

/** One doc to clear: its path + the exact flat delete-payload for it. */
export interface SweepClearTarget {
  readonly path: string;
  readonly payload: Record<string, unknown>;
}

/** The subset of firebase-functions' logger this loop uses. */
export interface SweepLogger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/**
 * The injected Firestore port. Deliberately primitive: every method maps 1:1 to
 * one Firestore operation the real sweep performs, so a port implementation has
 * nowhere to hide extra logic.
 */
export interface SweepIo {
  /** Docs per scan page. Prod passes the real PAGE_SIZE; tests page smaller. */
  readonly pageSize: number;
  /** FieldValue.delete() (Admin) / deleteField() (client) — the clear sentinel. */
  readonly deleteSentinel: unknown;
  /** FieldValue.serverTimestamp() — stamped on the audit record. */
  readonly serverTimestamp: unknown;
  readonly log: SweepLogger;
  /** Wall clock, injected so the deadline guard is testable. */
  now(): number;
  /** Read the control/audit/cursor state doc. Undefined when it doesn't exist. */
  readState(): Promise<Record<string, unknown> | undefined>;
  /** Merge-write onto the state doc (cursor per page, then the audit record). */
  mergeState(patch: Record<string, unknown>): Promise<void>;
  /** One ordered page of the `watchlist` collection group, starting after `cursor`. */
  scanPage(cursor: string | null, pageSize: number): Promise<readonly SweepScanDoc[]>;
  /**
   * Apply every clear payload. Chunking into ≤500-write batches is the port's job.
   *
   * `onCommitted` MUST be called with each chunk's size as soon as that chunk has
   * durably committed — the loop counts committed writes from it, so a throw partway
   * through a multi-chunk page still audits the clears that already landed. Reporting
   * only at the end (or not at all) would record `docsCleared: 0` for writes that are
   * permanently applied to user watchlists.
   */
  commitClears(
    targets: readonly SweepClearTarget[],
    onCommitted: (count: number) => void,
  ): Promise<void>;
}

/**
 * Run one sweep invocation. Returns the `lastRun` audit record it wrote; re-throws
 * whatever the loop threw AFTER writing that record (BIN-507 contract).
 *
 * NOTE — the state-doc read is deliberately OUTSIDE the audit-protected try, as
 * it always has been: if the control doc itself can't be read we don't know
 * whether this run was a dry-run, so an audit record would be a guess. Behaviour
 * preserved from the pre-BIN-566 inline loop, not an oversight.
 */
export async function runTmdbFieldsSweep(io: SweepIo): Promise<Record<string, unknown>> {
  const startMs = io.now();
  const state = (await io.readState()) ?? {};
  // Dry-run gate + cursor-resume policy (BIN-452/BIN-507 pure helpers): dry-run
  // is the default (only an explicit `true` enables writes) and each mode
  // resumes its OWN cursor (mutate → `cursor`, dry-run → `dryRunCursor`) so the
  // two never resume each other's position.
  const mutateEnabled = resolveMutateEnabled(state);
  const cursorField = cursorFieldFor(mutateEnabled);
  let cursor: string | null = resolveStartCursor(state, mutateEnabled);

  let scanned = 0;
  let clearable = 0; // docs JUDGED clearable — the verdict count
  let cleared = 0;   // docs whose clear DURABLY COMMITTED (0 in dry-run)
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
      const docs = await io.scanPage(cursor, io.pageSize);
      if (docs.length === 0) {
        fullPassCompleted = true;
        break;
      }

      const toClear: SweepClearTarget[] = [];
      for (const d of docs) {
        scanned += 1;
        // BIN-504: the `watchlist` collection group also matches
        // groups/{id}/watchlist docs (which likewise carry title/posterPath).
        // Skip anything that isn't a users/{uid}/watchlist doc so a live group's
        // titles are never judged stale and cleared. Still counted in `scanned`
        // (it was a billed read, so the per-run budget must see it) but never
        // classified, tallied, or cleared.
        if (!isUserWatchlistDocPath(d.path)) continue;
        // BIN-468 per-group verdict: which of the doc's field-groups are stale
        // AND still hold data. Empty → nothing to clear (fresh or already-swept).
        const groups = groupsToClear(d.data, startMs);
        if (groups.length > 0) {
          // A fixed allowlist payload touching only the stale groups' fields +
          // their own stamps — never a read-modify-write of the existing doc and
          // never a fresh sibling group's fields. One flat payload → one write.
          toClear.push({ path: d.path, payload: buildClearedPayload(groups, io.deleteSentinel) });
          for (const g of groups) wouldClearByGroup[g.name] += 1;
        } else {
          skipped += 1;
        }
      }

      // The VERDICT count always advances — it must stay consistent with
      // wouldClearByGroup above, which counted every classified doc.
      clearable += toClear.length;
      if (mutateEnabled && toClear.length > 0) {
        // COMMITTED count advances per chunk, not per page: the port batches at 450,
        // so a 2000-doc page is up to 5 separate commits. Counting only after the
        // whole page resolved meant a throw in a later chunk audited `docsCleared: 0`
        // for earlier chunks that had already landed permanently — understating the
        // blast radius of a partial failure on the one function that writes to every
        // user's watchlist.
        await io.commitClears(toClear, (count) => { cleared += count; });
      }

      cursor = docs[docs.length - 1].path;
      // Persist the CURRENT mode's cursor per committed page (BIN-507: mutate →
      // `cursor`, dry-run → `dryRunCursor`) so a timeout or budget abort resumes
      // here next run instead of rescanning from doc 0 and re-hitting the same
      // wall — the reason dry-run needs its own cursor.
      await io.mergeState({ [cursorField]: cursor });

      if (docs.length < io.pageSize) {
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
      if (deadlineReached(startMs, io.now())) {
        budgetAbort = true;
        break;
      }
    }

    // A completed full pass resets THIS mode's cursor so its next run starts
    // fresh from doc 0 (BIN-507 — both modes now own a cursor).
    if (shouldResetCursor(fullPassCompleted)) {
      await io.mergeState({ [cursorField]: null });
    }
  } catch (err) {
    // BIN-507: hold the error so the audit below still writes (with an error
    // flag), then re-throw so the platform records a failed invocation rather
    // than a false success. The cursor was persisted per page, so the next run
    // resumes where this one threw.
    runError = err;
  }

  const lastRun = buildLastRunAudit(
    { mutateEnabled, scanned, clearable, cleared, skipped, budgetAbort, fullPassCompleted, wouldClearByGroup },
    io.serverTimestamp,
    runError,
  );
  await io.mergeState({ lastRun });

  if (runError) {
    io.log.error('tmdbFieldsSweep: run threw — audit written with error flag', lastRun);
    throw runError;
  }
  if (budgetAbort || !fullPassCompleted) {
    io.log.warn('tmdbFieldsSweep: incomplete run — resumes next invocation', lastRun);
  } else {
    io.log.info('tmdbFieldsSweep done', lastRun);
  }
  return lastRun;
}
