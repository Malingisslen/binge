'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueries } from '@tanstack/react-query';
import { Film, Tv } from 'lucide-react';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { cardClass } from '@/components/ui/Card';
import { tagClass } from '@/components/ui/Badge';
import ProviderDot from '@/components/ui/ProviderDot';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { useAllEpisodeProgress } from '@/hooks/useAllEpisodeProgress';
import { useCalendarEntries } from '@/hooks/useCalendar';
import { useBehindShows } from '@/hooks/useBehindShows';
import { getMovieLite, getTVShowLite, posterUrl, titleHref } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { canonicalUniqueProviders, getProvider } from '@/lib/tmdb/providers';
import { resolveEffectiveMonthlyCost } from '@/lib/advisor/effectiveCost';
import { resolveProviderMonthlyCost } from '@/lib/tmdb/providers';
import { formatKr } from '@/lib/formatKr';
import { pluralSv } from '@/lib/utils';
import { toneForId } from '@/lib/duotone';
import type { TMDBMovie, TMDBTVShow } from '@/types';
import { buildToWatchRows, lastSeenByShow, newestAiredDateByShow, type ToWatchRow } from '@/lib/toWatch';
import {
  NO_SERVICE_ID,
  SERVICE_SORT_LABELS,
  costPerHourLeft,
  groupRowsByService,
  isNearlyDone,
  minutesLeft,
  tmdbRuntime,
  sortServiceColumns,
  unseenAiredEpisodes,
  type ServiceColumn,
  type ServiceSortKey,
} from '@/lib/toWatchByService';

const NO_SERVICE_NAME = 'Ingen tjänst';

