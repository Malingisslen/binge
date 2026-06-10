'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function FilmsPage() {
  usePageMeta({ title: 'Filmer' });
  return <AuthGuard><WatchlistPage status="sedd" title="Mina filmer" /></AuthGuard>;
}
