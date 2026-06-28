import { describe, it, expect } from 'vitest';
import { createSemaphore } from './semaphore';

describe('createSemaphore', () => {
  it('resolves immediately while slots are free and tracks inFlight', async () => {
    const sem = createSemaphore(2);
    await sem.acquire();
    await sem.acquire();
    expect(sem.inFlight).toBe(2);
    expect(sem.queueLength).toBe(0);
  });

  it('queues callers once full and grants the slot on release (FIFO)', async () => {
    const sem = createSemaphore(1);
    await sem.acquire(); // slot held
    let secondGranted = false;
    const second = sem.acquire().then(() => { secondGranted = true; });
    // Still parked — the only slot is held.
    expect(sem.queueLength).toBe(1);
    expect(secondGranted).toBe(false);
    sem.release();
    await second;
    expect(secondGranted).toBe(true);
    expect(sem.inFlight).toBe(1);
    expect(sem.queueLength).toBe(0);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const sem = createSemaphore(1);
    await sem.acquire(); // fill the slot so the next would queue
    const ac = new AbortController();
    ac.abort();
    await expect(sem.acquire(ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
    // A pre-aborted acquire must not have parked anything.
    expect(sem.queueLength).toBe(0);
  });

  it('rejects a QUEUED waiter promptly when its signal fires, and drops it from the queue', async () => {
    // This is the BIN-291 guard: before the fix the waiter parked until a slot
    // freed. Deleting the abort handling makes this test hang (never rejects).
    const sem = createSemaphore(1);
    await sem.acquire(); // slot held → next acquire queues
    const ac = new AbortController();
    const queued = sem.acquire(ac.signal);
    expect(sem.queueLength).toBe(1);

    ac.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    // The dead waiter is gone, so a later release does NOT grant it a phantom slot.
    expect(sem.queueLength).toBe(0);
  });

  it('keeps slot accounting balanced: an aborted waiter does not consume a permit', async () => {
    const sem = createSemaphore(1);
    await sem.acquire();           // permit 1 held
    const ac = new AbortController();
    const aborted = sem.acquire(ac.signal); // queued
    const live = sem.acquire();              // queued behind it
    ac.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

    let liveGranted = false;
    void live.then(() => { liveGranted = true; });
    sem.release();                 // frees permit 1 → should go to the LIVE waiter
    await live;
    expect(liveGranted).toBe(true);
    expect(sem.inFlight).toBe(1);  // exactly one permit held, none leaked to the aborted waiter
    expect(sem.queueLength).toBe(0);
  });

  it('a non-aborted queued waiter still resolves on release even when a sibling aborts', async () => {
    const sem = createSemaphore(1);
    await sem.acquire();
    const ac = new AbortController();
    const willAbort = sem.acquire(ac.signal);
    const willResolve = sem.acquire();
    expect(sem.queueLength).toBe(2);

    ac.abort();
    await expect(willAbort).rejects.toMatchObject({ name: 'AbortError' });
    expect(sem.queueLength).toBe(1); // only the live waiter remains

    sem.release();
    await expect(willResolve).resolves.toBeUndefined();
  });
});
