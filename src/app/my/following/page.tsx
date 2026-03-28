'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';

export default function FollowingPage() {
  return <AuthGuard><WatchlistPage status="följer" title="Följer" /></AuthGuard>;
}
