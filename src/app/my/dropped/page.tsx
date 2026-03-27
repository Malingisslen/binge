'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';

export default function DroppedPage() {
  return <AuthGuard><WatchlistPage status="dropped" title="Droppat" /></AuthGuard>;
}
