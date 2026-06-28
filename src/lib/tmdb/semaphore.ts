// Concurrency limiter, extracted from client.ts so the queue + abort logic is
// unit-testable in isolation (BIN-291). `createSemaphore(max)` hands back an
// acquire/release pair: acquire resolves immediately while slots are free and
// otherwise parks the caller in a FIFO queue. The key behaviour the extraction
// guards is cancellation — a queued `acquire(signal)` rejects promptly with an
// AbortError (and drops itself from the queue) the moment its signal fires,
// instead of parking until a slot happens to free. CLAUDE.md advertises
// "AbortSignal hela vägen"; the queue was the one spot it wasn't.

export interface Semaphore {
  /**
   * Reserve a slot. Resolves once a slot is held (caller MUST pair it with a
   * `release()` in a finally). If `signal` is already aborted, or aborts while
   * the caller is queued, the returned promise rejects with an AbortError and
   * no slot is reserved — so the caller must NOT call `release()` on rejection.
   */
  acquire(signal?: AbortSignal): Promise<void>;
  release(): void;
  /** Slots currently held — for assertions/diagnostics. */
  readonly inFlight: number;
  /** Callers parked waiting for a slot — for assertions/diagnostics. */
  readonly queueLength: number;
}

export function createSemaphore(max: number): Semaphore {
  let inFlight = 0;
  const waitQueue: Array<() => void> = [];

  return {
    get inFlight() {
      return inFlight;
    },
    get queueLength() {
      return waitQueue.length;
    },
    acquire(signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) {
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      }
      if (inFlight < max) {
        inFlight++;
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const i = waitQueue.indexOf(grant);
          // Drop the dead waiter so releaseSlot() never grants it a slot it can
          // no longer use (which would leak a permit until the next release).
          if (i !== -1) waitQueue.splice(i, 1);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        const grant = () => {
          signal?.removeEventListener('abort', onAbort);
          inFlight++;
          resolve();
        };
        waitQueue.push(grant);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
    release(): void {
      inFlight--;
      const next = waitQueue.shift();
      if (next) next();
    },
  };
}
