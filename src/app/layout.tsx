import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import Providers from '@/components/Providers';
import AppShell from '@/components/layout/AppShell';

const SITE_URL = 'https://binge.nu';
const OG_IMAGE = `${SITE_URL}/og-image.svg`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Binge.nu — Håll koll på vad du tittar på',
    template: '%s — Binge.nu',
  },
  description: 'Svensk mediatracker för film och TV-serier. Se var titlar finns att streama i Sverige.',
  themeColor: '#1e2028',
  // Förhindra FOUC + dubbelindexering mellan www/apex — hanteras via
  // Cloudflare-regler; här sätter vi bara canonical på rot-URL:en.
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Binge.nu',
    description: 'Håll koll på vad du tittar på — se var film och serier finns att streama i Sverige.',
    url: SITE_URL,
    siteName: 'Binge.nu',
    type: 'website',
    locale: 'sv_SE',
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'Binge.nu — håll koll på vad du tittar på',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Binge.nu',
    description: 'Håll koll på vad du tittar på — se var film och serier finns att streama i Sverige.',
    images: [OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    'max-image-preview': 'large',
    'max-snippet': -1,
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
