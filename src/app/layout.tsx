import type { Metadata } from 'next';
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
      <body suppressHydrationWarning>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
