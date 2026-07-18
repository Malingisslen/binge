// BIN-544 — client wrapper for the logRecapMiss callable.
//
// Records a genuine recap miss (no spoiler-safe summary available) so
// coverage backfill can be prioritized by real demand. The ONLY writer of
// recapCoverageGaps/{tmdbId} (sealed in firestore.rules). Fire-and-forget: a
// failed record — including an App-Check/auth reject for an anonymous caller
// before App Check is configured — must NEVER break the recap panel, so every
// error is swallowed. Mirrors src/lib/askBinge/record.ts's pattern.

export async function logRecapMiss(tmdbId: number): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import('firebase/functions');
    const app = (await import('@/lib/firebase/config')).default;
    const functions = getFunctions(app, 'europe-west1');
    if (process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true') {
      try { connectFunctionsEmulator(functions, '127.0.0.1', 5001); } catch { /* idempotent */ }
    }
    await httpsCallable(functions, 'logRecapMiss')({ tmdbId });
  } catch {
    /* swallow — telemetry is best-effort and must not affect the recap UX */
  }
}
