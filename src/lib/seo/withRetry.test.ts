import { describe, it, expect, vi } from 'vitest';
import { withRetry } from './withRetry';

describe('withRetry', () => {
  it('returns the first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, 5, 0)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a flaked call and returns a later success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue('recovered');
    await expect(withRetry(fn, 5, 0)).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after exhausting all attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('still failing'));
    await expect(withRetry(fn, 3, 0)).rejects.toThrow('still failing');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
