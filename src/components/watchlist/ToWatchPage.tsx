'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Film, Tv } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';
import { EmptyState } from '@/components/ui/EmptyState';
import { Segmented } from '@/components/ui/Segmented';
import { thClass } from '@/components/ui/tableHead';
import { tagClass } from '@/components/ui/Badge';
import { cardClass } from '@/components/ui/Card';
import { LibrarySubnav } from '@/components/WatchlistPage';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { useAllEpisodeProgress } from '@/hooks/useAllEpisodeProgress';
import { useCalendarEntries } from '@/hooks/useCalendar';
import { useBehindShows } from '@/hooks/useBehindShows';
import { usePersistedState } from '@/hooks/usePersistedState';
import { toWatchFiltersKey, toWatchSortKey } from '@/lib/persistedViewState';
import { posterUrl, titleHref } from '@/lib/tmdb/client';
import { genreLabel, parseGenreFilter } from '@/lib/tmdb/genreLabels';
import { canonicalProviderId, canonicalUniqueProviders, getProvider } from '@/lib/tmdb/providers';
import { toneForId } from '@/lib/duotone';
import { genreOptionsInLibrary, serviceCountsInLibrary, streamingProvidersOf } from '@/lib/libraryView';
import {
  TO_WATCH_GROUP_LABELS,
  TO_WATCH_GROUP_ORDER,
  TO_WATCH_SORT_LABELS,
  DEFAULT_TO_WATCH_FILTERS,
  TO_WATCH_AVAILABILITY_LABELS,
  availabilityOf,
  buildToWatchRows,
  compareToWatchRows,
  lastSeenByShow,
  newestAiredDateByShow,
  sanitizeToWatchFilters,
  sanitizeToWatchSort,
  type ToWatchAvailability,
  type ToWatchLayout,
  type ToWatchMedia,
  type ToWatchRow,
  type ToWatchSortKey,
} from '@/lib/toWatch';

export const TO_WATCH_TITLE = 'Nytt för dig';

const rtf = new Intl.RelativeTimeFormat('sv', { numeric: 'auto' });

function ago(date: Date, now: Date): string {
  const days = Math.round((date.getTime() - now.getTime()) / 86_400_000);
  if (Math.abs(days) < 14) return rtf.format(days, 'day');
  if (Math.abs(days) < 60) return rtf.format(Math.round(days / 7), 'week');
  return rtf.format(Math.round(days / 30), 'month');
}

function runtimeText(minutes: number | null | undefined, isFilm: boolean): string {
  if (!minutes) return '–';
  if (!isFilm) return `${minutes} min/avsnitt`;
  return minutes >= 60 ? `${Math.floor(minutes / 60)} tim ${minutes % 60} min` : `${minutes} min`;
}

