// BIN-1244: the admin view's only way to see a reported user's profile when the
// profile is private. The server function checks that the caller is admin, logs the
// lookup and returns the display fields; firestore.rules is unchanged, so no other
// screen in the app gains anything from it.

export interface ModerationProfile {
  displayName: string;
  username: string | null;
  photoURL: string | null;
  bio: string;
  isPublic: boolean;
}

export async function getProfileForModeration(uid: string): Promise<ModerationProfile | null> {
  // Lazy, like submitReport in ./reports.ts: firebase/functions stays out of the
  // first-load bundle.
  const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import('firebase/functions');
  const app = (await import('./config')).default;
  const functions = getFunctions(app, 'europe-west1');
  if (
    typeof window !== 'undefined' &&
    process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true'
  ) {
    try { connectFunctionsEmulator(functions, '127.0.0.1', 5001); } catch { /* idempotent */ }
  }
  const call = httpsCallable<{ uid: string }, { profile: ModerationProfile | null }>(
    functions,
    'getProfileForModeration',
  );
  const res = await call({ uid });
  return res.data.profile;
}
