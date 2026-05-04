import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Community-riktlinjer',
  description: 'Riktlinjer för recensioner, kommentarer och social interaktion på Binge.nu.',
  alternates: { canonical: '/community-guidelines/' },
};

export default function CommunityGuidelinesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
