import { useQuery } from '@tanstack/react-query';
import { getPersonExternalIds } from '@/lib/tmdb/client';
import { svwikiTitleFromEntities, cleanWikiExtract } from '@/lib/wikipedia/bio';

/**
 * Swedish-Wikipedia bio fallback: TMDB external_ids -> Wikidata svwiki title ->
 * Wikipedia REST summary. Client-side, keyless, CORS-safe. Only runs when
 * `enabled` (i.e. TMDB has no Swedish bio). Not persisted (per-title data).
 */
export function useSwedishWikiBio(
  personId: number | undefined,
  enabled: boolean,
): { text: string; pageUrl: string } | null {
  const { data } = useQuery({
    queryKey: ['wiki-bio', personId],
    enabled: enabled && personId != null,
    staleTime: 1000 * 60 * 60 * 24 * 30, // bios rarely change
    queryFn: async (ctx) => {
      const ext = await getPersonExternalIds(personId!, { signal: ctx.signal });
      const wd = ext.wikidata_id;
      if (!wd) return null;

      const entRes = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wd}&props=sitelinks&format=json&origin=*`,
        { signal: ctx.signal },
      );
      if (!entRes.ok) return null;
      const title = svwikiTitleFromEntities(await entRes.json(), wd);
      if (!title) return null;

      const sumRes = await fetch(
        `https://sv.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { signal: ctx.signal },
      );
      if (!sumRes.ok) return null;
      return cleanWikiExtract(await sumRes.json());
    },
  });
  return data ?? null;
}
