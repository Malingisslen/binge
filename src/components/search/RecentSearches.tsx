'use client';

import Link from 'next/link';
import { Clock, X } from 'lucide-react';
import { useRecentSearches } from '@/hooks/useRecentSearches';
import { eyebrowClass } from '@/components/ui/Eyebrow';
import { cardClass } from '@/components/ui/Card';

export default function RecentSearches({ onPick, popover }: { onPick?: () => void; popover?: boolean }) {
  const { searches, remove, clear } = useRecentSearches();
  if (searches.length === 0) return null;

  return (
    <section aria-label="Senaste sökningar" className={popover ? cardClass('shadow-pop max-h-[400px] overflow-y-auto') : undefined}>
      <div className="flex items-center justify-between px-3 pt-2 pb-0.5">
        <h2 className={eyebrowClass()}>Senaste sökningar</h2>
        <button type="button" onClick={clear} className="text-xs text-ink-3 hover:text-ink underline bg-transparent border-0 cursor-pointer">
          Rensa
        </button>
      </div>
      <ul className="list-none m-0 p-0">
        {searches.map(q => (
          <li key={q} className="flex items-center hover:bg-rule-2">
            <Link
              href={`/search/?q=${encodeURIComponent(q)}`}
              onClick={onPick}
              className="flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 text-sm text-ink-2 no-underline"
            >
              <Clock size={12} className="shrink-0 text-ink-3" aria-hidden="true" />
              <span className="truncate">{q}</span>
            </Link>
            <button
              type="button"
              onClick={() => remove(q)}
              aria-label={`Ta bort sökningen ${q}`}
              className="px-3 py-1.5 text-ink-3 hover:text-ink bg-transparent border-0 cursor-pointer"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
