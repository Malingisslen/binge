/**
 * Senaste sökningar, lagrade bara i den här webbläsaren (aldrig i Firestore:
 * ingen kostnad och ingen persondata som lämnar enheten).
 *
 * Pure `localStorage`, no Firebase import, so it is testable without a
 * Firestore environment (`.claude/rules/code-style.md`).
 */

export const RECENT_SEARCHES_KEY = 'binge:recentSearches';
export const RECENT_SEARCHES_MAX = 8;
const MIN_LENGTH = 2;
const MAX_LENGTH = 80;

// Lets every open consumer in the same tab refresh; `storage` covers other tabs.
export const RECENT_SEARCHES_EVENT = 'binge:recentSearchesChanged';

function sameQuery(a: string, b: string): boolean {
  return a.toLocaleLowerCase('sv') === b.toLocaleLowerCase('sv');
}

export function readRecentSearches(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === 'string')
      .slice(0, RECENT_SEARCHES_MAX);
  } catch {
    return [];
  }
}

function write(list: string[]): void {
  try {
    if (list.length === 0) window.localStorage.removeItem(RECENT_SEARCHES_KEY);
    else window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(RECENT_SEARCHES_EVENT));
  } catch {
    // Blocked or full storage: the history is a convenience, never an error.
  }
}

/** Newest first, case-insensitive duplicates collapse to the latest spelling. */
export function addRecentSearch(query: string): void {
  const q = query.trim().replace(/\s+/g, ' ');
  if (q.length < MIN_LENGTH || q.length > MAX_LENGTH) return;
  const rest = readRecentSearches().filter(s => !sameQuery(s, q));
  write([q, ...rest].slice(0, RECENT_SEARCHES_MAX));
}

export function removeRecentSearch(query: string): void {
  write(readRecentSearches().filter(s => !sameQuery(s, query)));
}

export function clearRecentSearches(): void {
  write([]);
}
