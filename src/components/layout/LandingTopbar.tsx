'use client';

import Link from 'next/link';
import BrandMark from '@/components/ui/BrandMark';
import { useSignedOutRedirect } from '@/hooks/useSignedOutRedirect';

/**
 * Toppraden på startsidan för gäster: logotyp och Logga in, inget sökfält.
 * Hjälten har redan ett sökfält, och tre sökfält på första mobilskärmen var
 * för många (Malins val 2026-10-09). Inloggningen går via /login av samma
 * skäl som i den vanliga toppraden (BIN-668).
 */
export default function LandingTopbar() {
  const goToLogin = useSignedOutRedirect();
  return (
    <header className="app-topbar" role="banner">
      <Link href="/" className="brand" aria-label="binge.nu">
        <BrandMark />
        binge.nu
      </Link>
      <div className="landing-topbar-actions">
        <button type="button" onClick={() => goToLogin()} className="topbar-signin-btn">
          Logga in
        </button>
      </div>
    </header>
  );
}
