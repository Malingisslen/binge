'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useFcmForeground } from '@/hooks/useFcmToken';
import { useTitleLinkPrefetch } from '@/hooks/useTitleLinkPrefetch';
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
  const { uid, loading } = useAuth();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useFcmForeground();
  useTitleLinkPrefetch();

  // Gatear på uid — inte user — så inloggade inte flashar guest-landing-
  // kromen under den RTT profilen tar att landa efter auth-beskedet.
  const isLandingForGuest = mounted && !loading && !uid && pathname === '/';

  if (isLandingForGuest) {
    return (
      <>
        <DuotoneFilters />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-pop"
        >
          Hoppa till innehåll
        </a>
        <main id="main" tabIndex={-1} className="outline-none">{children}</main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <DuotoneFilters />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-pop"
      >
        Hoppa till innehåll
      </a>
      <div className="app-shell">
        <AppTopbar />
        <Subnav />
        <EmailVerificationBanner />
        <main id="main" tabIndex={-1} className="canvas outline-none">{children}</main>
        <Footer />
      </div>
      <MobileTabBar />
    </>
  );
}
