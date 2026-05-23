import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Mina listor',
  description: 'Ditt bibliotek — Följer, Vill se, Sedda och Avbrutna.',
  // Privata sidor — indexera inte.
  robots: { index: false, follow: false },
};

export default function MyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
