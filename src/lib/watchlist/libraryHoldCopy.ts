/**
 * BIN-700/643/729 — ONE wording for "we cannot read your library right now",
 * shared by every surface that has to say it out loud.
 *
 * The three tickets are the same question asked from three sides (the library
 * view, the quick-rate modal / onboarding, the CSV importer), and the decision
 * they were waiting on is the honest-error shape: say what happened and offer a
 * retry, rather than retrying silently behind a view the visitor cannot read.
 * Three separately-worded answers to the same failure is how an app starts
 * behaving differently depending on where you happen to be standing, so the
 * copy lives here and the surfaces only choose their layout.
 *
 * Sibling, deliberately NOT merged: `src/components/title/libraryHold.ts`. That
 * one is the TAP-time wording for the two title-page add buttons, which stay
 * tappable and explain themselves on tap because a disabled control with a
 * `title=` tooltip says nothing at all on a phone. Different moment, different
 * sentence — but if you change the story told here, read that file too.
 */

/** Heading for the failed state. Never says "tomt" — the titles are not gone. */
export const LIBRARY_UNREACHABLE_TITLE = 'Vi når inte ditt bibliotek just nu';

/**
 * The reassurance is load-bearing: BIN-700 exists because a user with 300
 * titles was shown an empty library, and the fear that the data is gone is the
 * actual damage. Say that it isn't, then say what to do.
 */
export const LIBRARY_UNREACHABLE_BODY =
  'Dina titlar finns kvar — det är kontakten till servern som brister. Kontrollera anslutningen och försök igen.';

export const LIBRARY_RETRY_LABEL = 'Försök igen';

/**
 * The TRANSIENT half of the same gate (first snapshot still in flight). Ends on
 * its own in well under a second, so it gets no retry button — offering one
 * would invite a tap that does nothing.
 */
export const LIBRARY_LOADING = 'Läser in ditt bibliotek…';

/**
 * Shown next to a held WRITE action (import, quick-rate, onboarding) so a
 * disabled button is never unexplained. The read-side (`WatchlistPage`) uses the
 * title/body pair above instead — it has a whole page to fill, not a button.
 */
export const LIBRARY_WRITE_HELD =
  'Vi väntar på ditt bibliotek innan vi sparar något — annars kan titlar du redan har skrivas över.';
