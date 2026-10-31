export interface TvPairResult {
  deviceName: string;
}

/**
 * Approve the code a TV is showing. Throws the callable's FirebaseError on refusal;
 * the screen maps its `code` to Swedish. The code is never logged.
 */
export async function approveTvPairing(code: string): Promise<TvPairResult> {
  // The lazy import keeps firebase/functions out of the first-load bundle, as reports.ts does.
  const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import('firebase/functions');
  const app = (await import('./config')).default;
  const functions = getFunctions(app, 'europe-west1');
  if (
    typeof window !== 'undefined' &&
    process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true'
  ) {
    try { connectFunctionsEmulator(functions, '127.0.0.1', 5001); } catch { /* idempotent på samma instans */ }
  }
  const call = httpsCallable<{ code: string }, { ok: true; deviceName: string }>(functions, 'tvPairApprove');
  const res = await call({ code });
  return { deviceName: res.data.deviceName };
}

/** Swedish text for a callable failure. `failed-precondition` carries the server's own sentence. */
export function tvPairErrorMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code.replace(/^functions\//, '') : '';
  switch (code) {
    case 'not-found':
      return 'Koden har gått ut eller finns inte. Be TV:n om en ny kod.';
    case 'resource-exhausted':
      return 'För många försök. Vänta en stund och försök igen.';
    case 'invalid-argument':
      return 'Koden ser inte rätt ut. Kontrollera den på TV:n.';
    case 'failed-precondition':
      return typeof e?.message === 'string' && e.message ? e.message : 'Något gick fel. Försök igen.';
    default:
      return 'Något gick fel. Försök igen.';
  }
}
