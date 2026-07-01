'use client';

import Link from 'next/link';
import DynamicRouter from '@/components/pages/DynamicRouter';

export default function NotFound() {
  return (
    <DynamicRouter
      fallback={
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
          <h1 className="text-[48px] font-extrabold text-acc-deep mb-1">404</h1>
          <p className="text-sm text-ink-2 mb-4">Sidan hittades inte.</p>
          <div className="flex gap-2">
            <Link href="/" className="px-3 py-[5px] bg-acc-deep text-white border-none rounded-sm text-xs font-semibold no-underline">
              Till startsidan
            </Link>
            <Link href="/discover/" className="px-3 py-[5px] bg-surface text-ink-2 border border-rule rounded-sm text-xs font-semibold no-underline">
              Utforska
            </Link>
          </div>
        </div>
      }
    />
  );
}
