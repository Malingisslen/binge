// BIN-185 — pure helpers extracted from useRecap.ts so the loading/error-vs-empty derivation
// can be unit-tested without mocking React Query/Firestore machinery (mirrors the
// aggregateAdvisorLoading pattern in useSubscriptionAdvisor.helpers.ts).

/**
 * "Not yet successfully resolved" for one season recap query — true while pending AND while
 * errored, false only once the read has genuinely succeeded. A consumer must treat this as
 * "don't trust an empty/absent result yet": checking `isPending` alone is NOT enough, because
 * React Query settles `isPending` to false on error too (identical to success) — that gap
 * was a real shipped bug (BIN-185 story-so-far redesign review) where a timed-out
 * getDocWithTimeout call made "Visa tidigare säsonger" claim no recaps exist.
 */
export function isSeasonRecapLoading(enabled: boolean, result: { isSuccess: boolean } | undefined): boolean {
  return enabled && !(result?.isSuccess ?? false);
}
