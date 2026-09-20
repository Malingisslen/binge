/**
 * Firestore error-code predicates. Deliberately Firebase-IMPORT-free so anything can use
 * it without pulling the SDK into its module graph, and so it is unit-testable.
 *
 * `permission-denied` is the only code that proves the SERVER refused the write on its
 * merits. Everything else — `unavailable`, `deadline-exceeded`, `resource-exhausted`,
 * offline — is infrastructure, and it GOES AWAY. Collapsing the two is a mistake this repo
 * has already shipped and rolled back once: before 2026-07-20 `joinGroupViaToken` treated
 * any thrown error as "the link is invalid or was withdrawn", so a bad mobile connection
 * told the user to go ask the owner for a new token. See the long comment above
 * `joinGroupViaToken` in `groups.ts` for that history.
 *
 * BIN-942 added the watchlist edit paths, which may be refused by the create-floor when
 * they race a delete. They swallow `permission-denied` and rethrow everything else, so a
 * broad catch there would silently eat every network failure on the app's most common
 * writes. BIN-1251 added the notification read-flip, where the rule's update branch
 * dereferences `resource.data` and a deleted document therefore answers
 * `permission-denied` rather than `not-found` (measured; see
 * `useNotifications.helpers.ts`). One definition, so the callers cannot drift.
 *
 * Derive who they are rather than trusting a number here:
 *   grep -rn "isPermissionDenied" src functions
 */
export function isPermissionDenied(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'permission-denied';
}
