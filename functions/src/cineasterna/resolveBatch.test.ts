import { describe, it, expect, vi } from 'vitest';
import { resolveBatch, type ImdbMap, type ResolvedValue } from './resolveBatch';

// Real production constants — the whole BIN-146 point is that 50 is NOT a multiple
// of 6, so checkpoints land on the CROSS (54), never an exact multiple.
const CONCURRENCY = 6;
const INTERVAL = 50;

const titles = (n: number, prefix = 't') =>
  Array.from({ length: n }, (_, i) => ({ imdbId: `${prefix}${i}` }));

// Records the newlyResolved value at each checkpoint call.
function recordingCheckpoint() {
  const at: number[] = [];
  return { at, fn: async (n: number) => { at.push(n); } };
}

describe('resolveBatch — BIN-146 checkpoint crosses the interval (not exact multiples)', () => {
  it('fires the first checkpoint at the CROSS (54), not at 50 — old %-guard would fire 0', async () => {
    const imdbMap: ImdbMap = {};
    const cp = recordingCheckpoint();
    const res = await resolveBatch({
      titles: titles(60), imdbMap,
      resolve: async () => 1, // every title resolves to a number
      checkpoint: cp.fn, concurrency: CONCURRENCY, checkpointInterval: INTERVAL,
    });
    expect(res.newlyResolved).toBe(60);
    expect(res.checkpoints).toBe(1);
    expect(cp.at).toEqual([54]); // 6,12,…,48,54 → first chunk to cross 50 is 54
  });

  it('re-arms the interval for a second cross (two checkpoints over 120)', async () => {
    const imdbMap: ImdbMap = {};
    const cp = recordingCheckpoint();
    const res = await resolveBatch({
      titles: titles(120), imdbMap,
      resolve: async () => 1, checkpoint: cp.fn,
      concurrency: CONCURRENCY, checkpointInterval: INTERVAL,
    });
    expect(res.checkpoints).toBe(2);
    expect(cp.at).toEqual([54, 108]); // cross 1 at 54, then 54+≥50 → 108
  });
});

describe('resolveBatch — terminal-value semantics', () => {
  it("'NOT_FOUND' is written terminal AND counts toward checkpoints, exactly like a number", async () => {
    const imdbMap: ImdbMap = {};
    const cp = recordingCheckpoint();
    const res = await resolveBatch({
      titles: titles(60), imdbMap,
      resolve: async () => 'NOT_FOUND', checkpoint: cp.fn,
      concurrency: CONCURRENCY, checkpointInterval: INTERVAL,
    });
    expect(res.newlyResolved).toBe(60);
    expect(res.checkpoints).toBe(1);
    expect(cp.at).toEqual([54]);
    expect(Object.values(imdbMap).every(v => v === 'NOT_FOUND')).toBe(true);
  });

  it('a null (transient) result is stored but does NOT advance the checkpoint count', async () => {
    const imdbMap: ImdbMap = {};
    const cp = recordingCheckpoint();
    const res = await resolveBatch({
      titles: [{ imdbId: 'a' }, { imdbId: 'b' }, { imdbId: 'c' }], imdbMap,
      resolve: async (id) => (id === 'b' ? null : 7),
      checkpoint: cp.fn, concurrency: CONCURRENCY, checkpointInterval: INTERVAL,
    });
    expect(res.newlyResolved).toBe(2); // a, c counted; b (null) not
    expect(imdbMap).toEqual({ a: 7, b: null, c: 7 });
    expect(cp.at).toEqual([]); // 2 < 50 → no checkpoint
  });
});

describe('resolveBatch — only unresolved titles are retried', () => {
  it('skips terminal cached values (number / NOT_FOUND), retries undefined / null', async () => {
    const imdbMap: ImdbMap = { done: 5, gone: 'NOT_FOUND', transient: null };
    const asked: string[] = [];
    await resolveBatch({
      titles: [{ imdbId: 'done' }, { imdbId: 'gone' }, { imdbId: 'transient' }, { imdbId: 'fresh' }],
      imdbMap,
      resolve: async (id) => { asked.push(id); return 9; },
      checkpoint: async () => {}, concurrency: CONCURRENCY, checkpointInterval: INTERVAL,
    });
    expect(asked.sort()).toEqual(['fresh', 'transient']); // done + gone skipped
    expect(imdbMap).toEqual({ done: 5, gone: 'NOT_FOUND', transient: 9, fresh: 9 });
  });
});

describe('resolveBatch — final partial batch is not lost in memory', () => {
  it('leaves every resolved entry in imdbMap even when the last batch never crosses', async () => {
    const imdbMap: ImdbMap = {};
    const res = await resolveBatch({
      titles: titles(7), imdbMap,
      resolve: async () => 3, checkpoint: async () => {},
      concurrency: CONCURRENCY, checkpointInterval: INTERVAL,
    });
    expect(res.newlyResolved).toBe(7);
    expect(res.checkpoints).toBe(0); // 7 < 50 → never checkpointed...
    expect(Object.keys(imdbMap)).toHaveLength(7); // ...but all 7 are in the in-memory map
  });
});

describe('resolveBatch — fail-fast preserved', () => {
  it('rejects if a resolve throws, with earlier chunks already applied to imdbMap', async () => {
    const imdbMap: ImdbMap = {};
    const resolve = vi.fn(async (id: string): Promise<ResolvedValue> => {
      if (id === 't3') throw new Error('TMDB blew up');
      return 1;
    });
    await expect(resolveBatch({
      titles: titles(6), imdbMap, resolve,
      checkpoint: async () => {}, concurrency: 2, checkpointInterval: INTERVAL,
    })).rejects.toThrow('TMDB blew up');
    // chunk 1 (t0,t1) completed before the throw in chunk 2 (t2,t3).
    expect(imdbMap.t0).toBe(1);
    expect(imdbMap.t1).toBe(1);
  });
});
