'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';

export default function SeriesPage() {
  return <AuthGuard><WatchlistPage status="mina" title="Följer" /></AuthGuard>;
}
