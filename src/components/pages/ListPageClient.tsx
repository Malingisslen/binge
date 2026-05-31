'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { usePublicList, useListMutations } from '@/hooks/useLists';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useSearch } from '@/hooks/useTMDB';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { posterUrl, getDisplayTitle, getReleaseYear, isAddableMediaType, titleHref } from '@/lib/tmdb/client';
import { toneForId } from '@/lib/duotone';
import type { TMDBSearchResult, UserList, UserListItem } from '@/types';

export default function ListPageClient({ listId }: { listId: string }) {
  const { uid } = useAuth();
  const { data: list, isLoading } = usePublicList(listId);
  const { addItemToList, removeItemFromList } = useListMutations();
  const queryClient = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);

  const isOwner = !!(uid && list && list.uid === uid);

  usePageMeta({ title: list?.title ?? 'Lista' });

  const existingIds = useMemo(
    () => new Set((list?.items ?? []).map(i => i.tmdbId)),
    [list?.items],
  );

  if (isLoading) return <div className="text-sm text-text-muted py-4">Laddar…</div>;
  if (!list) return <div className="text-sm text-text-muted py-4">Listan hittades inte.</div>;

  // Optimistisk cache-uppdatering — undviker en extra getDoc per mutation. Om
  // skrivningen failar i Firestore skulle UI:n driva i sär från servern; en
  // toast + manuell refresh är acceptabelt för v1.
  const patchCache = (mutate: (items: UserListItem[]) => UserListItem[]) => {
    queryClient.setQueryData<UserList | null>(
      ['public-list', listId],
      prev => prev ? { ...prev, items: mutate(prev.items) } : prev,
    );
  };

  const handleAdd = async (r: TMDBSearchResult & { media_type: 'movie' | 'tv' }) => {
    const item: UserListItem = {
      tmdbId: r.id,
      mediaType: r.media_type,
      title: getDisplayTitle(r),
      posterPath: r.poster_path,
      addedAt: new Date(),
    };
    patchCache(items => [...items, item]);
    await addItemToList(listId, item);
  };

  const handleRemove = async (tmdbId: number) => {
    patchCache(items => items.filter(i => i.tmdbId !== tmdbId));
    await removeItemFromList(listId, tmdbId);
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-1">
        <h1 className="text-[18px] font-bold text-text-primary">{list.title}</h1>
        {isOwner && !showPicker && (
          <button
            onClick={() => setShowPicker(true)}
            className="inline-flex items-center gap-1 px-3 py-[3px] border-none rounded-sm text-xs font-[inherit] cursor-pointer bg-accent text-white shrink-0"
          >
            <Plus size={12} /> Lägg till titel
          </button>
        )}
      </div>
      {list.description && (
        <p className="text-xs text-text-muted mb-2">{list.description}</p>
      )}
      <span className="text-xxs text-text-muted">{list.items.length} {list.items.length === 1 ? 'titel' : 'titlar'}</span>

      {isOwner && showPicker && (
        <TitlePicker
          existingIds={existingIds}
          onAdd={handleAdd}
          onClose={() => setShowPicker(false)}
        />
      )}

      <div className="bg-surface border border-border-main rounded-sm mt-3">
        <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-[10px] md:gap-[7px] px-3 py-2">
          {list.items.map(item => {
            const poster = posterUrl(item.posterPath, 'w342');
            const href = titleHref(item.mediaType, item.tmdbId);
            return (
              <div key={item.tmdbId} className="relative">
                <Link href={href} className="no-underline text-text-primary block">
                  <div className={`poster duo-${toneForId(item.tmdbId)} mb-[3px]`}>
                    {poster && <img src={poster} alt={item.title} loading="lazy" decoding="async" width={342} height={513} />}
                  </div>
                  <div className="text-xs font-semibold truncate">{item.title}</div>
                </Link>
                {isOwner && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleRemove(item.tmdbId);
                    }}
                    title="Ta bort från listan"
                    aria-label={`Ta bort ${item.title} från listan`}
                    className="absolute top-1 right-1 w-5 h-5 inline-flex items-center justify-center bg-black/60 text-white rounded-sm border-none cursor-pointer hover:bg-black/80"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface TitlePickerProps {
  existingIds: Set<number>;
  onAdd: (r: TMDBSearchResult & { media_type: 'movie' | 'tv' }) => Promise<void>;
  onClose: () => void;
}

function TitlePicker({ existingIds, onAdd, onClose }: TitlePickerProps) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);
  const { data: searchData, isLoading } = useSearch(debouncedQuery);

  const results = (searchData?.results ?? [])
    .filter(isAddableMediaType)
    .slice(0, 8);

  return (
    <div className="bg-surface border border-border-main rounded-sm p-2 mt-3">
      <div className="flex items-center gap-2 mb-2 border border-border-main rounded-sm bg-white px-2">
        <Search size={12} className="text-text-muted" />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Sök film eller serie…"
          className="flex-1 py-1 text-xs border-none outline-none font-[inherit] bg-transparent"
          autoFocus
        />
        <button
          onClick={onClose}
          aria-label="Stäng"
          className="bg-transparent border-none cursor-pointer p-0 text-text-muted hover:text-text-primary"
        >
          <X size={12} />
        </button>
      </div>

      {query.length >= 2 && isLoading && (
        <div className="text-xxs text-text-muted py-1">Söker…</div>
      )}

      {query.length >= 2 && !isLoading && results.length === 0 && (
        <div className="text-xxs text-text-muted py-1">Inga träffar.</div>
      )}

      {results.length > 0 && (
        <ul className="space-y-1 max-h-[280px] overflow-y-auto">
          {results.map(r => {
            const poster = posterUrl(r.poster_path, 'w92');
            const alreadyAdded = existingIds.has(r.id);
            return (
              <li key={`${r.media_type}-${r.id}`}>
                <button
                  onClick={() => !alreadyAdded && onAdd(r)}
                  disabled={alreadyAdded}
                  className="w-full flex items-center gap-2 px-1 py-[3px] bg-transparent border-none cursor-pointer text-left hover:bg-surface-hover rounded-sm disabled:cursor-default disabled:opacity-60"
                >
                  {poster ? (
                    <div className={`poster duo-${toneForId(r.id)} w-[24px] h-[36px] shrink-0`}>
                      <img
                        src={poster}
                        alt=""
                        width={24}
                        height={36}
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  ) : (
                    <div className="w-[24px] h-[36px] bg-rule-2 rounded-sm shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-text-primary truncate">
                      {getDisplayTitle(r)}
                    </div>
                    <div className="text-xxs text-text-muted">
                      {r.media_type === 'movie' ? 'Film' : 'Serie'}
                      {getReleaseYear(r) ? ` · ${getReleaseYear(r)}` : ''}
                    </div>
                  </div>
                  {alreadyAdded && (
                    <span className="text-xxs text-accent shrink-0">Tillagd</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
