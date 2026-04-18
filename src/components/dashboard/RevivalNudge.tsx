'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { posterUrl } from '@/lib/tmdb/client';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useRevivalNudges } from '@/hooks/useRevivalNudges';
import { useToast } from '@/contexts/ToastContext';
import { formatSwedishDate } from '@/lib/utils';

export default function RevivalNudge() {
  const { nudges } = useRevivalNudges();
  const { addItem } = useWatchlist();
  const { show: toast } = useToast();

  if (nudges.length === 0) return null;

  return (
    <div className="bg-surface border border-accent/40 rounded-sm mb-[14px] px-3 py-[8px]">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={13} className="text-accent shrink-0" />
        <div className="text-xxs uppercase tracking-[0.5px] font-semibold text-accent">
          Nya avsnitt av serier du sett klart
        </div>
      </div>
      <div className="space-y-[6px]">
        {nudges.map(({ item, show, nextAirDate }) => {
          const poster = posterUrl(show.poster_path, 'w92');
          return (
            <div
              key={item.tmdbId}
              className="flex items-center gap-2 py-[3px]"
            >
              <Link href={`/tv/${item.tmdbId}`} className="shrink-0">
                {poster ? (
                  <img src={poster} alt="" className="w-[28px] h-[42px] rounded-sm object-cover" />
                ) : (
                  <div className="w-[28px] h-[42px] rounded-sm bg-[#ddd8d0]" />
                )}
              </Link>
              <div className="flex-1 min-w-0">
                <Link
                  href={`/tv/${item.tmdbId}`}
                  className="block text-xs font-semibold text-text-primary no-underline truncate hover:text-accent"
                >
                  {item.title}
                </Link>
                <div className="text-xxs text-text-muted">
                  Nytt avsnitt {formatSwedishDate(nextAirDate)}
                </div>
              </div>
              <button
                onClick={() => {
                  addItem({
                    ...item,
                    status: 'följer',
                    totalSeasons: show.number_of_seasons ?? item.totalSeasons,
                    tmdbStatus: show.status,
                  });
                  toast(`${item.title} — Följer igen`);
                }}
                className="shrink-0 px-2 py-[3px] bg-accent text-white border-none rounded-sm text-xxs font-semibold font-[inherit] cursor-pointer"
              >
                Följ igen
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
