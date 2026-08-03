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
import { LIBRARY_UNAVAILABLE } from './libraryHold';
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
  const { getItem, addItem, removeItem, listenerFailed, libraryKnown } = useWatchlist();
  // BIN-596: the OTHER half of the gate. `loading` from useWatchlist() cannot be
  // used here — it goes false both when the first snapshot lands and when the
  // listener dies, and a dead listener is not an empty library: writing then
  // makes every re-mark look like a genuine new add (no `watchedAt`, and BIN-601
  // has to suppress `addedAt` to avoid re-dating a years-old title). So we hold
  // the menu until the snapshot has actually settled, and keep holding it if the
  // listener failed. Signed-out is handled BEFORE this — that tap has an honest
  // destination (/login) and must stay tappable.
  //
  // `libraryKnown` comes FROM the context rather than being re-derived here:
  // every surface that re-derived it is a surface that could quietly get it
  // wrong, which is how the bulk-add in CollectionSection kept its `loading`
  // gate. `listenerFailed` is still read on its own — this button distinguishes
  // "died" (answers on tap) from "not settled yet" (stays silent).
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
    // BIN-596, belt-and-braces behind the disabled trigger: a menu opened before
    // the listener died must not write either. Placed ABOVE the toast on purpose
    // — a gate that blocks the write but still confirms it is worse than none.
    if (signedOut || authLoading || !libraryKnown) return;
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
    // Same gate, same reason: no delete, and therefore no "borttagen" toast.
    if (signedOut || authLoading || !libraryKnown) return;
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
          // BIN-596: a dead listener ANSWERS on tap. It is the only hold here
          // that never ends on its own, and `title=` never renders on touch —
          // so on a phone the disabled form is a control that stays silently
          // dead for the whole session. See libraryHold.ts.
          if (listenerFailed) { toast(LIBRARY_UNAVAILABLE); return; }
          // Signed in, first snapshot still in flight. Silent on purpose: it
          // resolves on its own, and opening the menu would offer writes we
          // cannot make correctly.
          if (!libraryKnown) return;
          setOpen(!open);
        }}
        // Disabled while the tap has no honest outcome rather than swallowing it:
        // a click that does nothing at all reads as a broken button. Two reasons
        // now — the auth verdict (BIN-645) and the watchlist snapshot (BIN-596).
        // A signed-OUT visitor is deliberately NOT disabled: their tap has a real
        // destination (/login), and they have no library to wait for. Neither is
        // a FAILED listener — that tap's outcome is the explanation itself.
        disabled={authLoading || (!signedOut && !libraryKnown && !listenerFailed)}
        className={`w-[28px] h-[28px] md:w-[22px] md:h-[22px] rounded-sm flex items-center justify-center border-none cursor-pointer disabled:opacity-50 disabled:cursor-default ${
          current
            ? 'bg-acc-deep text-white'
            : 'bg-black/60 text-white hover:bg-acc-deep'
        }`}
        title={
          authLoading ? 'Laddar…'
          : signedOut ? (current ? labelFor(current.status) : 'Lägg till')
          : listenerFailed ? LIBRARY_UNAVAILABLE
          // Ordered after listenerFailed, so this branch is "settled has not
          // happened yet" — the transient half of !libraryKnown.
          : !libraryKnown ? 'Laddar…'
          : current ? labelFor(current.status) : 'Lägg till'
        }
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
