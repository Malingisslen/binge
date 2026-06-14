'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Film, Tv } from 'lucide-react';
import { posterUrl, posterSrcSet, getDisplayTitle, getReleaseYear, isAddableMediaType, titleHref } from '@/lib/tmdb/client';
import type { TMDBSearchResult } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { getProvider, canonicalProviderId, dedupeProvidersByCanonicalId } from '@/lib/tmdb/providers';
import { toneForGenreIds, toneForId } from '@/lib/duotone';
import type { TMDBProvider, MediaType } from '@/types';
import QuickAddButton from './QuickAddButton';
import NotInterestedButton from './NotInterestedButton';

const MAX_BADGES = 3;

interface TitleCardProps {
  item: TMDBSearchResult;
  providers?: TMDBProvider[];
  showNotInterested?: boolean;
}

export default function TitleCard({ item, providers, showNotInterested }: TitleCardProps) {
  const { user } = useAuth();
  const { getItem } = useWatchlist();
  const isTrackable = isAddableMediaType(item);
  const href = isTrackable ? titleHref(item.media_type, item.id) : '#';
  const title = getDisplayTitle(item);
  const year = getReleaseYear(item);
  const poster = posterUrl(item.poster_path, 'w342');
  const myProviders = user?.myProviders ?? [];
  const isTracked = isTrackable && !!getItem(item.id);
  const Icon = item.media_type === 'tv' ? Tv : Film;
  const [imgError, setImgError] = useState(false);

  // Dedup på kanoniskt id innan vi slice:ar — annars kan t.ex. "HBO" och
  // "HBO Max Amazon Channel" uppta två av tre badge-platser för samma
  // tjänst (SÖ2).
  const dedupedProviders = providers ? dedupeProvidersByCanonicalId(providers) : [];
  const visibleBadges = dedupedProviders.slice(0, MAX_BADGES);
  const extraCount = dedupedProviders.length - MAX_BADGES;
  // Direction H rule: TitleCard is an identification surface (lists,
  // grids, search results) → duotone. Genre-mapped when we have ids,
  // otherwise a deterministic fallback so the same title always gets
  // the same tone.
  const tone = item.genre_ids && item.genre_ids.length > 0
    ? toneForGenreIds(item.genre_ids)
    : toneForId(item.id);

  return (
    <div className="group relative">
      <Link href={href} className="no-underline" style={{ color: 'var(--ink)' }}>
        <div
          className={`poster duo-${tone}`}
          style={{
            marginBottom: 3,
            outline: isTracked ? '2px solid var(--acc-deep)' : undefined,
            outlineOffset: isTracked ? '-2px' : undefined,
          }}
        >
          {poster && !imgError ? (
            <img
              src={poster}
              srcSet={posterSrcSet(item.poster_path)}
              sizes="(max-width: 768px) 45vw, 160px"
              alt={title}
              loading="lazy"
              decoding="async"
              width={342}
              height={513}
              onError={() => setImgError(true)}
            />
          ) : (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: 8, gap: 4,
              background: 'var(--bg-2)',
            }}>
              <Icon size={20} style={{ color: 'var(--ink-3)', opacity: 0.4 }} />
              <span style={{
                fontSize: 10, color: 'var(--ink-3)', textAlign: 'center',
                lineHeight: 1.2, overflow: 'hidden',
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
              }}>{title}</span>
            </div>
          )}
          {visibleBadges.length > 0 && (
            <div style={{
              position: 'absolute', bottom: 2, left: 2,
              display: 'flex', gap: 1,
              zIndex: 1,
            }}>
              {visibleBadges.map(p => {
                const mapped = getProvider(p.provider_id);
                const isMine = myProviders.includes(canonicalProviderId(p.provider_id));
                return (
                  <span
                    key={p.provider_id}
                    style={{
                      fontSize: 8,
                      padding: '1px 4px',
                      borderRadius: 1,
                      letterSpacing: 0.04,
                      background: isMine ? 'var(--acc-deep)' : 'oklch(0 0 0 / 0.65)',
                      color: isMine ? 'white' : 'oklch(0.85 0 0)',
                    }}
                  >
                    {mapped?.shortName ?? p.provider_name}
                  </span>
                );
              })}
              {extraCount > 0 && (
                <span style={{
                  fontSize: 8,
                  padding: '1px 4px',
                  borderRadius: 1,
                  background: 'oklch(0 0 0 / 0.65)',
                  color: 'oklch(0.85 0 0)',
                }}>
                  +{extraCount}
                </span>
              )}
            </div>
          )}
        </div>
      </Link>
      {isTrackable && (
        <div className="absolute top-[4px] right-[4px]">
          <QuickAddButton
            tmdbId={item.id}
            mediaType={item.media_type as MediaType}
            title={title}
            posterPath={item.poster_path}
            releaseYear={year}
            providers={providers ? dedupedProviders.map(p => canonicalProviderId(p.provider_id)) : undefined}
            genreIds={item.genre_ids}
          />
        </div>
      )}
      {isTrackable && showNotInterested && (
        <div className="absolute top-[4px] left-[4px]">
          <NotInterestedButton
            tmdbId={item.id}
            mediaType={item.media_type as MediaType}
            title={title}
            variant="icon"
          />
        </div>
      )}
      <Link href={href} className="no-underline" style={{ color: 'var(--ink)' }}>
        <div style={{
          fontFamily: 'var(--sans)',
          fontSize: 13.5,
          fontWeight: 600,
          letterSpacing: -0.015,
          marginTop: 6,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {title}
        </div>
        <div style={{
          fontSize: 11,
          color: 'var(--ink-3)',
          marginTop: 2,
          letterSpacing: 0.02,
        }}>
          {year ?? '—'} · {item.vote_average.toFixed(1)}
        </div>
      </Link>
    </div>
  );
}
