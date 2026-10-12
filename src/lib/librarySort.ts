import type { WatchlistItem } from '@/types';
import { compareTitles } from '@/lib/titleSort';
import { seenDate } from '@/lib/seenDate';

export type SortKey = 'updatedAt' | 'addedAt' | 'watchedAt' | 'title' | 'rating' | 'releaseYear' | 'providers';
export type SortDir = 'asc' | 'desc';

// A first click on a column should show what people expect from it: titles A to Ö,
// everything else biggest or newest first.
export function defaultSortDir(key: SortKey): SortDir {
  return key === 'title' ? 'asc' : 'desc';
}

type SortableItem = Pick<WatchlistItem, 'title' | 'rating' | 'releaseYear' | 'addedAt' | 'updatedAt' | 'providers' | 'status' | 'watchedAt'>;

// Ascending comparison per column; the direction flips it. Ties fall back to the title so
// the order stays stable when many rows share a year or a rating.
export function compareLibraryItems<T extends SortableItem>(key: SortKey, dir: SortDir): (a: T, b: T) => number {
  const sign = dir === 'asc' ? 1 : -1;
  const asc = (a: T, b: T): number => {
    switch (key) {
      case 'title': return compareTitles(a.title, b.title);
      case 'rating': return (a.rating ?? 0) - (b.rating ?? 0);
      case 'releaseYear': return (a.releaseYear ?? 0) - (b.releaseYear ?? 0);
      case 'addedAt': return a.addedAt.getTime() - b.addedAt.getTime();
      case 'watchedAt': return (seenDate(a)?.getTime() ?? 0) - (seenDate(b)?.getTime() ?? 0);
      case 'providers': return a.providers.length - b.providers.length;
      default: return a.updatedAt.getTime() - b.updatedAt.getTime();
    }
  };
  return (a, b) => sign * asc(a, b) || compareTitles(a.title, b.title);
}
