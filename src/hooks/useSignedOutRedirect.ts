'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { rememberNextPath } from '@/lib/nextPath';

/**
 * BIN-714 — what a SIGNED-OUT tap on an add affordance does. Malin's decision,
 * 2026-08-03: send them to `/login` and bring them back, the same as the poster
 * badge already did, rather than showing a disabled button with an explanation.
 * One action should not behave two different ways in the same app.
 *
 * Callers — keep this list current, it is the only thing that makes the drift
 * visible:
 *   · `QuickAddButton`  — the badge on poster grids, where the rule was born
 *                         (BIN-645)
 *   · `StatusButton`    — the title page (BIN-714, Malin's decision)
 *   · `TopbarActions`   — the topbar "Logga in" (BIN-668)
 *   · `HomePageClient`  — the landing CTA
 *
 * NOT a caller, and should not become one: `AuthGuard`. A bounce is not a tap —
 * it must CLEAR first and must not remember at all during a deliberate sign-out
 * (BIN-669). Different rule, deliberately its own code.
 *
 * Why a hook rather than three inline copies: the rule has four separate pieces
 * that each have a reason, and every copy is a place one of them can go missing.
 * That is not hypothetical — BIN-645, BIN-668 and BIN-669 are all the same
 * lineage of "the same rule, worded slightly differently somewhere else".
 *
 *  1. `/login`, never `signIn()` inline. A first-time Google sign-in CREATES the
 *     account, and account creation stamps `termsAcceptedAt` + `ageConfirmedAt`
 *     (13+). The villkor link and the 13-års-notisen live on the login page; a
 *     grid of posters shows neither, so signing in from here recorded a consent
 *     the visitor was never shown.
 *  2. `sessionStorage`, never a `?next=` query param. The query would ride along
 *     to Firebase's Google-hosted auth handler, and would be attacker-supplied.
 *  3. Through `rememberNextPath`, never `sessionStorage.setItem` directly — it
 *     owns the query allowlist (`?invite=` joins a group on mount with no
 *     confirmation) and the sign-in-route guard. A second writer is exactly how
 *     `?invite=` comes back.
 *  4. `window.location`, not `usePathname()`. Some surfaces ARE their query —
 *     `/search?q=`, the library's `?status=` — and usePathname drops it, so the
 *     visitor would return to an empty search. Safe here because this only ever
 *     runs inside a click handler, never during render.
 *
 * Callers must invoke this BEFORE their library-readiness gates. A signed-out
 * visitor has no library and never will have one in this session, so those gates
 * are false forever for them — ordering this second is how the tap goes dead.
 */
export function useSignedOutRedirect(): () => void {
  const router = useRouter();
  return useCallback(() => {
    rememberNextPath(window.location.pathname + window.location.search);
    router.push('/login/');
  }, [router]);
}
