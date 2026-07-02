import type {
  WatchlistItem,
  Seed,
  RecurringPerson,
  RecurringKeyword,
  DominantGenre,
  MediaType,
} from '@/types';

/** Minimal credit shape consumed by detection. Caller assembles from TMDB. */
export interface SeedCredits {
  cast: { id: number; name: string }[];
  director: { id: number; name: string } | null;
}

const STRONG_SEED_STATUSES: ReadonlyArray<WatchlistItem['status']> = ['sedd', 'mina'];

export function classifySeeds(items: readonly WatchlistItem[]): {
  strong: Seed[];
  weak: Seed[];
} {
  const strong: Seed[] = [];
  const weak: Seed[] = [];
  for (const it of items) {
    if (it.rating == null) continue;
    if (!STRONG_SEED_STATUSES.includes(it.status)) continue;
    const seed: Seed = {
      tmdbId: it.tmdbId,
      mediaType: it.mediaType,
      rating: it.rating,
      title: it.title,
      // BIN-349: prefer the dedicated rating-time; fall back to updatedAt for
      // items rated before ratedAt existed (lazy migration, no backfill sweep).
      ratedAt: it.ratedAt ?? it.updatedAt ?? null,
    };
    if (it.rating >= 4) strong.push(seed);
    else if (it.rating === 3) weak.push(seed);
  }
  return { strong, weak };
}

/**
 * Cap a seed list to the N most-recently-rated (ratedAt desc; missing
 * timestamps sort last). Used to bound the recommendations-cascade fan-out:
 * recurring-people/keyword detection only surfaces the top 3, so fetching
 * detail/keywords for seeds beyond ~N adds TMDB cost with ~zero marginal value.
 * Returns the input as-is when already within the cap.
 */
export function capRecentSeeds(seeds: readonly Seed[], n: number): Seed[] {
  if (seeds.length <= n) return [...seeds];
  return [...seeds]
    .sort((a, b) => (b.ratedAt?.getTime() ?? 0) - (a.ratedAt?.getTime() ?? 0))
    .slice(0, n);
}

export function detectLatestFiveStar(
  items: readonly WatchlistItem[],
  now: Date,
  windowDays: number,
): { tmdbId: number; mediaType: MediaType; title: string; daysSince: number } | null {
  const cutoffMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  let best: { item: WatchlistItem; ts: number } | null = null;
  for (const it of items) {
    if (it.rating !== 5) continue;
    if (!STRONG_SEED_STATUSES.includes(it.status)) continue;
    // BIN-349: anchor on ratedAt (when the user actually rated), falling back to
    // updatedAt for pre-ratedAt items. Guard so .getTime() never throws (L2).
    const ts = (it.ratedAt ?? it.updatedAt)?.getTime();
    if (!ts || ts < cutoffMs) continue;
    if (!best || ts > best.ts) best = { item: it, ts };
  }
  if (!best) return null;
  const daysSince = Math.floor((now.getTime() - best.ts) / (24 * 60 * 60 * 1000));
  return { tmdbId: best.item.tmdbId, mediaType: best.item.mediaType, title: best.item.title, daysSince };
}

export function detectRecurringPeople(
  strongSeeds: readonly Seed[],
  creditsByTmdb: ReadonlyMap<number, SeedCredits>,
  threshold: number,
): RecurringPerson[] {
  type Bucket = { id: number; name: string; titles: Set<number>; everDirector: boolean };
  const buckets = new Map<number, Bucket>();

  for (const seed of strongSeeds) {
    const credits = creditsByTmdb.get(seed.tmdbId);
    if (!credits) continue;
    for (const c of credits.cast.slice(0, 5)) {
      const b = buckets.get(c.id) ?? { id: c.id, name: c.name, titles: new Set<number>(), everDirector: false };
      b.titles.add(seed.tmdbId);
      buckets.set(c.id, b);
    }
    if (credits.director) {
      const d = credits.director;
      const b = buckets.get(d.id) ?? { id: d.id, name: d.name, titles: new Set<number>(), everDirector: false };
      b.titles.add(seed.tmdbId);
      b.everDirector = true;
      buckets.set(d.id, b);
    }
  }

  return Array.from(buckets.values())
    .filter(b => b.titles.size >= threshold)
    .map<RecurringPerson>(b => ({
      id: b.id,
      name: b.name,
      recurrence: b.titles.size,
      knownFor: b.everDirector ? 'director' : 'cast',
    }))
    .sort((a, b) => {
      if (b.recurrence !== a.recurrence) return b.recurrence - a.recurrence;
      if (a.knownFor !== b.knownFor) return a.knownFor === 'director' ? -1 : 1;
      return 0;
    })
    .slice(0, 5);
}

export function detectRecurringKeywords(
  seeds: readonly Seed[],
  keywordsByTmdb: ReadonlyMap<number, { id: number; name: string }[]>,
  threshold: number,
): RecurringKeyword[] {
  const buckets = new Map<number, { id: number; name: string; titles: Set<number> }>();
  for (const seed of seeds) {
    const ks = keywordsByTmdb.get(seed.tmdbId);
    if (!ks) continue;
    for (const k of ks) {
      const b = buckets.get(k.id) ?? { id: k.id, name: k.name, titles: new Set<number>() };
      b.titles.add(seed.tmdbId);
      buckets.set(k.id, b);
    }
  }
  return Array.from(buckets.values())
    .filter(b => b.titles.size >= threshold)
    .map<RecurringKeyword>(b => ({ id: b.id, name: b.name, recurrence: b.titles.size }))
    .sort((a, b) => b.recurrence - a.recurrence)
    .slice(0, 3);
}

export function detectDominantGenres(
  items: readonly WatchlistItem[],
  cap: number,
): DominantGenre[] {
  const counts = new Map<number, number>();
  for (const it of items) {
    if (it.rating == null || it.rating < 3) continue;
    if (!STRONG_SEED_STATUSES.includes(it.status)) continue;
    for (const g of it.genreIds) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, cap);
}
