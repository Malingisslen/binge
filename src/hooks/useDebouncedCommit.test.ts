import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedCommit } from './useDebouncedCommit';

describe('useDebouncedCommit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces rapid schedules into one commit with the latest value', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<number[]>(commit, 700));

    act(() => { result.current.schedule([1]); });
    act(() => { result.current.schedule([1, 2]); });
    act(() => { result.current.schedule([1, 2, 3]); });
    expect(commit).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(700); });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('flush() commits the pending value immediately', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<number[]>(commit, 700));
    act(() => { result.current.schedule([9]); });
    act(() => { result.current.flush(); });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([9]);
  });

  it('does nothing on flush when nothing is pending', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<number[]>(commit, 700));
    act(() => { result.current.flush(); });
    expect(commit).not.toHaveBeenCalled();
  });

  it('flushes a pending commit on unmount', () => {
    const commit = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedCommit<number[]>(commit, 700));
    act(() => { result.current.schedule([5]); });
    unmount();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([5]);
  });

  it('flushes a pending commit on pagehide', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<number[]>(commit, 700));
    act(() => { result.current.schedule([7]); });
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([7]);
  });

  it('flushes a pending commit on visibilitychange (tab hidden)', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<number[]>(commit, 700));
    act(() => { result.current.schedule([8]); });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([8]);
  });

  it('debounces a new value scheduled after a flush (reset path)', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<number[]>(commit, 700));
    act(() => { result.current.schedule([1]); });
    act(() => { result.current.flush(); });
    expect(commit).toHaveBeenCalledTimes(1);
    act(() => { result.current.schedule([2]); });
    act(() => { vi.advanceTimersByTime(700); });
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenLastCalledWith([2]);
  });
});
