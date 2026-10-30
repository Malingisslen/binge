'use client';

import AuthGuard from '@/components/AuthGuard';
import ToWatchPage, { TO_WATCH_TITLE } from '@/components/watchlist/ToWatchPage';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function NyttForDigPage() {
  usePageMeta({ title: TO_WATCH_TITLE });
  return <AuthGuard><ToWatchPage /></AuthGuard>;
}
