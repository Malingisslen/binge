'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSearch } from '@/hooks/useTMDB';
import { useUserSearch } from '@/hooks/useUserSearch';
import { posterUrl, getDisplayTitle, getReleaseYear, isAddableMediaType, titleHref } from '@/lib/tmdb/client';
import type { ResolvedUser } from '@/lib/firebase/username';

interface SearchDropdownProps {
  query: string;
  onSelect: () => void;
}

// Sökdropdownen visar både användar- och titelträffar. Pilar går genom alla
// rader (användare först, sedan titlar), Enter aktiverar den markerade.
type Row =
  | { kind: 'user'; user: ResolvedUser }
  | { kind: 'title'; item: { media_type: 'movie' | 'tv'; id: number } };

export default function SearchDropdown({ query, onSelect }: SearchDropdownProps) {
  const { data: titleData, isLoading: titlesLoading } = useSearch(query);
  const { data: userData, isLoading: usersLoading } = useUserSearch(query);
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(-1);

  const titleResults = useMemo(
    () => (titleData?.results ?? []).filter(isAddableMediaType).slice(0, 8),
    [titleData],
  );
  const userResults = useMemo(() => userData ?? [], [userData]);

  const rows: Row[] = useMemo(() => [
    ...userResults.map(u => ({ kind: 'user' as const, user: u })),
    ...titleResults.map(item => ({
      kind: 'title' as const,
      item: { media_type: item.media_type as 'movie' | 'tv', id: item.id },
    })),
  ], [userResults, titleResults]);

  useEffect(() => { setActiveIndex(-1); }, [query]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, rows.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, -1));
      } else if (e.key === 'Enter' && activeIndex >= 0 && rows[activeIndex]) {
        e.preventDefault();
        const row = rows[activeIndex];
        if (row.kind === 'user') {
          router.push(`/user/${row.user.username}/`);
        } else {
          router.push(titleHref(row.item.media_type, row.item.id));
        }
        onSelect();
      } else if (e.key === 'Enter' && activeIndex === -1) {
        e.preventDefault();
        router.push(`/search/?q=${encodeURIComponent(query)}`);
        onSelect();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [activeIndex, rows, query, router, onSelect]);

  const isLoading = titlesLoading || usersLoading;
  const hasAny = userResults.length > 0 || titleResults.length > 0;

  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-rule rounded-sm shadow-pop z-50 max-h-[400px] overflow-y-auto">
      {isLoading && !hasAny && (
        <div className="px-3 py-2 text-sm text-ink-3">Söker...</div>
      )}
      {!isLoading && !hasAny && (
        <div className="px-3 py-2 text-sm text-ink-3">Inga resultat</div>
      )}

      {userResults.length > 0 && (
        <>
          <div className="px-3 pt-2 pb-[2px] text-xxs uppercase tracking-[1px] text-ink-3 font-semibold">
            Användare
          </div>
          {userResults.map((user, i) => {
            const rowIndex = i;
            return (
              <Link
                key={`user-${user.uid}`}
                href={`/user/${user.username}/`}
                onClick={onSelect}
                className={`flex items-center gap-2 px-3 py-[6px] no-underline text-ink-2 ${
                  rowIndex === activeIndex ? 'bg-bg-2' : 'hover:bg-rule-2'
                }`}
              >
                <UserAvatar name={user.displayName} photoURL={user.photoURL} />
                <div className="min-w-0">
                  <div className="text-sm text-ink font-semibold truncate">{user.displayName}</div>
                  <div className="text-xs text-ink-3 truncate">@{user.username}</div>
                </div>
              </Link>
            );
          })}
        </>
      )}

      {titleResults.length > 0 && (
        <>
          {userResults.length > 0 && (
            <div className="px-3 pt-2 pb-[2px] text-xxs uppercase tracking-[1px] text-ink-3 font-semibold border-t border-rule-2">
              Titlar
            </div>
          )}
          {titleResults.map((item, i) => {
            const rowIndex = userResults.length + i;
            const href = titleHref(item.media_type, item.id);
            const title = getDisplayTitle(item);
            const year = getReleaseYear(item);
            const poster = posterUrl(item.poster_path, 'w92');

            return (
              <Link
                key={`${item.media_type}-${item.id}`}
                href={href}
                onClick={onSelect}
                className={`flex items-center gap-2 px-3 py-[6px] no-underline text-ink-2 ${
                  rowIndex === activeIndex ? 'bg-bg-2' : 'hover:bg-rule-2'
                }`}
              >
                {poster ? (
                  <img src={poster} alt="" className="w-[26px] h-[39px] rounded-sm object-cover shrink-0" loading="lazy" decoding="async" width={26} height={39} />
                ) : (
                  <div className="w-[26px] h-[39px] rounded-sm bg-rule-2 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-sm text-ink font-semibold truncate">{title}</div>
                  <div className="text-xs text-ink-3">
                    {year ?? '—'} · {item.media_type === 'movie' ? 'Film' : 'Serie'}
                  </div>
                </div>
              </Link>
            );
          })}
        </>
      )}

      {titleResults.length > 0 && (
        <Link
          href={`/search/?q=${encodeURIComponent(query)}`}
          onClick={onSelect}
          className={`block px-3 py-2 text-xs text-acc-deep no-underline border-t border-rule-2 ${
            activeIndex === -1 ? '' : 'hover:bg-rule-2'
          }`}
        >
          Visa alla resultat →
        </Link>
      )}
    </div>
  );
}

function UserAvatar({ name, photoURL }: { name: string; photoURL: string | null }) {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt=""
        className="w-[26px] h-[26px] rounded-full object-cover shrink-0"
        loading="lazy"
        decoding="async"
        width={26}
        height={26}
      />
    );
  }
  const initial = (name?.[0] ?? '?').toUpperCase();
  return (
    <div className="w-[26px] h-[26px] rounded-full bg-accent/30 text-accent text-xs flex items-center justify-center font-semibold shrink-0">
      {initial}
    </div>
  );
}
