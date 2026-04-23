import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import Providers from '@/components/Providers';
import AppShell from '@/components/layout/AppShell';

export const metadata: Metadata = {
  title: 'Binge.nu — Håll koll på vad du tittar på',
  description: 'Svensk mediatracker för film och TV-serier. Se var titlar finns att streama i Sverige.',
  themeColor: '#1e2028',
  openGraph: {
    title: 'Binge.nu',
    description: 'Håll koll på vad du tittar på — se var film och serier finns att streama i Sverige.',
    siteName: 'Binge.nu',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sv" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://api.themoviedb.org" crossOrigin="" />
        <link rel="preconnect" href="https://image.tmdb.org" crossOrigin="" />
      </head>
      <body suppressHydrationWarning>
        {/* Plausible analytics: cookie-free + IP-anonymized by default,
            so no consent banner is required under LEK §6 kap 18§. Custom
            events fire via window.plausible(...) — see src/lib/analytics.ts. */}
        <Script
          defer
          strategy="afterInteractive"
          data-domain="binge.nu"
          src="https://plausible.io/js/script.js"
        />
        <Script id="plausible-shim" strategy="afterInteractive">
          {`window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)};`}
        </Script>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
