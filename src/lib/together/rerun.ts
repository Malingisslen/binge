import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import type { SessionCandidate } from '@/types';

/**
 * Titlar som inte får komma med när värden kör om en session: de som sessionen
 * redan har, så att den nya omgången är ny. Valfria extra nycklar (t.ex. ett
 * bibliotek) läggs till. Nycklarna är mediaTypeDocId, som en film 42
 * och en serie 42 ska hålla isär.
 */
export function rerunExcludeIds(
  currentCandidates: ReadonlyArray<Pick<SessionCandidate, 'mediaType' | 'tmdbId'>>,
  extra: ReadonlySet<string> = new Set(),
): Set<string> {
  const out = new Set(extra);
  for (const c of currentCandidates) out.add(mediaTypeDocId(c.mediaType, c.tmdbId));
  return out;
}

/** Bara sessionens värd (inloggad) får köra om. Gäster har hostUid null. */
export function canRerun(session: { hostUid: string | null }, meUid: string | null | undefined): boolean {
  return !!session.hostUid && !!meUid && session.hostUid === meUid;
}
