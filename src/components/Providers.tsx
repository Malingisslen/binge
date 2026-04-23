'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/contexts/AuthContext';
import { WatchlistProvider } from '@/contexts/WatchlistContext';
import { NotInterestedProvider } from '@/contexts/NotInterestedContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { createQueryClient } from '@/lib/queryClient';
import { useState, type ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());

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
