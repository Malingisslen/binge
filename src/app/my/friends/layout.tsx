import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vänner',
  description: 'Personer du följer och följare på Binge.',
  robots: { index: false, follow: false },
};

export default function FriendsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
