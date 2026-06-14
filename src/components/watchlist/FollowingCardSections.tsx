'use client';

import { useState } from 'react';
import { WatchlistCard } from './WatchlistCard';
import {
  LIBRARY_SUB_STATE_ORDER,
  LIBRARY_SECTION_LABELS,
  type LibrarySubState,
} from '@/lib/libraryView';
import type { WatchlistItem } from '@/types';
import { useIncrementalList } from '@/hooks/useIncrementalList';

const CARD_GRID_CLASS = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[10px]';

function SectionGrid({
  items,
  nextAirByTmdbId,
  subState,
}: {
  items: WatchlistItem[];
  nextAirByTmdbId: Map<number, string>;
  subState: LibrarySubState;
}) {
  const { visible, hasMore, sentinelRef } = useIncrementalList(items);
  return (
    <>
      <div className={CARD_GRID_CLASS}>
        {visible.map(item => (
          <WatchlistCard
            key={item.tmdbId}
            item={item}
            nextAirDate={nextAirByTmdbId.get(item.tmdbId)}
            subState={subState}
          />
        ))}
      </div>
      {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
    </>
  );
}

// Specialvy för /my/series som delar upp TV-shows efter vad som är KNOWABLE
// från persisterade fält (kontraktet bor i src/lib/libraryView.ts, B7/T2):
//
//   "Ligger efter"  — säkert bakom (aired-data via advisorns behind-set,
//                     eller Ended-serie med osedda säsonger). Mest aktionerbar.
//   "Påbörjade"     — du har börjat; ikapp-vs-efter går inte att avgöra utan
//                     aired-data, så vi påstår ingetdera om SERIEN (namnet
//                     säger bara att DU börjat, inte att den pågår). Kortet
//                     visar bara vad vi vet ("S2E10 sedd" / "Nytt ons").
//   "Ej påbörjade"  — ingen progress sparad.
//   "Avslutade"     — Ended/Canceled + sedd till sista kända säsongen (eller
//                     ikapp enligt advisorns aired-data). Collapsed default
//                     eftersom inget mer kommer.
//
// Endast TV-titlar når hit — WatchlistPage filtrerar bort ev. legacy
// 'mina'-film (mediaType !== 'tv') innan bucketBySubState anropas.
export type CardSections = Record<LibrarySubState, WatchlistItem[]>;

export function bucketBySubState(
  items: WatchlistItem[],
  subStateOf: (item: WatchlistItem) => LibrarySubState,
): CardSections {
  const sections: CardSections = { ligger_efter: [], paborjad: [], ej_paborjad: [], avslutad: [] };
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
  const total = LIBRARY_SUB_STATE_ORDER.reduce((sum, key) => sum + sections[key].length, 0);

  if (total === 0) {
    return (
      <div className="bg-surface border border-border-main rounded-sm px-3 py-4 text-center text-sm text-text-muted">
        Inga serier i Följer än. Lägg till en serie via Rekommendationer eller sök.
      </div>
    );
  }

  // B1: sektionsräknarna är scope:ade som "X av Y" mot samma totalsumma som
  // standfirsten räknar, och wrappern får top-marginal så första rubriken
  // inte kan läsas som en global räknare invid vytogglarna.
  const countLabel = (n: number) => `${n} av ${total} ${total === 1 ? 'titel' : 'titlar'}`;

  return (
    <div className="mt-[18px] space-y-[14px]">
      {LIBRARY_SUB_STATE_ORDER.map(key => {
        const items = sections[key];
        if (items.length === 0) return null;
        const heading = LIBRARY_SECTION_LABELS[key];

        if (key === 'avslutad') {
          return (
            <section key={key}>
              <button
                onClick={() => setAvslutadOpen(!avslutadOpen)}
                className="w-full flex items-center justify-between mb-2 bg-transparent border-none p-0 cursor-pointer text-left"
              >
                <h2 className="text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold flex items-center gap-1">
                  {heading}
                  <span className="text-[9px] text-text-muted/70">
                    {avslutadOpen ? '▾' : '▸'}
                  </span>
                </h2>
                <span className="text-xxs text-text-muted">{countLabel(items.length)}</span>
              </button>
              {avslutadOpen && (
                <SectionGrid items={items} nextAirByTmdbId={nextAirByTmdbId} subState={key} />
              )}
            </section>
          );
        }

        return (
          <section key={key}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold">
                {heading}
              </h2>
              <span className="text-xxs text-text-muted">{countLabel(items.length)}</span>
            </div>
            <SectionGrid items={items} nextAirByTmdbId={nextAirByTmdbId} subState={key} />
          </section>
        );
      })}
    </div>
  );
}

export { CARD_GRID_CLASS };
