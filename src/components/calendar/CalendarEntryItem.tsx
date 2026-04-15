'use client';

import Link from 'next/link';
import { posterUrl } from '@/lib/tmdb/client';
import type { CalendarEntry } from '@/hooks/useCalendar';
import { useEpisodeProgressWithSync } from '@/hooks/useEpisodeProgressWithSync';

interface CalendarEntryItemProps {
  entry: CalendarEntry;
  compact?: boolean;
}

export default function CalendarEntryItem({ entry, compact }: CalendarEntryItemProps) {
  const { isWatched, markEpisodeWatched } = useEpisodeProgressWithSync(entry.tmdbId);
  const watched = isWatched(entry.season, entry.episode);
  const poster = posterUrl(entry.posterPath, 'w92');

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await markEpisodeWatched(entry.season, entry.episode, !watched);
  };

  if (compact) {
    return (
      <div className="mb-1 flex items-start gap-[4px]">
        <button
          onClick={handleToggle}
          className={`shrink-0 mt-[2px] w-[12px] h-[12px] rounded-[1px] border cursor-pointer ${
            watched ? 'bg-accent border-accent' : 'bg-transparent border-[#ccc]'
          }`}
          title={watched ? 'Markera osedd' : 'Markera sedd'}
        />
        <Link href={`/tv/${entry.tmdbId}/`} className="no-underline min-w-0">
          <div className="text-text-primary font-semibold text-xs leading-tight">{entry.title}</div>
          <div className="text-text-muted text-xxs">{entry.episodeCode}</div>
          {entry.provider && <div className="text-accent text-xxs">{entry.provider}</div>}
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-1 flex items-center gap-[6px]">
      <button
        onClick={handleToggle}
        className={`shrink-0 w-[12px] h-[12px] rounded-[1px] border cursor-pointer ${
          watched ? 'bg-accent border-accent' : 'bg-transparent border-[#ccc]'
        }`}
        title={watched ? 'Markera osedd' : 'Markera sedd'}
      />
      {poster && (
        <Link href={`/tv/${entry.tmdbId}/`} className="shrink-0">
          <img src={poster} alt="" className="w-[22px] h-[33px] rounded-sm object-cover" />
        </Link>
      )}
      <Link href={`/tv/${entry.tmdbId}/`} className="no-underline flex-1 min-w-0">
        <span className="text-text-primary font-semibold">{entry.title}</span>
        {' '}<span className="text-text-muted text-xxs">{entry.episodeCode}</span>
        {entry.provider && <span className="text-accent text-xxs ml-1">{entry.provider}</span>}
      </Link>
    </div>
  );
}
