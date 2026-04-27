import type { MemberProgress } from '@/hooks/useGroupMemberProgress';

// Spoiler-skydd-helper: räknar ut den "trailing edge" i en grupps progress
// på en TV-titel — alltså den medlem som ligger längst bak.
//
// Avsnitt utöver den positionen (säsong+avsnitt) bör maskeras i
// SeasonPageClient + SeriesDetail när användaren navigerat dit från
// grupp-watchlist.
//
// Returnerar null om alla medlemmar ligger på samma position eller högre
// — då finns inget att skydda.

export interface MaskBoundary {
  season: number;
  episode: number;
  // Vilka medlemmar ligger på minsta-positionen. Används för banner-text:
  // "Jonatan har sett t.o.m. S1E3" (plural om flera).
  trailingMemberUids: string[];
}

// Position som heltal: S2E5 → 2*1000 + 5 = 2005. Ger naturlig sortering.
// Cap:as på 999 episodes per säsong vilket täcker alla TV-serier som
// existerar i TMDB:s databas (största är typ The Simpsons med ~770).
function positionKey(season: number | null, episode: number | null): number {
  return (season ?? 0) * 1000 + (episode ?? 0);
}

export function computeMaskBoundary(
  progressByMember: Map<string, Map<number, MemberProgress>>,
  tmdbId: number,
  memberUids: string[],
): MaskBoundary | null {
  if (memberUids.length === 0) return null;

  // Bygg per-medlem position. Medlemmar utan progress-doc räknas som position 0.
  const positions = memberUids.map(uid => {
    const p = progressByMember.get(uid)?.get(tmdbId);
    return {
      uid,
      season: p?.lastWatchedSeason ?? 0,
      episode: p?.lastWatchedEpisode ?? 0,
      key: positionKey(p?.lastWatchedSeason ?? null, p?.lastWatchedEpisode ?? null),
    };
  });

  // Hitta minsta-positionen.
  let minKey = positions[0].key;
  for (const p of positions) {
    if (p.key < minKey) minKey = p.key;
  }
  // Hitta största för jämförelse.
  let maxKey = positions[0].key;
  for (const p of positions) {
    if (p.key > maxKey) maxKey = p.key;
  }

  // Alla på samma position → ingen mask.
  if (minKey === maxKey) return null;

  // Annars returnera minsta-positionen + uids som ligger där.
  const trailing = positions.filter(p => p.key === minKey);
  return {
    season: trailing[0].season,
    episode: trailing[0].episode,
    trailingMemberUids: trailing.map(p => p.uid),
  };
}

// Är ett specifikt avsnitt "över" mask-boundary (= ska maskeras)?
export function isEpisodeMasked(
  boundary: MaskBoundary | null,
  season: number,
  episode: number,
): boolean {
  if (!boundary) return false;
  const key = positionKey(season, episode);
  const boundaryKey = positionKey(boundary.season, boundary.episode);
  return key > boundaryKey;
}
