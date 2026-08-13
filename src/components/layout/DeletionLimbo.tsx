'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/layout/PageHeader';
import { classifyDeletionFailure } from '@/lib/authErrors';

/**
 * BIN-816 / ADR 0019 condition 4 — the screen a half-deleted account gets.
 *
 * The panel asked for "a real, persistent screen, not a self-dismissing toast",
 * on every load, reachable while the profile is null. Malin's answer of
 * 2026-08-13 (ADR 0020, question 3) went further: it has to *block*, not merely
 * explain. `firestore.rules`' `isOwner(uid)` never requires `users/{uid}` to
 * exist — it only checks that `request.auth.uid` matches the path — so a session
 * that survives a partial deletion can keep writing new watchlist items and
 * reviews, and the server sweep looks for accounts with no profile document and
 * therefore can never see what that session wrote. Every failed retry was a
 * chance for the data to grow rather than shrink.
 *
 * Replacing the whole shell is what makes the block real. Gating N write paths
 * would leave the N+1st, which is the same objection the panel raised against
 * per-call-site profile guards; if the app never renders a surface that writes,
 * there is no path to miss. The chokepoint in `userDocWrite.ts` stays as the
 * belt for the writes that run outside render (the auth listener, the projection
 * sync).
 *
 * Two ways out, and only two: finish the deletion, or sign out. There is
 * deliberately no "cancel" — by the time this screen exists the cascade has
 * already run, so the account it would restore no longer holds the data anyone
 * would want back.
 */
export function DeletionLimbo() {
  const { deleteAccount, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFinish = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      // `deleteAccount` returns early WITHOUT throwing when `auth.currentUser` is
      // null — a revoked token between render and click. That reads as success
      // here, and the screen would sit on "Slutför…" forever with no error and
      // no way out but a reload (integration review, 2026-08-13). On a real
      // success the provider unmounts this screen, so releasing the button is
      // harmless there and load-bearing here.
      setBusy(false);
    } catch (err: unknown) {
      // Same classifier as the settings page, deliberately — see authErrors.
      // The two screens say different things about the same four codes, but they
      // must never disagree about WHICH code they are looking at.
      const kind = classifyDeletionFailure(err instanceof Error ? err.message : '');
      setError(
        kind === 'preflight' || kind === 'recent-login'
          ? 'Sessionen är för gammal. Logga ut, logga in igen och tryck på Slutför raderingen.'
          : kind === 'partial'
            ? 'Raderingen kom en bit till men blev inte klar. Tryck på Slutför raderingen igen.'
            : 'Det gick inte just nu. Kontrollera anslutningen och försök igen.',
      );
      setBusy(false);
    }
  };

  return (
    <main id="main" tabIndex={-1} className="canvas outline-none">
      <div className="max-w-[46rem]">
        <PageHeader
          crumb="Konto"
          title="Din radering är påbörjad men inte klar"
          // Deliberately says "kan" and not "hann": this screen is also what a
          // user sees when the cascade failed on its very FIRST chunk, where
          // nothing was deleted at all (.claude/rules/accepted-deviations.md,
          // 2026-08-13). Claiming the data is gone would be the mirror image of
          // the lie BIN-876 was filed about, and DeletionLimbo.test.tsx pins
          // that this screen asserts neither extreme.
          standfirst="En del av din data kan redan vara borttagen, men själva kontot finns kvar. Tills raderingen är klar kan du inte spara något nytt här."
        />

        <p className="text-sm text-ink-2 mt-6">
          Det här är inte ett fel du behöver felsöka — det räcker att slutföra
          raderingen. Går den inte igenom kommer vi att städa bort kontot automatiskt.
        </p>

        {error && (
          <p role="alert" className="mt-4 rounded bg-danger-soft px-3 py-2 text-sm text-danger-ink">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={handleFinish}
            disabled={busy}
            className="btn btn-danger btn-sm disabled:opacity-50"
          >
            {busy ? 'Slutför…' : 'Slutför raderingen'}
          </button>
          <button onClick={() => void signOut()} className="btn btn-ghost btn-sm">
            Logga ut
          </button>
        </div>
      </div>
    </main>
  );
}
