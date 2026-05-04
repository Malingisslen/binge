import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Rekommendationer',
  description: 'Personliga film- och serierekommendationer baserat på vad du redan har sett, bland titlar tillgängliga i Sverige.',
  robots: { index: false, follow: false },
};

export default function RecommendationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
