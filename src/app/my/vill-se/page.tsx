'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function VillSePage() {
  usePageMeta({ title: 'Vill se' });
  return <AuthGuard><WatchlistPage status="vill_se" title="Vill se" /></AuthGuard>;
}
