'use client';

import { memo, useCallback, useMemo, useState } from 'react';
import { ChevronRight, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import type { TMDBEpisode, TMDBSeason } from '@/types';
import SeasonRow from './SeasonRow';
import EpisodeRow from './EpisodeRow';
import { titleHref } from '@/lib/tmdb/client';
import { useGroup } from '@/hooks/useGroups';
import { useGroupMemberProgress } from '@/hooks/useGroupMemberProgress';
import { useTVSeason } from '@/hooks/useTMDB';
import { LoadingView } from '@/components/ui/LoadingView';
import { computeMaskBoundary, type MaskBoundary } from '@/lib/groupProgress';
import { canonicalSpecialsFor, type CanonicalSpecials } from '@/lib/tv/canonicalSpecials';

interface SeasonListProps {
  tmdbId: number;
  seasons: TMDBSeason[];
  isWatched: (season: number, episode: number) => boolean;
  markEpisodeWatched: (season: number, episode: number, watched: boolean, episodeCount?: number) => Promise<void>;
  markSeasonWatched: (season: number, episodeCount: number) => Promise<void>;
  markSeasonUnwatched: (season: number, episodeNumbers: number[]) => Promise<void>;
  getSeasonProgress: (season: number, episodeCount?: number) => { watched: number; total: number };
  // Spoiler-skydd-grupp (Fas 2b). Sätts via `?fromGroup=` URL-param som
  // GroupWatchlistTable propagerar. När satt: hämta gruppens medlems-progress
  // och maska avsnitt över gruppens minsta-position.
  fromGroup?: string | null;
}

export default function SeasonList({
  tmdbId, seasons, isWatched, markEpisodeWatched, markSeasonWatched, markSeasonUnwatched, getSeasonProgress, fromGroup,
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

  // BIN-580 — a couple of shows (Doctor Who 2005) keep canonical episodes in
  // TMDB's season 0, which the filter above hides. Curated per show; null for
  // everyone else, and skipped entirely if TMDB lists no season 0 for this show.
  const specials = useMemo(() => {
    const curated = canonicalSpecialsFor(tmdbId);
    if (!curated) return null;
    return seasons.some(s => s.season_number === 0) ? curated : null;
  }, [tmdbId, seasons]);

  const toggle = (seasonNumber: number) => {
    setExpandedSeason(prev => prev === seasonNumber ? null : seasonNumber);
  };

  // Season 0 is never a real row (displaySeasons filters it out), so it doubles
  // as the expanded-key for the specials section — one section open at a time.
  const SPECIALS_KEY = 0;

  const rows = (boundary: MaskBoundary | null) => (
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
            markSeasonUnwatched={markSeasonUnwatched}
            maskBoundary={boundary}
          />
        );
      })}
      {/* Hidden while a group spoiler-mask is active: the specials carry titles and
          synopses (regenerations, finales) that the masking exists to withhold, and
          season 0 sits outside the mask's linear season/episode comparison. */}
      {specials && !boundary && (
        <CanonicalSpecialsSection
          tmdbId={tmdbId}
          specials={specials}
          expanded={expandedSeason === SPECIALS_KEY}
          onToggle={() => toggle(SPECIALS_KEY)}
          isWatched={isWatched}
          markEpisodeWatched={markEpisodeWatched}
          watchedCount={specials.episodeNumbers.filter(n => isWatched(SPECIALS_KEY, n)).length}
        />
      )}
    </div>
  );

  return (
    <>
      {fromGroup && (
        <SpoilerProtectionBanner tmdbId={tmdbId} groupId={fromGroup}>
          {boundary => rows(boundary)}
        </SpoilerProtectionBanner>
      )}
      {!fromGroup && rows(null)}
    </>
  );
}

