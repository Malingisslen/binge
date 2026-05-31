'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import ProviderDot from '@/components/ui/ProviderDot';
import StatCard from '@/components/ui/StatCard';
import { useWatchlist } from '@/hooks/useWatchlist';
import { getProvider } from '@/lib/tmdb/providers';

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

export default function StatsPage() {
  return <AuthGuard><StatsContent /></AuthGuard>;
}

function StatsContent() {
  const { items } = useWatchlist();

  const stats = useMemo(() => {
    // "Följer" på stats-sidan = TV-shows i 'mina' (samlingen), filmer i 'sedd'
    // räknas separat under "watched".
    const following = items.filter(i => i.status === 'mina' && !i.dropped);
    const watched = items.filter(i => i.status === 'sedd');
    const movies = items.filter(i => i.mediaType === 'movie');
    const tvShows = items.filter(i => i.mediaType === 'tv');
    const rated = items.filter(i => i.rating !== null);
    const avgRating = rated.length > 0
      ? rated.reduce((sum, i) => sum + (i.rating ?? 0), 0) / rated.length
      : 0;

    const ratingDist: Record<string, number> = {};
    for (const item of rated) {
      const bucket = String(Math.floor(item.rating!));
      ratingDist[bucket] = (ratingDist[bucket] ?? 0) + 1;
    }

    const providerStats: Record<number, number> = {};
    for (const item of items) {
      for (const pid of item.providers ?? []) {
        providerStats[pid] = (providerStats[pid] ?? 0) + 1;
      }
    }

    const topProviders = Object.entries(providerStats)
      .map(([id, count]) => ({ id: Number(id), count, provider: getProvider(Number(id)) }))
      .filter(p => p.provider)
      .sort((a, b) => b.count - a.count);

    // "Med streaming-data" = titlar vi faktiskt har SE-providers för. Räkna
    // providers-arrayen (som staplarna använder) ELLER providersCheckedAt —
    // addItem sätter providers men inte providersCheckedAt, så enbart
    // providersCheckedAt gav felaktigt "0 av N" trots att staplar visas.
    const withProviderData = items.filter(
      i => (i.providers?.length ?? 0) > 0 || i.providersCheckedAt != null
    ).length;

    const totalRewatches = items.reduce((sum, i) => sum + (i.rewatchCount ?? 0), 0);

    const monthlyActivity: Record<string, number> = {};
    for (const item of items) {
      if (item.watchedAt) {
        const key = `${item.watchedAt.getFullYear()}-${String(item.watchedAt.getMonth() + 1).padStart(2, '0')}`;
        monthlyActivity[key] = (monthlyActivity[key] ?? 0) + 1;
      }
    }
    const activityMonths = Object.entries(monthlyActivity).sort(([a], [b]) => a.localeCompare(b)).slice(-12);

    const moviePct = items.length > 0 ? Math.round((movies.length / items.length) * 100) : 0;

    return { following, watched, movies, tvShows, rated, avgRating, ratingDist, topProviders, withProviderData, totalRewatches, activityMonths, moviePct, total: items.length };
  }, [items]);

  if (stats.total === 0) {
    return (
      <>
        <header>
          <div className="crumb">Statistik</div>
          <h1 className="page-h1">Statistik</h1>
          <p className="stand">Lägg till titlar i din lista för att se statistik.</p>
        </header>
      </>
    );
  }

  const maxProviderCount = stats.topProviders.length > 0 ? stats.topProviders[0].count : 1;

  return (
    <>
      <header>
        <div className="crumb">Statistik · {stats.total} titlar totalt</div>
        <h1 className="page-h1">Statistik</h1>
        <p className="stand">
          {stats.watched.length} sedda · {stats.rated.length} betygsatta · snittbetyg {stats.avgRating.toFixed(1)}.
        </p>
      </header>
      <div style={{ marginTop: 28 }}>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px] mb-4">
        <StatCard label="Totalt" value={stats.total} />
        <StatCard label="Följer" value={stats.following.length} />
        <StatCard label="Sedd" value={stats.watched.length} />
        <StatCard label="Medelbetyg" value={stats.avgRating > 0 ? stats.avgRating.toFixed(1) : '—'} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-[14px] mb-4">
        {/* Film vs Serier — stacked bar */}
        <div className="bg-surface border border-border-main rounded-sm">
          <div className="px-3 py-[6px] border-b border-border-light">
            <span className="text-sm font-bold text-text-secondary">Film vs Serier</span>
          </div>
          <div className="px-3 py-3">
            <div className="flex h-[24px] rounded-sm overflow-hidden mb-2">
              {stats.movies.length > 0 && (
                <div
                  className="bg-accent flex items-center justify-center text-white text-xxs font-semibold"
                  style={{ width: `${stats.moviePct}%` }}
                >
                  {stats.moviePct > 15 && `${stats.moviePct}%`}
                </div>
              )}
              {stats.tvShows.length > 0 && (
                <div
                  className="bg-text-secondary flex items-center justify-center text-white text-xxs font-semibold"
                  style={{ width: `${100 - stats.moviePct}%` }}
                >
                  {(100 - stats.moviePct) > 15 && `${100 - stats.moviePct}%`}
                </div>
              )}
            </div>
            <div className="flex justify-between text-xs text-text-muted">
              <span><span className="inline-block w-[8px] h-[8px] rounded-[1px] bg-accent mr-1 align-middle" /> {stats.movies.length} filmer</span>
              <span><span className="inline-block w-[8px] h-[8px] rounded-[1px] bg-text-secondary mr-1 align-middle" /> {stats.tvShows.length} serier</span>
              {stats.totalRewatches > 0 && (
                <span className="text-text-muted">{stats.totalRewatches} omtittningar</span>
              )}
            </div>
          </div>
        </div>

        {/* Betygsfördelning */}
        <div className="bg-surface border border-border-main rounded-sm">
          <div className="px-3 py-[6px] border-b border-border-light">
            <span className="text-sm font-bold text-text-secondary">Betygsfördelning</span>
          </div>
          <div className="px-3 py-2">
            {[5, 4, 3, 2, 1].map(n => {
              const count = stats.ratingDist[String(n)] ?? 0;
              const maxCount = Math.max(...Object.values(stats.ratingDist), 1);
              return (
                <div key={n} className="flex items-center gap-2 mb-[2px]">
                  <span className="text-xs text-text-muted w-[16px]">{n}</span>
                  <div className="flex-1 h-[6px] bg-rule rounded-full overflow-hidden">
                    <div className="h-full bg-ink rounded-full" style={{ width: `${(count / maxCount) * 100}%` }} />
                  </div>
                  <span className="text-xxs text-text-muted w-[20px] text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Streamingtjänster — horizontal colored bars */}
      {stats.topProviders.length > 0 && (
        <div className="bg-surface border border-border-main rounded-sm mb-4">
          <div className="px-3 py-[6px] border-b border-border-light flex items-baseline justify-between gap-2">
            <span className="text-sm font-bold text-text-secondary">Streamingtjänster</span>
            <span className="text-xxs text-text-muted">
              Baserat på {stats.withProviderData} av {stats.total} titlar med streaming-data
              {stats.withProviderData < stats.total - 5 && (
                <>
                  {' — '}
                  <Link href="/settings" className="text-accent hover:underline">
                    uppdatera smakdata
                  </Link>
                </>
              )}
            </span>
          </div>
          <div className="px-3 py-2">
            {stats.topProviders.slice(0, 8).map(p => (
              <div key={p.id} className="flex items-center gap-2 py-[4px]">
                <span className="flex items-center gap-[6px] text-xs w-[90px] shrink-0 truncate">
                  <ProviderDot color={p.provider?.color ?? 'var(--ink-3)'} />
                  {p.provider?.name}
                </span>
                <div className="flex-1 h-[8px] bg-rule rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(p.count / maxProviderCount) * 100}%`,
                      backgroundColor: p.provider?.color ?? 'var(--ink-3)',
                    }}
                  />
                </div>
                <span className="text-xxs text-text-muted w-[40px] text-right">{p.count} {p.count === 1 ? 'titel' : 'titlar'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Aktivitet per månad — proper bar chart */}
      {stats.activityMonths.length > 1 && (
        <div className="bg-surface border border-border-main rounded-sm mb-4">
          <div className="px-3 py-[6px] border-b border-border-light">
            <span className="text-sm font-bold text-text-secondary">Aktivitet per månad</span>
          </div>
          <div className="px-3 py-2">
            <div className="flex items-end gap-[4px]" style={{ height: '100px' }}>
              {stats.activityMonths.map(([month, count]) => {
                const maxCount = Math.max(...stats.activityMonths.map(([, c]) => c), 1);
                const monthIdx = parseInt(month.slice(5), 10) - 1;
                const label = MONTH_NAMES[monthIdx] ?? month.slice(5);
                return (
                  <div key={month} className="flex-1 flex flex-col items-center justify-end h-full group">
                    <div className="text-xxs text-text-muted mb-[2px] opacity-0 group-hover:opacity-100 transition-opacity">{count}</div>
                    <div
                      className="w-full bg-accent rounded-t-[2px] min-h-[2px] transition-all"
                      style={{ height: `${(count / maxCount) * 80}%` }}
                    />
                    <div className="text-[8px] text-text-muted mt-[3px]">{label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
}
