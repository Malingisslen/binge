import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kalibrera smak',
  description: 'Ranka genrer du gillar för att finjustera dina rekommendationer.',
  robots: { index: false, follow: false },
};

export default function KalibreraLayout({ children }: { children: React.ReactNode }) {
  return children;
}
