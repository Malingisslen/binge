'use client';

import { useEffect } from 'react';
import { captureError, initSentry } from '@/lib/sentry';
import { trackEvent } from '@/lib/analytics';

const SCOPE = 'app:global';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Lokal console.error — syns i DevTools + bugrapporter från användare.
    console.error(`[${SCOPE}]`, error);

    // global-error.tsx ERSÄTTER root-layouten, så Providers (som normalt kör
    // initSentry) har aldrig monterats här. Vi måste därför initiera själva —
    // och invänta den lazy SDK-laddningen, annars no-op:ar captureError alltid.
    void initSentry().then(() => {
      captureError(error, {
        scope: SCOPE,
        kind: 'error-boundary',
        extra: { digest: error.digest },
      });
    });

    trackEvent('error_boundary_triggered', { scope: SCOPE });
  }, [error]);

  return (
    <html lang="sv">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#eeece8' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#222', marginBottom: 8 }}>Något gick fel</h2>
          <p style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>Appen kraschade. Ladda om sidan för att försöka igen.</p>
          <button
            onClick={reset}
            style={{ padding: '6px 16px', background: '#d97b35', color: '#fff', border: 'none', borderRadius: 2, fontSize: 12, cursor: 'pointer' }}
          >
            Ladda om
          </button>
        </div>
      </body>
    </html>
  );
}
