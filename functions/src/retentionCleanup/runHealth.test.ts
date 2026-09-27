import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  previousRunProblems,
  thisRunProblems,
  retentionAlert,
  runWatched,
  RUN_IN_PROGRESS_GRACE_MS,
  MISSED_RUN_AFTER_MS,
  MAX_QUOTED_ERRORS,
  SCHEDULED_SWEEPS_DONE_LINE,
  DONE_LINE,
  type RunHealthRecord,
  type WatchedRunIo,
} from './runHealth';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 27, 3, 0, 0);

describe('previousRunProblems (BIN-1317)', () => {
  it('says nothing on the first run, before any record exists', () => {
    expect(previousRunProblems(null, NOW)).toEqual([]);
    expect(previousRunProblems({}, NOW)).toEqual([]);
  });

  it('says nothing about a healthy previous run a day ago', () => {
    const started = NOW - 24 * HOUR;
    expect(previousRunProblems({ lastStartedAt: started, lastDoneAt: started + 60_000 }, NOW)).toEqual([]);
  });

  it('signature (a): the first line was stamped but done never was — names the tail', () => {
    const started = NOW - 24 * HOUR;
    const problems = previousRunProblems(
      { lastStartedAt: started, lastScheduledSweepsDoneAt: started + 60_000, lastDoneAt: started - 24 * HOUR },
      NOW,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`loggade "${SCHEDULED_SWEEPS_DONE_LINE}" men aldrig "${DONE_LINE}"`);
  });

  it('signature (b): neither line was stamped — names the part before the first line', () => {
    const started = NOW - 24 * HOUR;
    const problems = previousRunProblems({ lastStartedAt: started, lastDoneAt: started - 24 * HOUR }, NOW);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`loggade varken "${SCHEDULED_SWEEPS_DONE_LINE}" eller "${DONE_LINE}"`);
  });

  it('signature (b) even when an EARLIER run left a first-line stamp behind', () => {
    const started = NOW - 24 * HOUR;
    const problems = previousRunProblems(
      { lastStartedAt: started, lastScheduledSweepsDoneAt: started - 24 * HOUR + 60_000, lastDoneAt: started - 24 * HOUR + 120_000 },
      NOW,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('loggade varken');
  });

  it('flags a started run with no done stamp at all', () => {
    expect(previousRunProblems({ lastStartedAt: NOW - 24 * HOUR }, NOW)).toEqual([
      expect.stringContaining('loggade varken'),
    ]);
  });

  it('does not call a sibling still inside its grace window dead (at-least-once delivery)', () => {
    const started = NOW - RUN_IN_PROGRESS_GRACE_MS;
    expect(previousRunProblems({ lastStartedAt: started }, NOW)).toEqual([]);
    expect(previousRunProblems({ lastStartedAt: started - 1 }, NOW)).toHaveLength(1);
  });

  it('flags a missed schedule once the last start is older than the window, and not before', () => {
    const atEdge = NOW - MISSED_RUN_AFTER_MS;
    expect(previousRunProblems({ lastStartedAt: atEdge, lastDoneAt: atEdge + 60_000 }, NOW)).toEqual([]);
    const late = atEdge - 1;
    const problems = previousRunProblems({ lastStartedAt: late, lastDoneAt: late + 60_000 }, NOW);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('36 timmar');
  });

  it('reports both when a run died and nothing has run since', () => {
    expect(previousRunProblems({ lastStartedAt: NOW - 48 * HOUR }, NOW)).toHaveLength(2);
  });
});

describe('thisRunProblems (BIN-1317)', () => {
  it('says nothing for a clean run', () => {
    expect(thisRunProblems([], null)).toEqual([]);
  });

  it('reports the full error count but quotes only the first few messages', () => {
    const errors = Array.from({ length: MAX_QUOTED_ERRORS + 2 }, (_, i) => `err-${i}`);
    const [line] = thisRunProblems(errors, null);
    expect(line).toContain(`${errors.length} fel`);
    expect(line).toContain(`err-${MAX_QUOTED_ERRORS - 1}`);
    expect(line).not.toContain(`err-${MAX_QUOTED_ERRORS}`);
  });

  it('reports a throw, with or without logged errors', () => {
    expect(thisRunProblems([], new Error('boom'))).toEqual([expect.stringContaining('boom')]);
    expect(thisRunProblems(['retentionCleanup: sessions scan failed'], 'x')).toHaveLength(2);
  });
});

