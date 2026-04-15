'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';

export default function WantToWatchPage() {
  return <AuthGuard><WatchlistPage status="vill_se" title="Vill se" /></AuthGuard>;
}
