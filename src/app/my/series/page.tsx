'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function SeriesPage() {
  usePageMeta({ title: 'Följer' });
  return <AuthGuard><WatchlistPage status="mina" title="Följer" /></AuthGuard>;
}
