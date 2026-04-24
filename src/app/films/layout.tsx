import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Filmer',
  description: 'Alla filmer du trackar — trending, nya, kommande. Se var varje film går att streama i Sverige.',
};

export default function FilmsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
