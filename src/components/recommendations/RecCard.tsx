'use client';

import { useState } from 'react';
import Link from 'next/link';
import { posterUrl, getDisplayTitle, getReleaseYear, isAddableMediaType, titleHref } from '@/lib/tmdb/client';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { toneForGenreIds, toneForId } from '@/lib/duotone';
import { canonicalProviderId } from '@/lib/tmdb/providers';
import type { TMDBSearchResult, TMDBProvider, MediaType } from '@/types';
import QuickAddButton from '@/components/title/QuickAddButton';
import NotInterestedButton from '@/components/title/NotInterestedButton';

// Direction H recommendation card: duotone 2:3 poster (genre-mapped) +
// title + sub line (mono). On hover, the poster border darkens and the
// poster lifts. Quick-add + not-interested controls live in the corners.

interface Props {
  item: TMDBSearchResult;
  providers?: TMDBProvider[];
}

export default function RecCard({ item, providers }: Props) {
  useAuth(); // ensures hook order matches QuickAddButton (which uses auth)
  const { getItem } = useWatchlist();
  const isTrackable = isAddableMediaType(item);
  const href = isTrackable ? titleHref(item.media_type, item.id) : '#';
  const title = getDisplayTitle(item);
  const year = getReleaseYear(item);
  const poster = posterUrl(item.poster_path, 'w342');
  const tone = item.genre_ids && item.genre_ids.length > 0
    ? toneForGenreIds(item.genre_ids)
    : toneForId(item.id);
  const isTracked = isTrackable && !!getItem(item.id);
  const [imgError, setImgError] = useState(false);

  const sub = item.media_type === 'tv' ? 'serie' : 'film';
  const meta = year != null ? `${sub} · ${year} · ${(item.vote_average ?? 0).toFixed(1)}` : sub;

  return (
    <div className="rec-card">
      <Link href={href} aria-label={title} style={{ display: 'block' }}>
        <div className={`poster duo-${tone}`}>
          {poster && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={poster}
              alt=""
              width={342}
              height={513}
              loading="lazy"
              decoding="async"
              onError={() => setImgError(true)}
            />
          ) : null}
          {isTracked && (
            <span className="corner-badge in-lib" aria-label="I ditt bibliotek">
              i biblioteket
            </span>
          )}
        </div>
      </Link>
      <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
        <div className="ttl">{title}</div>
      </Link>
      <div className="sub">{meta}</div>
      {isTrackable && (
        <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 2 }}>
          <QuickAddButton
            tmdbId={item.id}
            mediaType={item.media_type as MediaType}
            title={title}
            posterPath={item.poster_path}
            releaseYear={year}
            providers={providers?.map(p => canonicalProviderId(p.provider_id))}
            genreIds={item.genre_ids}
          />
        </div>
      )}
      {isTrackable && (
        <div style={{ position: 'absolute', top: 6, left: 6, zIndex: 2 }}>
          <NotInterestedButton
            tmdbId={item.id}
            mediaType={item.media_type as MediaType}
            title={title}
            variant="icon"
          />
        </div>
      )}
    </div>
  );
}
