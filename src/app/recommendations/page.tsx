'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import RecommendationsHub from '@/components/recommendations/RecommendationsHub';
import RecommendationsExpanded from '@/components/recommendations/RecommendationsExpanded';

export default function RecommendationsPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<div className="text-sm text-text-muted">Laddar…</div>}>
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
