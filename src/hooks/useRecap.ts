import { useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';
import { toDate } from '@/lib/firebase/utils';
import { recapDocId, type EpisodeRef } from '@/lib/recaps/boundary';
import { RECAPS_ENABLED } from '@/lib/recaps/config';
import type { RecapDoc, RecapSource } from '@/lib/recaps/types';

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
    lang: 'sv',
    model: String(data.model ?? ''),
    sources,
    license: String(data.license ?? 'CC BY-SA 4.0'),
    generatedAt: data.generatedAt ? toDate(data.generatedAt) : new Date(0),
    schemaVersion: Number(data.schemaVersion ?? 1),
  };
}

/**
 * Read the shared recaps/{tmdbId}_{s}_{e} doc for a user's exact boundary. Returns null on a
 * cache miss (→ no recap surfaced). Gated by RECAPS_ENABLED so no read fires while the batch
 * is unshipped. Query key 'recap' is intentionally NOT in PERSISTED_QUERY_PREFIXES — per-title-
 * per-episode data must never hit localStorage (the standing 5MB-quota rule). In-memory only.
 */
export function useRecap(tmdbId: number | undefined, boundary: EpisodeRef | null): { recap: RecapDoc | null } {
  const enabled = RECAPS_ENABLED && tmdbId != null && boundary != null;
  const { data } = useQuery({
    queryKey: ['recap', tmdbId, boundary?.season, boundary?.episode],
    enabled,
    staleTime: 1000 * 60 * 60, // 1h client cache; recaps are immutable once generated
    queryFn: async () => {
      const { db, doc, getDoc } = await fsdb();
      const id = recapDocId(tmdbId!, boundary!.season, boundary!.episode);
      // Bind the read to a 10s timeout (streamingOffers precedent — getDoc has no own limit).
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('recap timeout')), 10_000);
      });
      try {
        const snap = await Promise.race([getDoc(doc(db, 'recaps', id)), timeout]);
        return snap.exists() ? docToRecap(snap.data() as Record<string, unknown>) : null;
      } finally {
        clearTimeout(timer);
      }
    },
  });
  return { recap: data ?? null };
}
