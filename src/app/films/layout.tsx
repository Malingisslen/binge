import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Filmer',
  description: 'Populära filmer just nu och var de går att streama i Sverige — Netflix, Max, Viaplay med flera. Spara det du vill se med Binge.',
  alternates: { canonical: '/films/' },
};

export default function FilmsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
