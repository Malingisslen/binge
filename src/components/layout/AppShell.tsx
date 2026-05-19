'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useFcmForeground } from '@/hooks/useFcmToken';
import AppTopbar from '@/components/layout/AppTopbar';
import Subnav from '@/components/layout/Subnav';
import MobileTabBar from '@/components/layout/MobileTabBar';
import Footer from '@/components/layout/Footer';
import DuotoneFilters from '@/components/ui/DuotoneFilters';
import { EmailVerificationBanner } from '@/components/layout/EmailVerificationBanner';

// Direction H "Schemat" chrome:
//   Topbar (brand · week strip · search · avatar) sits above every page.
//   Subnav below it (Hem · Bibliotek · Kalender · …).
//   MobileTabBar at the bottom on small screens — Sök is the center tab.
//   DuotoneFilters mounted once at the root so any <img> with
//   `filter: url(#duo-…)` picks up the SVG defs.

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useFcmForeground();

  const isLandingForGuest = mounted && !loading && !user && pathname === '/';

  if (isLandingForGuest) {
    return (
      <>
        <DuotoneFilters />
        <a href="#main" className="sr-only">Hoppa till innehåll</a>
        <main id="main">{children}</main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <DuotoneFilters />
      <a href="#main" className="sr-only">Hoppa till innehåll</a>
      <div className="app-shell">
        <AppTopbar />
        <Subnav />
        <EmailVerificationBanner />
        <main id="main" className="canvas">{children}</main>
        <Footer />
      </div>
      <MobileTabBar />
    </>
  );
}
