# 0021. BIN-813's preflight is hardened at the source; the rest is closed as already shipped

- **Date:** 2026-08-13
- **Status:** Accepted (Malin, 2026-08-13)
- **Trigger:** BIN-813 — "'Ingenting har raderats' kan bli falskt vid andra försöket".
  Fileset routed `tier: top`, `reasonCode: high-stakes` (hit on
  `src/contexts/AuthContext.tsx`). Convened after sprint 2026-08-13b pulled the ticket out
  of its build for lack of a panel.
- **Stakeholders (panel):** #5 Legal / GDPR Counsel (**block**), #27 Database Administrator
  / Data-layer Engineer (**block**), #19 Customer Support / Success (**block**), #4
  Security Architect (approve-with-conditions), #6 Data Protection Officer
  (approve-with-conditions), plus a blind Codebase Archaeologist pass. Router dropped #2
  Accessibility, #3 Financial Controller, #9 Product Manager, #10 Performance, #11
  Localization, #14 Software Architect, #15 Growth, #17 Content, #18 Community and #26
  Information Architect as incidental path matches.

Note for anyone reading the ticket's own history: the panel seated here is **not** the one
the sprint's report named (it claimed #20 Manual/Release QA and #14 Software Architect).
The router was re-run on the ticket's actual fileset at HEAD rather than inheriting a tier
or a roster from the sprint's plan text — the BIN-787/788 lesson — and it seats #4 and #6
instead. The verdicts above are from the roster the router actually returned.

## Context

BIN-813 was filed on 2026-08-07 as a known follow-up to BIN-796, at a time when the
`deletionMarker` / `DeletionLimbo` system did not exist. It asks for four things: (1) give
the deletion pre-check session memory of a prior attempt so it stops falsely promising
"Ingenting har raderats" on a retry; (2) evaluate the generic network-error branch for
large accounts; (3) extend `DeleteAccountSection.test.tsx` with the attempt-1 →
attempt-2-without-relogin sequence; (4) optionally add a persistent settings-page notice,
since the only trace today is a self-dismissing toast.

BIN-816/875/876 shipped and deployed on 2026-08-13 (`c233cbe`→`ccddcc6`), between the
ticket being written and this panel convening. All six seated critics independently reached
the same factual finding: `deleteAccount()` sets the marker *before* the cascade runs,
`AppShell` swaps the entire app for `DeletionLimbo` the moment `deletionInProgress` flips,
and `DeleteAccountSection` therefore unmounts before a second attempt can be clicked. The
live user-visible bug in ask (1) is unreachable. Ask (2) is `CASCADE_PARTIAL` (BIN-876),
already built and tested. Ask (4)'s premise is false — the durable trace is now a
full-screen non-dismissible limbo, not a toast. Ask (3) names the wrong file: the retry
button lives on `DeletionLimbo` now.

## Conflict

**Does a ticket whose user-visible symptom is gone still have work in it?**

#5 Legal, #27 DBA and #19 Support say no: close or rescope, and do not build a second
"remembers a prior attempt" mechanism next to the marker — `authErrors.ts`'s own docblock
already names two-copies-of-one-rule as this surface's live drift risk. Legal's stake is
that a competing memory mechanism is a second place the same Art. 12 statement can diverge.

#4 Security, #6 DPO and the Archaeologist say yes, narrowly: the pre-check inside
`deleteAccount()` (`src/contexts/AuthContext.tsx`) still decides purely on token age and
never calls `isDeletionStarted(uid)`. That `DeletionLimbo` renders the honest message is,
in the Archaeologist's words, accidental duplication rather than a guarantee — the next
caller added to this path inherits no protection. Security's stake is sharper still: if
someone later implements ask (1) as written, the natural-looking shortcut is to let the
remembered attempt *skip* the freshness gate, which would run the irreversible cascade on a
stale token every time.

This is a legal/privacy-interpretive disagreement with a `block` from a top-tier stake, so
the priority rubric does not resolve it. Escalated.

## Decision

Question put to Malin: the described bug is unreachable, but the pre-check itself is still
unaware of the marker and the correct message is a lucky side effect — close the ticket,
harden the source, or build it as written?

**Her answer (2026-08-13): harden the source, close the rest.** BIN-813 is rescoped to one
change — the pre-check in `deleteAccount()` reads `isDeletionStarted(uid)` itself, so the
honest message becomes guaranteed rather than incidental. Nothing changes for the user
today. Asks (1) as written, (2) and (4) are closed as already delivered by BIN-816/875/876.

## Consequences

Binding conditions on the rescoped build, from the panel:

1. The recent-login freshness check runs **unconditionally** before any Firestore read or
   write, on every call including a same-session retry. No code path may use the remembered
   attempt to skip or shorten it — it may only change which message is shown. Pin this as
   its own assertion: the gate still throws.
2. Any "prior attempt" signal reads the existing `isDeletionStarted(uid)` /
   `deletionMarker.ts`. Never a new field, never anything durable under `users/{uid}` —
   that is ADR 0019's decision and re-opening it recreates the document being erased.
3. `applyDeletionPlan`'s per-call `committedChunks` tagging is untouched; the deliberate
   "first chunk failure stays untagged" behaviour is pinned in test with a warning.
4. No fifth phrasing. The four `classifyDeletionFailure` strings and the limbo-screen text
   are locked and legal-approved.
5. Any attempt-1 → attempt-2 sequence test belongs in `DeletionLimbo.test.tsx`, not
   `DeleteAccountSection.test.tsx` — the latter component cannot be reached in that state,
   so a test placed there is green without covering anything.

Two findings outside this ticket's scope, filed on Malin's approval the same day:

- **BIN-877** (#19 Support) — neither the settings-page failure messages nor the limbo
  screen offer any route to a human. A user whose deletion is stuck has nowhere to go, and
  there is no support desk to catch them.
- **BIN-879** (#6 DPO) — `docs/data-retention-policy.md` flags its own open point: someone
  returning on a *different* device carries no marker and is not caught. ADR 0019 decided
  the marker stays device-local, so this ticket must not propose moving it to Firestore;
  it asks for either a mechanism that does not recreate the user document, or an explicit
  dated acceptance that replaces the doc's "open point" wording.

BIN-813 remains `tier: top` and still needs an attended session — not an unattended sprint.

## Decided by

Human owner (Malin), 2026-08-13. Escalated rather than resolved by rubric: a `block` from
#5 Legal on an interpretive privacy question.