describe('retentionAlert (BIN-1317)', () => {
  it('carries every problem and points at the runbook', () => {
    const { title, body } = retentionAlert(['a.', 'b.']);
    expect(title).toContain('retentionCleanup');
    expect(body).toContain('a.');
    expect(body).toContain('b.');
    expect(body).toContain('RUNBOOK §5d');
  });
});

/**
 * An in-memory port. `sweep` is swapped per test; the default one never
 * settles, which is what a run killed by the timeout looks like from inside:
 * nothing after the sweep's await ever executes.
 */
function harness(store: { health: RunHealthRecord | null }, nowMs: number) {
  const events: string[] = [];
  const notes: string[] = [];
  const io: WatchedRunIo = {
    now: () => nowMs,
    readHealth: async () => (store.health ? { ...store.health } : null),
    writeHealth: async (patch) => {
      store.health = { ...(store.health ?? {}), ...patch };
    },
    notify: async (_title, body) => {
      events.push('notify');
      notes.push(body);
      return true;
    },
    sweep: () => {
      events.push('sweep');
      return new Promise<void>(() => {});
    },
    logError: vi.fn(),
  };
  return { io, events, notes };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('runWatched (BIN-1317)', () => {
  it('replay: two runs dying in a row — the second alerts BEFORE it starts sweeping', async () => {
    const store: { health: RunHealthRecord | null } = { health: null };

    const first = harness(store, NOW);
    void runWatched(first.io);
    await flush();
    expect(first.events).toEqual(['sweep']);

    const second = harness(store, NOW + 24 * HOUR);
    void runWatched(second.io);
    await flush();
    expect(second.events).toEqual(['notify', 'sweep']);
    expect(second.notes[0]).toContain('loggade varken');
  });

  it('replay, signature (a): a run that logs the first line and then hangs is named as such by the next', async () => {
    const store: { health: RunHealthRecord | null } = { health: null };

    const first = harness(store, NOW);
    first.io.sweep = ({ onInfo }) => {
      first.events.push('sweep');
      onInfo('retentionCleanup: some other info line');
      onInfo(SCHEDULED_SWEEPS_DONE_LINE);
      return new Promise<void>(() => {});
    };
    void runWatched(first.io);
    await flush();
    expect(store.health).toMatchObject({ lastStartedAt: NOW, lastScheduledSweepsDoneAt: NOW });
    expect(store.health?.lastDoneAt).toBeUndefined();

    const second = harness(store, NOW + 24 * HOUR);
    void runWatched(second.io);
    await flush();
    expect(second.events).toEqual(['notify', 'sweep']);
    expect(second.notes[0]).toContain(`men aldrig "${DONE_LINE}"`);
  });

  it('replay, no run at all: the next run to start reports the gap', async () => {
    const store = { health: { lastStartedAt: NOW - 72 * HOUR, lastDoneAt: NOW - 72 * HOUR + 60_000 } as RunHealthRecord };
    const h = harness(store, NOW);
    void runWatched(h.io);
    await flush();
    expect(h.events).toEqual(['notify', 'sweep']);
    expect(h.notes[0]).toContain('Ingen körning har startat på 72 timmar');
  });

  it('a failing first-line stamp is logged and neither stops nor fails the sweep', async () => {
    const store: { health: RunHealthRecord | null } = { health: null };
    const h = harness(store, NOW);
    const write = h.io.writeHealth;
    h.io.writeHealth = async (patch) => {
      if ('lastScheduledSweepsDoneAt' in patch) throw new Error('stamp down');
      await write(patch);
    };
    h.io.sweep = async ({ onInfo }) => {
      h.events.push('sweep');
      onInfo(SCHEDULED_SWEEPS_DONE_LINE);
    };
    await runWatched(h.io);
    expect(h.events).toEqual(['sweep']);
    expect(store.health).toMatchObject({ lastStartedAt: NOW, lastDoneAt: NOW });
    expect(h.io.logError).toHaveBeenCalledWith('retentionCleanup: run health midway stamp failed', expect.anything());
  });

  it('an alert with no recipient is logged as not sent and the sweep still runs', async () => {
    const store = { health: { lastStartedAt: NOW - 72 * HOUR } as RunHealthRecord };
    const h = harness(store, NOW);
    h.io.notify = async () => {
      h.events.push('notify');
      return false;
    };
    h.io.sweep = async () => {
      h.events.push('sweep');
    };
    await expect(runWatched(h.io)).resolves.toBeUndefined();
    expect(h.events).toEqual(['notify', 'sweep']);
    expect(h.io.logError).toHaveBeenCalledWith('retentionCleanup: alert not sent — ADMIN_UID unbound', expect.anything());
  });

  it('a failing start stamp is logged and the sweep still runs', async () => {
    const store: { health: RunHealthRecord | null } = { health: null };
    const h = harness(store, NOW);
    const write = h.io.writeHealth;
    h.io.writeHealth = async (patch) => {
      if ('lastStartedAt' in patch) throw new Error('stamp down');
      await write(patch);
    };
    h.io.sweep = async () => {
      h.events.push('sweep');
    };
    await expect(runWatched(h.io)).resolves.toBeUndefined();
    expect(h.events).toEqual(['sweep']);
    expect(h.io.logError).toHaveBeenCalledWith('retentionCleanup: run health read/stamp failed', expect.anything());
  });

  it('a failing done stamp is logged and does not turn a run that swept into a failure', async () => {
    const store: { health: RunHealthRecord | null } = { health: null };
    const h = harness(store, NOW);
    const write = h.io.writeHealth;
    h.io.writeHealth = async (patch) => {
      if ('lastDoneAt' in patch) throw new Error('stamp down');
      await write(patch);
    };
    h.io.sweep = async () => {
      h.events.push('sweep');
    };
    await expect(runWatched(h.io)).resolves.toBeUndefined();
    expect(h.events).toEqual(['sweep']);
    expect(h.io.logError).toHaveBeenCalledWith('retentionCleanup: run health done-stamp failed', expect.anything());
  });

  it('sends nothing for a healthy run after a healthy run', async () => {
    const store = { health: { lastStartedAt: NOW - 24 * HOUR, lastDoneAt: NOW - 24 * HOUR + 60_000 } };
    const h = harness(store, NOW);
    h.io.sweep = async () => {
      h.events.push('sweep');
    };
    await runWatched(h.io);
    expect(h.events).toEqual(['sweep']);
    expect(store.health).toMatchObject({ lastStartedAt: NOW, lastDoneAt: NOW, lastErrorCount: 0 });
  });

  it('alerts after the sweep for errors this run logged, separately from the previous run', async () => {
    const store = { health: { lastStartedAt: NOW - 24 * HOUR } as RunHealthRecord };
    const h = harness(store, NOW);
    h.io.sweep = async ({ onError }) => {
      h.events.push('sweep');
      onError('retentionCleanup: sessions scan failed');
    };
    await runWatched(h.io);
    expect(h.events).toEqual(['notify', 'sweep', 'notify']);
    expect(h.notes[0]).toContain('retentionCleanup done');
    expect(h.notes[1]).toContain('sessions scan failed');
  });

  it('rethrows a sweep that throws, after alerting about it, and leaves lastDoneAt unstamped', async () => {
    const store: { health: RunHealthRecord | null } = { health: null };
    const h = harness(store, NOW);
    h.io.sweep = async () => {
      h.events.push('sweep');
      throw new Error('boom');
    };
    await expect(runWatched(h.io)).rejects.toThrow('boom');
    expect(h.events).toEqual(['sweep', 'notify']);
    expect(h.notes[0]).toContain('boom');
    expect(store.health?.lastDoneAt).toBeUndefined();
  });

  it('still sweeps when the health read and the alert both fail', async () => {
    const store = { health: null };
    const h = harness(store, NOW);
    h.io.readHealth = async () => {
      throw new Error('read down');
    };
    h.io.notify = async () => {
      throw new Error('inbox down');
    };
    let swept = false;
    h.io.sweep = async ({ onError }) => {
      swept = true;
      onError('x');
    };
    await runWatched(h.io);
    expect(swept).toBe(true);
    expect(h.io.logError).toHaveBeenCalledWith('retentionCleanup: run health read/stamp failed', expect.anything());
    expect(h.io.logError).toHaveBeenCalledWith('retentionCleanup: alert send failed', expect.anything());
  });
});

describe('the log lines runHealth listens for (BIN-1317)', () => {
  it('are spelled exactly as runRetentionCleanup logs them', () => {
    const source = readFileSync(join(__dirname, 'runCleanup.ts'), 'utf8').replace(/\r\n/g, '\n');
    expect(source).toContain(`io.log.info('${SCHEDULED_SWEEPS_DONE_LINE}',`);
    expect(source).toContain(`io.log.info('${DONE_LINE}',`);
  });
});
