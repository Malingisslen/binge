// The filters and sort orders a visitor picks are kept in localStorage so they survive a
// reload. They are not keyed by account, and the library filter holds the visitor's own tag
// names, so they are swept when a session ends: a shared browser must not hand them to the
// next person. usePersistedState takes only a PersistedViewKey, which only the builders below
// make, so a saved view whose key the sweep would miss does not compile.

export const FILTERS_PREFIX = 'binge:filters:';
export const SORT_PREFIX = 'binge:sort:';
export const PERSISTED_VIEW_PREFIXES = [FILTERS_PREFIX, SORT_PREFIX] as const;

/** Same-tab signal; other tabs hear the removals through the `storage` event. */
export const PERSISTED_VIEW_CLEARED_EVENT = 'binge:persisted-view-cleared';

export type PersistedViewKey = string & { readonly __sweptOnSignOut: true };
const viewKey = (key: string) => key as PersistedViewKey;

export const libraryFiltersKey = (status: string | null | undefined) => viewKey(`${FILTERS_PREFIX}library:${status ?? 'all'}`);
export const librarySortKey = (status: string | null | undefined) => viewKey(`${SORT_PREFIX}library:${status ?? 'all'}`);
export const groupSortKey = (groupId: string) => viewKey(`${SORT_PREFIX}group:${groupId}`);
export const toWatchFiltersKey = viewKey(`${FILTERS_PREFIX}to-watch`);
export const toWatchSortKey = viewKey(`${SORT_PREFIX}to-watch`);
export const RECOMMENDATION_FILTERS_KEY = viewKey(`${FILTERS_PREFIX}recommendations`);

export function isPersistedViewKey(key: string): boolean {
  return PERSISTED_VIEW_PREFIXES.some(prefix => key.startsWith(prefix));
}

/**
 * Removes every saved filter and sort order on this device. Never throws: it runs inside
 * sign-out, and a blocked or missing storage must not keep anyone signed in.
 *
 * Collect-then-remove, as in `clearAllInviteTokens`: removing inside an index loop shifts
 * the indices and skips keys.
 */
export function clearPersistedViewState(): void {
  if (typeof window === 'undefined') return;
  try {
    const storage = window.localStorage;
    const doomed = Object.keys(storage).filter(isPersistedViewKey);
    for (const key of doomed) storage.removeItem(key);
  } catch {
    // Unreadable storage holds nothing we could clear.
  }
  try {
    window.dispatchEvent(new Event(PERSISTED_VIEW_CLEARED_EVENT));
  } catch {
    // An Event constructor that throws only costs the reset of mounted views.
  }
}
