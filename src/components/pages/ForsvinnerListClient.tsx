'use client';

import Link from 'next/link';
import { useQueries } from '@tanstack/react-query';
import { useStreamingLeaving } from '@/hooks/useStreamingLeaving';
import { getEnglishTitle, getMovieLite, getTVShowLite, posterUrl } from '@/lib/tmdb/client';
import { hasNonLatinTitle } from '@/lib/utils/titleFilter';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { LoadingView } from '@/components/ui/LoadingView';
import { EmptyState } from '@/components/ui/EmptyState';
import type { TMDBMovie, TMDBTVShow } from '@/types/tmdb';
import { cardClass } from '@/components/ui/Card';

const MAX_SHOWN = 30;

function leavingLabel(iso: string): string {
  // Parse + format in UTC so the bare YYYY-MM-DD renders as exactly that calendar
  // day — a local-midnight parse drifts the label ±1 day in the small hours.
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * BIN-178 — the live "leaving soon" list for one provider. The indexable shell
 * (H1, intro, metadata, JSON-LD) is server-rendered by the route; this fills in
 * the current titles client-side from streamingLeaving/current, enriched with
 * names/posters via TMDB lite (the rollup carries only ids + dates).
 */
export default function ForsvinnerListClient({
  providerId,
  providerName,
}: {
  providerId: number;
  providerName: string;
}) {
  const { entries, loading } = useStreamingLeaving(providerId);
  const shown = entries.slice(0, MAX_SHOWN);

  const titleQueries = useQueries({
    queries: shown.map((e) => ({
      queryKey: [e.mediaType === 'tv' ? 'tv-lite' : 'movie-lite', e.tmdbId],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        e.mediaType === 'tv' ? getTVShowLite(e.tmdbId, { signal }) : getMovieLite(e.tmdbId, { signal }),
      staleTime: TMDB_STALE.LITE_DETAIL,
    })),
  });

  // TMDB faller tillbaka på originaltiteln när en svensk saknas. Står den i ett
  // annat skriftsystem hämtas den engelska titeln, bara för just den raden.
  const swedishTitles = shown.map((_, i) => {
    const data = titleQueries[i]?.data as TMDBMovie | TMDBTVShow | undefined;
    return data
      ? ('title' in data ? data.title : data.name) || ('original_title' in data ? data.original_title : data.original_name)
      : undefined;
  });
  const englishQueries = useQueries({
    queries: shown.map((e, i) => ({
      queryKey: ['title-en', e.mediaType, e.tmdbId],
      queryFn: ({ signal }: { signal: AbortSignal }) => getEnglishTitle(e.mediaType, e.tmdbId, { signal }),
      enabled: hasNonLatinTitle(swedishTitles[i]),
      staleTime: TMDB_STALE.LITE_DETAIL,
    })),
  });

  if (loading) return <LoadingView label={`Hämtar vad som försvinner från ${providerName}…`} />;

  if (shown.length === 0) {
    return (
      <EmptyState
        title={`Inget känt försvinner från ${providerName} just nu`}
        body="Inga kända titlar lämnar den här tjänsten den närmaste tiden. Datumen kommer från Movie of the Night och uppdateras löpande, så titta in igen."
      />
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {shown.map((e, i) => {
        const data = titleQueries[i]?.data as TMDBMovie | TMDBTVShow | undefined;
        const english = englishQueries[i]?.data;
        const title = (english && (english.title || english.name)) || swedishTitles[i] || '…';
        const poster = posterUrl(data?.poster_path ?? null, 'w92');
        const href = `/${e.mediaType === 'movie' ? 'movie' : 'tv'}/${e.tmdbId}/`;
        return (
          <li key={`${e.tmdbId}-${e.mediaType}`}>
            <Link href={href} className={cardClass('flex items-center gap-3 p-2 hover:shadow-lift transition-shadow')}>
              {poster ? (
                <img src={poster} alt="" width={46} height={69} loading="lazy" decoding="async" className="rounded-sm shrink-0" />
              ) : (
                <div className="w-[46px] h-[69px] rounded-sm bg-bg-2 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-base font-medium text-ink truncate">{title}</div>
                <div className="text-sm text-ink-2">{e.mediaType === 'tv' ? 'Serie' : 'Film'}</div>
              </div>
              <div className="text-sm text-acc-deep shrink-0 whitespace-nowrap">lämnar {leavingLabel(e.leaving)}</div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
