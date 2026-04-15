'use client';

import { useMemo } from 'react';
import AuthGuard from '@/components/AuthGuard';
import ProviderDot from '@/components/ui/ProviderDot';
import StatCard from '@/components/ui/StatCard';
import { useWatchlist } from '@/hooks/useWatchlist';
import { getProvider } from '@/lib/tmdb/providers';

export default function StatsPage() {
  return <AuthGuard><StatsContent /></AuthGuard>;
}

function StatsContent() {
  const { items } = useWatchlist();

  const stats = useMemo(() => {
    const following = items.filter(i => i.status === 'följer' && !i.dropped);
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

    const totalRewatches = items.reduce((sum, i) => sum + (i.rewatchCount ?? 0), 0);

    const monthlyActivity: Record<string, number> = {};
    for (const item of items) {
      if (item.watchedAt) {
        const key = `${item.watchedAt.getFullYear()}-${String(item.watchedAt.getMonth() + 1).padStart(2, '0')}`;
        monthlyActivity[key] = (monthlyActivity[key] ?? 0) + 1;
      }
    }
    const activityMonths = Object.entries(monthlyActivity).sort(([a], [b]) => a.localeCompare(b)).slice(-12);

    return { following, watched, movies, tvShows, rated, avgRating, ratingDist, topProviders, totalRewatches, activityMonths, total: items.length };
  }, [items]);

  if (stats.total === 0) {
    return (
      <div>
        <h1 className="text-[18px] font-bold text-text-primary mb-3">Statistik</h1>
        <p className="text-sm text-text-muted">Lägg till titlar i din lista för att se statistik.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[18px] font-bold text-text-primary mb-3">Statistik</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px] mb-4">
        <StatCard label="Totalt" value={stats.total} />
        <StatCard label="Följer" value={stats.following.length} />
        <StatCard label="Sedd" value={stats.watched.length} />
        <StatCard label="Medelbetyg" value={stats.avgRating > 0 ? stats.avgRating.toFixed(1) : '—'} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-[14px] mb-4">
        <div className="bg-surface border border-border-main rounded-sm">
          <div className="px-3 py-[6px] border-b border-border-light">
            <span className="text-sm font-bold text-text-secondary">Film vs Serier</span>
          </div>
          <div className="px-3 py-2 flex gap-4">
            <div className="text-center flex-1">
              <div className="text-[20px] font-bold text-accent">{stats.movies.length}</div>
              <div className="text-xxs text-text-muted uppercase">Filmer</div>
            </div>
            <div className="text-center flex-1">
              <div className="text-[20px] font-bold text-accent">{stats.tvShows.length}</div>
              <div className="text-xxs text-text-muted uppercase">Serier</div>
            </div>
            {stats.totalRewatches > 0 && (
              <div className="text-center flex-1">
                <div className="text-[20px] font-bold text-text-secondary">{stats.totalRewatches}</div>
                <div className="text-xxs text-text-muted uppercase">Omtittningar</div>
              </div>
            )}
          </div>
        </div>

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
                  <div className="flex-1 h-[6px] bg-[#e5e0d8] rounded-[1px] overflow-hidden">
                    <div className="h-full bg-accent rounded-[1px]" style={{ width: `${(count / maxCount) * 100}%` }} />
                  </div>
                  <span className="text-xxs text-text-muted w-[20px] text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {stats.topProviders.length > 0 && (
        <div className="bg-surface border border-border-main rounded-sm mb-4">
          <div className="px-3 py-[6px] border-b border-border-light">
            <span className="text-sm font-bold text-text-secondary">Streamingtjänster</span>
          </div>
          <div className="px-3 py-2">
            {stats.topProviders.slice(0, 8).map(p => (
              <div key={p.id} className="flex items-center justify-between py-[2px]">
                <span className="flex items-center gap-[6px] text-base">
                  <ProviderDot color={p.provider?.color ?? '#888'} />
                  {p.provider?.name}
                </span>
                <span className="text-xs text-text-muted">{p.count} {p.count === 1 ? 'titel' : 'titlar'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.activityMonths.length > 0 && (
        <div className="bg-surface border border-border-main rounded-sm mb-4">
          <div className="px-3 py-[6px] border-b border-border-light">
            <span className="text-sm font-bold text-text-secondary">Aktivitet per månad</span>
          </div>
          <div className="px-3 py-2 flex items-end gap-[3px]" style={{ height: '80px' }}>
            {stats.activityMonths.map(([month, count]) => {
              const maxCount = Math.max(...stats.activityMonths.map(([, c]) => c), 1);
              return (
                <div key={month} className="flex-1 flex flex-col items-center justify-end h-full">
                  <div className="w-full bg-accent rounded-t-[1px]" style={{ height: `${(count / maxCount) * 100}%` }} />
                  <div className="text-[7px] text-text-muted mt-[2px]">{month.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

