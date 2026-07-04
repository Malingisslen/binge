import type { Metadata } from 'next';

// Egen metadata + EXPLICIT noindex — sidan är personlig OCH delvis algoritmisk
// (upptäckts-sektionen), så den ska aldrig indexeras. Förlitar oss inte på arv
// från förälderns calendar/layout.
export const metadata: Metadata = {
  title: 'Premiärer & finaler',
  description: 'Kommande säsongspremiärer, säsongsfinaler och filmsläpp för dina serier — kvartalet framåt.',
  robots: { index: false, follow: false },
};

export default function PremiererLayout({ children }: { children: React.ReactNode }) {
  return children;
}
