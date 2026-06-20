import type { WatchlistItem } from '@/types';

// BIN-103 — activity diary. v1 covers FILMS only: WatchlistItem.watchedAt is a
// true "watched on" date (set when marked sedd, backdatable via BIN-91), and
// it's already in the loaded watchlist — so this is a zero-extra-read payoff of
// editable dates. Per-episode watchedAt lives in per-show episodeProgress docs
// (not loaded app-wide); merging those in is a deliberate follow-up that needs
// a new (cheap, own-data) episodeProgress fan-out.

const MONTHS_SV = [
  'januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december',
];

export interface DiaryEntry { item: WatchlistItem; date: Date }
export interface DiaryMonth { key: string; label: string; entries: DiaryEntry[] }

/**
 * Build a reverse-chronological film diary grouped by calendar month.
 * Only sedd films with a watchedAt date qualify; newest first, and within a
 * month newest first too (stable from the global sort).
 */
export function buildFilmDiary(items: WatchlistItem[]): DiaryMonth[] {
  const entries: DiaryEntry[] = items
    .filter(i => i.mediaType === 'movie' && i.status === 'sedd' && i.watchedAt != null)
    .map(i => ({ item: i, date: i.watchedAt as Date }))
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const months: DiaryMonth[] = [];
  let current: DiaryMonth | null = null;
  for (const entry of entries) {
    const key = `${entry.date.getFullYear()}-${String(entry.date.getMonth() + 1).padStart(2, '0')}`;
    if (!current || current.key !== key) {
      current = {
        key,
        label: `${MONTHS_SV[entry.date.getMonth()]} ${entry.date.getFullYear()}`,
        entries: [],
      };
      months.push(current);
    }
    current.entries.push(entry);
  }
  return months;
}

/** Total dated films in the diary — for the header count. */
export function diaryFilmCount(months: DiaryMonth[]): number {
  return months.reduce((sum, m) => sum + m.entries.length, 0);
}
