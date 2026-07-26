# tasks/todo.md — scratch

## ACTIVE PLAN — BIN-595 only (BIN-596 split out after four review rounds)

Malin approved the queue **BIN-595 → BIN-599 → BIN-596 → source flag + BIN-597 → BIN-598**
and later approved "commit BIN-595 when review is clean, then stop". This plan is the
**reduced** scope after that stop condition failed four times; she approved the split.

### The defect (BIN-595, pre-existing, CONFIRMED)

`WatchlistContext.addItem` wrote the two denormalised visibility fields
(`effectiveVisibility` + the legacy `isPublic` mirror — never the per-item `visibility`
override itself, which only `updateVisibility` writes) unconditionally from the PROFILE-WIDE default. `addItem` is
also the re-mark path (StatusButton / QuickAddButton / useMarkSeen), so an ordinary status
change clobbered a per-title privacy override. The stored `visibility` field survived — the
payload omits it — but nothing reads it for access control: both `firestore.rules` and
`usePublicProfile` key on `effectiveVisibility`.

`addItem` was the worst offender. The six sibling mutators inline the same rule as
`current?.visibility == null`, which is ALSO true for `undefined` — so they stamp during a
cold load too. That is reachable (`SeasonPageClient`, the calendar's `EventCard`) and is
tracked in BIN-598.

### The fix, as it now stands

One pure helper in `src/lib/watchlistWrites.ts`:

```ts
export function shouldStampVisibility(
  current: { visibility: ItemVisibility | null } | undefined,
): boolean {
  return current?.visibility == null;
}
```

`addItem` spreads `effectiveVisibilityNow()` only when it returns true. That is deliberately
the SAME rule the siblings already inline — extracting it changes no behaviour for an
unloaded title; it gives the rule one name and one test so BIN-598 can tighten all seven
writers together once the per-title override actually ships.

### Why BIN-596 was split out — the decision this plan records

An earlier version of the helper ALSO refused to stamp during a cold load, to protect an
override that might not have loaded yet. That branch triggered a four-round cascade:

1. It caused a real product regression — a doc with NO `effectiveVisibility` is missing from
   the owner's own public profile, because `usePublicWatchlist`'s tier queries match that
   field by EQUALITY and Firestore equality never matches an absent field. For a PUBLIC
   default too, not just the 'friends' case the first comment described.
2. To close that window I pulled BIN-596 in — gating `StatusButton`/`QuickAddButton` on the
   snapshot. That required an `onSnapshot` error callback, because `loading` otherwise
   sticks true forever on a failed listen and every add control in the app would grey out.
3. The error callback then made a failed listener render as a **confidently empty library**:
   `items` stays `[]`, so a user with 300 titles sees an empty Bibliotek, and
   `CollectionSection`'s "Lägg till alla" reappears and can bulk-demote films already marked
   seen. I traded a stuck spinner for a lie with destructive buttons attached.
4. Round 4 also found the `!uid` guard made every logged-out click a silent dead click on the
   two highest-traffic SEO pages, and `QuickAddButton`'s gate keyed on the Firestore profile
   doc rather than auth, throwing signed-in users into a re-auth popup.

**The cold-load branch protected nothing.** The DPO established `updateVisibility` has zero
callers and never had one in any released version, so the override it guarded cannot exist.
Removing the branch removes the regression, which removes the need for BIN-596 here, which
removes the whole cascade.

BIN-596 is now its own ticket, to be done with the loading / failed / empty states designed
properly rather than bolted on. The abandoned implementation is not worth recovering as a
patch — its shape is what caused the cascade — but everything learned about WHY is written up
on BIN-596 itself, which is the durable record.

### Also reverted out of this commit

The `/feed` `Promise.allSettled` change and the extracted `collectSettledFeed` helper. Both
were sound in isolation and reviewed clean twice, but they are independent of BIN-595 and
round 4 raised a real open question about them (swallowing TRANSIENT failures past React
Query's retry). They belong in the same ticket as the rest of the feed work — BIN-600 already
covers that area.

### Acceptance

- Re-mark of an override'd item omits both fields; re-mark of a non-override'd item still stamps
  (the A4.3 lazy-on-write re-assert must not regress); a genuinely new title stamps.
- No behaviour change for a title not in the local snapshot — same as today.
- No `firestore.rules`, indexes or schema change.
- Mutation-verify each assertion.

### Panel (ran on the original, larger scope — conclusions still hold)

- **Software Architect (#14)** — no blocking. Endorsed a named helper over re-inlining.
- **DPO (#6)** — no remediation duty, no Art. 33/34 action: the per-title override has never
  been reachable, so the state this bug reverses could not be created. Verified independently
  and harder (`git log --all -S` over `src/components/ src/app/` is empty for
  `updateVisibility`, so no released version ever had a UI for it either).
