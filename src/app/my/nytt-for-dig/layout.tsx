import type { Metadata } from 'next';

// Egen dokumenttitel per biblioteksvy; robots ärvs från my/layout (noindex).
export const metadata: Metadata = {
  title: 'Nytt för dig',
};

export default function NyttForDigLayout({ children }: { children: React.ReactNode }) {
  return children;
}
