import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Albert_Sans } from 'next/font/google';
import './globals.css';
import Providers from '@/components/Providers';
import AppShell from '@/components/layout/AppShell';

const SITE_URL = 'https://binge.nu';
// PNG, inte SVG: Twitter/X-card-validatorn och LinkedIn avvisar SVG og:image
// och renderar då ingen förhandsvisning alls (BIN-306). og-image.svg är kvar
// som källkonst; PNG:n rastreras från den (1200×630).
const OG_IMAGE = `${SITE_URL}/og-image.png`;

// Albert Sans är den enda typografin i designen. --mono-tokenen finns kvar i
// globals.css som alias mot --sans tills alla callsites är städade.
const albertSans = Albert_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

// Next 16: themeColor lives in viewport, not metadata. BIN-151: dark-aware —
// matchar sidans bg per tema (off-white ljust, varm nästan-svart mörkt) så
// browser-kromen inte lyser vit i mörkt läge.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#191712' },
    { media: '(prefers-color-scheme: light)', color: '#f9f7f1' },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Binge.nu — Håll koll på vad du tittar på',
    template: '%s — Binge.nu',
  },
  description: 'Håll koll på film och TV-serier och se var varje titel finns att streama i Sverige — Netflix, Viaplay, HBO Max, Disney+, SVT Play och fler tjänster.',
  // Defensiv default-canonical → undersidor som inte sätter egen alternates.canonical
  // får root som fallback. movie/[id]/tv/[id]/person/[id] skriver över med egen URL
  // i sina generateMetadata-hooks; här skyddar vi mot dubletter på catch-all-shellet
  // när Google indexerar /index.html som "/" + diverse query-param-varianter.
  alternates: { canonical: '/' },
  // BIN-68 — PWA: manifest + add-to-home. Den additiva, ofarliga halvan.
  // Offline-service-workern är medvetet INTE registrerad här: FCM-SW:en äger
  // redan scope '/', så en andra SW skulle ersätta den och slå sönder push —
  // den delen kräver att caching slås ihop i firebase-messaging-sw.js och
  // preview-testas (se BIN-68-kommentar). BIN-151: PNG-ikoner (192/512 + maskable
  // + apple-touch) genererade från brand-marken (saffran-ruta, "b") finns nu i
  // /public → appen är installerbar med riktig hemskärms-ikon.
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, title: 'Binge', statusBarStyle: 'default' },
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
    <html lang="sv" suppressHydrationWarning className={albertSans.variable}>
      <head>
        {/* TMDB-API:t fetch:as (CORS) → crossOrigin krävs för att socketen
            ska återanvändas. image.tmdb.org konsumeras av <img> (no-CORS) →
            INGEN crossOrigin, annars förvarmas fel socket-typ. Firebase-
            origins (CORS-fetch): auth-token-refresh + Firestore är inloggades
            första nätverkshopp — kall DNS+TLS kostar 100–300 ms på mobil. */}
        <link rel="preconnect" href="https://api.themoviedb.org" crossOrigin="" />
        <link rel="preconnect" href="https://image.tmdb.org" />
        <link rel="preconnect" href="https://identitytoolkit.googleapis.com" crossOrigin="" />
        <link rel="preconnect" href="https://securetoken.googleapis.com" crossOrigin="" />
        <link rel="preconnect" href="https://firestore.googleapis.com" crossOrigin="" />
        {/*
          Pre-hydration login-detect: sätter .returning-user på <html> innan
          body parsas, så CSS kan dölja LandingPage-flashen för återvändande
          inloggade användare. Klassiskt dark-mode-flash-prevention-mönster
          (Theme-UI, next-themes m.fl.) anpassat till login-state.

          Defensiv: try/catch runt localStorage eftersom tracking-prevention
          i Safari/Brave kan kasta. Misslyckad detection = anonym fallback,
          vilket är säkert (LandingPage syns som idag).

          AuthContext skriver/rensar binge:wasLoggedIn i onAuthStateChanged.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('binge:wasLoggedIn')==='1')document.documentElement.classList.add('returning-user')}catch(_){}`,
          }}
        />
        {/* BIN-67 — mörkt tema före paint. Static export → ingen server, så
            ett blockerande inline-script sätter data-theme innan första paint
            och eliminerar ljus-flash. Default 'system' följer OS-preferensen. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var m=localStorage.getItem('binge:theme')||'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches);if(d)document.documentElement.dataset.theme='dark'}catch(_){}`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'Binge.nu',
              url: SITE_URL,
              logo: OG_IMAGE,
              description: 'Svensk mediatracker för film och TV-serier.',
              areaServed: { '@type': 'Country', name: 'Sweden', sameAs: 'https://www.wikidata.org/wiki/Q34' },
              serviceType: ['Media Tracker', 'Streaming Aggregator', 'Watchlist Manager'],
              knowsAbout: [
                'Swedish streaming services', 'Netflix Sweden', 'Viaplay',
                'HBO Max Sweden', 'Disney Plus Sweden', 'SVT Play', 'TV4 Play',
                'C More', 'SkyShowtime', 'movie tracking', 'TV show tracking',
                'streaming subscription management', 'watchlist',
                'film och TV-serier i Sverige', 'var streamar jag',
              ],
            }),
          }}
        />

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
