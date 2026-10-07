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
import { Film, Tv } from 'lucide-react';

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
  const isTracked = isTrackable && !!getItem(item.media_type as MediaType, item.id);
  const [imgError, setImgError] = useState(false);

  const sub = item.media_type === 'tv' ? 'serie' : 'film';
  const meta = year != null ? `${sub} · ${year} · ${item.vote_average ? item.vote_average.toFixed(1) : '—'}` : sub;

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
          ) : (
            // Same placeholder as the search cards: a title without a TMDB poster
            // still says what it is instead of showing an empty tile.
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: 8, gap: 4,
              background: 'var(--bg-2)',
            }}>
              {item.media_type === 'tv'
                ? <Tv size={20} style={{ color: 'var(--ink-3)', opacity: 0.4 }} aria-hidden />
                : <Film size={20} style={{ color: 'var(--ink-3)', opacity: 0.4 }} aria-hidden />}
              <span style={{
                fontSize: 'var(--fs-xxs)', color: 'var(--ink-3)', textAlign: 'center',
                lineHeight: 1.2, overflow: 'hidden',
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
              }}>{title}</span>
            </div>
          )}
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
            // BIN-814: this surface is handed the FLATRATE bucket only (RecRow reads
            // providerMap[...].flatrate), so the same list is honestly both answers.
            // Passing it as the subset too is what stops the add from stamping
            // providersCheckedAt with the subset absent, which would gate the
            // title-page repair out for 60 days and leave the advisor on the fallback.
            providers={providers?.map(p => canonicalProviderId(p.provider_id))}
            subscriptionProviders={providers?.map(p => canonicalProviderId(p.provider_id))}
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
