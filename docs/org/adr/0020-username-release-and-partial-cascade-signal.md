# 0020. The username reservation is released by uid-query and by the reaper, not by the client's memory

- **Date:** 2026-08-13
- **Status:** Accepted (Malin, 2026-08-13 — all three escalated questions answered; see
  "Questions put to Malin" below)
- **Trigger:** BIN-875 (an aborted deletion can leave `usernames/{username}` orphaned
  forever) and BIN-876 (a mid-cascade network failure half-deletes the account and the UI
  says nothing happened). Fileset `src/lib/firebase/accountDeletion.ts`,
  `src/contexts/AuthContext.tsx`, `src/components/settings/DeleteAccountSection.tsx`;
  router returned `tier: top` (high-stakes hit on `AuthContext.tsx`).
- **Stakeholders (panel):** #5 Legal / GDPR Counsel (approve-with-conditions), #6 Data
  Protection Officer (approve-with-conditions), #4 Security Architect
  (approve-with-conditions), #27 Database Administrator / Data-layer Engineer
  (approve-with-conditions), #19 Customer Support / Success (approve-with-conditions),
  plus a blind Codebase Archaeologist pass. No role blocked. #18 Community Manager was
  seated by the router and dropped as an incidental path match — neither ticket touches a
  community surface; #19 Support was seated in its place as BIN-876's owning role.

## Context

Both tickets were filed *by* the 2026-08-12 blind panel on BIN-813, and both sit on the
same surface ADR 0019 already governs. Neither had been reviewed on its own. This panel was
convened to do that.

BIN-875 proposed three candidate fixes and deliberately left the choice to build time:
delete the reservation in the first chunk before the profile; query the `usernames`
collection by `uid`; or stash the name in ADR 0019's device-local marker at cascade start
and read it back on retry. BIN-876 left three design questions open in the same way.

The panel closed both sets. It also found two things neither ticket knew.

## Conflict

**1. Which source the username is recovered from.**

