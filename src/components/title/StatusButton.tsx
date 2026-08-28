'use client';

import { useState, useRef, useCallback } from 'react';
import type { WatchStatus, MediaType } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useMarkSeen } from '@/hooks/useMarkSeen';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useToast } from '@/contexts/ToastContext';
import { statusLabel, statusMenuLabel, statusOptionsFor } from '@/lib/watchStatus';
import { clearEpisodeProgress } from '@/lib/firebase/episodeProgress';
import { buildWatchlistAddPayload } from '@/lib/watchlist/buildAddPayload';
import { rewatchFields } from '@/lib/watchlistWrites';
import { LIBRARY_UNAVAILABLE } from './libraryHold';
import { useSignedOutRedirect } from '@/hooks/useSignedOutRedirect';
import { DELETION_IN_PROGRESS_MESSAGE, isDeletionInProgressError } from '@/lib/deletionInProgressError';

interface StatusButtonProps {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  totalSeasons?: number | null;
  providers?: number[];
  /** BIN-814: the flatrate/free/ads subset, carried alongside `providers`. */
  subscriptionProviders?: number[];
  genreIds?: number[];
  tmdbStatus?: string | null;
}

export default function StatusButton({
  tmdbId,
  mediaType,
  title,
  posterPath,
  releaseYear,
  totalSeasons,
  providers,
  subscriptionProviders,
  genreIds,
  tmdbStatus,
}: StatusButtonProps) {
  const { uid, loading: authLoading } = useAuth();
  const { getItem, upsertTitle, removeItem, listenerFailed, libraryKnown } = useWatchlist();
  const markSeen = useMarkSeen();
  const goToLogin = useSignedOutRedirect();
  const { show: toast } = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = getItem(mediaType, tmdbId);
  // BIN-655: ask the helper the write asks, instead of re-deriving the rule in JSX.
  // The old inline `current?.status === 'sedd' && mediaType === 'movie'` was a THIRD
  // copy of a predicate that already has one home — and the film-only half was only
  // ever true by coincidence of the same fact rewatchFields encodes ('sedd' is the
  // terminal FILM status, so a TV write lands as 'mina' and can never be a rewatch).
  // Reading the render closure rather than the live ref is unchanged and still
  // deliberate: the worst case is a menu entry that shows and writes nothing, which
  // is the grading the reviewer gave it. `'mina'` is passed for TV precisely so this
  // predicate answers false there, exactly as the write would.
  const canRewatch = 'rewatchCount' in rewatchFields(
    mediaType === 'tv' ? 'mina' : 'sedd',
    current?.status,
    current?.rewatchCount,
  );
  // BIN-596 — hold every write until BOTH questions have real answers.
  //
  //  1. Auth, keyed on `uid` (the auth verdict), never on the Firestore profile:
  //     AuthContext deliberately KEEPS uid when a profile read fails, so `!user`
  //     would read as "signed out" forever for that visitor (BIN-645's bug).
  //  2. The watchlist snapshot — `snapshotSettled`, not `loading`. `loading` goes
  //     false in two very different states, and a dead listener is NOT an empty
  //     library: writing then makes a re-mark look like a genuine new add, which
  //     is how a "Sedd" tapped in the first second landed with no `watchedAt` at
  //     all (absent from Dagbok, Statistik and Streamingrådgivaren, with nothing
  //     to repair it later and no message telling the user).
  //
  // `listenerFailed` is held separately from `snapshotSettled` on purpose: both
  // hold the button, but only one of them ends on its own.
  const authKnown = !authLoading;
  const signedIn = authKnown && uid != null;
  // BIN-714 (Malin, 2026-08-03): a signed-out tap goes to /login and comes back,
  // exactly as QuickAddButton's has since BIN-645 — one action, one behaviour.
  // It is decided FIRST, above every library gate: they have no library and will
  // not get one this session, so those gates are false forever for them.
  const signedOut = authKnown && uid == null;
  // One expression, ordered from "we know least" to "we know most" — it decides
  // BOTH whether the button writes and what its tooltip says, so the two can
  // never disagree. `libraryKnown` comes from the context rather than being
  // recomposed here from its primitives: every surface that re-derived the rule
  // is a surface that could quietly get it wrong. `listenerFailed` is still read
  // on its own so this button can tell "died" (answers on tap) from "not settled
  // yet" (stays silent, it ends by itself).
  const holdReason = !authKnown ? 'Laddar…'
    : signedOut ? null
    : listenerFailed ? LIBRARY_UNAVAILABLE
    : !libraryKnown ? 'Laddar…'
    : null;
  // "May this button write?" — signed-out is deliberately NOT ready: their tap
  // has a destination, not a write.
  const ready = signedIn && holdReason == null;
  // BIN-596 — the one hold that never ends on its own, so it does not get the
  // disabled+tooltip treatment the transient ones get. See libraryHold.ts.
  const libraryDead = signedIn && listenerFailed;
  const options = statusOptionsFor(mediaType);
  const labelFor = (s: WatchStatus) => statusLabel(s, mediaType);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close);

  async function handleSelect(status: WatchStatus, countsAsViewing = false) {
    setOpen(false);
    // Belt-and-braces behind the disabled trigger below: the menu can only be
    // opened when `ready`, but a menu left open across a listener failure must
    // not write either. The toast lives BELOW this return on purpose — a gate
    // that stops the write but still says "The Matrix — Sedd" is worse than no
    // gate, because the user then has no reason to try again.
    if (!ready) return;
    // 'sedd' (film: terminal · TV: "alla avsnitt sedda" → 'mina') går via den
    // delade markSeen-vägen, som även nudgar ett betyg om titeln saknar ett.
    if (status === 'sedd') {
      await markSeen({
        tmdbId, mediaType, title, posterPath, releaseYear,
        totalSeasons, providers, subscriptionProviders, genreIds, tmdbStatus,
      }, { countsAsViewing });
      return;
    }
    // BIN-655: the BULK entry point. This branch is every status EXCEPT 'sedd'
    // (which returned above via markSeen), so it can never be a viewing.
    // BIN-1038, the same answer QuickAddButton gives: the refusal was silent, never false.
    // Only the refusal is caught; everything else propagates exactly as before.
    try {
      await upsertTitle(buildWatchlistAddPayload({
        tmdbId, mediaType, status, title, posterPath, releaseYear,
        current, providers, subscriptionProviders, genreIds, tmdbStatus,
        // Explicit null (not omitted): this surface owns the season count from
        // its own props, so an absent prop clears it rather than carrying over.
        totalSeasons: totalSeasons ?? null,
      }));
    } catch (err) {
      if (isDeletionInProgressError(err)) { toast(DELETION_IN_PROGRESS_MESSAGE); return; }
      throw err;
    }
    toast(`${title} — ${labelFor(status)}`);
  }

  function handleRemove() {
    setOpen(false);
    // Same gate, same reason as handleSelect: no write, and therefore no
    // "borttagen" toast about a removal that did not happen.
    if (!ready) return;
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
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          // BIN-714: first, and before every library gate — see the hook.
          if (signedOut) { goToLogin(); return; }
          // A dead listener answers on tap instead of going inert — the tooltip
          // below is hover-only, and this hold has no end. See libraryHold.ts.
          if (libraryDead) { toast(LIBRARY_UNAVAILABLE); return; }
          if (ready) setOpen(!open);
        }}
        // Visibly disabled, not inert: a button that swallows the tap reads as
        // broken. Two states are deliberately NOT disabled — a signed-out
        // visitor (their tap goes to /login) and a dead listener (their tap is
        // the explanation). Both would otherwise be controls that do nothing.
        disabled={!ready && !libraryDead && !signedOut}
        // No tooltip once there is nothing left to explain — the button's own
        // label already says what it does. For a signed-out visitor `holdReason`
        // is null AND `current` is null (the context clears `items` on a null
        // uid), so they get no tooltip either, which is right: theirs is a normal
        // tappable button now.
        title={holdReason ?? (current ? labelFor(current.status) : undefined)}
        className={`px-[10px] py-[3px] border rounded-sm text-xs font-[inherit] cursor-pointer font-semibold disabled:opacity-50 disabled:cursor-default ${
          current
            ? 'bg-acc-deep text-white border-acc-deep'
            : 'bg-acc-deep text-white border-acc-deep hover:bg-acc-deep/90'
        }`}
      >
        {current ? labelFor(current.status) : '+ Lägg till'}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-surface border border-rule rounded-sm z-40 min-w-[130px]">
          {options.map(status => (
            <button
              key={status}
              onClick={() => handleSelect(status)}
              className={`block w-full text-left px-3 py-[5px] text-xs font-[inherit] border-none cursor-pointer hover:bg-bg-2 ${
                current?.status === status ? 'text-acc-deep font-semibold' : 'text-ink'
              } bg-transparent`}
            >
              {statusMenuLabel(status, mediaType)}
            </button>
          ))}
          {/* BIN-641 — the ONLY thing that counts a rewatch. Deliberately not the
              'Sedd' option above: that renders highlighted when it is the current
              status, so tapping it is as likely to mean "confirm/dismiss" as
              "again" — and rewatchCount is editable nowhere. Film-only because
              'sedd' is the terminal FILM status (watchStatus.ts).

              QuickAddButton has the same menu and deliberately has NO such entry:
              its plain 'Sedd' behaves identically there, and BIN-645 is mid-flight
              in that file. Do not close the gap by copying this without saying so.
              Malin, 2026-07-31. */}
          {canRewatch && (
            <button
              onClick={() => handleSelect('sedd', true)}
              className="block w-full text-left px-3 py-[5px] text-xs font-[inherit] border-none cursor-pointer hover:bg-bg-2 text-ink bg-transparent"
            >
              Sedd igen
            </button>
          )}
          {current && (
            <>
              <div className="border-t border-rule-2" />
              <button
                onClick={handleRemove}
                className="block w-full text-left px-3 py-[5px] text-xs font-[inherit] border-none cursor-pointer hover:bg-bg-2 text-danger-ink bg-transparent"
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
