'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useToast } from '@/contexts/ToastContext';
import { takePendingAdd } from '@/lib/pendingAdd';
import { buildWatchlistAddPayload } from '@/lib/watchlist/buildAddPayload';
import { statusLabel } from '@/lib/watchStatus';
import { isDeletionInProgressError } from '@/lib/deletionInProgressError';
import { pendingAddStatus } from '@/lib/pendingAdd.helpers';
import { captureError } from '@/lib/sentry';
import { existsOnServer } from '@/lib/firebase/pendingAddServerCheck';

/**
 * BIN-1442 — performs the "Lägg till" a signed-out visitor tapped, once they are
 * signed in (`useSignedOutRedirect` stored it). Mounted once, app-wide, so it runs
 * wherever sign-in lands them: back on the title page, or in onboarding for a new
 * account, where the title then already counts as their first.
 *
 * Waits for the same two answers every add surface waits for (BIN-596): a known
 * library, and a profile. A title already in the library — in the cache or on the
 * server — is left exactly as it is: the tap was "add", never "change status".
 */
export default function PendingAddRunner() {
  const { uid, user, loading: authLoading, profileLoading } = useAuth();
  const { getItem, upsertTitle, libraryKnown } = useWatchlist();
  const { show: toast } = useToast();
  const ranForUid = useRef<string | null>(null);

  useEffect(() => {
    // A sign-out in the same tab must let the next sign-in run again, even as the
    // same account — otherwise a tap made while signed out would never land.
    if (!authLoading && !uid) { ranForUid.current = null; return; }
    if (authLoading || profileLoading || !uid || !user || !libraryKnown) return;
    if (ranForUid.current === uid) return;
    ranForUid.current = uid;
    const pending = takePendingAdd();
    if (!pending) return;
    if (getItem(pending.mediaType, pending.tmdbId)) return;
    const status = pendingAddStatus(pending.mediaType);
    // The cache can be behind the server; see existsOnServer.
    void existsOnServer(uid, pending.mediaType, pending.tmdbId).then(onServer => {
      if (onServer === true) return undefined;
      return upsertTitle(buildWatchlistAddPayload({
        ...pending,
        status,
        // A genuine new add: explicit [] so the created doc satisfies WatchlistItem.
        providers: pending.providers ?? [],
        genreIds: pending.genreIds ?? [],
      })).then(() => true);
    }).then(
      added => { if (added) toast(`${pending.title} — ${statusLabel(status, pending.mediaType)}`); },
      (err: unknown) => {
        // Not retried — the title page's own button is the retry — but never
        // silent: the visitor tapped "Lägg till" and must not believe it landed.
        if (isDeletionInProgressError(err)) return;
        console.error('Pending add failed:', err);
        captureError(err, { scope: 'watchlist', kind: 'pendingAdd' });
        toast(`Kunde inte lägga till ${pending.title}. Försök igen från titelns sida.`);
      },
    );
  }, [authLoading, profileLoading, uid, user, libraryKnown, getItem, upsertTitle, toast]);

  return null;
}
