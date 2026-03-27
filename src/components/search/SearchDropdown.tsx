'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSearch } from '@/hooks/useTMDB';
import { posterUrl, getDisplayTitle, getReleaseYear } from '@/lib/tmdb/client';

interface SearchDropdownProps {
  query: string;
  onSelect: () => void;
}

export default function SearchDropdown({ query, onSelect }: SearchDropdownProps) {
  const { data, isLoading } = useSearch(query);
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(-1);

  const results = (data?.results ?? [])
    .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
    .slice(0, 8);

  useEffect(() => { setActiveIndex(-1); }, [query]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, -1));
      } else if (e.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
        e.preventDefault();
        const item = results[activeIndex];
        const href = item.media_type === 'movie' ? `/movie/${item.id}/` : `/tv/${item.id}/`;
        router.push(href);
        onSelect();
      } else if (e.key === 'Enter' && activeIndex === -1) {
        e.preventDefault();
        router.push(`/search/?q=${encodeURIComponent(query)}`);
        onSelect();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [activeIndex, results, query, router, onSelect]);

  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1b23] border border-white/10 rounded-sm shadow-lg z-50 max-h-[400px] overflow-y-auto">
      {isLoading && (
        <div className="px-3 py-2 text-sm text-text-sidebar">Söker...</div>
      )}
      {!isLoading && results.length === 0 && (
        <div className="px-3 py-2 text-sm text-text-sidebar">Inga resultat</div>
      )}
      {results.map((item, index) => {
        const href = item.media_type === 'movie' ? `/movie/${item.id}/` : `/tv/${item.id}/`;
        const title = getDisplayTitle(item);
        const year = getReleaseYear(item);
        const poster = posterUrl(item.poster_path, 'w92');

        return (
          <Link
            key={`${item.media_type}-${item.id}`}
            href={href}
            onClick={onSelect}
            className={`flex items-center gap-2 px-3 py-[6px] no-underline text-text-sidebar ${
              index === activeIndex ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
            }`}
          >
            {poster ? (
              <img src={poster} alt="" className="w-[26px] h-[39px] rounded-sm object-cover shrink-0" />
            ) : (
              <div className="w-[26px] h-[39px] rounded-sm bg-white/10 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm text-[#ddd] font-semibold truncate">{title}</div>
              <div className="text-xs text-text-sidebar">
                {year ?? '—'} · {item.media_type === 'movie' ? 'Film' : 'Serie'}
              </div>
            </div>
          </Link>
        );
      })}
      {results.length > 0 && (
        <Link
          href={`/search/?q=${encodeURIComponent(query)}`}
          onClick={onSelect}
          className={`block px-3 py-2 text-xs text-accent no-underline border-t border-white/[0.06] ${
            activeIndex === -1 ? '' : 'hover:bg-white/[0.04]'
          }`}
        >
          Visa alla resultat →
        </Link>
      )}
    </div>
  );
}
