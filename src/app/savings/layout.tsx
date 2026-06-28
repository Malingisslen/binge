import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Streamingrådgivaren',
  description: 'Översikt över dina streamingtjänster. Se vad du kan pausa, kommande avsnitt per serie och hur mycket du sparar per månad.',
  alternates: { canonical: '/savings/' },
  // BIN-305: auth-gated yta — crawlers får bara en spinner. noindex håller den
  // ur indexet; follow:true behåller intern länk-equity (samma-domän-verktygs-
  // sida, ingen anledning att kapa länkgrafen). Medvetet INGEN robots.txt
  // Disallow: en blockerad URL kan inte crawlas för att se detta direktiv.
  robots: { index: false, follow: true },
};

export default function SavingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
