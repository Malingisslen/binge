// Betygsfördelningen på /stats: en stapel per hel stjärna, 1–5. Betygen sätts i halva
// stjärnor (0,5–5), så ett halvt steg hamnar i stapeln under (4,5 → 4) och 0,5 i
// stapeln för 1. Utan golvet föll 0,5 bort ur alla staplar medan rubrikens antal
// betygsatta räknade med dem, så staplarna summerade till mindre än rubriken.
export function ratingDistribution(ratings: readonly number[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const r of ratings) {
    const bucket = String(Math.min(5, Math.max(1, Math.floor(r))));
    dist[bucket] = (dist[bucket] ?? 0) + 1;
  }
  return dist;
}
