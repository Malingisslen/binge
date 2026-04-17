import type { TasteVector } from '@/types';

export function cosineSimilarity(a: TasteVector, b: TasteVector): number {
  const keys = Array.from(new Set<number>([
    ...Object.keys(a.genres).map(Number),
    ...Object.keys(b.genres).map(Number),
  ]));

  let dot = 0, aMag = 0, bMag = 0;
  for (const k of keys) {
    const av = a.genres[k] ?? 0;
    const bv = b.genres[k] ?? 0;
    dot += av * bv;
    aMag += av * av;
    bMag += bv * bv;
  }

  if (aMag === 0 || bMag === 0) return 0;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

// Cosine ligger på [-1, 1]. Clampar till [0, 1] och skalar till procent
// så "smak-match 74%" blir läsbart.
export function matchPercent(a: TasteVector, b: TasteVector): number {
  const sim = cosineSimilarity(a, b);
  return Math.round(Math.max(0, Math.min(1, sim)) * 100);
}

// Poängsätt en kandidat mot en användares smakvektor. Returnerar tal som
// kan jämföras mellan kandidater (inte ett absolut mått). Baseline: summa
// av användarens vikt för kandidatens genrer, normaliserat per genre.
export function scoreCandidateForUser(
  candidateGenres: number[],
  user: TasteVector,
): number {
  if (candidateGenres.length === 0) return 0;
  let score = 0;
  for (const gid of candidateGenres) {
    score += user.genres[gid] ?? 0;
  }
  return score / candidateGenres.length;
}
