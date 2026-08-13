# Plan 2026-08-13 — aborted account deletion (BIN-816 + BIN-875 + BIN-876)

**One change, three tickets.** Malin's call 2026-08-13 (ADR 0020): they ship together or
not at all. Stakeholder panels are DONE — do not convene another:

- **ADR 0019** (Accepted 2026-08-11) — 9 binding conditions, BIN-816.
- **ADR 0020** (Accepted 2026-08-13) — 12 binding conditions, BIN-875 + BIN-876, plus her
  three answers: one change · the reaper also releases usernames · a marked session is
  **blocked from writing**, not merely told.

Read both before touching code. Every acceptance criterion below traces to a numbered
condition; nothing here is invented at build time.

---

## The defect, in one paragraph

`deleteAccount()` runs a Firestore cascade and *then* `deleteUser()`. Anything that kills
the second half — a stale token, a network drop — leaves an auth account alive with its
Firestore data gone. On the next page load `ensureUserProfile` finds no `users/{uid}`,
**recreates it**, and stamps `termsAcceptedAt`/`ageConfirmedAt` with today's date: the app
manufactures a consent record for someone who just asked to leave. Seven other
`merge:true` writers can resurrect the same document without a login at all. Separately,
the username reservation is resolved from the profile doc that the first attempt already
deleted, so a retry silently drops it and the handle is held forever.

## Shape of the fix

A uid-scoped, device-local marker set immediately before the cascade. While it is set:
nothing may write `users/{uid}` or `publicProfiles/{uid}`, the app renders a persistent
limbo screen instead of the normal shell (that is what makes "blocked" real rather than
narrated), and the only actions offered are *finish the deletion* and *sign out*. A daily
server sweep finishes what the device cannot: orphaned auth accounts and orphaned username
reservations, independent of whether the user ever returns.

---

## Files

**New**
- `src/lib/deletionMarker.ts` — pure localStorage marker (no Firebase import, per the
  test-extraction convention). ADR 0019 c6.
- `src/lib/deletionMarker.test.ts`
- `src/components/layout/DeletionLimbo.tsx` — the persistent screen. ADR 0019 c4.
  (In `layout/`, not `settings/`: it replaces the whole shell and its only consumer
  is `AppShell`.)
- `src/components/layout/DeletionLimbo.test.tsx`
- `src/lib/firebase/userDocWrite.ts` — the single chokepoint every `users/{uid}` merge
  write passes through. ADR 0019 c1.
- `src/lib/firebase/userDocWrite.test.ts`
- `src/lib/firebase/userDocWrite.chokepoint.test.ts` — the guard test (below).
- `functions/src/retentionCleanup/orphans.ts` + `orphans.test.ts` — pure predicates for the
  two new sweeps.

**Changed**
- `src/lib/authErrors.ts` — add `CASCADE_PARTIAL`. BIN-876.
- `src/lib/firebase/accountDeletion.ts` — username by uid-query; ownership re-check that
  SKIPS; phase-tagged failure. ADR 0020 c1–c3, c5, c9.
- `src/contexts/AuthContext.tsx` — marker set/clear; every profile writer routed through
  the chokepoint; `ensureUserProfile` refuses to resurrect; limbo state exposed.
- `src/components/onboarding/OnboardingFlow.tsx` — the eighth writer, through the chokepoint.
- `src/lib/firebase/username.ts` — `claimUsername`'s `users/{uid}` update through the
  chokepoint.
