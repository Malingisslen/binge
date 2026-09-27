/**
 * BIN-1317 — the decisions behind retentionCleanup's own failure alarm.
 *
 * Pure on purpose (no firebase-admin), like ./logic.ts: the schedule wrapper in
 * ./index.ts supplies the health-document, notification and sweep operations;
 * every "is this worth an alert" decision, and the order the steps run in, is
 * here, where a test can reach it.
 *
 * WHAT IT CAN SEE. The run stamps `lastStartedAt` before it sweeps,
 * `lastScheduledSweepsDoneAt` when the sweep logs `SCHEDULED_SWEEPS_DONE_LINE`,
 * and `lastDoneAt` after `runRetentionCleanup` returns. The NEXT run reads all
 * three, which tells apart the two signatures the BIN-1193 accepted deviation
 * names:
 *   - the first line stamped but never done → the run died in the sweeps that
 *     run after that line;
 *   - neither stamped → the run died before the first line;
 *   - started too long ago → a scheduled run did not happen at all.
 * And a run that completes counts its own `io.log.error` calls: every sweep
 * catches its own failure and carries on, so a failed scan otherwise ends in an
 * ordinary-looking `done` line.
 *
 * The middle stamp is a write of its own, so a run killed before that write
 * lands reads as the second signature. The stamp's own failure is logged.
 *
 * WHAT IT CANNOT SEE. It is the function watching itself, so if the schedule
 * stops firing altogether no run is left to notice. Named in
 * docs/RUNBOOK.md §5d.
 */

/** The function's `timeoutSeconds`, shared with ./index.ts so the two cannot drift. */
export const RETENTION_TIMEOUT_SECONDS = 300;

/**
 * The two log lines `runRetentionCleanup` writes, as ./runCleanup.ts spells
 * them. runHealth.test.ts reads that file to hold the two spellings together.
 */
export const SCHEDULED_SWEEPS_DONE_LINE = 'retentionCleanup: scheduled sweeps done';
export const DONE_LINE = 'retentionCleanup done';

/**
 * How long after `lastStartedAt` a missing `lastDoneAt` is still a run in
 * progress rather than a dead one. Cloud Scheduler delivers at least once, so a
 * duplicate invocation can start while the first is still sweeping; it must not
 * report its sibling as dead. The timeout plus margin.
 */
export const RUN_IN_PROGRESS_GRACE_MS = RETENTION_TIMEOUT_SECONDS * 1000 + 5 * 60 * 1000;

/**
 * How old `lastStartedAt` may be before a scheduled run counts as missed. The
 * schedule is every 24 hours; the extra half day absorbs scheduler jitter so a
 * run that is merely late does not alert.
 */
export const MISSED_RUN_AFTER_MS = 36 * 60 * 60 * 1000;

/** Error messages quoted in the alert body. The count is always given in full. */
export const MAX_QUOTED_ERRORS = 3;

/** The admin-only document the run keeps its own timestamps in. */
export const RUN_HEALTH_DOC_PATH = 'retentionCleanupHealth/current';

export interface RunHealthRecord {
  lastStartedAt?: number;
  lastScheduledSweepsDoneAt?: number;
  lastDoneAt?: number;
}

/**
 * What the previous run's timestamps say went wrong, read at the START of this
 * run. An absent record — the first run after this shipped — says nothing.
 */
export function previousRunProblems(prev: RunHealthRecord | null, nowMs: number): string[] {
  if (!prev || typeof prev.lastStartedAt !== 'number') return [];
  const started = prev.lastStartedAt;
  const done = typeof prev.lastDoneAt === 'number' ? prev.lastDoneAt : null;
  const midway = typeof prev.lastScheduledSweepsDoneAt === 'number' ? prev.lastScheduledSweepsDoneAt : null;
  const problems: string[] = [];

  const sinceStartMs = nowMs - started;
  if ((done === null || done < started) && sinceStartMs > RUN_IN_PROGRESS_GRACE_MS) {
    const when = new Date(started).toISOString();
    // A midway stamp older than this run's start belongs to an earlier run.
    if (midway !== null && midway >= started) {
      problems.push(
        `Förra körningen (${when}) loggade "${SCHEDULED_SWEEPS_DONE_LINE}" men aldrig "${DONE_LINE}": den dog i sopningarna efter den första raden.`,
      );
    } else {
      problems.push(
        `Förra körningen (${when}) loggade varken "${SCHEDULED_SWEEPS_DONE_LINE}" eller "${DONE_LINE}": den dog innan den nådde den första raden.`,
      );
    }
  }
  if (sinceStartMs > MISSED_RUN_AFTER_MS) {
    problems.push(
      `Ingen körning har startat på ${Math.floor(sinceStartMs / 3_600_000)} timmar (schemat är var 24:e timme).`,
    );
  }
  return problems;
}

