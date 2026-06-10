'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function AllPage() {
  usePageMeta({ title: 'Allt' });
  return <AuthGuard><WatchlistPage title="Hela biblioteket" /></AuthGuard>;
}
