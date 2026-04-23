'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';

export default function AvbrutnaPage() {
  return <AuthGuard><WatchlistPage status="avbruten" title="Avbrutna" /></AuthGuard>;
}
