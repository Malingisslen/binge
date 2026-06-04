/** Pure page-param logic for useInfiniteQuery + Firestore cursor pagination. */
export function hasFullPage<T>(page: readonly T[], pageSize: number): boolean {
  return page.length === pageSize;
}
export function nextCursor<T>(page: readonly T[], pageSize: number): T | undefined {
  if (!hasFullPage(page, pageSize)) return undefined;
  return page[page.length - 1];
}
