'use client';

import { useState } from 'react';
import { WatchlistCard } from './WatchlistCard';
import type { WatchlistItem } from '@/types';

const CARD_GRID_CLASS = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[10px]';

/**
 * Specialvy för /my/foljer som delar upp titlarna i "Pågår" + "Avslutade".
 * "Avslutade" är default-collapsed för att inte ta plats när listan växer.
 */
export function FollowingCardSections({
  sections,
  nextAirByTmdbId,
}: {
  sections: { ongoing: WatchlistItem[]; ended: WatchlistItem[] };
  nextAirByTmdbId: Map<number, string>;
}) {
  const [endedOpen, setEndedOpen] = useState(false);
  const { ongoing, ended } = sections;
  const totalEmpty = ongoing.length === 0 && ended.length === 0;

  if (totalEmpty) {
    return (
      <div className="bg-surface border border-border-main rounded-sm px-3 py-4 text-center text-sm text-text-muted">
        Inga titlar att visa
      </div>
    );
  }

  return (
    <div className="space-y-[14px]">
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold">
            Pågår
          </h2>
          <span className="text-xxs text-text-muted">
            {ongoing.length} {ongoing.length === 1 ? 'titel' : 'titlar'}
          </span>
        </div>
        {ongoing.length > 0 ? (
          <div className={CARD_GRID_CLASS}>
            {ongoing.map(item => (
              <WatchlistCard
                key={item.tmdbId}
                item={item}
                nextAirDate={nextAirByTmdbId.get(item.tmdbId)}
              />
            ))}
          </div>
        ) : (
          <div className="bg-surface border border-border-main rounded-sm px-3 py-3 text-center text-xs text-text-muted">
            Inga pågående titlar just nu.
          </div>
        )}
      </section>

      {ended.length > 0 && (
        <section>
          <button
            onClick={() => setEndedOpen(!endedOpen)}
            className="w-full flex items-center justify-between mb-2 bg-transparent border-none p-0 cursor-pointer text-left"
          >
            <h2 className="text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold flex items-center gap-1">
              Avslutade / pågående titt
              <span className="text-[9px] text-text-muted/70">
                {endedOpen ? '▾' : '▸'}
              </span>
            </h2>
            <span className="text-xxs text-text-muted">
              {ended.length} {ended.length === 1 ? 'titel' : 'titlar'}
            </span>
          </button>
          {endedOpen && (
            <div className={CARD_GRID_CLASS}>
              {ended.map(item => (
                <WatchlistCard
                  key={item.tmdbId}
                  item={item}
                  nextAirDate={nextAirByTmdbId.get(item.tmdbId)}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export { CARD_GRID_CLASS };
