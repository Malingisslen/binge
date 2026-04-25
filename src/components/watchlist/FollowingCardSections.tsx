'use client';

import { useState } from 'react';
import { WatchlistCard } from './WatchlistCard';
import type { WatchlistItem, TvSubState } from '@/types';

const CARD_GRID_CLASS = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[10px]';

// Specialvy för /my/series som delar upp TV-shows i sub-states:
// "Ligger efter" (du har osedda aireade avsnitt) — överst, mest aktionerbar
// "Ikapp" (väntar på nästa avsnitt — Returning Series)
// "Avslutade" — collapsed default eftersom inget kommer mer
//
// Icke-TV-titlar (t.ex. legacy 'mina'-film) hamnar tillsammans med "Ligger
// efter" eftersom de inte har sub-state.
export interface CardSections {
  aktiv: WatchlistItem[];
  ikapp: WatchlistItem[];
  avslutad: WatchlistItem[];
}

export function bucketBySubState(
  items: WatchlistItem[],
  subStateOf: (item: WatchlistItem) => TvSubState,
): CardSections {
  const sections: CardSections = { aktiv: [], ikapp: [], avslutad: [] };
  for (const item of items) {
    sections[subStateOf(item)].push(item);
  }
  return sections;
}

export function FollowingCardSections({
  sections,
  nextAirByTmdbId,
}: {
  sections: CardSections;
  nextAirByTmdbId: Map<number, string>;
}) {
  const [avslutadOpen, setAvslutadOpen] = useState(false);
  const { aktiv, ikapp, avslutad } = sections;
  const totalEmpty = aktiv.length === 0 && ikapp.length === 0 && avslutad.length === 0;

  if (totalEmpty) {
    return (
      <div className="bg-surface border border-border-main rounded-sm px-3 py-4 text-center text-sm text-text-muted">
        Inga titlar att visa
      </div>
    );
  }

  return (
    <div className="space-y-[14px]">
      {aktiv.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold">
              Ligger efter
            </h2>
            <span className="text-xxs text-text-muted">
              {aktiv.length} {aktiv.length === 1 ? 'titel' : 'titlar'}
            </span>
          </div>
          <div className={CARD_GRID_CLASS}>
            {aktiv.map(item => (
              <WatchlistCard
                key={item.tmdbId}
                item={item}
                nextAirDate={nextAirByTmdbId.get(item.tmdbId)}
                subState="aktiv"
              />
            ))}
          </div>
        </section>
      )}

      {ikapp.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold">
              Ikapp — väntar på nytt
            </h2>
            <span className="text-xxs text-text-muted">
              {ikapp.length} {ikapp.length === 1 ? 'titel' : 'titlar'}
            </span>
          </div>
          <div className={CARD_GRID_CLASS}>
            {ikapp.map(item => (
              <WatchlistCard
                key={item.tmdbId}
                item={item}
                nextAirDate={nextAirByTmdbId.get(item.tmdbId)}
                subState="ikapp"
              />
            ))}
          </div>
        </section>
      )}

      {avslutad.length > 0 && (
        <section>
          <button
            onClick={() => setAvslutadOpen(!avslutadOpen)}
            className="w-full flex items-center justify-between mb-2 bg-transparent border-none p-0 cursor-pointer text-left"
          >
            <h2 className="text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold flex items-center gap-1">
              Avslutade
              <span className="text-[9px] text-text-muted/70">
                {avslutadOpen ? '▾' : '▸'}
              </span>
            </h2>
            <span className="text-xxs text-text-muted">
              {avslutad.length} {avslutad.length === 1 ? 'titel' : 'titlar'}
            </span>
          </button>
          {avslutadOpen && (
            <div className={CARD_GRID_CLASS}>
              {avslutad.map(item => (
                <WatchlistCard
                  key={item.tmdbId}
                  item={item}
                  nextAirDate={nextAirByTmdbId.get(item.tmdbId)}
                  subState="avslutad"
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
