'use client';

import Link from 'next/link';
import DynamicRouter from '@/components/pages/DynamicRouter';
import { buttonClass } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <DynamicRouter
      fallback={
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
          <h1 className="text-6xl font-extrabold text-acc-deep mb-1">404</h1>
          <p className="text-sm text-ink-2 mb-4">Sidan hittades inte.</p>
          <div className="flex gap-2">
            <Link href="/" className={buttonClass({ variant: 'acc', size: 'sm', className: 'no-underline' })}>
              Till startsidan
            </Link>
            <Link href="/discover/" className={buttonClass({ variant: 'ghost', size: 'sm', className: 'no-underline' })}>
              Utforska
            </Link>
          </div>
        </div>
      }
    />
  );
}
