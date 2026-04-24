'use client';

import { useEffect } from 'react';
import { captureError } from '@/lib/sentry';

/**
 * Reusable segment-level error boundary body for app-router `error.tsx`.
 *
 * Use one per segment (`src/app/<segment>/error.tsx`) so a failure in one
 * area — say `/my/*` Firestore call — doesn't blank out the whole app.
 *
 * `scope` is logged with the error so we can tell which segment threw.
 * Once Sentry is wired up (task 8.1), it will be forwarded there too.
 */
export function SegmentError({
  error,
  reset,
  scope,
  heading,
  body,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  scope: string;
  heading?: string;
  body?: string;
}) {
  useEffect(() => {
    // Lokal console.error — syns i DevTools + bugrapporter från användare.
     
    console.error(`[${scope}]`, error);
    // Vidarebefordra till Sentry om DSN är satt. No-op annars.
    captureError(error, {
      scope,
      kind: 'error-boundary',
      extra: { digest: error.digest },
    });
  }, [error, scope]);

  return (
    <div
      className="flex flex-col items-center justify-center min-h-[40vh] text-center px-4"
      role="alert"
      aria-live="polite"
    >
      <h2 className="text-[18px] font-bold text-text-primary mb-2">
        {heading ?? 'Något gick fel'}
      </h2>
      <p className="text-sm text-text-muted mb-4 max-w-md">
        {body ?? 'Ett oväntat fel uppstod. Försök ladda om sidan.'}
      </p>
      {error.digest && (
        <p className="text-[11px] text-text-muted mb-4 font-mono">ref: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="px-4 py-[5px] bg-accent text-white border-none rounded-sm text-xs font-[inherit] cursor-pointer"
      >
        Försök igen
      </button>
    </div>
  );
}
