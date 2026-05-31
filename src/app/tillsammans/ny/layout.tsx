import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tillsammans ikväll',
  robots: { index: false, follow: false },
};

export default function TillsammansNyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
