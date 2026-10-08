import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Streamingpriser i Sverige',
  description:
    'Ordinarie månadspriser för svenska streamingtjänster, nivå för nivå, med datum för senaste kontroll och en logg över prisändringar.',
  alternates: { canonical: '/streamingpriser/' },
  // noindex tills Malin bekräftat att prisagenten är schemalagd (#26:s villkor 2):
  // en prissida som ingen håller färsk ska inte ranka. follow:true behåller
  // länkarna till kalkylatorn. Medvetet INGEN robots.txt Disallow — en blockerad
  // URL kan inte crawlas för att se detta direktiv (samma skäl som /savings/).
  robots: { index: false, follow: true },
};

export default function StreamingpriserLayout({ children }: { children: React.ReactNode }) {
  return children;
}
