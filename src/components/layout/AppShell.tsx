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
import { EmailVerificationBanner } from '@/components/layout/EmailVerificationBanner';
import { DeletionLimbo } from '@/components/layout/DeletionLimbo';
import { ReconsentGate } from '@/components/layout/ReconsentGate';
import { ShellChrome } from '@/components/layout/ShellChrome';

// Direction H "Schemat" chrome:
//   Topbar (brand · week strip · search · avatar) sits above every page.
//   Subnav below it (Hem · Bibliotek · Kalender · …).
//   MobileTabBar at the bottom on small screens — Sök is the center tab.
//   DuotoneFilters mounted once at the root so any <img> with
//   `filter: url(#duo-…)` picks up the SVG defs — it and the skip link are the
//   `ShellChrome` pair every branch below opens with (BIN-1033).

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { uid, loading, deletionInProgress, pendingReconsent } = useAuth();
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
        <ShellChrome />
        <div className="app-shell">
          <DeletionLimbo />
        </div>
      </>
    );
  }

  // BIN-909 — the third shell takeover, and the precedence between all three is written
  // out because it is now a real question rather than an obvious one (#14, #26).
  //
  // AFTER `deletionInProgress` on purpose: the two states describe the same story from
  // different devices, and they are not mutually exclusive by construction — one comes
  // from the localStorage marker, the other from a missing profile doc. When both are
  // true the deletion wins: finish the erasure that was already asked for before asking
  // anyone to consent to a profile that may not survive the next minute.
  //
  // AHEAD of `isLandingForGuest` for the same reason the deletion branch is: this user IS
  // signed in, so the branch below would otherwise hand them the whole app.
  //
  // The URL never changes here — no `router.push` — so whatever the visitor was heading
  // for is still where they are once the gate lifts. `nextPath` is deliberately not read
  // or written on this path (#26's condition 4).
  if (mounted && uid && pendingReconsent) {
    return (
      <>
        <ShellChrome />
        <div className="app-shell">
          <ReconsentGate />
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
        <ShellChrome />
        <main id="main" tabIndex={-1} className="outline-none">{children}</main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <ShellChrome />
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