// BIN-580 — the curated season-0 section. BIN-679 made it tickable: the reason it
// was read-only was that markEpisodeWatched wrote the exact position you ticked, so
// a season-0 tick parked the watchlist marker on S0 and dragged someone caught up
// on 13 seasons back to "bakom". useEpisodeProgressWithSync now routes season 0
// past the marker entirely (and highestWatchedPosition skips it on the way back),
// so a tick lands in episodeProgress and nowhere else.
//
// Still no "markera alla": TMDB's season-0 numbering is SPARSE — the curated list
// is a handful of episode numbers scattered through ~199 entries — so `episodeCount`
// has no meaning here and neither does "everything up to N". Per-episode only.
//
// Reusing the shared EpisodeRow brings EpisodeReactions to specials for the first
// time — deliberate, and reviewed by #18 Community Manager (2026-08-08, godkänd):
// the thread key is `${tmdbId}_0_${ep}`, a fresh slot in the same namespace with no
// collision, and the reactions list only opens once YOU have marked the episode
// watched, so the specials' heavier spoilers get the same gate as any other episode.
function CanonicalSpecialsSection({
  tmdbId, specials, expanded, onToggle, isWatched, markEpisodeWatched, watchedCount,
}: {
  tmdbId: number;
  specials: CanonicalSpecials;
  expanded: boolean;
  onToggle: () => void;
  isWatched: (season: number, episode: number) => boolean;
  markEpisodeWatched: (season: number, episode: number, watched: boolean, episodeCount?: number) => Promise<void>;
  watchedCount: number;
}) {
  return (
    <div className="border-b border-rule-2 last:border-b-0">
      <div className="flex items-center justify-between py-[5px] text-sm">
        <div
          className="flex items-center gap-1 cursor-pointer flex-1 min-w-0"
          onClick={onToggle}
        >
          <ChevronRight
            size={12}
            className={`shrink-0 text-ink-3 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          />
          <span className="font-semibold text-ink-2">
            {specials.label}{' '}
            <span className="font-normal text-ink-3 text-xs">({specials.episodeNumbers.length} avs)</span>
          </span>
        </div>
        <span className="text-xxs text-ink-3 mx-4">
          {watchedCount}/{specials.episodeNumbers.length}
        </span>
      </div>
      {expanded && (
        <CanonicalSpecialsPanel
          tmdbId={tmdbId}
          episodeNumbers={specials.episodeNumbers}
          isWatched={isWatched}
          markEpisodeWatched={markEpisodeWatched}
        />
      )}
    </div>
  );
}

// Same memo + stable-callback shape as PanelEpisodeRow in SeasonEpisodePanel:
// without it every episodeProgress onSnapshot re-renders every special.
// `episodeCount` is deliberately NOT passed — it drives the auto-advance to the
// next season, which has no meaning for a sparse season 0 (and the season-0 guard
// in useEpisodeProgressWithSync returns before it anyway).
const SpecialEpisodeRow = memo(function SpecialEpisodeRow({
  episode, tmdbId, watched, markEpisodeWatched,
}: {
  episode: TMDBEpisode;
  tmdbId: number;
  watched: boolean;
  markEpisodeWatched: (season: number, episode: number, watched: boolean, episodeCount?: number) => Promise<void>;
}) {
  const handleToggle = useCallback(
    (w: boolean) => { void markEpisodeWatched(0, episode.episode_number, w); },
    [markEpisodeWatched, episode.episode_number]
  );
  // The air year rides in the title. The shared row shows a year for nothing but
  // UNAIRED episodes, which is right for a numbered season you read top to bottom —
  // and wrong here: this list spans 2005-2022 in air order, and four of the entries
  // are Christmas specials. The year IS the disambiguator. Kept in this component
  // rather than added to EpisodeRow so numbered seasons are untouched.
  const withYear = useMemo(() => {
    const year = episode.air_date?.substring(0, 4);
    return year ? { ...episode, name: `${episode.name} (${year})` } : episode;
  }, [episode]);
  return (
    <EpisodeRow
      episode={withYear}
      seasonNumber={0}
      tmdbId={tmdbId}
      watched={watched}
      onToggle={handleToggle}
    />
  );
});

// Fetches season 0 (only once the section is expanded — same lazy pattern as
// SeasonEpisodePanel) and keeps just the curated episode numbers. Titles, stills
// and synopses come from TMDB live; nothing about them is stored in the repo.
function CanonicalSpecialsPanel({
  tmdbId, episodeNumbers, isWatched, markEpisodeWatched,
}: {
  tmdbId: number;
  episodeNumbers: readonly number[];
  isWatched: (season: number, episode: number) => boolean;
  markEpisodeWatched: (season: number, episode: number, watched: boolean, episodeCount?: number) => Promise<void>;
}) {
  const { data: season, isLoading } = useTVSeason(tmdbId, 0);

  const episodes = useMemo(() => {
    const allowed = new Set(episodeNumbers);
    return (season?.episodes ?? []).filter(ep => allowed.has(ep.episode_number));
  }, [season, episodeNumbers]);

  if (isLoading) {
    return (
      <div className="bg-bg-2 border-t border-rule-2 px-4">
        <LoadingView label="Laddar avsnitt…" />
      </div>
    );
  }

  if (episodes.length === 0) {
    return (
      <div className="bg-bg-2 border-t border-rule-2 px-4 py-2 text-xs text-ink-3">
        Inga avsnitt hittades.
      </div>
    );
  }

  return (
    <div className="bg-bg-2 border-t border-rule-2">
      <div className="px-4 py-3">
        <div className="eps">
          {episodes.map(ep => (
            <SpecialEpisodeRow
              key={ep.id}
              episode={ep}
              tmdbId={tmdbId}
              watched={isWatched(0, ep.episode_number)}
              markEpisodeWatched={markEpisodeWatched}
            />
          ))}
        </div>
      </div>
    </div>
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
