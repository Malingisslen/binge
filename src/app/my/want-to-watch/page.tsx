'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';

export default function WantToWatchPage() {
  return <AuthGuard><WatchlistPage status="want_to_watch" title="Vill se" /></AuthGuard>;
}
