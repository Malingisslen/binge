'use client';

import { PersistQueryClientProvider, removeOldestQuery } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { WatchlistProvider } from '@/contexts/WatchlistContext';
import { NotInterestedProvider } from '@/contexts/NotInterestedContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { createQueryClient, shouldPersistQuery, PERSIST_MAX_AGE } from '@/lib/queryClient';
import { initSentry } from '@/lib/sentry';
import { initAppCheck } from '@/lib/firebase/appCheck';
import { useState, useEffect, type ReactNode } from 'react';

/**
 * React Query-cachen persisteras till localStorage så återbesök hydreras
 * från disk istället för ~200 nätverksanrop.
 *
 * - EN permanent PersistQueryClientProvider — den gamla swappen
 *   QueryClientProvider→PersistQueryClientProvider efter mount remountade
 *   hela appträdet (dubbla auth-subscriptions, all DOM byggdes om).
 *   Hydration-mismatch undviks genom att persister-objektet skapas med
 *   storage: undefined på server/build (no-op-persister) — samma
 *   komponenttyp på båda sidor, ingen DOM-skillnad.
 * - PQCP pausar query-fetching tills restore är klar (isRestoring), så
 *   cachen läses INNAN första fetch.
 * - dehydrateOptions whitelistar vad som persisteras (shouldPersistQuery)
 *   så 100 fulla TMDB-detaljsvar inte spränger ~5 MB-kvoten; retry:
 *   removeOldestQuery kastar äldsta querien vid quota-fel.
 * - maxAge/gcTime delar konstant (PERSIST_MAX_AGE) — se queryClient.ts.
 * - buster = git-SHA invaliderar cachen per deploy.
 */
export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());
  const [persister] = useState(() =>
    createSyncStoragePersister({
      storage: typeof window === 'undefined' ? undefined : window.localStorage,
      key: 'binge-rq-cache',
      // 3 s: sync-serialiseringen av hela cachen kördes tidigare ~1 ggr/s
      // under laddningsbursten — ren main-thread-jank.
      throttleTime: 3000,
      retry: removeOldestQuery,
    })
  );

  // Sentry + App Check init efter hydration. Sentry: no-op utan DSN.
  // App Check: AuthContext awaitar samma promise före auth-subscribe;
  // anropet här är bara en tidig kickoff. Båda lazy-laddar sina SDK:er.
  useEffect(() => {
    initSentry();
    void initAppCheck();
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE,
        buster: process.env.NEXT_PUBLIC_GIT_SHA ?? 'dev',
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
    >
      <ThemeProvider>
        <AuthProvider>
          <WatchlistProvider>
            <NotInterestedProvider>
              <ToastProvider>
                {children}
              </ToastProvider>
            </NotInterestedProvider>
          </WatchlistProvider>
        </AuthProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
