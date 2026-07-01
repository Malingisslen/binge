'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Film, Tv, Check } from 'lucide-react';
import { posterUrl, titleHref } from '@/lib/tmdb/client';
import { useAuth } from '@/hooks/useAuth';
import { getProvider } from '@/lib/tmdb/providers';
import { shortSwedishWeekday, daysBetween, todayIso } from '@/lib/utils';
import { toneForGenreIds, toneForId } from '@/lib/duotone';
import RatingStars from '@/components/title/RatingStars';
import {
  librarySubState,
  libraryProgressLabel,
  seenEpisodeCode,
  type LibrarySubState,
  type ProgressTone,
} from '@/lib/libraryView';
import type { WatchlistItem } from '@/types';

function upcomingWeekday(isoDate: string | undefined): string | null {
  if (!isoDate) return null;
  if (isoDate < todayIso()) return null;
  if (daysBetween(todayIso(), new Date(isoDate + 'T00:00:00')) > 4) return null;
  return shortSwedishWeekday(isoDate);
}

/**
 * Watchlist-kort för cards-vyn. Visar poster, titel, rating, providers +
 * progressbar för TV-serier. "Nytt mån"-chippet highlightar avsnitt som
 * sänds inom 4 dagar (upcomingWeekday-tröskeln).
 */
