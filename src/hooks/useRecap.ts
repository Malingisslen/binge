import { useQueries, useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';
import { toDate } from '@/lib/firebase/utils';
import { recapDocId, seasonRecapDocId, type EpisodeRef } from '@/lib/recaps/boundary';
import { recapIndexDocId, parseRecapIndex, nearestCoveredBoundary } from '@/lib/recaps/coverage';
import { RECAPS_ENABLED } from '@/lib/recaps/config';
import { isSeasonRecapLoading } from './useRecap.helpers';
import type { RecapDoc, RecapSource, SeasonRecapDoc } from '@/lib/recaps/types';

/** A source entry is usable only if it has string name + url (attribution must link somewhere). */
function isValidSource(s: unknown): s is { name: string; url: string; license?: unknown } {
  return !!s && typeof s === 'object'
    && typeof (s as { name?: unknown }).name === 'string'
    && typeof (s as { url?: unknown }).url === 'string';
}

function docToRecap(data: Record<string, unknown>): RecapDoc {
  const rawSources = Array.isArray(data.sources) ? (data.sources as unknown[]) : [];
  const sources: RecapSource[] = rawSources.filter(isValidSource).map((s) => ({
    name: s.name,
    url: s.url,
    license: typeof s.license === 'string' ? s.license : 'CC BY-SA 4.0',
  }));
  return {
    tmdbId: Number(data.tmdbId),
    season: Number(data.season),
    episode: Number(data.episode),
    text: String(data.text ?? ''),
    textFull: typeof data.textFull === 'string' && data.textFull.length > 0 ? data.textFull : undefined,
    lang: 'sv',
    model: String(data.model ?? ''),
    sources,
    license: String(data.license ?? 'CC BY-SA 4.0'),
    generatedAt: data.generatedAt ? toDate(data.generatedAt) : new Date(0),
    schemaVersion: Number(data.schemaVersion ?? 1),
  };
}

function docToSeasonRecap(data: Record<string, unknown>): SeasonRecapDoc {
  const rawSources = Array.isArray(data.sources) ? (data.sources as unknown[]) : [];
  const sources: RecapSource[] = rawSources.filter(isValidSource).map((s) => ({
    name: s.name,
    url: s.url,
    license: typeof s.license === 'string' ? s.license : 'CC BY-SA 4.0',
  }));
  return {
    tmdbId: Number(data.tmdbId),
    season: Number(data.season),
    text: String(data.text ?? ''),
    lang: 'sv',
    model: String(data.model ?? ''),
    sources,
    license: String(data.license ?? 'CC BY-SA 4.0'),
    generatedAt: data.generatedAt ? toDate(data.generatedAt) : new Date(0),
    schemaVersion: Number(data.schemaVersion ?? 1),
  };
}

/** Direct doc get with the streamingOffers 10s-timeout precedent (getDoc has no own limit). */
async function getDocWithTimeout(docId: string): Promise<Record<string, unknown> | null> {
  const { db, doc, getDoc } = await fsdb();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('recap timeout')), 10_000);
  });
  try {
    const snap = await Promise.race([getDoc(doc(db, 'recaps', docId)), timeout]);
    return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  } finally {
    clearTimeout(timer);
  }
}

export interface RecapResult {
  recap: RecapDoc | null;
  /** The boundary the recap actually covers — equals the request on an exact hit, an
   * EARLIER boundary on a fallback (never later; spoiler-safe by construction). */
  coveredBoundary: EpisodeRef | null;
}

/** On an index/doc drift (indexed boundary whose doc is missing) walk back at most this
 * many earlier covered boundaries before giving up — keeps the read cost hard-bounded. */
const MAX_FALLBACK_STEPS = 3;

/**
 * Read the recap for a user's exact boundary — or, when that boundary has no recap, the
 * nearest EARLIER covered one (per the show's `recaps/{tmdbId}_index` doc, maintained by
 * the upload batch). The index is cached PER SHOW (its own query key), so a binge-watcher
 * advancing their boundary re-reads only the recap doc, not the index. Direct doc gets
 * only, never a query (DBA condition). Query keys are intentionally NOT in
 * PERSISTED_QUERY_PREFIXES — per-title data must never hit localStorage. In-memory only.
 */
