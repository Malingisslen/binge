import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Serier',
  description: 'Populära TV-serier just nu och var de går att streama i Sverige — Netflix, Max, Viaplay med flera. Följ dina serier med Binge.',
  alternates: { canonical: '/series/' },
};

export default function SeriesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
