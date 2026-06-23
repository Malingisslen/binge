import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Fråga Binge',
  description: 'Skriv vad du är sugen på i vanlig svenska — Binge tolkar och hittar titlar på dina tjänster.',
  // Search-like utility page — not for indexing.
  robots: { index: false, follow: true },
};

export default function AskLayout({ children }: { children: React.ReactNode }) {
  return children;
}
