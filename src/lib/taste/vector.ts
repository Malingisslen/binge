import type { TasteVector, WatchlistItem } from '@/types';

// Viktning per WatchlistItem när vi bygger smakvektorn.
// Baseline: items med rating räknas som 2×rating/10, items utan rating
// räknas som en mild positiv signal om status är "sedd" eller "följer",
// och neutralt för "vill_se" (planerat — inte bevisat).
function weightForItem(item: WatchlistItem): number {
  if (item.rating != null) return (item.rating / 10) * 2;
  if (item.dropped) return -0.5;
  if (item.status === 'sedd') return 1;
  if (item.status === 'följer') return 0.75;
  return 0.25;
}

export function buildTasteVector(
  items: WatchlistItem[],
  calibration?: Record<number, number> | null,
): TasteVector {
  const genres: Record<number, number> = {};
  let sampleSize = 0;
  for (const item of items) {
    if (item.genreIds.length === 0) continue;
    const w = weightForItem(item);
    if (w === 0) continue;
    // Normalisera per item så att serier med många genres inte dominerar.
    const perGenre = w / item.genreIds.length;
    for (const gid of item.genreIds) {
      genres[gid] = (genres[gid] ?? 0) + perGenre;
    }
    sampleSize += 1;
  }
  // Fas 3-uppföljning: kalibreringsswipe. Nya användare (eller de med få
  // watchlist-items) får bootstrappa smakvektorn via /kalibrera. Varje
  // +1/-1-vote från kalibreringen räknas som ett halvt "sedd"-item.
  if (calibration) {
    for (const [gidStr, weight] of Object.entries(calibration)) {
      const gid = Number(gidStr);
      genres[gid] = (genres[gid] ?? 0) + weight;
    }
    const calibSamples = Math.round(
      Object.values(calibration).reduce((s, w) => s + Math.abs(w), 0),
    );
    sampleSize += calibSamples;
  }
  return { genres, sampleSize };
}

export function isUsableVector(v: TasteVector, minSample = 5): boolean {
  return v.sampleSize >= minSample;
}