export function WatchlistCard({
  item,
  nextAirDate,
  subState,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  item: WatchlistItem;
  nextAirDate?: string;
  // Persisted-fields-only-substate (se kontraktet i src/lib/libraryView.ts) —
  // passas in från WatchlistPage som redan beräknat det via bucketBySubState
  // (inkl. advisorns behind-set). Skippas för film och för icke-/my/series-
  // vyer; för TV i 'mina' utan prop härleder kortet själv från item-fälten.
  subState?: LibrarySubState;
  // BIN-42: multi-select. I select-läge togglar klick på kortet markeringen
  // istället för att navigera (inre länkar avaktiveras).
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const { user } = useAuth();
  const myProviders = user?.myProviders ?? [];
  const poster = posterUrl(item.posterPath, 'w92');
  const href = titleHref(item.mediaType, item.tmdbId);
  const Icon = item.mediaType === 'tv' ? Tv : Film;
  // Identification surface (library list) → duotone. Genre-mapped when we
  // have ids, otherwise a deterministic id-derived tone so the same title
  // always gets the same look across sessions.
  const tone = item.genreIds.length > 0
    ? toneForGenreIds(item.genreIds)
    : toneForId(item.tmdbId);

  // TV i 'mina': substate enligt persisted-fields-kontraktet i libraryView.ts.
  // Prop:en vinner (WatchlistPage har advisorns behind-set); utan prop härleds
  // baseline från item-fälten så /my/all-kort också får ärliga etiketter.
  const effectiveSubState: LibrarySubState | null =
    item.mediaType === 'tv' && item.status === 'mina'
      ? (subState ?? librarySubState(item))
      : null;

  const progressPct = useMemo(() => {
    if (item.mediaType !== 'tv') return null;
    // Avslutad = sedd till sista kända säsongen → bar full. Övriga states
    // räknas ungefärligt baserat på säsong — vi påstår inte "100%" för
    // pågående serier eftersom ikapp-vs-efter är obestämt utan aired-data.
    // (Legacy: TV med status 'sedd' kan finnas i ej-migrerade docs.)
    if (effectiveSubState === 'avslutad') return 100;
    if (item.status === 'sedd') return 100;
    if (!item.totalSeasons || !item.lastWatchedSeason) return 0;
    const seasonPart = (item.lastWatchedSeason - 1) / item.totalSeasons;
    const episodePart = item.lastWatchedEpisode ? 1 / (item.totalSeasons * 20) : 0;
    return Math.min(100, Math.round((seasonPart + episodePart) * 100));
  }, [item, effectiveSubState]);

  const upcomingWd = upcomingWeekday(nextAirDate);
  const progressLabel: { text: string; tone: ProgressTone } = (() => {
    if (item.mediaType === 'movie') {
      return { text: item.status === 'sedd' ? 'Sedd' : '—', tone: item.status === 'sedd' ? 'done' : 'muted' };
    }
    // TV i 'mina': exhaustiva substate-etiketter (B2 — aldrig bara "—").
    if (effectiveSubState) return libraryProgressLabel(item, effectiveSubState, upcomingWd);
    // TV utanför 'mina' (avbruten i /my/all m.fl.): visa vad vi vet.
    if (upcomingWd) return { text: `Nytt ${upcomingWd}`, tone: 'accent' };
    const code = seenEpisodeCode(item);
    if (code) return { text: `${code} sedd`, tone: 'muted' };
    return { text: 'Ej påbörjad', tone: 'muted' };
  })();

  const providersToShow = item.providers.slice(0, 3);

  const posterInner = (
    <div className={`poster duo-${tone} w-[50px] h-[75px]`} style={{ aspectRatio: '2 / 3' }}>
      {poster ? (
        <img src={poster} alt="" loading="lazy" decoding="async" width={50} height={75} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-2">
          <Icon size={16} className="text-ink-3 opacity-40" />
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`bg-surface border rounded-sm p-[10px] flex gap-[10px] transition-colors ${
        selectMode
          ? `cursor-pointer ${selected ? 'border-acc-deep' : 'border-rule hover:border-rule-2'}`
          : 'border-rule hover:border-rule-2'
      }`}
      {...(selectMode
        ? { onClick: onToggleSelect, role: 'checkbox', 'aria-checked': selected, 'aria-label': `Välj ${item.title}`, tabIndex: 0 }
        : {})}
    >
      {selectMode && (
        <span className="shrink-0 self-center" aria-hidden="true">
          <span className={`inline-flex items-center justify-center w-[16px] h-[16px] rounded-sm border ${
            selected ? 'bg-acc-deep border-acc-deep text-white' : 'border-rule bg-surface'
          }`}>
            {selected && <Check size={11} />}
          </span>
        </span>
      )}
      {selectMode ? (
        <span className="shrink-0">{posterInner}</span>
      ) : (
        <Link href={href} className="shrink-0">{posterInner}</Link>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          {selectMode ? (
            <span className="text-ink min-w-0">
              <div className="text-xs font-semibold truncate">{item.title}</div>
            </span>
          ) : (
            <Link href={href} className="no-underline text-ink min-w-0">
              <div className="text-xs font-semibold truncate">{item.title}</div>
            </Link>
          )}
          <span className="shrink-0">
            {/* B8: obetygsatt = dimmade stjärnor — samma visning som
                Tabell-vyn, så de två vyerna inte säger olika saker. */}
            <span className="inline-flex items-center gap-[3px]">
              <RatingStars rating={item.rating} readonly size="sm" dim={item.rating === null} />
              {item.rating !== null && (
                <span className="text-xxs text-ink-3">{item.rating.toFixed(1)}</span>
              )}
            </span>
          </span>
        </div>
        <div className="text-xxs text-ink-3 mt-[1px]">
          {item.releaseYear ?? '—'}
          {item.mediaType === 'tv' && item.totalSeasons ? ` · ${item.totalSeasons} säsong${item.totalSeasons === 1 ? '' : 'er'}` : ''}
        </div>
        {providersToShow.length > 0 ? (
          <div className="mt-[4px] flex flex-wrap gap-[2px]">
            {providersToShow.map(id => {
              const p = getProvider(id);
              if (!p) return null;
              const isMine = myProviders.includes(id);
              return (
                <span
                  key={id}
                  className={`text-xxs px-1 py-[1px] border rounded-sm inline-block ${
                    isMine ? 'border-acc-deep text-acc-deep' : 'border-rule text-ink-3'
                  }`}
                >
                  {p.shortName}
                </span>
              );
            })}
          </div>
        ) : item.providersCheckedAt != null ? (
          <div className="mt-[4px] flex flex-wrap gap-[2px]">
            <span className="text-xxs px-1 py-[1px] border border-rule-2 text-ink-3/70 rounded-sm inline-block">
              Ej på SE
            </span>
          </div>
        ) : null}
        {item.mediaType === 'tv' && (
          <div className="mt-[5px] flex items-center gap-[6px]">
            <div className="flex-1 h-[4px] bg-rule rounded-full overflow-hidden relative">
              <div
                className={`h-full ${progressLabel.tone === 'done' ? 'bg-season-done' : 'bg-ink'}`}
                style={{ width: `${progressPct ?? 0}%` }}
              />
              {progressLabel.tone === 'accent' && (progressPct ?? 0) > 0 && (progressPct ?? 0) < 100 && (
                <div
                  className="absolute top-0 bottom-0 w-[2px] bg-acc-deep"
                  style={{ left: `${progressPct}%`, transform: 'translateX(-2px)' }}
                />
              )}
            </div>
            <span className={`text-xxs ${
              progressLabel.tone === 'done' ? 'text-ink-2'
              : progressLabel.tone === 'accent' ? 'text-acc-deep font-semibold'
              : 'text-ink-3'
            }`}>
              {progressLabel.text}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