Legal (#5) asked for a fix that is *provably* retry-proof rather than merely likelier to
work, and proposed reusing ADR 0019's marker as the mechanism, on the grounds that the
repo should not grow a second ad-hoc recovery path.

The DBA (#27) and the Archaeologist, independently, showed the marker cannot carry it: it
is device-local by ADR 0019's own decision, and the population that retries days later on a
different device is exactly the population with no marker. The Archaeologist went further —
commit `e75a8dc` (2026-06-14) *already* fixed one iteration of this bug by adding the
profile-doc read as the primary source, and `src/test/rules/account-deletion.test.ts`
(lines 306–374) already pins that behaviour. The bug recurring means the profile-doc source
is also insufficient, not that the earlier fix was wrong. Worse, `ensureUserProfile` can
resurrect the profile between attempts, so on a retry both sources may be present and
*wrong* rather than null.

Security (#4) ruled out the third candidate on its own grounds. Today `users/{uid}` and
`usernames/{username}` are pushed adjacently at the tail of the same `refs` array
(`accountDeletion.ts:196–204`) and normally land in the same atomic chunk, so the repo has
effectively no window in which a name is free while the account still resolves. Moving the
reservation into an earlier phase deliberately reopens one. Reviews and comments store
`username` as a denormalised string at write time and it is never revalidated, so a second
account claiming the freed name inherits the same visible `@handle` on the first account's
historical content, with no reader-visible way to tell them apart.

The DBA also established that the surviving candidate costs nothing to enable:
`firestore.rules:498` grants `allow read: if true` across the `/usernames/{username}` block
(list as well as get), and `firestore.indexes.json` carries no `fieldOverrides` exemption on
`usernames.uid`, so Firestore's default single-field index already serves
`where('uid','==',id)`. Security confirmed this grants no new access — BIN-509's own rules
comment already documents uids as enumerable through the public `usernames` docs.

**2. Whether a client-side fix can work at all.**

The Archaeologist found a race the tickets do not mention. ADR 0019 condition 5b ships a
server-side reaper that deletes Firebase Auth accounts with no matching `users/{uid}`,
*independent of any client retry*. If the reaper fires before the user returns, there is no
second attempt left in which to release the username — and the reaper, per ADR 0019's own
text, does not touch the `usernames` collection. Any purely client-side fix to BIN-875 is
silently defeated the moment the reaper wins that race.

The DPO (#6) reached the same gap from the retention side: ADR 0019's cover is the pairing
of a documented window with a sweep that closes it, and that pairing does not exist for
this collection. Legal (#5) and Support (#19) each asked for a server-side sweep from their
own seat. Four roles, four routes, one conclusion.

**3. What the panel found that neither ticket contains.**

Security (#4): `isOwner(uid)` in `firestore.rules` never requires `users/{uid}` to exist —
it only checks that `request.auth.uid` matches the path. A session that survives a partial
deletion can therefore still *write new* owner-scoped documents (watchlist, reviews, lists),
and the reaper's precondition can never see them. Every failed retry is a chance to grow
orphaned data, not merely to fail to shrink it. This makes ADR 0019 condition 4 load-bearing
in a way it was not written to be: a persistent screen that only narrates the state does not
stop it.

Support (#19): the generic error branch in `DeleteAccountSection.tsx` has no retry action at
all — only `startedNotFinished` gets the "Försök igen" toast button (lines 53–57). A user
hit by a network drop mid-cascade sees a self-dismissing toast and has nothing to click.

DBA (#27): nothing sweeps stale `memberUids`/`editors` entries left pointing at a deleted
uid in *other users'* groups and lists if the cascade is interrupted during the
member/editor-leave phase (`accountDeletion.ts:226–239`). `reclaimOrphanFollows` covers
followers and friends only.

Archaeologist: `DeleteAccountSection.test.tsx` (lines 105–114) deliberately pins the generic
branch to the full message string for `auth/network-request-failed`, as mutant-swap
protection introduced by BIN-796. BIN-876 changes that branch's semantics, so the test must
be *revised honestly*, never loosened to a substring match.

## Decision

**Conflict 1 — resolved by evidence, not by tier.** The username is recovered by querying
`usernames` where `uid == <the deleting account>`. The marker is not the mechanism (it
cannot survive a cross-device retry, which is the case that matters); the profile document
is not the mechanism (already tried in `e75a8dc`, already recurring, and resurrectable);
reservation-first ordering is rejected outright on Security's impersonation ground. Legal's
underlying condition — one mechanism, provably retry-proof, not a second ad-hoc path — is
met by the surviving candidate rather than by its proposal.

**Conflict 2 — escalated.** Whether the reaper grows to release orphaned usernames is the
same shape of scope question Malin already answered once for ADR 0019, and it is hers.

**Conflict 3 — escalated in part.** Blocking writes from a half-deleted session is a real
product tradeoff (it refuses writes to someone whose connection merely dropped), so it goes
to Malin. The remaining findings are folded into the conditions below.

### Questions put to Malin — all three answered 2026-08-13

1. **Do BIN-816, BIN-875 and BIN-876 build as one change?** The panel's position is yes —
   every route through BIN-875's fix passes through BIN-816's reaper, BIN-876's legal
   framing depends on BIN-875 landing, and all three are symptoms of the same "aborted
   deletion" concept ADR 0019 designed and nothing has yet built.
   → **Malin: yes, one change.** The three tickets ship together or not at all.
2. **Does BIN-816's reaper also release orphaned username reservations?** Panel position:
   yes, on the same schedule and with the same "a zero-result read means *could not check*"
   guard ADR 0019 already put on it.
   → **Malin: yes.** ADR 0019 condition 5b grows: the reaper releases a
   `usernames/{username}` document whose `uid` resolves to neither a live auth user nor a
   `users/{uid}` document, under the same could-not-check guard. Its window belongs in
   `docs/data-retention-policy.md` beside the auth-account window.
3. **Should a marked, half-deleted session be blocked from writing new data**, or only be
   shown the persistent screen? Panel position: blocked, because a screen that only narrates
   lets each failed retry grow data the reaper cannot see.
   → **Malin: blocked.** ADR 0019 condition 4's persistent screen must actually prevent
   owner-scoped writes, not merely explain the state. The accepted cost is that a user whose
   connection merely dropped is temporarily unable to save anything until the deletion is
   retried or completed — that user is, by their own request, on the way out. This does not
   touch condition 3: `deleteAccount()` and its retry are never gated.

## Consequences

Binding conditions on any BIN-875 / BIN-876 build, folded from the panel's must-haves, and
in force regardless of how the three questions above are answered:

1. **Recover the username by uid-query.** No index or rules change is required. Do not
   reintroduce the marker or the profile document as the source of truth for which
   reservation to delete.
2. **Re-check ownership before including the reservation, and SKIP on mismatch — never
   throw.** If the name has since been reclaimed, `resource.data.uid` no longer matches and
   the delete is refused; because chunks are atomic, a thrown delete aborts the entire
   chunk and would gate the retry on a stale reference, contradicting ADR 0019 condition 3.
3. **Keep the release atomic with the profile delete.** Do not move it earlier. The current
   adjacency is what keeps the free-name-while-account-still-resolves window at effectively
   zero, and denormalised `@handle` strings on existing reviews and comments are never
   revalidated.
4. **Deletion stays bound to the deleting account's own `auth.uid` end to end.** No refactor
   may start trusting a client-supplied uid/username pair.
5. **Tag the cascade's own failures so the UI can tell the phases apart.** An error raised
   from inside `applyDeletionPlan` (i.e. after at least one chunk committed) must be
   distinguishable from one raised during `collectUserDataSnapshots` or the freshness
   preflight (pure reads, nothing touched). String-matching Firebase error codes — the
   trick the `REQUIRES_RECENT_LOGIN` branch uses — does not generalise to a plain network
   error. The signal must be in-memory for that call: **no persisted cursor or resumable
   plan**, per ADR 0016 and per this cascade's stated "ask Firestore fresh every attempt"
   principle.
6. **Two honest messages, both with a retry action.** Nothing-touched keeps a sentence that
   says so; partial-cascade must not imply nothing happened, and must gain the "Försök
   igen" button the generic branch lacks today. Support's candidate strings:

   **Superseded in part by question 3's answer, at build time (2026-08-13).** Blocking a
   marked session means `AppShell` replaces the settings page with the limbo screen, so a
   retry button on a branch that only fires AFTER the marker is a promise to a component
   that no longer exists. Those branches therefore carry no action and name the limbo
   screen's "Slutför raderingen" instead; the two branches that fire BEFORE the marker keep
   theirs. Recorded here so the reversal reads as what it is rather than as a regression
   against this condition.

   **Superseded in part again by BIN-925 (2026-08-19), on Malin's decision.** "Those
   branches name the limbo screen's button" is now true of `partial` only. The
   `recent-login` string renders in BOTH states — tagged, where the limbo screen owns the
   button, and untagged (BIN-813's second attempt), where the only visible control is the
   toast's own "Försök igen" — so no wording that names a button can be true in both. It
   therefore names none: *"Raderingen har påbörjats men inte slutförts. Logga in igen för
   att avsluta den."* `partial` is unaffected because `CASCADE_PARTIAL` is always re-wrapped
   in `DELETION_HANDED_OFF` before the classifier sees it, so that branch can never render
   untagged. #19 Customer Support and #5 Legal/GDPR ran blind and independently produced the
   same replacement. Note that ADR 0021 condition 4's "No fifth phrasing" still stands and
   is what ruled out splitting the string in two — the count is locked, the wording was not.
   - *"Kunde inte ta bort kontot. Ingenting har raderats. Kontrollera anslutningen och
     försök igen."*
   - *"Raderingen avbröts av ett anslutningsfel innan den hann bli klar. En del av din data
     kan redan vara borttagen. Tryck på Försök igen — resten av raderingen slutförs utan
     att skada det som redan tagits bort."*
7. **Revise `DeleteAccountSection.test.tsx`'s generic-branch pin, do not loosen it.** The
   full-string pinning is BIN-796's deliberate mutant-swap protection; a new branch needs
   the same treatment.
8. **Reproduce the real trigger before writing BIN-875's test.** The existing emulator test
   simulates the split by slicing the last ref off by hand and says so in its own comment.
   Either drive the failure through the real chunking path, or state plainly in the test
   that it proves a defensive backstop rather than the live trigger — a hand-crafted state
   the app cannot produce is not proof.
9. **Rewrite the two comments that now describe behaviour the code does not have:** the
   idempotency claim in `AuthContext.tsx` (~line 1059) and the per-chunk atomicity comment
   in `accountDeletion.ts` (lines 213–215), which reads as a whole-cascade guarantee. Same
   commit as the fix.
10. **Write down the limits.** `docs/data-retention-policy.md` gains an entry for the
    orphaned-username case beside its existing "Användarnamn → Hård radering + release"
    section — that section currently states a guarantee this code path can break — and an
    entry naming the interrupted-mid-cascade state with retry as its resolution. Both need
    a window and the sweep that closes it, matching the pairing ADR 0019 required.
11. **`docs/RUNBOOK.md` gains a three-way console signature**, widening ADR 0019 condition 9
    beyond the single case it names: (a) untouched account, (b) partially cascaded —
    `users/{uid}` present, some subcollections empty, (c) fully cascaded orphan —
    `users/{uid}` absent, auth account present. Plus a manual remedy for a squatted
    `usernames/{name}` doc: read its `uid`, confirm neither a live auth user nor a
    `users/{uid}` doc exists, then delete.
12. **BIN-876's written-down state must name the `memberUids`/`editors` orphan-reference gap**
    on other users' documents, not only what happened to the deleting user's own data.

### Follow-ups that are not code

- **A one-time production check**, asked for independently by Legal and the DPO: query for
  `usernames/*` documents whose `uid` resolves to no `users/{uid}` document. If BIN-875 has
  already fired in production, those need manual remediation, which a forward-looking code
  fix cannot reach. Admin-SDK query or Firebase Console; not a sprint task.
- The username sweep, if approved, rides on the `retentionCleanup` Cloud Function family and
  therefore needs a manual `firebase deploy --only functions` — `deploy.yml` ships hosting
  only.

This review advises. Nothing was built, committed or deployed.

## Decided by

Panel convened 2026-08-13 by Malin in an attended session, after the 2026-08-13 sprint
pulled both tickets out before build for want of exactly this review. Conflict 1 resolved by
the synthesizer on the panel's own evidence — three roles independently disqualified two of
the ticket's three candidates, and the DBA established the third needs no schema change.
Conflicts 2 and 3 escalated to **Malin** as scope and product decisions in the same class as
the two she answered for ADR 0019, and **answered by her the same session** — one bundled
change, the reaper grows to release usernames, and the marked session is blocked from
writing.
