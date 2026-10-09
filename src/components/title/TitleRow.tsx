'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Film, Tv } from 'lucide-react';
import { formatStars, starsFromTmdb } from '@/lib/filters/titleFilters';
import { posterUrl, getDisplayTitle, getReleaseYear, isAddableMediaType, titleHref } from '@/lib/tmdb/client';
import { getProvider, canonicalProviderId, dedupeProvidersByCanonicalId } from '@/lib/tmdb/providers';
import { toneForGenreIds, toneForId } from '@/lib/duotone';
import { useAuth } from '@/hooks/useAuth';
import type { TMDBSearchResult, TMDBProvider, MediaType } from '@/types';
import QuickAddButton from './QuickAddButton';

interface TitleRowProps {
  item: TMDBSearchResult;
  providers?: TMDBProvider[];
}

// A phone fits about ten of these per screen where the two-column poster grid
// fits four, which is what makes scanning a result list bearable.
export default function TitleRow({ item, providers }: TitleRowProps) {
  const { user } = useAuth();
  const [imgError, setImgError] = useState(false);
  const isTrackable = isAddableMediaType(item);
  const href = isTrackable ? titleHref(item.media_type, item.id) : '#';
  const title = getDisplayTitle(item);
  const year = getReleaseYear(item);
  const poster = posterUrl(item.poster_path, 'w154');
  const Icon = item.media_type === 'tv' ? Tv : Film;
  const tone = item.genre_ids && item.genre_ids.length > 0 ? toneForGenreIds(item.genre_ids) : toneForId(item.id);

  const deduped = providers ? dedupeProvidersByCanonicalId(providers) : [];
  const first = deduped[0];
  const firstMapped = first ? getProvider(first.provider_id) : undefined;
  const isMine = first ? (user?.myProviders ?? []).includes(canonicalProviderId(first.provider_id)) : false;
  const extra = deduped.length - 1;

  const stars = starsFromTmdb(item.vote_average);
  // 0 means nobody has voted yet, not a rating of zero.
  const meta = [
    year,
    item.media_type === 'tv' ? 'Serie' : 'Film',
    stars > 0 ? `${formatStars(stars)}★` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="flex items-center gap-3 py-2">
      <Link href={href} className="flex items-center gap-3 min-w-0 flex-1 no-underline text-ink">
        <div className={`poster duo-${tone} w-10 shrink-0`}>
          {poster && !imgError ? (
            <img
              src={poster}
              alt=""
              loading="lazy"
              decoding="async"
              width={154}
              height={231}
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-bg-2">
              <Icon size={16} className="text-ink-3" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold truncate">{title}</div>
          <div className="text-xs text-ink-3 mt-0.5">{meta}</div>
        </div>
        {first && (
          <span
            className={`text-xs px-1.5 py-0.5 rounded-sm shrink-0 whitespace-nowrap ${isMine ? 'bg-acc-soft text-acc-deep font-semibold' : 'bg-bg-2 text-ink-2'}`}
          >
            {firstMapped?.shortName ?? first.provider_name}{extra > 0 ? ` +${extra}` : ''}
          </span>
        )}
      </Link>
      {isTrackable && (
        <QuickAddButton
          tmdbId={item.id}
          mediaType={item.media_type as MediaType}
          title={title}
          posterPath={item.poster_path}
          releaseYear={year}
          providers={providers ? deduped.map(p => canonicalProviderId(p.provider_id)) : undefined}
          subscriptionProviders={providers ? deduped.map(p => canonicalProviderId(p.provider_id)) : undefined}
          genreIds={item.genre_ids}
        />
      )}
    </div>
  );
}
