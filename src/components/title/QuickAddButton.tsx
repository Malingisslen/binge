'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Check } from 'lucide-react';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useMarkSeen } from '@/hooks/useMarkSeen';
import { useAuth } from '@/hooks/useAuth';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useToast } from '@/contexts/ToastContext';
import { statusLabel, statusMenuLabel, statusOptionsFor } from '@/lib/watchStatus';
import { clearEpisodeProgress } from '@/lib/firebase/episodeProgress';
import { buildWatchlistAddPayload } from '@/lib/watchlist/buildAddPayload';
import { rememberNextPath } from '@/lib/nextPath';
import type { WatchStatus, MediaType } from '@/types';

interface QuickAddButtonProps {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  providers?: number[];
  genreIds?: number[];
}

export default function QuickAddButton({
  tmdbId, mediaType, title, posterPath, releaseYear, providers, genreIds,
}: QuickAddButtonProps) {
  const { uid, loading: authLoading } = useAuth();
  const router = useRouter();
  // BIN-645: keyed on `uid` (the auth verdict), never on the Firestore profile.
  // AuthContext deliberately KEEPS uid when a profile read fails, so `!user`
  // would read as "signed out" forever for that user — handing them a login
  // round trip on every tap.
  const signedOut = !authLoading && uid == null;
  const { getItem, addItem, removeItem } = useWatchlist();
  const markSeen = useMarkSeen();
  const { show: toast } = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = getItem(mediaType, tmdbId);
  const options = statusOptionsFor(mediaType);
  const labelFor = (s: WatchStatus) => statusLabel(s, mediaType);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close);

  async function handleSelect(status: WatchStatus) {
    setOpen(false);
    // 'sedd' (film: terminal · TV: "alla avsnitt sedda" → 'mina') går via den
    // delade markSeen-vägen, som även nudgar ett betyg om titeln saknar ett.
    if (status === 'sedd') {
      await markSeen({ tmdbId, mediaType, title, posterPath, releaseYear, providers, genreIds });
      return;
    }
    await addItem(buildWatchlistAddPayload({
      tmdbId, mediaType, status, title, posterPath, releaseYear,
      current, providers, genreIds,
    }));
    toast(`${title} — ${labelFor(status)}`);
  }

  function handleRemove() {
    setOpen(false);
    // Serie med påbörjad historik: per-avsnitt-historiken sparas medvetet
    // (återtillägg återupptar där man var) — säg det och erbjud full
    // rensning. Se clearEpisodeProgress + docs/data-retention-policy.md.
    const ownerUid = uid;
    const hadProgress =
      mediaType === 'tv' && ownerUid != null && current?.lastWatchedSeason != null;
    void removeItem(mediaType, tmdbId);
    if (hadProgress && ownerUid) {
      toast(`${title} borttagen. Avsnittshistoriken sparas.`, {
        label: 'Rensa helt',
        onClick: () => {
          void clearEpisodeProgress(ownerUid, tmdbId)
            .then(() => toast('Historiken rensad.'))
            .catch(() => toast('Kunde inte rensa historiken. Försök igen om en stund.'));
        },
      });
    } else {
      toast(`${title} borttagen`);
    }
  }

  return (
    <div
      ref={ref}
      className="relative"
      onClick={e => { e.preventDefault(); e.stopPropagation(); }}
    >
      <button
        onClick={async () => {
          // BIN-645: go to /login rather than calling signIn() here. A
          // first-time Google sign-in CREATES the account, and account creation
          // stamps termsAcceptedAt + ageConfirmedAt (13+). The villkor link and
          // the 13-års-notisen live on the login page; a grid of posters shows
          // neither, so signing in from here recorded a consent we never asked
          // for. `next` carries them back to this page afterwards.
          if (signedOut) {
            // Remembered in sessionStorage, not a ?next= param — see nextPath.ts:
            // the query would ride along to Firebase's Google-hosted auth handler.
            //
            // location, not usePathname(): this badge renders on /search, whose
            // whole state is the ?q= query. usePathname() drops it, so a
            // signed-out tap there would return the visitor to an empty search.
            // Safe to read here — this runs in a click handler, never in render.
            rememberNextPath(window.location.pathname + window.location.search);
            router.push('/login/');
            return;
          }
          // Belt-and-braces behind the disabled attribute below: we do not yet
          // know whether this visitor is signed in, so there is no honest
          // destination — neither the menu nor a trip to /login.
          if (authLoading) return;
          setOpen(!open);
        }}
        // Disabled while auth is unresolved rather than swallowing the tap: a
        // click that does nothing at all reads as a broken button. This is the
        // NARROW gate — only the auth verdict. Gating on the watchlist snapshot
        // as well is BIN-596, deliberately not in this change.
        disabled={authLoading}
        className={`w-[28px] h-[28px] md:w-[22px] md:h-[22px] rounded-sm flex items-center justify-center border-none cursor-pointer disabled:opacity-50 disabled:cursor-default ${
          current
            ? 'bg-acc-deep text-white'
            : 'bg-black/60 text-white hover:bg-acc-deep'
        }`}
        title={authLoading ? 'Laddar…' : current ? labelFor(current.status) : 'Lägg till'}
      >
        {current ? <Check size={13} /> : <Plus size={13} />}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 bg-surface border border-rule rounded-sm z-50 min-w-[110px] shadow-pop">
          {options.map(status => (
            <button
              key={status}
              onClick={() => handleSelect(status)}
              className={`block w-full text-left px-2 py-[4px] text-xs font-[inherit] border-none cursor-pointer hover:bg-bg-2 ${
                current?.status === status ? 'text-acc-deep font-semibold' : 'text-ink'
              } bg-transparent`}
            >
              {statusMenuLabel(status, mediaType)}
            </button>
          ))}
          {current && (
            <>
              <div className="border-t border-rule-2" />
              <button
                onClick={handleRemove}
                className="block w-full text-left px-2 py-[4px] text-xs font-[inherit] border-none cursor-pointer hover:bg-bg-2 text-danger-ink bg-transparent"
              >
                Ta bort
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
