'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function FilmsPage() {
  usePageMeta({ title: 'Mina filmer' });
  return <AuthGuard><WatchlistPage status="sedd" title="Mina filmer" /></AuthGuard>;
}
