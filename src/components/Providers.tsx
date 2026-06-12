'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { AuthProvider } from '@/contexts/AuthContext';
import { WatchlistProvider } from '@/contexts/WatchlistContext';
import { NotInterestedProvider } from '@/contexts/NotInterestedContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { createQueryClient } from '@/lib/queryClient';
import { initSentry } from '@/lib/sentry';
import { initAppCheck } from '@/lib/firebase/appCheck';
import { useState, useEffect, type ReactNode } from 'react';

/**
 * React Query-client persisteras till localStorage så att första laddning
 * efter en revisit är snabbare (TMDB-metadata, watchlist-cache, etc.) och
 * hela appen kan rendera något vettigt offline.
 *
 * maxAge: 24h — längre än vår längsta staleTime men kort nog att stale
 * data inte rider ut realla ändringar.
 * buster: git-SHA — invaliderar cache vid varje ny deploy så användare
 * inte ser data från en annan schema-version.
 */
const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());
  // Persister måste skapas i ett useEffect för att inte ge hydration-mismatch:
  // typeof window-checken gör server-tree QCP-only och klient-tree PQCP-only,
  // vilket React #418 fångar. Genom att starta som null på BÅDA sidor och
  // sedan sätta efter mount blir initial-hydration matchande och vi byter
  // till PQCP via vanlig state-uppdatering.
  const [persister, setPersister] = useState<ReturnType<typeof createSyncStoragePersister> | null>(null);

  // Initiera Sentry + App Check så tidigt som möjligt — men efter hydration.
  // Sentry: no-op om DSN saknas. App Check: no-op om site key saknas; måste
  // köras post-hydration eftersom ReCaptchaV3Provider:s placeholder-div
  // klubbas av React 19 om det skapas på module-load (se appCheck.ts).
  // Redundant säkring — AuthContext-effekten (barn, fyrar först) äger den
  // riktiga init-vägen och awaitar promisen innan onAuthStateChanged
  // subscribar; det här anropet är en idempotent backstop om AuthProvider
  // någonsin flyttas.
  useEffect(() => {
    initSentry();
    void initAppCheck();
    setPersister(createSyncStoragePersister({
      storage: window.localStorage,
      key: 'binge-rq-cache',
      throttleTime: 1000,
    }));
  }, []);

  const tree = (
    <AuthProvider>
      <WatchlistProvider>
        <NotInterestedProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </NotInterestedProvider>
      </WatchlistProvider>
    </AuthProvider>
  );

  if (!persister) {
    return <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>;
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE,
        buster: process.env.NEXT_PUBLIC_GIT_SHA ?? 'dev',
      }}
    >
      {tree}
    </PersistQueryClientProvider>
  );
}