export function useRecap(tmdbId: number | undefined, boundary: EpisodeRef | null): RecapResult {
  const baseEnabled = RECAPS_ENABLED && tmdbId != null;

  // 1) Per-show coverage index — cached across boundary changes (1h), absent → not seeded.
  const { data: covered } = useQuery({
    queryKey: ['recap-index', tmdbId],
    enabled: baseEnabled,
    staleTime: 1000 * 60 * 60,
    queryFn: async () => parseRecapIndex(await getDocWithTimeout(recapIndexDocId(tmdbId!))),
  });

  // 2) The recap at the exact-or-nearest-earlier covered boundary. On a drifted index
  //    (doc missing for an indexed boundary) walk back a bounded number of steps.
  const { data } = useQuery({
    queryKey: ['recap', tmdbId, boundary?.season, boundary?.episode],
    enabled: baseEnabled && boundary != null && covered != null && covered.length > 0,
    staleTime: 1000 * 60 * 60, // recaps are immutable once generated
    queryFn: async (): Promise<RecapResult> => {
      let cursor: EpisodeRef | null = boundary!;
      for (let step = 0; step < MAX_FALLBACK_STEPS && cursor; step++) {
        const target: EpisodeRef | null = nearestCoveredBoundary(covered!, cursor);
        if (!target) break;
        const recapData = await getDocWithTimeout(recapDocId(tmdbId!, target.season, target.episode));
        if (recapData) return { recap: docToRecap(recapData), coveredBoundary: target };
        // Drifted index entry: try the next boundary strictly before this one.
        cursor = target.episode > 1
          ? { season: target.season, episode: target.episode - 1 }
          : { season: target.season - 1, episode: Number.MAX_SAFE_INTEGER };
      }
      return { recap: null, coveredBoundary: null };
    },
  });
  return data ?? { recap: null, coveredBoundary: null };
}

export interface SeasonRecapResult {
  season: number;
  recap: SeasonRecapDoc | null;
  /** True until this season's query has resolved SUCCESSFULLY — covers both "still in
   * flight" AND "the read errored/timed out" (getDocWithTimeout's 10s race can reject). A
   * consumer MUST check this before treating `recap === null` as "no recap exists": on an
   * error, React Query settles `isPending` to false too, so checking pending-state alone
   * still produces the same false-negative empty state as not checking anything (confirmed
   * finding, BIN-185 story-so-far redesign review — this is the fixed, complete version). */
  isLoading: boolean;
}

/**
 * Lazily fetch full season recap docs (`recaps/{tmdbId}_season_{n}`) for the given season
 * numbers — powers "Visa tidigare säsonger" only. `enabled` must stay false until the user
 * expands that disclosure: these are extra reads with no default-view purpose. Parallel doc
 * gets, in-memory only (never PERSISTED_QUERY_PREFIXES — per-title data), 1h staleTime
 * (season recaps are immutable once generated, same as boundary recaps).
 */
export function useSeasonRecaps(tmdbId: number | undefined, seasons: number[], enabled: boolean): SeasonRecapResult[] {
  const results = useQueries({
    queries: seasons.map((season) => ({
      queryKey: ['recap-season', tmdbId, season],
      enabled: RECAPS_ENABLED && tmdbId != null && enabled,
      staleTime: 1000 * 60 * 60,
      queryFn: async (): Promise<SeasonRecapDoc | null> => {
        const data = await getDocWithTimeout(seasonRecapDocId(tmdbId!, season));
        return data ? docToSeasonRecap(data) : null;
      },
    })),
  });
  return seasons.map((season, i) => ({
    season,
    recap: results[i]?.data ?? null,
    isLoading: isSeasonRecapLoading(enabled, results[i]),
  }));
}