- `src/components/layout/AppShell.tsx` — render limbo instead of children when marked.
- `src/components/settings/DeleteAccountSection.tsx` — four honest messages; the retry
  action rides only on the branches that fire BEFORE the marker (ADR 0020 c6, as
  superseded in part by question 3's answer — see the note in the ADR).
- `src/components/settings/DeleteAccountSection.test.tsx` — revise the pinned assertion
  honestly, never loosen it. ADR 0020 c7.
- `functions/src/retentionCleanup/index.ts` — the two new sweeps. ADR 0019 c5b, ADR 0020 (Malin #2).
- `docs/data-retention-policy.md`, `docs/RUNBOOK.md`, `.claude/rules/accepted-deviations.md`.

---

## Screen sketch — DeletionLimbo (ADR 0019 c4)

Replaces the whole shell. No topbar, no subnav — there is nothing else to do here.

```
┌────────────────────────────────────────────────┐
│  binge                                         │
│                                                │
│  Din radering är påbörjad men inte klar        │  ← page-h1
│                                                │
│  En del av din data kan redan vara borttagen,  │
│  men själva kontot finns kvar. Tills            │
│  raderingen är klar kan du inte spara något    │
│  nytt här.                                     │
│                                                │
│  [ Slutför raderingen ]  [ Logga ut ]          │
│                                                │
│  Går det inte? Logga ut, logga in igen och     │
│  försök på nytt — sessionen måste vara färsk.  │
└────────────────────────────────────────────────┘
```

Tokens only, through `PageHeader` — nothing invented, per
`.claude/rules/design-system.md`. Not a new route, so no preview gate; reachable with a
null profile, which is the load-bearing part.

The wording says "kan redan vara borttagen", not "vi hann ta bort": this screen is also
what a user sees when the cascade failed on its very FIRST chunk, where nothing was
deleted at all. Claiming otherwise would be the mirror image of the lie BIN-876 was filed
about (`.claude/rules/accepted-deviations.md`, 2026-08-13).

---

## Work items

### 1 · The marker — `src/lib/deletionMarker.ts` (ADR 0019 c2, c6)
`binge:deletionStarted:<uid>` → `{ startedAt }`. Read **fresh** on every call, never
cached in a ref (BIN-592). Storage that throws answers "not marked" for the read — a
browser with no localStorage could not have stored one either, and a false *true* would
lock a user out of an account nothing ever tried to delete.
Exported key helper so the cascade's own localStorage sweep can exclude it (c6).

### 2 · The chokepoint — `src/lib/firebase/userDocWrite.ts` (ADR 0019 c1)
`mergeUserDoc(uid, data)` — the only sanctioned way to `setDoc(users/{uid}, …, {merge:true})`.
Throws `DELETION_IN_PROGRESS` when marked. `assertProfileWritable(uid)` is the same check
exposed for the two call sites that must build their own batch (`resumeProvider`,
`claimUsername`).
**Guard test:** scan `AuthContext.tsx`, `OnboardingFlow.tsx`, `username.ts`,
`publicProfile.ts` for `doc(db, 'users'`/`'publicProfiles'` write forms and fail if any
occurrence is not inside the chokepoint module. This is what stops the ninth writer from
reopening the hole — the panel's actual objection to per-call-site patching.

### 3 · Refuse the resurrection — `ensureUserProfile` (BIN-816 AC1, AC2, AC3)
Marked uid → return `{ profile: null, deletionInProgress: true }`. No `runTransaction`
create, no `tryAutoClaimUsername`, and the `syncMyPublicProfile` effect is skipped so
`publicProfiles/{uid}` is not rebuilt either.

### 4 · Set the marker at the right instant (ADR 0019 c2, c3)
In `deleteAccount()`, **after** the freshness preflight throws-or-passes and immediately
before `collectUserDataSnapshots`. `STALE_SESSION_PREFLIGHT` must remain a true no-op.
`deleteAccount()` itself and its retry are **never** gated on the marker (c3) — the marker
gates *profile writes*, and `deleteAccount` writes none. Cleared only after `deleteUser()`
resolves. There is deliberately no "cancel" — recorded as a conscious deviation (c8).

### 5 · Finish it on return (ADR 0019 c5)
`DeletionLimbo` calls `deleteAccount()` again. The cascade is idempotent by design and,
after item 6, actually is. A stale session surfaces the preflight message and the sign-in
route; a fresh one completes.

### 6 · The username survives the retry — BIN-875 (ADR 0020 c1–c3, c8)
`collectDeletionRefs` resolves the reservation by **querying `usernames` where `uid == id`**
— not the marker, not the profile doc, not React state. No rules change and no
`firestore.indexes.json` entry: `allow read: if true` covers `list`, and the default
single-field index serves the equality. Keep the delete adjacent to `users/{uid}` in the
same chunk (c3 — do NOT move it earlier). Include only reservations the query itself
returned, so a handle already reclaimed by someone else is skipped rather than throwing
and aborting the chunk (c2).
The profile-doc and React-state sources are REMOVED, not demoted: neither carries
ownership proof, so queuing a name from them could throw inside the atomic chunk and gate
the retry (ADR 0020 c2). A failed query queues nothing; the daily sweep covers it.

### 7 · Say what actually happened — BIN-876 (ADR 0020 c5, c6)
`applyDeletionPlan` tracks whether any chunk committed and, on failure, rethrows tagged
`CASCADE_PARTIAL`. **In-memory for that call only** — no persisted cursor, no resumable
plan (ADR 0016, and this cascade's own "ask Firestore fresh every attempt" principle).
`DeleteAccountSection` grows a third branch with Support's two strings, adjusted to name
the limbo screen's "Slutför raderingen" — because answer 3 means this component is
unmounted by the time those branches fire, so its own retry button would be a no-op. The
nothing-touched branch, which fires before the marker, gains the action it lacks today.

### 8 · The server finishes what the device cannot (ADR 0019 c5b, Malin #2)
Two sweeps in `retentionCleanup`:
- **Orphaned auth accounts** — `listUsers()` paginated, `users/{uid}` checked via
  `getAll()`, deleted only when the account is **older than 7 days** and the read
  *succeeded* and returned absent. A failed read means "could not check", never "nothing
  there". 7 days is far beyond any transient profile-creation failure and well inside Art.
  12(3)'s one month.
- **Orphaned username reservations** — a `usernames/*` doc whose `uid` resolves to neither
  a live auth user nor a `users/{uid}` document. Same could-not-check guard.
Needs a manual `firebase deploy --only functions` — `deploy.yml` ships hosting only.

### 9 · Write it down (ADR 0019 c8–c9, ADR 0020 c10–c12)
- `docs/data-retention-policy.md` — the cross-device/private-window/cleared-storage gap;
  the orphaned-auth-account window; the orphaned-username window beside the existing
  "Användarnamn → Hård radering + release" section, which today states a guarantee this
  code path could break; the interrupted-mid-cascade state with retry as its resolution;
  and the `memberUids`/`editors` orphan-reference gap on other users' documents.
- `docs/RUNBOOK.md` — three-way console signature (untouched / partially cascaded / fully
  cascaded orphan) and the manual remedy for a squatted `usernames/{name}`.
- `.claude/rules/accepted-deviations.md` — the marker has no natural retirement (a
  conscious departure from BIN-748's lesson), and a first-chunk failure therefore parks a
  user with intact data in limbo until they retry.
- Rewrite the two comments that now describe behaviour the code does not have:
  `AuthContext.tsx` ~1059 (idempotency) and `accountDeletion.ts` 213–215 (per-chunk
  atomicity read as a whole-cascade guarantee). Same commit (ADR 0020 c9).

---

## Acceptance

- `users/{uid}` does not exist **at all** after a simulated re-login with the marker set —
  not merely that consent fields are unchanged (ADR 0019 c7). Every merge writer covered.
  `tryAutoClaimUsername` proven not to fire. `publicProfiles/{uid}` not rebuilt.
- A second deletion attempt after `users/{uid}` is already gone still releases the
  username, proven against partially-deleted data (ADR 0020 c8) — and the test drives the
  real path rather than hand-slicing the plan, or says plainly that it proves a backstop.
- An interruption between two chunks renders the "may be partial" message, not the
  "nothing happened" one and not silence (ADR 0020 c7).
- `deleteAccount()` and its retry are never blocked by the marker.
- `npm run typecheck`, `npm run lint`, `npm test` green; `npm run test:rules` green (needs
  Java/JBR on PATH).

## Not in scope

- Malin's one-time production check for already-orphaned `usernames/*` (Legal + DPO asked
  for it independently) — her Firebase Console, not a build task.
- BIN-813, which waits on this landing.
