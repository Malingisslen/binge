'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function AvbrutnaPage() {
  usePageMeta({ title: 'Avbrutna' });
  return <AuthGuard><WatchlistPage status="avbruten" title="Avbrutna" /></AuthGuard>;
}
