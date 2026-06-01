'use client';

import type { ReactNode } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';

export function NotFound({
  crumb, title, body, action,
}: {
  crumb?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div>
      <PageHeader crumb={crumb} title={title} standfirst={body} actions={action} />
    </div>
  );
}
