/**
 * Pure helpers for the morning episode question (BIN-1475): grouping the queue
 * episodeReleaseNotify leaves per show into one list per user, and the wording.
 * No firebase-admin import, so it runs under the root Vitest suite.
 */

export interface PendingEpisode {
  episodeId: number;
  season: number;
  episode: number;
  /** TMDB air_date (YYYY-MM-DD) or null when TMDB had none. */
  airDate: string | null;
  uids: string[];
  /** ms epoch when the episode was queued; older than MAX_QUEUE_AGE_MS is dropped. */
  queuedAt?: number;
}

/** A queued episode nobody has been told about by now is stale, not owed. */
export const MAX_QUEUE_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export interface DigestItem {
  tmdbId: number;
  title: string;
  season: number;
  episode: number;
  airDate: string | null;
}

/** Cap on rows in the card; the count in the text is of the rows actually listed. */
export const MAX_DIGEST_ITEMS = 12;

export function episodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

/** One entry per (user, show, episode) from the per-show queue docs. */
export function groupQueueByUser(
  queue: ReadonlyArray<{ tmdbId: number; pending: readonly PendingEpisode[] }>,
): Map<string, Array<{ tmdbId: number; season: number; episode: number; airDate: string | null }>> {
  const out = new Map<string, Array<{ tmdbId: number; season: number; episode: number; airDate: string | null }>>();
  const seen = new Set<string>();
  for (const show of queue) {
    for (const p of show.pending) {
      for (const uid of p.uids) {
        const key = `${uid}|${show.tmdbId}|${p.episodeId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const list = out.get(uid) ?? [];
        list.push({ tmdbId: show.tmdbId, season: p.season, episode: p.episode, airDate: p.airDate });
        out.set(uid, list);
      }
    }
  }
  return out;
}

/** True when the user already watched this episode or a later one of the show. */
export function alreadyWatched(
  progress: { lastWatchedSeason: number | null; lastWatchedEpisode: number | null },
  season: number,
  episode: number,
): boolean {
  if (progress.lastWatchedSeason == null) return false;
  const s = progress.lastWatchedSeason;
  const e = progress.lastWatchedEpisode ?? 0;
  return s > season || (s === season && e >= episode);
}

/** One row per show: if a show queued two episodes, the later one stands for it. */
export function onePerShow(items: DigestItem[]): DigestItem[] {
  const latest = new Map<number, DigestItem>();
  for (const it of items) {
    const cur = latest.get(it.tmdbId);
    if (!cur || it.season > cur.season || (it.season === cur.season && it.episode > cur.episode)) latest.set(it.tmdbId, it);
  }
  return [...latest.values()].sort((a, b) => a.title.localeCompare(b.title, 'sv'));
}

/** "Igår" is only said when every listed episode aired yesterday (Stockholm). */
export function allAiredYesterday(items: readonly DigestItem[], yesterdayId: string): boolean {
  return items.length > 0 && items.every((i) => i.airDate === yesterdayId);
}

export function digestTitle(count: number, airedYesterday: boolean): string {
  if (airedYesterday) return count === 1 ? 'Igår kom ett avsnitt du följer' : `Igår kom ${count} avsnitt du följer`;
  return count === 1 ? 'Nytt avsnitt av en serie du följer' : `${count} nya avsnitt av serier du följer`;
}

/** Series name and code only, never the episode title or plot (no spoilers). */
export function digestBody(items: readonly DigestItem[]): string {
  const shown = items.slice(0, 3).map((i) => `${i.title} ${episodeCode(i.season, i.episode)}`);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} och ${rest} till` : shown.join(', ');
}

/**
 * What stays on a show's queue after a run. Only the uids this run finished with
 * (told, or deliberately skipped) are removed, and only from the entries it read;
 * an entry queued while the run was going is untouched, so nothing is lost and
 * nobody is told twice. Entries older than MAX_QUEUE_AGE_MS go as well.
 */
export function settlePending(
  current: readonly PendingEpisode[],
  readEpisodeIds: ReadonlySet<number>,
  doneUids: ReadonlySet<string>,
  nowMs: number,
): PendingEpisode[] {
  const out: PendingEpisode[] = [];
  for (const p of current) {
    if (p.queuedAt != null && nowMs - p.queuedAt > MAX_QUEUE_AGE_MS) continue;
    const uids = readEpisodeIds.has(p.episodeId) ? p.uids.filter((u) => !doneUids.has(u)) : p.uids;
    if (uids.length > 0) out.push({ ...p, uids });
  }
  return out;
}
