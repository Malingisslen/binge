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

// ── BIN-1422: the Firestore backups are checked from the same run ─────────────
//
// The backup schedule is daily (`gcloud firestore backups schedules list
// --database="(default)" --project=binge-nu`). Nothing else notices if it stops.
// The check lives here because this run already has an alert path; the cost is
// that it stops with this function, which RUNBOOK §5d names.

/**
 * How old the newest usable backup may be before it alerts. A daily schedule
 * plus margin for the drift between backups and for when in the day this run
 * lands. A missed backup can therefore take up to about two runs to alert.
 */
export const BACKUP_MAX_AGE_MS = 36 * 60 * 60 * 1000;

/** How long the backup check may take before the run goes on without it. */
export const BACKUP_CHECK_TIMEOUT_MS = 15_000;

/** The location the `(default)` database and its backups live in. */
export const BACKUP_LOCATION = 'eur3';

/** The Firestore Admin API call that lists the project's backups. */
export function backupsListUrl(projectId: string): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${BACKUP_LOCATION}/backups`;
}

/** One entry of the API's `backups` array, as far as this check reads it. */
export interface BackupEntry {
  database?: string;
  state?: string;
  snapshotTime?: string;
}

/**
 * The newest READY backup of `(default)`, in ms, or null when there is none.
 * The API's order is not relied on, and a backup still being created, or one of
 * another database, does not count.
 */
export function newestUsableBackupMs(backups: readonly BackupEntry[]): number | null {
  let newest: number | null = null;
  for (const b of backups) {
    if (b.state !== 'READY' || !String(b.database ?? '').endsWith('/databases/(default)')) continue;
    const t = Date.parse(String(b.snapshotTime ?? ''));
    if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
  }
  return newest;
}

/** What the backup port found: a newest backup (or none), or that it could not read the list. */
export type BackupRead = { ok: true; newestMs: number | null } | { ok: false; reason: string };

/**
 * The list call's answer as a read. A non-2xx status or any unreachable location
 * is a failed read: a partial list must not look like a list with no backups.
 */
export function backupReadFromResponse(
  status: number,
  body: { backups?: BackupEntry[]; unreachable?: string[] } | null,
): BackupRead {
  if (status < 200 || status >= 300) return { ok: false, reason: `HTTP ${status}` };
  const unreachable = body?.unreachable ?? [];
  if (unreachable.length > 0) return { ok: false, reason: `oåtkomliga platser: ${unreachable.join(', ')}` };
  return { ok: true, newestMs: newestUsableBackupMs(body?.backups ?? []) };
}

/** What the backup read says is wrong. Two different texts: a missing list is not missing backups. */
export function backupProblems(read: BackupRead, nowMs: number): string[] {
  if (!read.ok) {
    return [`Kan inte läsa listan över säkerhetskopior (${read.reason}). Kontrollera behörigheten innan du drar slutsatsen att kopiorna saknas.`];
  }
  if (read.newestMs === null) {
    return ['Inga säkerhetskopior av databasen finns. Schemat eller lagringstiden kan ha tagits bort.'];
  }
  const ageMs = nowMs - read.newestMs;
  if (ageMs > BACKUP_MAX_AGE_MS) {
    return [`Den senaste säkerhetskopian är ${Math.floor(ageMs / 3_600_000)} timmar gammal (${new Date(read.newestMs).toISOString()}); schemat är dagligt.`];
  }
  return [];
}

/** The admin-inbox notification for backup problems. */
export function backupAlert(problems: readonly string[]): { title: string; body: string } {
  return {
    title: 'Säkerhetskopiorna av databasen behöver tittas på',
    body: `${problems.join(' ')} Se RUNBOOK §5d.`,
  };
}

/** The backup port's answer, or a failed read once BACKUP_CHECK_TIMEOUT_MS has passed. */
async function readBackupsBounded(io: WatchedRunIo): Promise<BackupRead> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<BackupRead>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: `inget svar inom ${BACKUP_CHECK_TIMEOUT_MS / 1000} s` }), BACKUP_CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([io.readBackups(), expiry]);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  /** Lists the database's backups (BIN-1422). Bounded by `runWatched`, so it may hang or throw. */
  readBackups: () => Promise<BackupRead>;
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

  // BIN-1422: after the start stamp and apart from the previous run's alert, so
  // a failure here can drop neither. Bounded, so it cannot eat the sweep's time.
  try {
    const problems = backupProblems(await readBackupsBounded(io), io.now());
    if (problems.length > 0) {
      const { title, body } = backupAlert(problems);
      if (!(await io.notify(title, body))) {
        io.logError('retentionCleanup: backup alert not sent — ADMIN_UID unbound', { problems });
      }
    }
  } catch (err) {
    io.logError('retentionCleanup: backup check failed', err);
  }

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
