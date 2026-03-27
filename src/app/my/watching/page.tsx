'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';

export default function WatchingPage() {
  return <AuthGuard><WatchlistPage status="watching" title="Tittar på" /></AuthGuard>;
}
