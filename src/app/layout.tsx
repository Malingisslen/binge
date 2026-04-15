import type { Metadata } from 'next';
import './globals.css';
import Providers from '@/components/Providers';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import MobileNav from '@/components/layout/MobileNav';

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
      <body className="flex min-h-screen" suppressHydrationWarning>
        <Providers>
          <div className="hidden md:block">
            <Sidebar />
          </div>
          <MobileNav />
          <div className="flex-1 overflow-y-auto">
            <TopBar />
            <main className="p-[14px_18px]">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
