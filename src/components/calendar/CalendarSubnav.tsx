'use client';

import Link from 'next/link';

// Flikrad mellan kalenderns två vyer. Riktiga <Link>:ar (inte state-tabbar) så
// URL:erna förblir delbara — samma mönster som LibrarySubnav på /my/*. Chip-
// etiketterna hålls korta ("Premiärer", inte "Premiärer & finaler" — den fulla
// titeln bor i sidans h1/crumb).
const VIEWS = [
  { key: 'week', label: 'Vecka', href: '/calendar/' },
  { key: 'premiarer', label: 'Premiärer', href: '/calendar/premiarer/' },
] as const;

export default function CalendarSubnav({ active }: { active: 'week' | 'premiarer' }) {
  return (
    <nav
      aria-label="Kalendervyer"
      style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}
    >
      {VIEWS.map(view => {
        const isActive = view.key === active;
        return (
          <Link
            key={view.href}
            href={view.href}
            aria-current={isActive ? 'page' : undefined}
            className={`chip no-underline${isActive ? ' is-on' : ''}`}
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}
