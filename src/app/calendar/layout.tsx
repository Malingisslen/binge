import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kalender',
  description: 'Premiärer och nya avsnitt från dina serier — samlat i en svensk tidszon-kalender.',
};

export default function CalendarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
