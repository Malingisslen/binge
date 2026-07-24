import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOptimisticMirrorField } from './useOptimisticMirrorField';

type Costs = Record<number, number>;

/** Two distinct accounts. Every test that is not ABOUT switching accounts pins UID_A,
 *  so a rebase can only be caused by the thing that test is actually exercising. */
const UID_A = 'uid-a';
const UID_B = 'uid-b';

/** A commit whose settlement this test controls, so an edit can be left in flight. */
function deferredCommit() {
  let settle!: { resolve: () => void; reject: (err: Error) => void };
  const pending = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
  return { pending, ...settle };
}

/** Swallow the rejection of a promise we assert on later, so Node sees no unhandled rejection. */
function park<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  return p;
}

describe('useOptimisticMirrorField', () => {
  it('commits the source map plus the new key', async () => {
    const source: Costs = { 8: 99 };
    const commit = vi.fn<(next: Costs) => Promise<void>>().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOptimisticMirrorField<number>(UID_A, source, commit));

    await act(async () => { await result.current(119, 139); });

    expect(commit).toHaveBeenCalledWith({ 8: 99, 119: 139 });
    // The caller's map is never mutated — the mirror always spreads a fresh object.
    expect(source).toEqual({ 8: 99 });
  });

  it('treats an undefined source as an empty map', async () => {
    const commit = vi.fn<(next: Costs) => Promise<void>>().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOptimisticMirrorField<number>(UID_A, undefined, commit));

    await act(async () => { await result.current(8, 99); });

    expect(commit).toHaveBeenCalledWith({ 8: 99 });
  });

  it('a null value DELETES the key rather than writing undefined', async () => {
    const source: Costs = { 8: 99, 119: 139 };
    const commit = vi.fn<(next: Costs) => Promise<void>>().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOptimisticMirrorField<number>(UID_A, source, commit));

    await act(async () => { await result.current(8, null); });

    const written = commit.mock.calls[0][0];
    expect(written).toEqual({ 119: 139 });
    // `next[key] = undefined` would also satisfy toEqual — the key must be absent,
    // because an undefined field is rejected by Firestore's setDoc/merge write.
    expect(Object.keys(written)).toEqual(['119']);
    expect('8' in written).toBe(false);
  });

  it('deleting a key that is not in the map is a no-op write, not a throw', async () => {
    const source: Costs = { 8: 99 };
    const commit = vi.fn<(next: Costs) => Promise<void>>().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOptimisticMirrorField<number>(UID_A, source, commit));

    await act(async () => { await result.current(1899, null); });

    expect(commit).toHaveBeenCalledWith({ 8: 99 });
  });

  it('updates the mirror SYNCHRONOUSLY, so a second edit before the first settles keeps both (BIN-40/BIN-46)', async () => {
    const source: Costs = { 8: 99 };
    const first = deferredCommit();
    const commit = vi.fn<(next: Costs) => Promise<void>>()
      .mockReturnValueOnce(first.pending)
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useOptimisticMirrorField<number>(UID_A, source, commit));

    // Two blurs back to back (tab from provider A's field to B's) — no re-render in
    // between, so a render-snapshot-based implementation would lose the first edit.
    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = park(result.current(119, 139));
      b = park(result.current(76, 109));
    });

    expect(commit).toHaveBeenNthCalledWith(1, { 8: 99, 119: 139 });
    expect(commit).toHaveBeenNthCalledWith(2, { 8: 99, 119: 139, 76: 109 });

    await act(async () => { first.resolve(); await a; await b; });
  });

  it('rolls the mirror back when the write is rejected, so the rejected value never rides along on the next edit (BIN-516/BIN-531)', async () => {
    const source: Costs = { 8: 99 };
    const commit = vi.fn<(next: Costs) => Promise<void>>()
      .mockRejectedValueOnce(new Error('permission-denied'))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useOptimisticMirrorField<number>(UID_A, source, commit));

    // The rejection is re-thrown to the caller (AuthContext surfaces it as a toast).
    await act(async () => {
      await expect(result.current(119, 139)).rejects.toThrow('permission-denied');
    });

    await act(async () => { await result.current(76, 109); });

    expect(commit).toHaveBeenLastCalledWith({ 8: 99, 76: 109 });
    expect(commit).toHaveBeenLastCalledWith(expect.not.objectContaining({ 119: expect.anything() }));
  });

  it('SKIPS the rollback when a concurrent edit already moved the mirror', async () => {
    const source: Costs = { 8: 99 };
    const first = deferredCommit();
    const commit = vi.fn<(next: Costs) => Promise<void>>()
      .mockReturnValueOnce(first.pending)
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useOptimisticMirrorField<number>(UID_A, source, commit));

    let slow!: Promise<void>;
    act(() => { slow = park(result.current(119, 139)); });

    // A second edit lands (and succeeds) while the first write is still in flight.
    await act(async () => { await result.current(76, 109); });

    await act(async () => {
      first.reject(new Error('permission-denied'));
      await expect(slow).rejects.toThrow('permission-denied');
    });

    await act(async () => { await result.current(8, 100); });

    // An unconditional rollback would have restored { 8: 99 } and thrown away the
    // second edit; the identity check keeps it.
    expect(commit).toHaveBeenLastCalledWith({ 8: 100, 119: 139, 76: 109 });
  });

  it('SKIPS the rollback when a profile sync already replaced the source', async () => {
    const first = deferredCommit();
    const commit = vi.fn<(next: Costs) => Promise<void>>()
      .mockReturnValueOnce(first.pending)
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ source }: { source: Costs }) => useOptimisticMirrorField<number>(UID_A, source, commit),
      { initialProps: { source: { 8: 99 } as Costs } },
    );

    let slow!: Promise<void>;
    act(() => { slow = park(result.current(119, 139)); });

    // Firestore pushes a fresh profile (another device, or a re-login) mid-write.
    rerender({ source: { 8: 42 } });

    await act(async () => {
      first.reject(new Error('permission-denied'));
      await expect(slow).rejects.toThrow('permission-denied');
    });

    await act(async () => { await result.current(76, 109); });

    // The rollback must not resurrect the pre-sync snapshot { 8: 99 }.
    expect(commit).toHaveBeenLastCalledWith({ 8: 42, 76: 109 });
  });

  // NAME CHANGED 2026-07-24. This was called "(account switch, 2026-07-20)" and was
  // read as proof that switching accounts is safe. It is not: it holds `source` at
  // the SAME object across the rerender, so it exercises only the commit ref. The
  // mirror ref — the half that actually leaked — is covered by the BIN-592 test
  // below. An xhigh review also mutation-proved that reverting the hook's
  // useIsomorphicLayoutEffect to a plain useEffect leaves this whole file green,
  // because RTL's `rerender` is itself act()-wrapped and flushes passive effects
  // before any assertion runs. That timing branch is therefore NOT unit-testable
  // here; do not add a test that claims to cover it without proving the mutation
  // fails first.
  it('keeps a stable setter identity but always calls the LATEST commit', async () => {
    const source: Costs = { 8: 99 };
    const commitA = vi.fn<(next: Costs) => Promise<void>>().mockResolvedValue(undefined);
    const commitB = vi.fn<(next: Costs) => Promise<void>>().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ commit }: { commit: (next: Costs) => Promise<void> }) =>
        useOptimisticMirrorField<number>(UID_A, source, commit),
      { initialProps: { commit: commitA } },
    );

    const setterBeforeRerender = result.current;
    rerender({ commit: commitB });

    // Stable identity: consumers pass this straight into memoized children.
    expect(result.current).toBe(setterBeforeRerender);

    await act(async () => { await result.current(119, 139); });

    // The write goes to the CURRENT account's commit, never the previous render's.
    expect(commitA).not.toHaveBeenCalled();
    expect(commitB).toHaveBeenCalledWith({ 8: 99, 119: 139 });
  });

  // BIN-592 — the regression this file existed to catch and did not.
  it('clears the mirror when the ACCOUNT changes even though source is undefined on both sides', async () => {
    const commit = vi.fn<(next: Costs) => Promise<void>>().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ uid, source }: { uid: string | null; source: Costs | undefined }) =>
        useOptimisticMirrorField<number>(uid, source, commit),
      // User A has never saved a price, so their source is undefined.
      { initialProps: { uid: UID_A as string | null, source: undefined as Costs | undefined } },
    );

    // A enters a Netflix price. It lands in the mirror synchronously; assume the
    // write is still in flight (or A signs out) before the profile echoes back.
    await act(async () => { await result.current(8, 99); });
    expect(commit).toHaveBeenLastCalledWith({ 8: 99 });

    // Sign-out, then user B signs in. B has never saved a price either — so
    // `source` is undefined the whole way through and NEVER changes identity.
    // Before BIN-592 the rebasing effect was keyed on [source] alone, so it never
    // re-ran and A's { 8: 99 } survived into B's session.
    rerender({ uid: null, source: undefined });
    rerender({ uid: UID_B, source: undefined });

    await act(async () => { await result.current(76, 109); });

    // B's write must contain ONLY B's own entry. A leaked Netflix cost here is a
    // real user-visible defect: Streamingrådgivaren bills B for a subscription
    // they never entered.
    expect(commit).toHaveBeenLastCalledWith({ 76: 109 });
    expect(commit).not.toHaveBeenLastCalledWith({ 8: 99, 76: 109 });
  });

  it('rebases the mirror on a new source between edits', async () => {
    const commit = vi.fn<(next: Costs) => Promise<void>>().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ source }: { source: Costs }) => useOptimisticMirrorField<number>(UID_A, source, commit),
      { initialProps: { source: { 8: 99 } as Costs } },
    );

    await act(async () => { await result.current(119, 139); });
    expect(commit).toHaveBeenLastCalledWith({ 8: 99, 119: 139 });

    // The committed profile comes back from Firestore and becomes the new source.
    rerender({ source: { 8: 99, 119: 139 } });
    await act(async () => { await result.current(8, null); });

    expect(commit).toHaveBeenLastCalledWith({ 119: 139 });
  });
});

