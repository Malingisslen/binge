import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sök',
  description: 'Sök bland filmer och TV-serier. Se var varje titel går att streama i Sverige.',
  // Söksidor ska inte indexeras — query-strängar skapar oändliga URL:er.
  robots: { index: false, follow: true },
};

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
