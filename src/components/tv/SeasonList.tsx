'use client';

import { useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import type { TMDBSeason } from '@/types';
import SeasonRow from './SeasonRow';
import { titleHref } from '@/lib/tmdb/client';
import { useGroup } from '@/hooks/useGroups';
import { useGroupMemberProgress } from '@/hooks/useGroupMemberProgress';
import { computeMaskBoundary, type MaskBoundary } from '@/lib/groupProgress';

interface SeasonListProps {
  tmdbId: number;
  seasons: TMDBSeason[];
  isWatched: (season: number, episode: number) => boolean;
  markEpisodeWatched: (season: number, episode: number, watched: boolean, episodeCount?: number) => Promise<void>;
  markSeasonWatched: (season: number, episodeCount: number) => Promise<void>;
  getSeasonProgress: (season: number, episodeCount?: number) => { watched: number; total: number };
  // Spoiler-skydd-grupp (Fas 2b). Sätts via `?fromGroup=` URL-param som
  // GroupWatchlistTable propagerar. När satt: hämta gruppens medlems-progress
  // och maska avsnitt över gruppens minsta-position.
  fromGroup?: string | null;
}

export default function SeasonList({
  tmdbId, seasons, isWatched, markEpisodeWatched, markSeasonWatched, getSeasonProgress, fromGroup,
}: SeasonListProps) {
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);

  const displaySeasons = useMemo(() => seasons.filter(s => s.season_number > 0), [seasons]);
  // T7: stabil identitet — tidigare byggdes en ny array per SeasonRow och
  // render (`displaySeasons.map(...)` inline), vilket bröt memo-kedjan ned
  // till avsnittsraderna via markUpTo-callbackens deps.
  const previousSeasonsMeta = useMemo(
    () => displaySeasons.map(s => ({ season_number: s.season_number, episode_count: s.episode_count })),
    [displaySeasons]
  );

  const toggle = (seasonNumber: number) => {
    setExpandedSeason(prev => prev === seasonNumber ? null : seasonNumber);
  };

  return (
    <>
      {fromGroup && (
        <SpoilerProtectionBanner tmdbId={tmdbId} groupId={fromGroup}>
          {boundary => (
            <div className="px-3 py-1">
              {displaySeasons.map(season => {
                const progress = getSeasonProgress(season.season_number, season.episode_count);
                return (
                  <SeasonRow
                    key={season.id}
                    name={season.name}
                    episodeCount={season.episode_count}
                    watchedCount={progress.watched}
                    expanded={expandedSeason === season.season_number}
                    tmdbId={tmdbId}
                    seasonNumber={season.season_number}
                    previousSeasons={previousSeasonsMeta}
                    onToggle={() => toggle(season.season_number)}
                    isWatched={isWatched}
                    markEpisodeWatched={markEpisodeWatched}
                    markSeasonWatched={markSeasonWatched}
                    maskBoundary={boundary}
                  />
                );
              })}
            </div>
          )}
        </SpoilerProtectionBanner>
      )}
      {!fromGroup && (
        <div className="px-3 py-1">
          {displaySeasons.map(season => {
            const progress = getSeasonProgress(season.season_number, season.episode_count);
            return (
              <SeasonRow
                key={season.id}
                name={season.name}
                episodeCount={season.episode_count}
                watchedCount={progress.watched}
                expanded={expandedSeason === season.season_number}
                tmdbId={tmdbId}
                seasonNumber={season.season_number}
                previousSeasons={previousSeasonsMeta}
                onToggle={() => toggle(season.season_number)}
                isWatched={isWatched}
                markEpisodeWatched={markEpisodeWatched}
                markSeasonWatched={markSeasonWatched}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

// Hämtar gruppens member-lista + progress, räknar mask-boundary, renderar
// banner om någon ligger efter. Render-prop:en får boundary så barn-trädet
// kan applicera per-avsnitt-mask.
function SpoilerProtectionBanner({
  tmdbId, groupId, children,
}: {
  tmdbId: number;
  groupId: string;
  children: (boundary: MaskBoundary | null) => React.ReactNode;
}) {
  const { group, members } = useGroup(groupId);
  const progressMap = useGroupMemberProgress(groupId);

  if (!group) return <>{children(null)}</>;

  const memberUids = members.map(m => m.uid);
  const boundary = computeMaskBoundary(progressMap, tmdbId, memberUids);

  if (!boundary) return <>{children(null)}</>;

  // Plocka displayName för trailing-medlemmar för banner-text.
  const trailingNames = boundary.trailingMemberUids
    .map(uid => members.find(m => m.uid === uid)?.displayName)
    .filter((n): n is string => !!n);
  const trailingLabel = trailingNames.length === 1
    ? trailingNames[0]
    : trailingNames.length > 1
      ? `${trailingNames.slice(0, -1).join(', ')} och ${trailingNames[trailingNames.length - 1]}`
      : 'Någon i gruppen';
  const positionLabel = boundary.season === 0 && boundary.episode === 0
    ? 'inte påbörjat serien än'
    : `sett t.o.m. S${boundary.season}E${boundary.episode}`;

  return (
    <>
      <div className="px-3 py-2 bg-acc-soft border-b border-acc-deep/30 flex items-start gap-2">
        <ShieldAlert size={13} className="text-acc-deep shrink-0 mt-[2px]" />
        <div className="text-xxs leading-relaxed flex-1">
          <span className="font-semibold text-acc-deep">Spoiler-skydd aktivt</span>
          <span className="text-ink-2">
            {' — '}
            {trailingLabel} har {positionLabel}. Avsnitt utöver dessa är dolda.
          </span>
          {' '}
          <Link href={titleHref('tv', tmdbId)} className="text-acc-deep underline">
            Stäng av
          </Link>
        </div>
      </div>
      {children(boundary)}
    </>
  );
}
