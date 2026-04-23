import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Community-riktlinjer',
  description: 'Riktlinjer för recensioner, kommentarer och social interaktion på Binge.nu.',
};

export default function CommunityGuidelinesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
