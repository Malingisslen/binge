import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Logga in',
  description: 'Logga in på Binge.nu för att tracka vad du tittar på och se var titlarna finns att streama.',
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
