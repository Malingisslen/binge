'use client';

import { useEffect, useState } from 'react';

export interface SettingsNavItem {
  id: string;
  label: string;
  danger?: boolean;
}

/**
 * Sektionsmenyn på /settings. På bred skärm en klistrad spalt till vänster,
 * på smal en rullbar rad överst. Markerar sektionen som står överst i fönstret.
 */
export function SettingsNav({ items }: { items: readonly SettingsNavItem[] }) {
  const [current, setCurrent] = useState(items[0]?.id);

  useEffect(() => {
    const onScroll = () => {
      // Längst ned kan de sista sektionerna aldrig nå överkanten; då är det den sista som gäller.
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) { setCurrent(items[items.length - 1]?.id); return; }
      // Aktuell är den sista sektion vars överkant passerat strax under den klistrade toppraden.
      let next = items[0]?.id;
      for (const i of items) {
        const el = document.getElementById(i.id);
        if (el && el.getBoundingClientRect().top <= 140) next = i.id;
      }
      setCurrent(next);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [items]);

  return (
    <nav aria-label="Inställningar" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
      <ul className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible -mx-1 px-1 pb-1 lg:pb-0">
        {items.map(item => {
          const isCurrent = item.id === current;
          const tone = item.danger
            ? 'text-danger-ink'
            : isCurrent ? 'text-ink font-semibold' : 'text-ink-2';
          return (
            <li key={item.id} className="shrink-0">
              <a
                href={`#${item.id}`}
                aria-current={isCurrent ? 'location' : undefined}
                className={`block whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm hover:bg-bg-2 border lg:border-0 lg:border-l-2 lg:rounded-none ${isCurrent ? 'bg-bg-2 border-ink lg:border-ink' : 'border-rule lg:border-transparent'} ${tone}`}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
