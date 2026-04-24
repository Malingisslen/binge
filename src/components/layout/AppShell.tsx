'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import MobileNav from '@/components/layout/MobileNav';
import Footer from '@/components/layout/Footer';
import { EmailVerificationBanner } from '@/components/layout/EmailVerificationBanner';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isLandingForGuest = mounted && !loading && !user && pathname === '/';

  if (isLandingForGuest) {
    return (
      <>
        <a href="#main" className="sr-only">Hoppa till innehåll</a>
        <main id="main">{children}</main>
        <Footer />
      </>
    );
  }

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only">Hoppa till innehåll</a>
      <div className="hidden md:block">
        <Sidebar />
      </div>
      <MobileNav />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar />
        <EmailVerificationBanner />
        <main id="main" className="p-[14px_18px] flex-1">{children}</main>
        <Footer />
      </div>
    </div>
  );
}
