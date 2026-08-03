/**
 * BIN-596 — the copy and the rule for "we could not read your library".
 *
 * Shared by `StatusButton` and `QuickAddButton` so the two add-affordances on a
 * title page cannot word the same state differently (the drift class that
 * produced the BIN-645/668/669 lineage).
 *
 * The hold has two shapes and they are NOT interchangeable:
 *
 *  - Transient holds (auth unresolved, first snapshot still in flight) end on
 *    their own in well under a second. A `disabled` button with a `title=`
 *    tooltip is right for those — nobody is stuck.
 *  - A FAILED listener never ends on its own. `title=` does not render on touch
 *    and a `disabled` button fires no tap event, so on a phone that state is a
 *    grey control that does nothing, says nothing, and stays that way for the
 *    rest of the session — it reads as "the app is broken", not "reload".
 *
 * So the failed state stays TAPPABLE and explains itself on tap instead. The
 * write gates in `handleSelect` / `handleRemove` are what actually stop the
 * write; leaving the trigger tappable never re-opens that hole.
 */
export const LIBRARY_UNAVAILABLE = 'Kunde inte läsa ditt bibliotek — ladda om sidan';
