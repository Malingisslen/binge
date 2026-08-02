import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import GlobalError from './global-error';

// BIN-657: global-error.tsx is the LAST boundary — it replaces the root layout,
// so Providers (and with it initSentry) never mounted. Before this ticket the
// component swallowed the crash silently: no console, no Sentry, no analytics.
//
// The Sentry leg is asynchronous on purpose (the SDK is lazy-imported), so the
// test drives the WHOLE transition — assert nothing was captured while the load
// is still pending, then resolve it and assert the capture actually fires. A
// test that only asserted "initSentry was called" would pass against a version
// that never reports anything.

const captureError = vi.fn();
const trackEvent = vi.fn();
let resolveInit: () => void;
let initCalls = 0;

vi.mock('@/lib/sentry', () => ({
  initSentry: () => {
    initCalls += 1;
    return new Promise<void>((resolve) => {
      resolveInit = resolve;
    });
  },
  captureError: (...args: unknown[]) => captureError(...args),
}));
vi.mock('@/lib/analytics', () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

describe('GlobalError telemetry (BIN-657)', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureError.mockReset();
    trackEvent.mockReset();
    initCalls = 0;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => consoleError.mockRestore());

  it('logs, initialises Sentry and reports the crash once the SDK has loaded', async () => {
    const error = Object.assign(new Error('root layout exploded'), { digest: 'abc123' });

    render(<GlobalError error={error} reset={() => {}} />);

    // Immediate, synchronous legs: the local log and the analytics counter.
    expect(consoleError).toHaveBeenCalledWith('[app:global]', error);
    expect(trackEvent).toHaveBeenCalledWith('error_boundary_triggered', { scope: 'app:global' });
    expect(initCalls).toBe(1);

    // The SDK chunk has not arrived yet — reporting must WAIT, not no-op away.
    expect(captureError).not.toHaveBeenCalled();

    resolveInit();

    await waitFor(() =>
      expect(captureError).toHaveBeenCalledWith(error, {
        scope: 'app:global',
        kind: 'error-boundary',
        extra: { digest: 'abc123' },
      }),
    );
  });

  it('still renders the recovery UI', () => {
    const reset = vi.fn();
    render(<GlobalError error={new Error('boom')} reset={reset} />);

    expect(screen.getByText('Något gick fel')).toBeTruthy();
    screen.getByRole('button', { name: 'Ladda om' }).click();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