/**
 * What THIS run says went wrong: the errors it logged, and whether it threw.
 * `runRetentionCleanup` is written never to throw, so a throw is itself news.
 */
export function thisRunProblems(loggedErrors: readonly string[], threw: unknown): string[] {
  const problems: string[] = [];
  if (loggedErrors.length > 0) {
    const quoted = loggedErrors.slice(0, MAX_QUOTED_ERRORS).join('; ');
    const more = loggedErrors.length > MAX_QUOTED_ERRORS ? ' …' : '';
    problems.push(`Körningen loggade ${loggedErrors.length} fel: ${quoted}${more}`);
  }
  if (threw !== null && threw !== undefined) {
    const message = threw instanceof Error ? threw.message : String(threw);
    problems.push(`Körningen kastade innan den var klar: ${message}`);
  }
  return problems;
}

/** The admin-inbox notification for a non-empty problem list. */
export function retentionAlert(problems: readonly string[]): { title: string; body: string } {
  return {
    title: 'Rensningen (retentionCleanup) behöver tittas på',
    body: `${problems.join(' ')} Se RUNBOOK §5d.`,
  };
}

/** What the sweep port hands back to `runWatched`: one callback per log level. */
export interface SweepLogTap {
  /** The message of every error the sweep logs. */
  onError: (message: string) => void;
  /** The message of every info line the sweep logs. */
  onInfo: (message: string) => void;
}

/** What the schedule wrapper in ./index.ts hands `runWatched`: one operation per method. */
export interface WatchedRunIo {
  now: () => number;
  readHealth: () => Promise<RunHealthRecord | null>;
  writeHealth: (patch: RunHealthRecord & { lastErrorCount?: number }) => Promise<void>;
  /** Resolves false when there is no recipient to send to. */
  notify: (title: string, body: string) => Promise<boolean>;
  /** Runs the sweep, reporting its log lines through `tap`. */
  sweep: (tap: SweepLogTap) => Promise<void>;
  logError: (message: string, data?: unknown) => void;
}

async function sendAlert(io: WatchedRunIo, problems: readonly string[]): Promise<void> {
  if (problems.length === 0) return;
  try {
    const { title, body } = retentionAlert(problems);
    if (!(await io.notify(title, body))) {
      io.logError('retentionCleanup: alert not sent — ADMIN_UID unbound', { problems });
    }
  } catch (err) {
    io.logError('retentionCleanup: alert send failed', { problems, err });
  }
}

/**
 * The watched run. Every health and alert step is best-effort and caught on its
 * own: a failure there must never stop the sweep, and must never turn a run
 * that swept into one that reports failure.
 *
 * The previous run's problems are sent BEFORE the sweep starts. A run killed by
 * the timeout never reaches any line after its sweep, so an alert sent there
 * would be lost on exactly the run that repeats the death it is reporting.
 */
export async function runWatched(io: WatchedRunIo): Promise<void> {
  let previous: string[] = [];
  try {
    previous = previousRunProblems(await io.readHealth(), io.now());
    await io.writeHealth({ lastStartedAt: io.now() });
  } catch (err) {
    io.logError('retentionCleanup: run health read/stamp failed', err);
  }
  await sendAlert(io, previous);

  const loggedErrors: string[] = [];
  // The midway stamp is written while the sweep carries on; it is awaited
  // below only so a completed run does not return before it settles.
  let midwayStamp: Promise<void> = Promise.resolve();
  let threw: unknown = null;
  try {
    await io.sweep({
      onError: (message) => loggedErrors.push(message),
      onInfo: (message) => {
        if (message !== SCHEDULED_SWEEPS_DONE_LINE) return;
        // Deferred through a promise so even a synchronous throw stays out of the sweep's log call.
        midwayStamp = Promise.resolve()
          .then(() => io.writeHealth({ lastScheduledSweepsDoneAt: io.now() }))
          .catch((err: unknown) => {
            io.logError('retentionCleanup: run health midway stamp failed', err);
          });
      },
    });
  } catch (err) {
    threw = err;
  }
  await midwayStamp;

  if (threw === null) {
    try {
      await io.writeHealth({ lastDoneAt: io.now(), lastErrorCount: loggedErrors.length });
    } catch (err) {
      io.logError('retentionCleanup: run health done-stamp failed', err);
    }
  }

  await sendAlert(io, thisRunProblems(loggedErrors, threw));

  if (threw !== null) throw threw;
}
