import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Flöde',
  description: 'Se vad dina vänner tittar på, betygsätter och rekommenderar.',
  robots: { index: false, follow: false },
};

export default function FeedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
