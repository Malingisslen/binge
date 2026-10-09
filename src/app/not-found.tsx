'use client';

import Link from 'next/link';
import DynamicRouter from '@/components/pages/DynamicRouter';
import { buttonClass } from '@/components/ui/Button';
import { fieldClass } from '@/components/ui/Field';

export default function NotFound() {
  return (
    <DynamicRouter
      fallback={
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
          <h1 className="text-6xl font-extrabold text-acc-deep mb-1">404</h1>
          <p className="text-sm text-ink-2 mb-4">Sidan hittades inte. Sök efter filmen eller serien du letade efter.</p>
          {/* Ett vanligt formulär (GET till /search/) fungerar även innan sidans JavaScript laddats. */}
          <form action="/search/" method="get" className="flex gap-2 mb-4 w-full max-w-[360px]">
            <input
              type="search"
              name="q"
              aria-label="Sök film eller serie"
              placeholder="Sök film eller serie…"
              className={fieldClass({ className: 'flex-1 min-w-0' })}
            />
            <button type="submit" className={buttonClass({ variant: 'acc', size: 'sm' })}>Sök</button>
          </form>
          <div className="flex gap-2">
            <Link href="/" className={buttonClass({ variant: 'ghost', size: 'sm', className: 'no-underline' })}>
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
