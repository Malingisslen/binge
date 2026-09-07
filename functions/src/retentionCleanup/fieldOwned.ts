/**
 * BIN-1063 steg 3, bunt 3 — the FIELD-OWNED half of the orphan-data sweep.
 *
 * BIN-1023 erased what a departed account owns through the uid in its PATH: the
 * whole `users/{uid}` tree and `publicProfiles/{uid}`. This is the half owned
 * through a FIELD, which no path walk can reach — reviews, the account's own
 * likes and comments wherever they sit, episode reactions, lists, hosted
 * sessions, and the groups the account owned.
 *
 * Pure predicates only, no firebase-admin import, so the deciding half is
 * testable under the root vitest toolchain like `logic.ts` and `orphans.ts`.
 */

/**
 * The categories, in the order they must be erased.
 *
 * #6 DPO's binding condition: the order is stated, not incidental. `groups` is
 * LAST.
 *
 * Which categories are world-readable is not asserted here: it is a property of
 * `firestore.rules`, and a sentence about it goes stale the next time a match
 * block changes. Read the rules.
 *
 * The array is exported so a test can assert the run walks all of it — an
 * enumeration nobody counts is one a later category silently drops out of.
 */
export const FIELD_OWNED_CATEGORIES = [
  'reviews',
  'foreignReviewUgc',
  'reactions',
  'lists',
  'sessions',
  'groups',
] as const;

export type FieldOwnedCategory = (typeof FIELD_OWNED_CATEGORIES)[number];

/**
 * The most documents ONE uid's field-owned erasure may delete before it refuses.
 *
 * The account-level ceiling in `orphans.ts` answers "did we pick the wrong
 * people". This answers the question that ceiling cannot see: the blast radius
 * of a CORRECT pick is unbounded in documents. One account can own thousands of
 * reactions, and the sweep deletes them on the strength of a query whose
 * predicate nothing at runtime re-checks.
 *
 * 5000 is far above any plausible single account here and far below "the
 * collection". Exceeding it erases nothing for
 * that uid, logs loudly, and leaves the watch record in place so the next run
 * retries; the alternative is an unrecoverable run.
 */
export const FIELD_OWNED_MAX_DOCS_PER_UID = 5000;

/** What one category's scan found for one uid. */
export interface CategoryFindings {
  /** Full paths to delete outright. */
  readonly deletePaths: readonly string[];
  /**
   * Documents that survive with the uid removed from an array field.
   *
   * A co-edited list is the case: the list belongs to someone else and only the
   * departed uid leaves `editors`. Deleting it would destroy a third party's
   * data over someone else's erasure.
   */
  readonly arrayStrips: readonly { readonly path: string; readonly field: string }[];
}

/** An empty result, for a category with nothing to erase. */
export const NO_FINDINGS: CategoryFindings = { deletePaths: [], arrayStrips: [] };

/**
 * How many WRITES a set of findings would make.
 *
 * Not documents: a path listed by two categories is counted twice, which is the
 * refusing direction and therefore the safe one for a budget.
 */
export function findingsSize(findings: CategoryFindings): number {
  return findings.deletePaths.length + findings.arrayStrips.length;
}

/**
 * Whether this uid's whole field-owned erasure fits under the document budget,
 * and what it costs.
 *
 * All-or-nothing per uid, deliberately. A partial erasure driven by a budget
 * would leave an arbitrary half of a person's public content standing with no
 * record of which half, and the next run would face the same wall — so the run
 * that refuses is the one that can be diagnosed.
 */
export function withinDocumentBudget(
  perCategory: readonly CategoryFindings[],
  budget = FIELD_OWNED_MAX_DOCS_PER_UID,
): { readonly allowed: boolean; readonly documents: number } {
  const documents = perCategory.reduce((sum, f) => sum + findingsSize(f), 0);
  return { allowed: documents <= budget, documents };
}
