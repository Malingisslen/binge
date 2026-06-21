'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';
import { useAuth } from '@/hooks/useAuth';
import { usePublicList, useListMutations, useListEditors, useListFollows } from '@/hooks/useLists';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useSearch } from '@/hooks/useTMDB';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { posterUrl, getDisplayTitle, getReleaseYear, isAddableMediaType, titleHref } from '@/lib/tmdb/client';
import { toneForId } from '@/lib/duotone';
import type { TMDBSearchResult, UserList, UserListItem } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';
import { NotFound } from '@/components/ui/NotFound';
import { EmptyState } from '@/components/ui/EmptyState';

export default function ListPageClient({ listId }: { listId: string }) {
  const { uid } = useAuth();
  const { data: list, isLoading } = usePublicList(listId);
  const { addItemToList, removeItemFromList } = useListMutations();
  const { addEditor, removeEditor } = useListEditors();
  const { isFollowing, followList, unfollowList } = useListFollows();
  const queryClient = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);

  const isOwner = !!(uid && list && list.uid === uid);
  // BIN-100: owner OR a co-editor may add/remove items. Only the owner manages
  // the editor list itself.
  const canEdit = isOwner || !!(uid && list?.editors?.includes(uid));

  usePageMeta({ title: list?.title ?? 'Lista' });

  const existingIds = useMemo(
    () => new Set((list?.items ?? []).map(i => i.tmdbId)),
    [list?.items],
  );

  if (isLoading) return <LoadingView variant="detail" label="Laddar lista…" />;
  if (!list) {
    return (
      <NotFound
        crumb="Lista"
        title="Listan hittades inte"
        body="Listan kan vara borttagen eller satt till privat."
        action={<Link href="/bibliotek" className="btn btn-ghost">Till biblioteket</Link>}
      />
    );
  }

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
      <PageHeader
        crumb="Lista"
        title={list.title}
        actions={canEdit && !showPicker ? (
          <button
            onClick={() => setShowPicker(true)}
            className="inline-flex items-center gap-1 px-3 py-[3px] border-none rounded-sm text-xs font-[inherit] cursor-pointer bg-accent text-white shrink-0"
          >
            <Plus size={12} /> Lägg till titel
          </button>
        ) : (!canEdit && uid) ? (
          // BIN-96: följ/avfölj någon annans lista (inloggad, ej egen lista
          // och ej medredigerare — canEdit täcker både ägare och editors).
          <button
            type="button"
            onClick={() => isFollowing(listId) ? unfollowList(listId) : followList(listId, list.uid)}
            className={`chip${isFollowing(listId) ? ' is-on' : ''} shrink-0`}
            aria-pressed={isFollowing(listId)}
          >
            {isFollowing(listId) ? 'Följer' : 'Följ lista'}
          </button>
        ) : undefined}
      />
      {list.description && (
        <p className="text-xs text-text-muted mb-2">{list.description}</p>
      )}
      <span className="text-xxs text-text-muted">{list.items.length} {list.items.length === 1 ? 'titel' : 'titlar'}</span>
      {!isOwner && canEdit && (
        <span className="text-xxs text-accent ml-2">· du är medredigerare</span>
      )}

      {isOwner && (
        <EditorsManager
          editors={list.editors}
          onAdd={(handle) => addEditor(listId, handle)}
          onRemove={(u) => removeEditor(listId, u)}
        />
      )}

      {canEdit && showPicker && (
        <TitlePicker
          existingIds={existingIds}
          onAdd={handleAdd}
          onClose={() => setShowPicker(false)}
        />
      )}

      {list.items.length === 0 ? (
        <EmptyState
          title="Listan är tom"
          body={canEdit && !showPicker ? 'Lägg till din första titel med knappen ovan.' : canEdit ? 'Använd sökfältet ovan.' : 'Den här listan har inga titlar ännu.'}
        />
      ) : (
        <div className="bg-surface border border-rule rounded-sm mt-3">
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
                {canEdit && (
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
      )}
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

// BIN-100: owner-only co-editor management. Add by @handle, remove by row.
// Editors can add/remove items but never change list metadata (rules-enforced).
function EditorsManager({ editors, onAdd, onRemove }: {
  editors: string[];
  onAdd: (handle: string) => Promise<{ ok: boolean; error?: string }>;
  onRemove: (uid: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [handle, setHandle] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const h = handle.trim().replace(/^@/, '');
    if (!h || busy) return;
    setBusy(true);
    setMsg(null);
    const res = await onAdd(h);
    setBusy(false);
    if (res.ok) { setHandle(''); setMsg('Medredigerare tillagd.'); }
    else setMsg(res.error ?? 'Kunde inte lägga till.');
  };
  const handleRemove = async (uid: string) => {
    const res = await onRemove(uid);
    if (!res.ok) setMsg(res.error ?? 'Kunde inte ta bort medredigeraren.');
  };
  return (
    <div className="bg-surface border border-rule rounded-md px-3 py-[10px] mt-3 max-w-[420px]">
      <div className="text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold mb-1">Medredigerare</div>
      <p className="text-xxs text-text-muted mb-2">
        De du lägger till kan lägga till och ta bort titlar — men inte ändra listans namn eller synlighet.
      </p>
      <div className="flex gap-[6px] items-center mb-1">
        <input
          value={handle}
          onChange={e => setHandle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
          placeholder="@användarnamn"
          className="select flex-1"
        />
        <button type="button" onClick={() => void submit()} disabled={busy} className="chip">Lägg till</button>
      </div>
      {msg && <div className="text-xxs text-text-muted mb-2">{msg}</div>}
      {editors.length > 0 && (
        <div className="flex flex-col gap-[4px] mt-2">
          {editors.map(uid => <EditorRow key={uid} uid={uid} onRemove={() => handleRemove(uid)} />)}
        </div>
      )}
    </div>
  );
}

function EditorRow({ uid, onRemove }: { uid: string; onRemove: () => void }) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { db, doc, getDoc } = await fsdb();
        const snap = await getDoc(doc(db, 'users', uid));
        const d = snap.exists() ? snap.data() : null;
        if (active) setName((d?.displayName as string) || (d?.username as string) || 'Användare');
      } catch { if (active) setName('Användare'); }
    })();
    return () => { active = false; };
  }, [uid]);
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-primary truncate">{name ?? '…'}</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-xxs text-danger-ink border border-rule rounded-sm px-2 py-[1px] bg-surface cursor-pointer shrink-0 ml-2"
      >
        Ta bort
      </button>
    </div>
  );
}
