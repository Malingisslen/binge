import type { GroupWatchlistItem } from '@/types';
import { compareTitles } from '@/lib/titleSort';
import type { SortDir } from '@/lib/librarySort';

// 'addedAt' is the order before anyone clicks a heading; the other keys are the headings.
export type GroupSortKey = 'addedAt' | 'title' | 'avg' | `member:${string}`;

export function defaultGroupSortDir(key: GroupSortKey): SortDir {
  return key === 'title' ? 'asc' : 'desc';
}

export function averageRating(item: Pick<GroupWatchlistItem, 'memberRatings'>, memberUids: readonly string[]): number | null {
  const present = memberUids.map(uid => item.memberRatings[uid]).filter((r): r is number => r != null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;
}

type SortableItem = Pick<GroupWatchlistItem, 'title' | 'addedAt' | 'memberRatings'>;

// A title nobody has rated goes last in either direction: "lowest rated first" should not
// open with rows that simply have no rating yet.
export function compareGroupItems<T extends SortableItem>(
  key: GroupSortKey, dir: SortDir, memberUids: readonly string[],
): (a: T, b: T) => number {
  const sign = dir === 'asc' ? 1 : -1;
  const byTitle = (a: T, b: T) => compareTitles(a.title, b.title);
  const rated = (value: (i: T) => number | null) => (a: T, b: T): number => {
    const x = value(a);
    const y = value(b);
    if (x == null && y == null) return byTitle(a, b);
    if (x == null) return 1;
    if (y == null) return -1;
    return sign * (x - y) || byTitle(a, b);
  };
  if (key === 'title') return (a, b) => sign * byTitle(a, b);
  if (key === 'avg') return rated(i => averageRating(i, memberUids));
  if (key.startsWith('member:')) {
    const uid = key.slice('member:'.length);
    return rated(i => i.memberRatings[uid] ?? null);
  }
  return (a, b) => sign * (a.addedAt.getTime() - b.addedAt.getTime()) || byTitle(a, b);
}

export interface GroupSort { key: GroupSortKey; dir: SortDir }

export const DEFAULT_GROUP_SORT: GroupSort = { key: 'addedAt', dir: 'desc' };

// Stored sorts come from localStorage, so anything unrecognised falls back to the default.
export function sanitizeGroupSort(raw: unknown): GroupSort {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_GROUP_SORT;
  const { key, dir } = raw as Record<string, unknown>;
  const valid = key === 'addedAt' || key === 'title' || key === 'avg'
    || (typeof key === 'string' && key.startsWith('member:'));
  if (!valid) return DEFAULT_GROUP_SORT;
  return { key: key as GroupSortKey, dir: dir === 'asc' || dir === 'desc' ? dir : defaultGroupSortDir(key as GroupSortKey) };
}
