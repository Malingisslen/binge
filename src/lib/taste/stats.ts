import type { WatchlistItem } from '@/types';

export interface ProfileStats {
  topGenres: { genreId: number; count: number; weight: number }[];
  topProviders: { providerId: number; count: number }[];
  recent30: {
    watched: number;
    added: number;
    rated: number;
  };
}

// Ej påbörjade 'mina'-serier viktas som planerade (vill_se-nivån) — se
// taste/vector.ts för resonemanget.
//
// AVSIKTLIGT olik `buildTasteVector` i taste/vector.ts: detta är en
// *beskrivande* topp-genre-vy för profilen, så betyg räknas rakt (rating/10,
// inte ×2) och 'avbruten' är neutral (0) — en topp-5-lista sorterad på vikt
// kan inte visa "negativ genre-närvaro". vector.ts straffar 'avbruten' (-0.5)
// för att rekommendationsmotorn ska väga bort övergivna genrer. Skalorna ska
// förbli olika.
function weightForItem(item: WatchlistItem): number {
  if (item.rating != null) return item.rating / 10;
  if (item.status === 'avbruten') return 0;
  if (item.status === 'sedd') return 0.8;
  if (item.status === 'mina') return item.lastWatchedSeason == null ? 0.3 : 0.6;
  return 0.3;
}

function within30Days(d: Date | null): boolean {
  if (!d) return false;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return d.getTime() >= cutoff;
}

export function computeProfileStats(items: WatchlistItem[]): ProfileStats {
  const genreCount = new Map<number, { count: number; weight: number }>();
  const providerCount = new Map<number, number>();
  let watched = 0, added = 0, rated = 0;

  for (const item of items) {
    const w = weightForItem(item);
    for (const gid of item.genreIds) {
      const cur = genreCount.get(gid) ?? { count: 0, weight: 0 };
      cur.count += 1;
      cur.weight += w;
      genreCount.set(gid, cur);
    }
    for (const pid of item.providers) {
      providerCount.set(pid, (providerCount.get(pid) ?? 0) + 1);
    }

    if (within30Days(item.watchedAt)) watched += 1;
    if (within30Days(item.addedAt)) added += 1;
    // BIN-349: "rated in last 30 days" should anchor on when the user actually
    // rated (ratedAt), not any edit (updatedAt); fall back for pre-ratedAt items.
    if (item.rating != null && within30Days(item.ratedAt ?? item.updatedAt)) rated += 1;
  }

  const topGenres = Array.from(genreCount.entries())
    .map(([genreId, v]) => ({ genreId, count: v.count, weight: v.weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  const topProviders = Array.from(providerCount.entries())
    .map(([providerId, count]) => ({ providerId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    topGenres,
    topProviders,
    recent30: { watched, added, rated },
  };
}
