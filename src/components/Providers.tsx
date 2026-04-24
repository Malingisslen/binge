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

  // Initiera Sentry så tidigt som möjligt så att client-side errors fångas
  // innan resten av trädet mountar. initSentry är no-op om DSN saknas.
  useEffect(() => {
    initSentry();
  }, []);

  // Persister kan bara skapas i browsern (behöver localStorage). I build-
  // miljön faller vi tillbaka till QueryClientProvider utan persist så att
  // static export fungerar.
  const persister = typeof window !== 'undefined'
    ? createSyncStoragePersister({
        storage: window.localStorage,
        key: 'binge-rq-cache',
        throttleTime: 1000,
      })
    : null;

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
