'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { computeProfileStats } from '@/lib/taste/stats';
import { useGenreMap } from '@/hooks/useGenreMap';
import { getProvider } from '@/lib/tmdb/providers';
import type { WatchlistItem } from '@/types';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { cardClass } from '@/components/ui/Card';

export default function ProfileStatsPanel({ items }: { items: WatchlistItem[] }) {
  const genreMap = useGenreMap();
  const stats = useMemo(() => computeProfileStats(items), [items]);

  if (items.length === 0) return null;

  const maxWeight = stats.topGenres[0]?.weight ?? 1;

  return (
    <div className={cardClass('mb-3.5')}>
      <div className="px-3 py-1.5 border-b border-rule-2">
        <span className="text-sm font-bold text-ink-2">Profil</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-3 py-3">
        <div>
          <Eyebrow className="mb-2">
            Topp-genrer
          </Eyebrow>
          {stats.topGenres.length === 0 ? (
            <div className="text-xs text-ink-3">—</div>
          ) : (
            <ul className="space-y-1">
              {stats.topGenres.map(g => {
                const name = genreMap.get(g.genreId) ?? `#${g.genreId}`;
                const pct = Math.round((g.weight / maxWeight) * 100);
                return (
                  <li key={g.genreId} className="text-xs">
                    <div className="flex items-baseline justify-between">
                      <span className="text-ink">{name}</span>
                      <span className="text-xxs text-ink-3">{g.count}</span>
                    </div>
                    <div className="h-[3px] bg-rule-2 rounded-sm mt-0.5 overflow-hidden">
                      <div className="h-full bg-acc-deep" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <Eyebrow className="mb-2">
            Topp-tjänster
          </Eyebrow>
          {stats.topProviders.length === 0 ? (
            <div className="text-xs text-ink-3">—</div>
          ) : (
            <ul className="space-y-1">
              {stats.topProviders.map(p => {
                const provider = getProvider(p.providerId);
                if (!provider) return null;
                return (
                  <li key={p.providerId} className="text-xs flex items-center gap-1.5">
                    <span className="provider-swatch w-[6px] h-[6px] rounded-full shrink-0" style={{ background: provider.color }} />
                    <Link href={`/provider/${p.providerId}/`} className="text-ink no-underline hover:text-acc-deep flex-1 truncate">
                      {provider.name}
                    </Link>
                    <span className="text-xxs text-ink-3">{p.count}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <Eyebrow className="mb-2">
            Senaste 30 dagarna
          </Eyebrow>
          <ul className="space-y-1 text-xs">
            <li className="flex justify-between">
              <span className="text-ink">Sedd</span>
              <span className="text-ink-2 font-semibold">{stats.recent30.watched}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-ink">Tillagda</span>
              <span className="text-ink-2 font-semibold">{stats.recent30.added}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-ink">Betygsatta</span>
              <span className="text-ink-2 font-semibold">{stats.recent30.rated}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
