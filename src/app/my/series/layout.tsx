import type { Metadata } from 'next';

// X5/B16: varje biblioteksvy har en egen dokumenttitel — statisk metadata
// per segment så hård-laddningar får rätt <title> i HTML:en (klient-sidan
// speglas via usePageMeta i page.tsx). Robots ärvs från my/layout (noindex).
export const metadata: Metadata = {
  title: 'Följer',
};

export default function SeriesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
