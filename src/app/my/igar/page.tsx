'use client';

import AuthGuard from '@/components/AuthGuard';
import EpisodeDigestPage, { EPISODE_DIGEST_TITLE } from '@/components/watchlist/EpisodeDigestPage';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function IgarPage() {
  usePageMeta({ title: EPISODE_DIGEST_TITLE });
  return <AuthGuard><EpisodeDigestPage /></AuthGuard>;
}
