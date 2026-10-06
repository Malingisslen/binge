'use client';

import type { ReactNode } from 'react';
import { cardClass } from '@/components/ui/Card';

export function EmptyState({
  icon, title, body, action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={cardClass('px-4 py-8 text-center flex flex-col items-center gap-2')}>
      {icon && <div className="text-ink-3 mb-1" aria-hidden>{icon}</div>}
      <div className="text-md font-semibold text-ink">{title}</div>
      {body && <p className="text-sm text-ink-2 max-w-[42ch]">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
