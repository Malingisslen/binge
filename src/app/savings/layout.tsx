import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Streamingrådgivaren',
  description: 'Översikt över dina streamingtjänster. Se vad du kan pausa, kommande avsnitt per serie och hur mycket du sparar per månad.',
  alternates: { canonical: '/savings/' },
};

export default function SavingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
