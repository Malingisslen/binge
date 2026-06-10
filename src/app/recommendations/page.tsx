'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import RecommendationsHub from '@/components/recommendations/RecommendationsHub';
import RecommendationsExpanded from '@/components/recommendations/RecommendationsExpanded';
import { LoadingView } from '@/components/ui/LoadingView';

export default function RecommendationsPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<LoadingView label="Laddar…" />}>
        <RecsRouter />
      </Suspense>
    </AuthGuard>
  );
}

function RecsRouter() {
  const params = useSearchParams();
  const row = params.get('row');
  return row ? <RecommendationsExpanded rowKeyParam={row} /> : <RecommendationsHub />;
}
