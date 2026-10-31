import type { Metadata } from 'next';

// Egen dokumenttitel; robots ärvs från my/layout (noindex).
export const metadata: Metadata = {
  title: 'Nya avsnitt',
};

export default function IgarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
