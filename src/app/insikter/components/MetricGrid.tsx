import type { ReactNode } from 'react';

/** Responsive grid of MetricTiles. */
export function MetricGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
      {children}
    </div>
  );
}
