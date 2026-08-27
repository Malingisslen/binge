'use client';

// BIN-909 — the screen a RETURNING user meets when their profile is gone.
//
// Why it exists: `ensureUserProfile`'s create branch used to re-create `users/{uid}` and
// stamp `termsAcceptedAt`/`ageConfirmedAt` with the server's now. After an aborted
// deletion "profile missing" is the intended end state, so that stamp was a consent
// record the app invented for someone who had just asked to leave. The gate replaces the
// stamp with a question.
//
// SHELL TAKEOVER, NOT A ROUTE (#26 Information Architect's call). A route would need the
// static-export catch-all dispatch plus a `firebase.json` rewrite — for a screen whose
// whole job is to be unlinkable. You must never be able to deep-link past unresolved
// consent. The cost is that a support reply has no URL to point at, which is exactly why
// the mail address below is on the screen instead.
//
// The copy is Malin's, approved 2026-08-27, with one change she made in the same breath:
// the first draft read "…så vi behöver skapa den på nytt". #19 Customer Support caught
// that `docs/voice-and-tone.md` rule 1 bans "vi" outside legal text. She struck it.

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/layout/PageHeader';
import { isDeletionInProgressError } from '@/lib/deletionInProgressError';

export function ReconsentGate() {
  const { completeReconsent, signOut } = useAuth();
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // #5 Legal, condition 2: two separate boxes, neither pre-checked, and the button stays
  // inert until BOTH are ticked. Age and terms are distinct facts with different legal
  // bases; one blanket checkbox is not specific consent to either. Mirrors the pair on
  // `src/app/login/page.tsx`, which is where a first-time user gives the same two.
  const ready = ageConfirmed && termsAccepted;

  async function onSubmit() {
    if (!ready || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await completeReconsent();
    } catch (err) {
      // Rule 6 in voice-and-tone: what happened + how to solve. Never the stack.
      //
      // BIN-1032, #19 Customer Support's blocking condition: the two failures need
      // different advice. A transaction that failed is worth retrying; a refused write is
      // not — the marker does not clear on its own, so "försök igen" sends someone into a
      // loop that fails identically every time, on a screen whose whole reason to exist is
      // that its visitor is already confused. `DELETION_IN_PROGRESS` exists as its own
      // code precisely so a caller can tell the two apart.
      //
      // The copy says only that a deletion is running, and says nothing about WHERE it was
      // started. An earlier draft said "från en annan enhet"; the marker is localStorage,
      // so this code can never observe another device — it can only observe a marker on
      // this one. It opens on the same sentence as `useMarkSeen`'s refusal and then parts
      // company deliberately — that screen offers no support address and this one does — so
      // do not consolidate the two: two screens that disagree about what a refused write
      // means teach the reader two things, but they are not the same screen.
      setError(
        isDeletionInProgressError(err)
          ? 'Kontot håller på att raderas. Profilen kan inte skapas nu. Hör av dig till hej@binge.nu om det inte var meningen.'
          : 'Profilen kunde inte skapas. Kontrollera anslutningen och försök igen.',
      );
      setSubmitting(false);
    }
  }

  // `tabIndex={-1}` + `outline-none` mirror `DeletionLimbo`: the skip link jumps to
  // `#main`, and without a programmatic focus target the jump moves the viewport but
  // leaves focus behind — so the next Tab lands back at the top of the page.
  return (
    <main id="main" tabIndex={-1} className="canvas outline-none">
      <PageHeader
        crumb="Ditt konto"
        title="Välkommen tillbaka"
        standfirst="Din profil är borta och behöver skapas på nytt. Det du sparat tidigare finns inte kvar."
      />

      {/*
        #19 Customer Support, condition 2: say plainly that this makes a NEW, empty
        profile rather than restoring anything. Someone who lands here is looking for
        their library; letting them click "Skapa profil" believing it brings the library
        back is how this screen generates the support mail the next paragraph invites.
      */}
      <p className="text-sm text-ink-2 mt-6">
        Att skapa profilen igen ger dig ett tomt konto. Det återställer inte listor,
        betyg eller anteckningar.
      </p>

      <p className="text-sm text-ink mt-6">Godkänn villkoren för att fortsätta.</p>

      {/*
        #2 Accessibility, condition 2: the two boxes gate ONE action, so they are a group
        with a name — not two independent optional fields. `login/page.tsx` wraps each in
        its own label and stops there; copying that forward would leave a screen-reader
        user with no idea the pair belongs together.
      */}
      <fieldset className="mt-3 border-0 p-0">
        <legend className="sr-only">Villkor</legend>

        <label className="flex items-start gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={ageConfirmed}
            onChange={(e) => setAgeConfirmed(e.target.checked)}
            className="mt-0.5"
          />
          <span>Jag är minst 13 år.</span>
        </label>

        <label className="mt-2 flex items-start gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Jag godkänner{' '}
            <Link href="/villkor" target="_blank" className="text-acc-deep underline">
              användarvillkoren
            </Link>
            .
          </span>
        </label>
      </fieldset>

      {/*
        #2 Accessibility, condition 3: a disabled button that says nothing is a dead end
        for anyone who cannot see which box is unticked. The helper text is visible AND
        wired with `aria-describedby`, so tabbing to the button explains itself.
      */}
      {!ready && (
        <p id="reconsent-hint" className="mt-4 text-sm text-ink-3">
          Kryssa i båda rutorna för att fortsätta.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!ready || submitting}
          aria-describedby={ready ? undefined : 'reconsent-hint'}
          className="btn-primary"
        >
          {submitting ? 'Skapar…' : 'Skapa profil'}
        </button>
        <button type="button" onClick={() => void signOut()} className="btn">
          Logga ut
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded bg-danger-soft px-3 py-2 text-sm text-danger-ink">
          {error}
        </p>
      )}

      {/*
        #19 Customer Support, condition 1 — BIN-877's precedent, applied to a sibling
        surface. `DeletionLimbo` carries this address for exactly this reason: a screen
        that replaces the whole app leaves the user no other page to reach support from.
        Someone here may believe this is a mistake and want to ask before they click a
        button that confirms the loss. The address is no new promise — the privacy policy
        already names it, and art. 12 puts the duty to answer on us.
      */}
      <p className="text-sm text-ink-2 mt-6">
        Hittade du hit av misstag? Mejla{' '}
        <a href="mailto:hej@binge.nu" className="text-acc-deep">hej@binge.nu</a>
        {' '}innan du skapar profilen.
      </p>
    </main>
  );
}
