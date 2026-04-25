'use client';

import AuthGuard from '@/components/AuthGuard';
import WatchlistPage from '@/components/WatchlistPage';

export default function FilmsPage() {
  return <AuthGuard><WatchlistPage status="sedd" title="Mina filmer" /></AuthGuard>;
}
