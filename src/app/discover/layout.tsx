import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Upptäck',
  description: 'Trending, populära och nyheter på Netflix, Viaplay, HBO Max, Disney+, SVT Play och fler svenska strömningstjänster.',
  alternates: { canonical: '/discover/' },
};

export default function DiscoverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
