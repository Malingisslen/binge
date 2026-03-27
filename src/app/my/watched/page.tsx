'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';

export default function WatchedPage() {
  return <AuthGuard><WatchlistPage status="watched" title="Har sett" /></AuthGuard>;
}
