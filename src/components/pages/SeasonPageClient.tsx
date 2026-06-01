'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTVSeason } from '@/hooks/useTMDB';
import { useEpisodeProgressWithSync } from '@/hooks/useEpisodeProgressWithSync';
import { useGroup } from '@/hooks/useGroups';
import { useGroupMemberProgress } from '@/hooks/useGroupMemberProgress';
import { computeMaskBoundary, isEpisodeMasked } from '@/lib/groupProgress';
import EpisodeRow from '@/components/tv/EpisodeRow';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';
import { NotFound } from '@/components/ui/NotFound';

export default function SeasonPageClient({ id, num }: { id: string; num: string }) {
  const seriesId = parseInt(id, 10);
  const seasonNum = parseInt(num, 10);
  const searchParams = useSearchParams();
  const fromGroup = searchParams?.get('fromGroup') ?? null;
  const { data: season, isLoading } = useTVSeason(seriesId, seasonNum);
  const { isWatched, markEpisodeWatched, markSeasonWatched, progressLoading } = useEpisodeProgressWithSync(seriesId);
  // Spoiler-skydd (Fas 2b): hämta gruppens member-progress om vi kommer från
  // grupp-watchlist (`?fromGroup=`). Hooken kostar ingenting när fromGroup
  // är null — useGroup/useGroupMemberProgress no-op:ar då.
  const { members } = useGroup(fromGroup);
  const progressMap = useGroupMemberProgress(fromGroup ?? '');
  const maskBoundary = fromGroup
    ? computeMaskBoundary(progressMap, seriesId, members.map(m => m.uid))
    : null;

  if (isLoading) return <LoadingView variant="detail" label="Laddar säsong…" />;
  if (!season) return <NotFound crumb="Säsong" title="Säsongen hittades inte." />;

  const episodes = season.episodes ?? [];
  const watchedCount = episodes.filter(ep => isWatched(seasonNum, ep.episode_number)).length;

  return (
    <div>
      <PageHeader
        crumb={<Link href={`/tv/${seriesId}/`} className="text-accent no-underline">← Tillbaka till serien</Link>}
        title={season.name}
        standfirst={`${progressLoading ? '—' : watchedCount}/${episodes.length} avsnitt sedda`}
        actions={!progressLoading && watchedCount < episodes.length ? (
          <button type="button" onClick={() => markSeasonWatched(seasonNum, episodes.length)} className="btn btn-acc btn-sm">Markera alla sedda</button>
        ) : undefined}
      />

      <div className="bg-surface border border-rule rounded-sm px-3 py-1 mt-3">
        <div className="flex items-center gap-2 py-2 border-b border-border-light">
          <div className="flex-1 h-[3px] bg-rule rounded-full overflow-hidden">
            <div
              className="h-full bg-ink rounded-full transition-all"
              style={{ width: progressLoading ? '0%' : `${episodes.length > 0 ? (watchedCount / episodes.length) * 100 : 0}%` }}
            />
          </div>
          <span className="text-xxs text-ink-3">{progressLoading ? '—' : watchedCount}/{episodes.length}</span>
        </div>

        {episodes.map(ep => (
          <EpisodeRow
            key={ep.id}
            episode={ep}
            seasonNumber={seasonNum}
            watched={!progressLoading && isWatched(seasonNum, ep.episode_number)}
            spoilerMasked={isEpisodeMasked(maskBoundary, seasonNum, ep.episode_number)}
            onToggle={w => markEpisodeWatched(seasonNum, ep.episode_number, w)}
          />
        ))}
      </div>
    </div>
  );
}
