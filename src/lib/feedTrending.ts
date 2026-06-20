// BIN-101 — "trendar bland personer du följer". Pure aggregation over the feed
// items the /feed page already fetches (followed users' recent watchlist
// activity) — counts DISTINCT followed users per title, surfaces titles ≥2
// people engaged with as a social-proof discovery row. Zero new reads.

export interface TrendingInput {
  kind: string;
  uid: string;
  displayName: string;
  title: string;
  tmdbId: number;
  mediaType: string;
  posterPath: string | null;
}

export interface TrendingTitle {
  tmdbId: number;
  title: string;
  mediaType: string;
  posterPath: string | null;
  followerCount: number; // distinct followed users who added it in the window
  names: string[];       // their display names, first-seen order
}

export function computeFollowTrending(
  items: TrendingInput[],
  minFollowers = 2,
  limit = 6,
): TrendingTitle[] {
  const byTitle = new Map<number, {
    title: string; mediaType: string; posterPath: string | null;
    uids: Set<string>; names: string[];
  }>();

  for (const it of items) {
    if (it.kind !== 'watchlist') continue; // "lade till" = watchlist activity, not reviews
    let entry = byTitle.get(it.tmdbId);
    if (!entry) {
      entry = { title: it.title, mediaType: it.mediaType, posterPath: it.posterPath, uids: new Set(), names: [] };
      byTitle.set(it.tmdbId, entry);
    }
    if (!entry.uids.has(it.uid)) {
      entry.uids.add(it.uid);
      entry.names.push(it.displayName); // distinct user → one name
    }
    // Prefer a poster if a later item has one and the first didn't.
    if (!entry.posterPath && it.posterPath) entry.posterPath = it.posterPath;
  }

  return [...byTitle.entries()]
    .map(([tmdbId, e]) => ({
      tmdbId, title: e.title, mediaType: e.mediaType, posterPath: e.posterPath,
      followerCount: e.uids.size, names: e.names,
    }))
    .filter(t => t.followerCount >= minFollowers)
    .sort((a, b) => b.followerCount - a.followerCount || a.title.localeCompare(b.title, 'sv'))
    .slice(0, limit);
}
