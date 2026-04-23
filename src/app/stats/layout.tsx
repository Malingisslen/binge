import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Statistik',
  description: 'Din tittar-statistik — timmar sedda, favoritgenrer, snittbetyg och mer.',
  robots: { index: false, follow: true },
};

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
