'use client';

import DynamicRouter from '@/components/pages/DynamicRouter';

export default function CatchAllClient() {
  return (
    <DynamicRouter
      fallback={
        <div className="text-sm text-text-muted py-4">Sidan hittades inte.</div>
      }
    />
  );
}
