// Pure extraction (no firebase-admin) of the Cineasterna resolve+checkpoint loop,
// so the BIN-146 checkpoint-cross logic is unit-testable. The resolver and the
// checkpoint writer are injected; the real wiring (resolveTmdbId + mapRef.set) lives
// in index.ts's thin resolveUnknown wrapper.

export type ResolvedValue = number | 'NOT_FOUND' | null;
export type ImdbMap = Record<string, ResolvedValue>;

export interface ResolveBatchResult {
  newlyResolved: number;
  checkpoints: number;
}

/**
 * Resolve a batch of unknown titles with bounded concurrency, writing incremental
 * checkpoints. Mutates `imdbMap` in place. Behavior-identical to the original inline
 * loop:
 *  - `unknown` = titles whose cached value is undefined (never attempted) or null
 *    (prior transient error); a `number` or `'NOT_FOUND'` is terminal and skipped.
 *  - each result is stored as `result ?? null`, so `'NOT_FOUND'` IS written as a
 *    terminal cached value and counts toward progress; only `null` (transient) does
 *    not advance `newlyResolved`.
 *  - BIN-146: checkpoint when CROSSING another `checkpointInterval` since the last —
 *    NOT on exact multiples (newlyResolved steps by up to `concurrency`, so it rarely
 *    lands on a multiple; the old `% interval === 0` guard almost never fired).
 *  - no final checkpoint after the loop (preserved): the caller builds the catalog
 *    from the in-memory imdbMap; checkpoints are only a cross-run cache + timeout
 *    survival. (The missing final write is tracked as a separate follow-up.)
 *
 * `Promise.all` per chunk is fail-fast: if a `resolve` rejects, the whole batch
 * rejects (the scheduled run fails and retries next week). resolveTmdbId never throws
 * in practice, but the contract is preserved deliberately.
 */
export async function resolveBatch(opts: {
  titles: { imdbId: string }[];
  imdbMap: ImdbMap;
  resolve: (imdbId: string) => Promise<ResolvedValue>;
  checkpoint: (newlyResolved: number) => Promise<void>;
  concurrency: number;
  checkpointInterval: number;
}): Promise<ResolveBatchResult> {
  const { titles, imdbMap, resolve, checkpoint, concurrency, checkpointInterval } = opts;

  const unknown = titles.filter((t) => {
    const cached = imdbMap[t.imdbId];
    return cached === undefined || cached === null;
  });

  let newlyResolved = 0;
  let lastCheckpointed = 0;
  let checkpoints = 0;

  for (let i = 0; i < unknown.length; i += concurrency) {
    const chunk = unknown.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map((t) => resolve(t.imdbId)));
    for (let j = 0; j < chunk.length; j++) {
      const result = results[j];
      imdbMap[chunk[j].imdbId] = result ?? null;
      if (result !== null) newlyResolved++; // both number and 'NOT_FOUND' are terminal progress
    }
    if (newlyResolved - lastCheckpointed >= checkpointInterval) {
      await checkpoint(newlyResolved);
      lastCheckpointed = newlyResolved;
      checkpoints++;
    }
  }

  return { newlyResolved, checkpoints };
}
