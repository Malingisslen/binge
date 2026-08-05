'use client';

import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { LoadingView } from '@/components/ui/LoadingView';
import { clearNextPath, rememberNextPath } from '@/lib/nextPath';
import { tabShowedSessionOn } from '@/lib/tabSession';

export default function AuthGuard({ children }: { children: ReactNode }) {
  // Gatear på uid — inte user — eftersom profilen laddas parallellt med
  // auth-beskedet. Med user-gating skulle en inloggad användare redirectas
  // till /login under den RTT profilen tar att landa.
  const { uid, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // BIN-732 — was this visitor ALREADY signed out when this guard first got an
  // auth verdict? That is the whole difference between the two ways `uid` can be
  // null here: they arrived at a guarded page without a session (a real bounce,
  // remember it), or a session they had just ended underneath them (a handover,
  // remember nothing). `null` = no verdict yet; `loading` is true until Firebase
  // has spoken, so the first non-loading pass is what sets it.
  //
  // This replaces BIN-669's `isSigningOut()` flag, which only knew about a
  // sign-out THIS tab asked for. Firebase broadcasts sign-out to every tab, so a
  // second tab parked on a guarded page had a false flag and stored the
  // departing user's page anyway. The mount-time verdict is per-tab-instance
  // and therefore right in all of them. It is also re-run-safe by construction
  // (a ref, written once), which the flag needed a whole doc-comment to argue.
  //
  // BIN-748 — a first verdict of `null` is still not proof of a bounce. This ref
  // is memory, and a tab that RE-BOOTS mid-sign-out has none: another tab ends
  // the session (or the token is revoked) and this tab reloads, or is opened
  // from the signed-in one, with the departing user's URL still in the address
  // bar. `tabShowedSessionOn()` is the part that survives that reload — it
  // answers whether THIS page is the one the departing session was on, so a
  // guard on any other page is still a real bounce and keeps its return path,
  // no matter which commit it mounts in (see lib/tabSession.ts).
  const signedOutAtFirstVerdict = useRef<boolean | null>(null);

  useEffect(() => {
    if (loading) return;
    if (signedOutAtFirstVerdict.current === null) {
      // window.location, not usePathname(): the same source the return path is
      // written from below, so the two can never disagree about which page this is.
      signedOutAtFirstVerdict.current = !uid && !tabShowedSessionOn(window.location.pathname);
    }
    if (!uid) {
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
      // …but ONLY when they were turned away. A session ending under a guarded
      // page — this tab's own `signOut()`, another tab's, an expired or revoked
      // token, or a session already gone when this tab booted onto that page
      // (BIN-748) — is a HANDOVER, not a bounce: remembering that page hands
      // the departing user's private URL to whoever signs in next on a shared
      // device, and a remembered path outlives onboarding (BIN-669), so a
      // brand-new account gets routed straight into it. `/grupper/<id>/` then
      // discloses the group's name and memberUids. The clear above still runs
      // either way: leaving, if anything, invalidates an older intent too.
      if (signedOutAtFirstVerdict.current) {
        rememberNextPath(window.location.pathname + window.location.search);
      }
      router.push('/login');
    }
  }, [uid, loading, router]);

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
