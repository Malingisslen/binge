'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';

export default function AllPage() {
  return <AuthGuard><WatchlistPage title="Hela samlingen" /></AuthGuard>;
}
