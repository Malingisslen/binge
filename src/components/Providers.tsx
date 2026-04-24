'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/contexts/AuthContext';
import { WatchlistProvider } from '@/contexts/WatchlistContext';
import { NotInterestedProvider } from '@/contexts/NotInterestedContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { createQueryClient } from '@/lib/queryClient';
import { initSentry } from '@/lib/sentry';
import { useState, useEffect, type ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());

  // Initiera Sentry så tidigt som möjligt så att client-side errors fångas
  // innan resten av trädet mountar. initSentry är no-op om DSN saknas.
  useEffect(() => {
    initSentry();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WatchlistProvider>
          <NotInterestedProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </NotInterestedProvider>
        </WatchlistProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
