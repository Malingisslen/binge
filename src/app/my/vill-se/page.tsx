'use client';

import AuthGuard from '@/components/AuthGuard';
import VillSePickerPage from '@/components/watchlist/VillSePickerPage';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function VillSePage() {
  usePageMeta({ title: 'Vill se' });
  return <AuthGuard><VillSePickerPage /></AuthGuard>;
}
