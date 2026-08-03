'use client';

import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useState, useEffect, type ReactNode } from 'react';
import { LoadingView } from '@/components/ui/LoadingView';
import { clearNextPath, rememberNextPath } from '@/lib/nextPath';

export default function AuthGuard({ children }: { children: ReactNode }) {
  // Gatear på uid — inte user — eftersom profilen laddas parallellt med
  // auth-beskedet. Med user-gating skulle en inloggad användare redirectas
  // till /login under den RTT profilen tar att landa.
  const { uid, loading, isSigningOut } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!loading && !uid) {
      // BIN-669: the bounce IS the visitor's last intent, so it decides the
      // return path outright. Clear first, then write: `rememberNextPath`
      // silently declines a path it refuses (a sign-in route, an unsafe value),
      // and without the clear that refusal would leave an older tap's path
      // standing and land them somewhere they never asked for.
      //
      // Written through `rememberNextPath` rather than sessionStorage directly —
      // it owns the query allowlist and the sign-in-route guard, and a second
      // writer is exactly how `?invite=` would come back (see nextPath.ts).
      // Reading window.location, not usePathname(): views whose whole state is
      // the query (?status=, ?q=) come back empty otherwise.
      clearNextPath();
      // …but ONLY when they were turned away. `signOut()` does not navigate, so
      // this same effect fires on a deliberate sign-out with the departing
      // user's own page still mounted — remembering it would hand their private
      // URL to whoever signs in next on a shared device, and BIN-669 makes a
      // remembered path outlive onboarding. The clear above still runs either
      // way: leaving, if anything, invalidates an older intent too.
      if (!isSigningOut()) {
        rememberNextPath(window.location.pathname + window.location.search);
      }
      router.push('/login');
    }
  }, [uid, loading, router, isSigningOut]);

  if (!mounted || loading) {
    // X2/G6: designad loading-state — AuthGuard är första synliga tillstånd
    // på varje inloggad sida, så bar "Laddar…"-text syntes överallt.
    return <LoadingView label="Laddar…" />;
  }

  if (!uid) {
    return null;
  }

  return <>{children}</>;
}