function hoursText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} tim` : `${h} tim ${m} min`;
}

// Samma titlar som Nytt för dig, grupperade per tjänst. Avsnittsantalet kommer ur den
// tv-lite-cache som kalendern och rådgivaren redan fyller.
export default function LeftPerService() {
  const { items, loading } = useWatchlist();
  const { user } = useAuth();
  const { episodes } = useAllEpisodeProgress();
  const { entries } = useCalendarEntries();
  const followedTv = useMemo(
    () => items.filter(i => i.mediaType === 'tv' && i.status === 'mina' && !i.dropped),
    [items],
  );
  const behind = useBehindShows(followedTv);
  const now = useMemo(() => new Date(), []);

  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [sort, setSort] = useState<ServiceSortKey>('time');

  const myProviders = useMemo(() => canonicalUniqueProviders(user?.myProviders ?? []), [user?.myProviders]);
  const costSettings = useMemo(() => ({
    providerTiers: user?.providerTiers ?? {},
    providerCosts: user?.providerCosts ?? {},
    providerCampaigns: user?.providerCampaigns ?? {},
  }), [user?.providerTiers, user?.providerCosts, user?.providerCampaigns]);

  const allRows = useMemo(
    () => buildToWatchRows(items, {
      behindIds: behind.behindIds,
      lastSeen: lastSeenByShow(episodes),
      newestAired: newestAiredDateByShow(entries, now),
      now,
    }),
    [items, behind.behindIds, episodes, entries, now],
  );

  // Every row is looked up so a title never saved with a length still gets one; the keys are the
  // shared tv-lite and movie-lite caches that the calendar and the advisor already fill.
  const showQueries = useQueries({
    queries: allRows.map(r => ({
      queryKey: [r.item.mediaType === 'movie' ? 'movie-lite' : 'tv-lite', r.item.tmdbId],
      queryFn: ({ signal }: { signal: AbortSignal }) => (
        r.item.mediaType === 'movie'
          ? getMovieLite(r.item.tmdbId, { signal })
          : getTVShowLite(r.item.tmdbId, { signal })
      ),
      staleTime: TMDB_STALE.LITE_DETAIL,
    })),
  });
  const stamp = showQueries.map(q => q.dataUpdatedAt).join(',');
  const lookups = useMemo(() => {
    const unseen = new Map<number, number | null>();
    const runtime = new Map<string, number | null>();
    allRows.forEach((r, i) => {
      const data = showQueries[i]?.data;
      if (!data) return;
      const key = `${r.item.mediaType}-${r.item.tmdbId}`;
      if (r.item.mediaType === 'tv') {
        unseen.set(r.item.tmdbId, unseenAiredEpisodes(r.item, data as TMDBTVShow));
        runtime.set(key, tmdbRuntime(data as TMDBTVShow));
      } else {
        runtime.set(key, tmdbRuntime(data as TMDBMovie));
      }
    });
    return { unseen, runtime };
    // showQueries is a new array each render; dataUpdatedAt marks when any answer changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, stamp]);

  const minutesOf = useMemo(
    () => (row: ToWatchRow) => minutesLeft(
      row,
      lookups.unseen.get(row.item.tmdbId),
      lookups.runtime.get(`${row.item.mediaType}-${row.item.tmdbId}`),
    ),
    [lookups],
  );

  const infoOf = useMemo(() => (providerId: number) => {
    if (providerId === NO_SERVICE_ID) return { name: NO_SERVICE_NAME, color: 'var(--ink-3)', monthlyCost: null, estimated: false, campaign: false };
    const provider = getProvider(providerId);
    const monthlyCost = resolveEffectiveMonthlyCost(providerId, costSettings, now);
    const campaign = monthlyCost !== resolveProviderMonthlyCost(providerId, costSettings);
    const ownCost = costSettings.providerTiers[provider?.id ?? providerId] != null
      || costSettings.providerCosts[provider?.id ?? providerId] != null;
    return {
      name: provider?.name ?? `Tjänst ${providerId}`,
      color: provider?.color ?? 'var(--ink-3)',
      monthlyCost,
      estimated: monthlyCost != null && monthlyCost > 0 && !ownCost && !campaign,
      campaign,
    };
  }, [costSettings, now]);

  const columns = useMemo(() => {
    const rows = onlyNew ? allRows.filter(r => r.group === 'nya') : allRows;
    const grouped = groupRowsByService(rows, { myProviders, minutesOf })
      .filter(c => !onlyMine || c.isMine)
      .filter(c => c.providerId === NO_SERVICE_ID || getProvider(c.providerId) != null);
    return sortServiceColumns(grouped, sort, infoOf);
  }, [allRows, onlyNew, onlyMine, myProviders, minutesOf, sort, infoOf]);

  if (loading || allRows.length === 0) return null;

  const titleCount = new Set(columns.flatMap(c => c.rows.map(r => `${r.item.mediaType}-${r.item.tmdbId}`))).size;

  return (
    <div className="mb-3.5">
      <div className="flex items-baseline justify-between mb-1.5">
        <Eyebrow as="h2" size="xs">Kvar att se per tjänst</Eyebrow>
        <span className="text-xxs text-ink-3" aria-live="polite">
          {pluralSv(columns.length, 'tjänst', 'tjänster')} · {pluralSv(titleCount, 'titel', 'titlar')}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button type="button" className={`chip${onlyMine ? ' is-on' : ''}`} aria-pressed={onlyMine} onClick={() => setOnlyMine(v => !v)}>
          Bara mina tjänster
        </button>
        <button type="button" className={`chip${onlyNew ? ' is-on' : ''}`} aria-pressed={onlyNew} onClick={() => setOnlyNew(v => !v)}>
          Bara med nya avsnitt
        </button>
        <span className="flex-1" />
        <select className="select" aria-label="Sortera tjänster" value={sort} onChange={e => setSort(e.target.value as ServiceSortKey)}>
          {(Object.keys(SERVICE_SORT_LABELS) as ServiceSortKey[]).map(k => (
            <option key={k} value={k}>Sortera: {SERVICE_SORT_LABELS[k]}</option>
          ))}
        </select>
      </div>
      {columns.length === 0 ? (
        <p className="text-sm text-ink-3">Inget matchar filtren. Rensa ett filter för att se fler tjänster.</p>
      ) : (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
          {columns.map(col => (
            <ServiceColumnCard key={col.providerId} col={col} info={infoOf(col.providerId)} minutesOf={minutesOf} filteredToNew={onlyNew} />
          ))}
        </div>
      )}
      <p className="text-xxs text-ink-3 mt-2">
        Kronor per timme räknas på månadskostnaden du angett, annars på katalogens listpris (märkt ca).
        Tiden för en serie är osedda avsnitt gånger avsnittslängd. Tjänster du inte har visar listpris, inte erbjudanden.
      </p>
    </div>
  );
}

function ServiceColumnCard({ col, info, minutesOf, filteredToNew }: {
  col: ServiceColumn;
  info: { name: string; color: string; monthlyCost: number | null; estimated: boolean; campaign: boolean };
  minutesOf: (row: ToWatchRow) => number | null;
  /** The column only holds titles with new episodes, so its time left says nothing about the whole service. */
  filteredToNew: boolean;
}) {
  const isNone = col.providerId === NO_SERVICE_ID;
  // A time-limited campaign price would make a service look cheaper per hour than it normally is.
  const perHour = col.minutesPartial || info.campaign ? null : costPerHourLeft(info.monthlyCost, col.minutes);
  const costLine = isNone
    ? 'Finns inte på någon svensk streamingtjänst'
    : info.monthlyCost === 0
      ? 'Gratis'
      : info.monthlyCost != null
        ? `${info.estimated ? 'ca ' : ''}${formatKr(info.monthlyCost)} kr/mån${info.campaign ? ' (kampanjpris)' : ''}${perHour != null ? ` · ca ${formatKr(perHour)} kr per timme kvar` : ''}`
        : null;

  return (
    <section className={cardClass('p-3 flex flex-col gap-2 min-w-0')} aria-label={info.name}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold text-sm min-w-0">
          <ProviderDot color={info.color} size={8} />
          <span className="truncate">{info.name}</span>
        </span>
        {!isNone && <span className={tagClass(col.isMine ? 'acc' : 'muted')}>{col.isMine ? 'Din tjänst' : 'Ej din'}</span>}
      </div>
      <div className="text-xs text-ink-2 border border-dashed border-rule rounded px-2 py-1.5">
        <b className="block text-ink tabular-nums">
          {pluralSv(col.rows.length, 'titel', 'titlar')}
          {col.minutes > 0 && ` · ${col.minutesPartial ? 'minst ' : ''}${hoursText(col.minutes)} kvar`}
        </b>
        {costLine && <span className="tabular-nums">{costLine}</span>}
      </div>
      {!filteredToNew && isNearlyDone(col, info.monthlyCost) && (
        <p className="text-xs rounded px-2 py-1.5 bg-cal-soft text-cal-deep">Nästan genomtittad av dina sparade titlar. Kolla bindningstid innan du säger upp den.</p>
      )}
      <ul className="flex flex-col gap-1.5 list-none p-0 m-0">
        {col.rows.map(r => <ServiceTitleRow key={`${r.item.mediaType}-${r.item.tmdbId}`} row={r} minutes={minutesOf(r)} />)}
      </ul>
    </section>
  );
}

function ServiceTitleRow({ row, minutes }: { row: ToWatchRow; minutes: number | null }) {
  const { item } = row;
  const isFilm = item.mediaType === 'movie';
  const poster = posterUrl(item.posterPath, 'w92');
  const Icon = isFilm ? Film : Tv;
  const progress = isFilm
    ? 'Vill se'
    : item.lastWatchedSeason == null
      ? 'Ej påbörjad'
      : `S${item.lastWatchedSeason} A${item.lastWatchedEpisode ?? 0}`;
  return (
    <li>
      <Link href={titleHref(item.mediaType, item.tmdbId)} className="flex items-center gap-2.5 no-underline text-ink border border-rule-2 rounded p-1.5 min-w-0">
        <div className={`poster duo-${toneForId(item.tmdbId)} w-[34px] shrink-0 aspect-[2/3]`}>
          {poster
            ? <img src={poster} alt="" width={92} height={138} loading="lazy" decoding="async" />
            : <Icon size={14} className="text-ink-3 m-auto" />}
        </div>
        <span className="min-w-0 text-xs leading-tight">
          <span className="block text-sm font-semibold break-words">{item.title}</span>
          <span className="text-ink-2">{progress}</span>
          {minutes != null && <span className="text-ink-3 tabular-nums"> · {hoursText(minutes)}</span>}
          {row.group === 'nya' && <span className={`${tagClass('acc')} ml-1`}>Nytt avsnitt</span>}
        </span>
      </Link>
    </li>
  );
}
