'use client';

import AuthGuard from '@/components/AuthGuard';
import DiaryPageClient from '@/components/watchlist/DiaryPageClient';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function DiaryPage() {
  usePageMeta({ title: 'Dagbok' });
  return <AuthGuard><DiaryPageClient /></AuthGuard>;
}
