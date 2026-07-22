import type { WatchlistItem } from '@/types';
import { parseTmdbIdFromDocId } from '@/lib/mediaTypeDocId';

// BIN-103 — activity diary. Merges FILM watched-dates (WatchlistItem.watchedAt,
// already in the loaded watchlist) with TV per-episode watched-dates
// (episodeProgress/{tmdbId}.seasons[s][e].watchedAt, fetched once via
// useAllEpisodeProgress). Both are the payoff of editable watch dates (BIN-91).
// All assembly is pure + testable; the hook only fetches + normalises.

const MONTHS_SV = [
  'januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december',
];

export interface WatchedEpisode { tmdbId: number; season: number; episode: number; watchedAt: Date }
export interface DiaryEntry { item: WatchlistItem; date: Date; episodeCode: string | null }
export interface DiaryMonth { key: string; label: string; entries: DiaryEntry[] }

// Raw shapes from a Firestore episodeProgress doc — kept loose so the flattener
// stays pure and unit-testable (a fake timestamp with a toDate() suffices).
interface RawTimestamp { toDate: () => Date }
interface RawProgressDoc { id: string; tmdbId?: unknown; seasons?: unknown }

/**
 * Flatten raw episodeProgress docs into watched-episode records. Defensive:
 * skips corrupt dot-notation season keys (old bug, see useEpisodeProgress),
 * unwatched episodes, and entries without a real watchedAt timestamp.
 */
export function flattenEpisodeProgress(docs: RawProgressDoc[]): WatchedEpisode[] {
  const out: WatchedEpisode[] = [];
  for (const d of docs) {
    // Prefer the stored field; parse the doc id as fallback (parse-safe once
    // episodeProgress ids are namespaced tv_123 in Phase 4 — bare Number('tv_123')
    // would be NaN and drop the whole doc's watched episodes from the diary).
    const tmdbId = d.tmdbId != null ? Number(d.tmdbId) : parseTmdbIdFromDocId(d.id);
    if (!Number.isFinite(tmdbId)) continue;
    const seasons = d.seasons;
    if (!seasons || typeof seasons !== 'object') continue;
    for (const [sKey, sVal] of Object.entries(seasons as Record<string, unknown>)) {
      const season = Number(sKey);
      if (!Number.isFinite(season) || !sVal || typeof sVal !== 'object') continue;
      for (const [eKey, eVal] of Object.entries(sVal as Record<string, unknown>)) {
        const episode = Number(eKey);
        if (!Number.isFinite(episode)) continue;
        const rec = eVal as { watched?: boolean; watchedAt?: RawTimestamp | null };
        if (!rec || typeof rec !== 'object' || rec.watched !== true) continue;
        const wa = rec.watchedAt;
        if (!wa || typeof wa.toDate !== 'function') continue;
        out.push({ tmdbId, season, episode, watchedAt: wa.toDate() });
      }
    }
  }
  return out;
}

function filmEntries(items: WatchlistItem[]): DiaryEntry[] {
  return items
    .filter(i => i.mediaType === 'movie' && i.status === 'sedd' && i.watchedAt != null)
    .map(i => ({ item: i, date: i.watchedAt as Date, episodeCode: null }));
}

function episodeDiaryEntries(items: WatchlistItem[], episodes: WatchedEpisode[]): DiaryEntry[] {
  const showById = new Map(items.map(i => [i.tmdbId, i]));
  const out: DiaryEntry[] = [];
  for (const ep of episodes) {
    const show = showById.get(ep.tmdbId);
    if (!show) continue; // orphan progress — show no longer in the library
    out.push({ item: show, date: ep.watchedAt, episodeCode: `S${ep.season}E${ep.episode}` });
  }
  return out;
}

function groupByMonth(entries: DiaryEntry[]): DiaryMonth[] {
  const sorted = [...entries].sort((a, b) => b.date.getTime() - a.date.getTime());
  const months: DiaryMonth[] = [];
  let current: DiaryMonth | null = null;
  for (const entry of sorted) {
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

/**
 * Build the full diary: sedd films + watched episodes (looked up against the
 * library for show metadata), newest-first, grouped by calendar month.
 */
export function buildDiary(items: WatchlistItem[], episodes: WatchedEpisode[] = []): DiaryMonth[] {
  return groupByMonth([...filmEntries(items), ...episodeDiaryEntries(items, episodes)]);
}

/** Films-only diary (no episode data needed). */
export function buildFilmDiary(items: WatchlistItem[]): DiaryMonth[] {
  return buildDiary(items, []);
}

/** Total entries across all months — for the header count. */
export function diaryEntryCount(months: DiaryMonth[]): number {
  return months.reduce((sum, m) => sum + m.entries.length, 0);
}
