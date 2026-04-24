import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Serier',
  description: 'Alla TV-serier du trackar — pågående, avslutade, kommande. Se var varje serie går att streama i Sverige.',
};

export default function SeriesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
