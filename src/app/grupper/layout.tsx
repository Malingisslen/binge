import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Mina grupper',
  description: 'Gemensamma titlar och grupp-sessioner med vänner och familj.',
  robots: { index: false, follow: false },
};

export default function GruppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
