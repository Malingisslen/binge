'use client';

type Variant = 'inline' | 'detail' | 'grid';

export function LoadingView({
  label = 'Laddar…',
  variant = 'inline',
  rows = 6,
}: {
  label?: string;
  variant?: Variant;
  rows?: number;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {variant === 'inline' && (
        <div className="text-sm text-ink-3 py-4" aria-hidden>{label}</div>
      )}
      {variant === 'detail' && (
        <div className="animate-pulse py-2" aria-hidden>
          <div data-skeleton className="h-3 w-24 bg-rule-2 rounded-sm mb-3" />
          <div data-skeleton className="h-9 w-2/3 bg-rule-2 rounded-sm mb-2" />
          <div data-skeleton className="h-3 w-1/2 bg-rule-2 rounded-sm" />
        </div>
      )}
      {variant === 'grid' && (
        <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-[10px] md:gap-[7px] py-2 animate-pulse" aria-hidden>
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} data-skeleton className="poster bg-rule-2" />
          ))}
        </div>
      )}
    </div>
  );
}
