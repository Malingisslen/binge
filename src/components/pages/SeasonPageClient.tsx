'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTVSeason } from '@/hooks/useTMDB';
import { useEpisodeProgressWithSync } from '@/hooks/useEpisodeProgressWithSync';
import { useGroup } from '@/hooks/useGroups';
import { useGroupMemberProgress } from '@/hooks/useGroupMemberProgress';
import { computeMaskBoundary, isEpisodeMasked } from '@/lib/groupProgress';
import EpisodeRow from '@/components/tv/EpisodeRow';

export default function SeasonPageClient({ id, num }: { id: string; num: string }) {
  const seriesId = parseInt(id, 10);
  const seasonNum = parseInt(num, 10);
  const searchParams = useSearchParams();
  const fromGroup = searchParams?.get('fromGroup') ?? null;
  const { data: season, isLoading } = useTVSeason(seriesId, seasonNum);
  const { isWatched, markEpisodeWatched, markSeasonWatched } = useEpisodeProgressWithSync(seriesId);
  // Spoiler-skydd (Fas 2b): hämta gruppens member-progress om vi kommer från
  // grupp-watchlist (`?fromGroup=`). Hooken kostar ingenting när fromGroup
  // är null — useGroup/useGroupMemberProgress no-op:ar då.
  const { members } = useGroup(fromGroup);
  const progressMap = useGroupMemberProgress(fromGroup ?? '');
  const maskBoundary = fromGroup
    ? computeMaskBoundary(progressMap, seriesId, members.map(m => m.uid))
    : null;

  if (isLoading) return <div className="text-sm text-text-muted py-4">Laddar...</div>;
  if (!season) return <div className="text-sm text-text-muted py-4">Säsongen hittades inte.</div>;

  const episodes = season.episodes ?? [];
  const watchedCount = episodes.filter(ep => isWatched(seasonNum, ep.episode_number)).length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <Link href={`/tv/${seriesId}/`} className="text-xs text-accent no-underline">
            ← Tillbaka till serien
          </Link>
          <h1 className="text-[18px] font-bold text-text-primary mt-1">{season.name}</h1>
          <span className="text-xs text-text-muted">
            {watchedCount}/{episodes.length} avsnitt sedda
          </span>
        </div>
        {watchedCount < episodes.length && (
          <button
            onClick={() => markSeasonWatched(seasonNum, episodes.length)}
            className="px-[10px] py-[3px] border-none rounded-sm text-xs font-semibold cursor-pointer bg-accent text-white"
          >
            Markera alla sedda
          </button>
        )}
      </div>

      <div className="bg-surface border border-border-main rounded-sm px-3 py-1">
        <div className="flex items-center gap-2 py-2 border-b border-border-light">
          <div className="flex-1 h-[3px] bg-[#e5e0d8] rounded-[1px] overflow-hidden">
            <div
              className="h-full bg-accent rounded-[1px] transition-all"
              style={{ width: `${episodes.length > 0 ? (watchedCount / episodes.length) * 100 : 0}%` }}
            />
          </div>
          <span className="text-xxs text-text-muted">{watchedCount}/{episodes.length}</span>
        </div>

        {episodes.map(ep => (
          <EpisodeRow
            key={ep.id}
            episode={ep}
            seasonNumber={seasonNum}
            watched={isWatched(seasonNum, ep.episode_number)}
            spoilerMasked={isEpisodeMasked(maskBoundary, seasonNum, ep.episode_number)}
            onToggle={w => markEpisodeWatched(seasonNum, ep.episode_number, w)}
          />
        ))}
      </div>
    </div>
  );
}