// Vyn svarar på "vad har jag kvar att se?": serier du följer men inte är ikapp på (eller
// inte börjat) och filmer du vill se. Underlaget kommer från bibliotekets data, avsnittsmarkeringarna, kalendern och Streamingrådgivarens
// behind-set, så TMDB-anropen delar cache med startsidan.
export default function ToWatchPage() {
  const { items, loading } = useWatchlist();
  const { user } = useAuth();
  const { episodes, episodesLoading } = useAllEpisodeProgress();
  const { entries, isLoading: calendarLoading } = useCalendarEntries();
  const followedTv = useMemo(
    () => items.filter(i => i.mediaType === 'tv' && i.status === 'mina' && !i.dropped),
    [items],
  );
  const behind = useBehindShows(followedTv);

  const [filters, setFilters] = usePersistedState(toWatchFiltersKey, DEFAULT_TO_WATCH_FILTERS, sanitizeToWatchFilters);
  const [sort, setSort] = usePersistedState(toWatchSortKey, 'seen' as ToWatchSortKey, sanitizeToWatchSort);
  const { media, layout, onlyMine, onlyNew, genre, service, availability } = filters;
  const patch = (p: Partial<typeof filters>) => setFilters(f => ({ ...f, ...p }));

  const now = useMemo(() => new Date(), []);
  const myProviders = useMemo(() => canonicalUniqueProviders(user?.myProviders ?? []), [user?.myProviders]);

  const allRows = useMemo(
    () => buildToWatchRows(items, {
      behindIds: behind.behindIds,
      lastSeen: lastSeenByShow(episodes),
      newestAired: newestAiredDateByShow(entries, now),
      now,
    }),
    [items, behind.behindIds, episodes, entries, now],
  );

  const rowItems = useMemo(() => allRows.map(r => r.item), [allRows]);
  const genreOptions = useMemo(() => genreOptionsInLibrary(rowItems), [rowItems]);
  const services = useMemo(
    () => serviceCountsInLibrary(rowItems, id => getProvider(id)?.name),
    [rowItems],
  );

  const rows = useMemo(() => {
    const genreIds = genre ? parseGenreFilter(genre) : [];
    const serviceId = service ? Number(service) : null;
    return allRows
      .filter(r => {
        const i = r.item;
        const providers = canonicalUniqueProviders(streamingProvidersOf(i));
        if (media !== 'all' && i.mediaType !== media) return false;
        if (onlyMine && !providers.some(p => myProviders.includes(p))) return false;
        if (onlyNew && r.group !== 'nya') return false;
        if (genreIds.length && !(i.genreIds ?? []).some(g => genreIds.includes(g))) return false;
        if (availability && availabilityOf(i) !== availability) return false;
        if (serviceId != null && !providers.includes(canonicalProviderId(serviceId))) return false;
        return true;
      })
      .sort(compareToWatchRows(sort));
  }, [allRows, media, onlyMine, onlyNew, genre, service, availability, sort, myProviders]);

  const header = (
    <PageHeader
      crumb="Bibliotek · nytt för dig"
      title={TO_WATCH_TITLE}
      standfirst="Serier du följer men inte är ikapp på, och filmer du vill se."
    />
  );

  if (loading) {
    return (
      <>
        {header}
        <LibrarySubnav activeKey="nytt-for-dig" />
        <LoadingView variant="grid" label="Laddar biblioteket…" />
      </>
    );
  }

  const detailsLoading = episodesLoading || calendarLoading || behind.isLoading;
  const filtered = media !== 'all' || onlyMine || onlyNew || genre !== '' || service !== '' || availability !== '';
  const clearFilters = () => patch({ ...DEFAULT_TO_WATCH_FILTERS, layout });

  return (
    <>
      {header}
      <LibrarySubnav activeKey="nytt-for-dig" />

      <div className="flex flex-wrap items-center gap-2 mt-5">
        <Segmented<ToWatchMedia>
          ariaLabel="Typ"
          value={media}
          onChange={v => patch({ media: v })}
          options={[{ value: 'all', label: 'Alla' }, { value: 'tv', label: 'Serier' }, { value: 'movie', label: 'Film' }]}
        />
        <button type="button" className={`chip${onlyMine ? ' is-on' : ''}`} aria-pressed={onlyMine} onClick={() => patch({ onlyMine: !onlyMine })}>
          Mina tjänster
        </button>
        <button type="button" className={`chip${onlyNew ? ' is-on' : ''}`} aria-pressed={onlyNew} onClick={() => patch({ onlyNew: !onlyNew })}>
          Nya avsnitt
        </button>
        <select className="select" aria-label="Genre" value={genre} onChange={e => patch({ genre: e.target.value })}>
          <option value="">Alla genrer</option>
          {genreOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="select" aria-label="Tjänst" value={service} onChange={e => patch({ service: e.target.value })}>
          <option value="">Alla tjänster</option>
          {services.map(s => <option key={s.id} value={s.id}>{s.name} ({s.count})</option>)}
        </select>
        <select className="select" aria-label="Tillgänglighet" value={availability} onChange={e => patch({ availability: e.target.value as ToWatchAvailability | '' })}>
          <option value="">Överallt</option>
          {(Object.keys(TO_WATCH_AVAILABILITY_LABELS) as ToWatchAvailability[]).map(k => (
            <option key={k} value={k}>{TO_WATCH_AVAILABILITY_LABELS[k]}</option>
          ))}
        </select>
        <span className="flex-1" />
        <select className="select" aria-label="Sortera" value={sort} onChange={e => setSort(e.target.value as ToWatchSortKey)}>
          {(Object.keys(TO_WATCH_SORT_LABELS) as ToWatchSortKey[]).map(k => (
            <option key={k} value={k}>Sortera: {TO_WATCH_SORT_LABELS[k]}</option>
          ))}
        </select>
        <Segmented<ToWatchLayout>
          ariaLabel="Visning"
          value={layout}
          onChange={v => patch({ layout: v })}
          options={[{ value: 'list', label: 'Lista' }, { value: 'grouped', label: 'Gruppera' }]}
        />
      </div>

      <p className="text-sm text-ink-3 mt-3" aria-live="polite">
        {rows.length === allRows.length
          ? `${rows.length} titlar`
          : `${rows.length} av ${allRows.length} titlar`}
        {detailsLoading && ' · hämtar fler uppgifter…'}
      </p>

      <div className="mt-3">
        {rows.length === 0 && detailsLoading ? (
          <LoadingView variant="grid" label="Hämtar dina serier…" />
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState
              title="Inga titlar matchar."
              body="Inget passar de valda filtren just nu."
              action={<button type="button" className="chip" onClick={clearFilters}>Rensa filter</button>}
            />
          ) : (
            <EmptyState
              title="Du är ikapp."
              body="Här samlas serier du ligger efter på och filmer du vill se. Hitta något nytt via Rekommendationer."
              action={<Link href="/recommendations/" className="chip no-underline">Till rekommendationer</Link>}
            />
          )
        ) : layout === 'list' ? (
          <ToWatchTable rows={rows} myProviders={myProviders} now={now} />
        ) : (
          <div className="flex flex-col gap-5">
            {TO_WATCH_GROUP_ORDER.map(group => {
              const groupRows = rows.filter(r => r.group === group);
              if (groupRows.length === 0) return null;
              return (
                <section key={group} aria-label={TO_WATCH_GROUP_LABELS[group]}>
                  <h2 className="text-md font-semibold mb-2">
                    {TO_WATCH_GROUP_LABELS[group]} <span className="text-ink-3 font-normal">{groupRows.length}</span>
                  </h2>
                  <ToWatchTable rows={groupRows} myProviders={myProviders} now={now} />
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function ToWatchTable({ rows, myProviders, now }: { rows: ToWatchRow[]; myProviders: number[]; now: Date }) {
  return (
    <div className={cardClass('overflow-x-auto')}>
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="text-left">
            <th className={thClass('px-3')}>Titel</th>
            <th className={thClass('px-3')}>Tjänst</th>
            <th className={thClass('px-3')}>Genre</th>
            <th className={thClass('px-3')}>Senast sett</th>
            <th className={thClass('px-3')}>Nytt avsnitt</th>
            <th className={thClass('px-3')}>Längd</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => <ToWatchRowView key={`${r.item.mediaType}-${r.item.tmdbId}`} row={r} myProviders={myProviders} now={now} />)}
        </tbody>
      </table>
    </div>
  );
}

function ToWatchRowView({ row, myProviders, now }: { row: ToWatchRow; myProviders: number[]; now: Date }) {
  const { item } = row;
  const isFilm = item.mediaType === 'movie';
  const poster = posterUrl(item.posterPath, 'w92');
  const Icon = isFilm ? Film : Tv;
  const providers = canonicalUniqueProviders(streamingProvidersOf(item)).filter(id => getProvider(id)).slice(0, 3);
  const genres = (item.genreIds ?? []).slice(0, 2).map(genreLabel);
  const newest = row.newestAirDate ? new Date(`${row.newestAirDate}T00:00:00`) : null;

  return (
    <tr className="border-t border-rule-2 even:bg-bg-2">
      <td className="px-3 py-2">
        <Link href={titleHref(item.mediaType, item.tmdbId)} className="flex items-center gap-3 no-underline text-ink">
          <div className={`poster duo-${toneForId(item.tmdbId)} w-[34px] shrink-0 aspect-[2/3]`}>
            {poster
              ? <img src={poster} alt="" width={92} height={138} loading="lazy" decoding="async" />
              : <Icon size={14} className="text-ink-3 m-auto" />}
          </div>
          <span className="min-w-0">
            <span className="block font-semibold">{item.title}</span>
            <span className="block text-xs text-ink-3">{isFilm ? 'Film' : row.group === 'ej_paborjad' ? 'Serie · ej påbörjad' : 'Serie'}</span>
          </span>
        </Link>
      </td>
      <td className="px-3 py-2">
        {providers.length === 0
          ? <AvailabilityTag item={item} />
          : (
            <span className="flex flex-wrap gap-1">
              {providers.map(id => (
                <span key={id} className={tagClass(myProviders.includes(id) ? 'acc' : 'muted')}>{getProvider(id)?.shortName ?? getProvider(id)?.name}</span>
              ))}
            </span>
          )}
      </td>
      <td className="px-3 py-2 text-ink-2">{genres.join(', ') || '–'}</td>
      <td className="px-3 py-2 text-ink-2">{isFilm ? '–' : row.seenAt ? ago(row.seenAt, now) : row.group === 'ej_paborjad' ? 'Aldrig' : '–'}</td>
      <td className="px-3 py-2">
        {newest
          ? <span className={row.group === 'nya' ? 'font-semibold text-acc-deep' : 'text-ink-2'}>{ago(newest, now)}</span>
          : <span className="text-ink-3">–</span>}
      </td>
      <td className="px-3 py-2 text-ink-2 whitespace-nowrap">{runtimeText(item.runtime, isFilm)}</td>
    </tr>
  );
}

// Without a subscription offer the row still says where the title can be had: hyr/köp, or not at all in Sweden.
function AvailabilityTag({ item }: { item: ToWatchRow['item'] }) {
  switch (availabilityOf(item)) {
    case 'rent': {
      const names = canonicalUniqueProviders(item.providers).map(id => getProvider(id)?.shortName).filter(Boolean).slice(0, 2);
      return (
        <span className="flex flex-wrap gap-1" title="Går att hyra eller köpa, men finns inte i någon streamingtjänst">
          <span className={tagClass('ink')}>Hyr eller köp</span>
          {names.map(n => <span key={n} className={tagClass('muted')}>{n}</span>)}
        </span>
      );
    }
    case 'none':
      return <span className={tagClass('faint')} title="Går inte att streama, hyra eller köpa i Sverige just nu">Finns inte i Sverige</span>;
    default:
      return <span className="text-ink-3">–</span>;
  }
}
