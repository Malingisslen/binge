import type { Metadata } from 'next';
import './globals.css';
import Providers from '@/components/Providers';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import MobileNav from '@/components/layout/MobileNav';

export const metadata: Metadata = {
  title: 'Binge.nu — Håll koll på vad du tittar på',
  description: 'Svensk mediatracker för film och TV-serier. Se var titlar finns att streama i Sverige.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sv">
      <body className="flex min-h-screen">
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
