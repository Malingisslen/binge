// BIN-176 — client wrapper for the recordAskBinge callable (the learning loop).
//
// Sends PII-free search outcomes to the server-authoritative counter (the only
// writer of askBingeStats/{date}; the collection is sealed in firestore.rules).
// Fire-and-forget: a failed record — including an App-Check/auth reject for an
// anonymous caller before App Check is configured — must NEVER break search, so
// every error is swallowed. App Check tokens (when a site key is set) are attached
// automatically by the Functions SDK.

export type AskBingeRecord =
  | { type: 'search'; resultBucket: string; filters: string }
  | { type: 'low_confidence' }
  | { type: 'chip_removed'; key: string };

export async function recordAskBinge(payload: AskBingeRecord): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    // Lazy import keeps firebase/functions out of the first-load bundle (as fsdb does).
    const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import('firebase/functions');
    const app = (await import('@/lib/firebase/config')).default;
    const functions = getFunctions(app, 'europe-west1');
    if (process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true') {
      try { connectFunctionsEmulator(functions, '127.0.0.1', 5001); } catch { /* idempotent */ }
    }
    await httpsCallable(functions, 'recordAskBinge')(payload);
  } catch {
    /* swallow — telemetry is best-effort and must not affect the search UX */
  }
}
