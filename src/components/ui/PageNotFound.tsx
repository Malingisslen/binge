import Link from 'next/link';
import { buttonClass } from './Button';
import { fieldClass } from './Field';

const LINKS = [
  { href: '/', label: 'Hem' },
  { href: '/my/all/', label: 'Bibliotek' },
  { href: '/streamingpriser/', label: 'Streamingpriser' },
] as const;

// Same view for an unknown URL in the catch-all and for the static 404.html, so no
// hooks or client-only APIs: the search is a plain GET form that works before any
// JavaScript has loaded.
export function PageNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
      <h1 className="text-6xl font-extrabold text-acc-deep mb-1">Sidan finns inte</h1>
      <p className="text-sm text-ink-2 mb-4">Länken kan vara fel, eller så har sidan flyttat.</p>
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
      <nav aria-label="Genvägar" className="flex flex-wrap justify-center gap-2">
        {LINKS.map(l => (
          <Link key={l.href} href={l.href} className={buttonClass({ variant: 'ghost', size: 'sm', className: 'no-underline' })}>
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
