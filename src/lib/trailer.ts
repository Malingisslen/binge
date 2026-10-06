import type { TMDBVideo } from '@/types/tmdb';

// Vilket klipp titelsidan visar: en trailer före en teaser, och inom samma sort ett
// svenskt klipp före ett engelskt före ett utan språk. TMDB:s egen ordning avgör resten.
const LANGUAGE_RANK: Record<string, number> = { sv: 0, en: 1 };
const TYPE_RANK: Record<string, number> = { Trailer: 0, Teaser: 1 };

export function pickTrailer(videos: readonly TMDBVideo[] | undefined): TMDBVideo | undefined {
  const candidates = (videos ?? []).filter(v => v.site === 'YouTube' && v.type in TYPE_RANK);
  const rank = (v: TMDBVideo) => TYPE_RANK[v.type] * 10 + (LANGUAGE_RANK[v.iso_639_1 ?? ''] ?? 2);
  return candidates.reduce<TMDBVideo | undefined>((best, v) => (!best || rank(v) < rank(best) ? v : best), undefined);
}