/**
 * A MECHANISM pin, not a behaviour pin — and labelled as such on purpose.
 *
 * The hook sets both refs in a LAYOUT effect. A passive effect flushes after paint,
 * leaving a window where a blur runs the previous render's commit against the
 * previous account's snapshot — the cross-account price leak of 2026-07-20. That
 * branch is NOT reachable from a behavioural test here: RTL's `rerender` is itself
 * act()-wrapped, so passive effects flush before any assertion runs, and an xhigh
 * review mutation-proved that swapping useLayoutEffect for useEffect leaves every
 * behavioural test in this file green.
 *
 * So instead of a test that pretends to cover it, this reads the source. Precedent:
 * src/lib/design/consistency.test.ts guards a convention the same way.
 */
describe('useOptimisticMirrorField — layout-effect mechanism (source guard)', () => {
  it('binds both refs in a layout effect, never a plain useEffect', () => {
    const src = readFileSync(join(__dirname, 'useOptimisticMirrorField.ts'), 'utf8');
    // The isomorphic wrapper must still resolve to useLayoutEffect in the browser.
    expect(src).toMatch(/typeof window !== 'undefined' \? useLayoutEffect : useEffect/);
    // Both ref bindings must go through it — a bare `useEffect(` binding either ref
    // reopens the gap.
    const bindings = src.match(/useIsomorphicLayoutEffect\(\(\) => \{ (?:mirrorRef|commitRef)\.current/g);
    expect(bindings).toHaveLength(2);
  });
});
