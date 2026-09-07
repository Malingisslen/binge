/**
 * BIN-1063 steg 3 — ask the server to hand over the groups this account owns.
 *
 * Malin's decision of 2026-09-06: a group whose owner leaves goes to the member
 * who has been in it longest, never gets deleted out from under the people still
 * in it. The client cannot do that write — `ownerUid` is pinned unchanged on
 * every `groups/{groupId}` update branch in `firestore.rules` — and it should not
 * be able to: the rules cannot iterate the member subcollection to check that the
 * successor really is the longest-standing one, so a branch loose enough to allow
 * the write would leave the guarantee in client code.
 *
 * Called by the deletion cascade BEFORE it builds its plan. What the server hands
 * over stops matching the cascade's own `memberUids array-contains` query, so the
 * cascade then sees only the groups that must genuinely be deleted.
 */

/**
 * The marker the server puts in its refusal when it already wrote something.
 *
 * Declared here rather than imported from `functions/src/` because no production
 * client code crosses that boundary — only tests do. `functions/src/groupHandover/
 * logic.ts` exports the same constant, and a test pins the two to each other.
 */
export const HANDOVER_PARTIAL = 'binge/handover-partial';

/**
 * Hand over every group this account owns. Throws on failure.
 *
 * Deliberately NOT swallowed by the caller: a failure here means the cascade
 * would fall through to its old behaviour and delete a group other people are
 * still in. Erasure that stops and can be retried is the better outcome — the
 * whole operation is idempotent, so a retry re-runs it from wherever it stopped.
 */
export async function handOverOwnedGroups(): Promise<void> {
  // The lazy import keeps firebase/functions out of the first-load bundle, the
  // same reason `reports.ts` does it.
  const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import('firebase/functions');
  const app = (await import('./config')).default;
  const functions = getFunctions(app, 'europe-west1');
  if (
    typeof window !== 'undefined' &&
    process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true'
  ) {
    try { connectFunctionsEmulator(functions, '127.0.0.1', 5001); } catch { /* idempotent på samma instans */ }
  }

  // The summary is logged server-side and is not the client's to interpret; what
  // the client needs from a failure is in the thrown message — which is why the
  // client must OUTWAIT the server rather than the other way round.
  //
  // `httpsCallable` defaults to 70s and only loses its own race: it does not abort
  // the request, so a client that gives up first throws `deadline-exceeded` while
  // the handover runs on and usually finishes. The user would read "Ingenting har
  // raderats" over writes that landed. Kept at or above the function's own
  // `timeoutSeconds` (300) so the verdict the client reports is the server's.
  const call = httpsCallable<undefined, void>(functions, 'handOverOwnedGroups', {
    timeout: 300_000,
  });
  await call();
}
