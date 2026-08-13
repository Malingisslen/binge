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
import { DeletionLimbo } from '@/components/layout/DeletionLimbo';

// Direction H "Schemat" chrome:
//   Topbar (brand · week strip · search · avatar) sits above every page.
//   Subnav below it (Hem · Bibliotek · Kalender · …).
//   MobileTabBar at the bottom on small screens — Sök is the center tab.
//   DuotoneFilters mounted once at the root so any <img> with
//   `filter: url(#duo-…)` picks up the SVG defs.

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { uid, loading, deletionInProgress } = useAuth();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useFcmForeground();
  useTitleLinkPrefetch();

  // BIN-816 / ADR 0020: an account whose deletion started and never finished
  // gets ONE screen and nothing else — no topbar, no subnav, no page. This is
  // most of where "blocked from writing" is enforced (Malin's call 2026-08-13):
  // a page that is never rendered cannot write, which is a guarantee that
  // gating individual write paths cannot give.
  //
  // Most, not all. `WatchlistProvider` and its siblings mount ABOVE this shell
  // (`Providers.tsx`) and stay mounted through the swap, and two of their
  // migration effects write `users/{uid}/watchlist*` off a snapshot with no user
  // action at all. Those read the marker themselves — see WatchlistContext.
  //
  // The flag is set when the marker is found at profile load, when an attempt in
  // THIS tab ends without success, and — via AuthContext's `storage` listener —
  // when another tab starts a deletion while this one is already open.
  //
  // Ahead of `isLandingForGuest` on purpose: a marked user IS signed in, so it
  // is the branch below that would otherwise render the whole app for them.
  // Gated on `mounted` like its neighbour, because the marker is localStorage
  // and reading it during SSR/hydration would mismatch.
  if (mounted && uid && deletionInProgress) {
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
          <DeletionLimbo />
        </div>
      </>
    );
  }

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
