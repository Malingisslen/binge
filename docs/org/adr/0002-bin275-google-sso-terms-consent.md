# 0002. BIN-275 — recording terms acceptance for Google-SSO users

- **Date:** 2026-06-27
- **Status:** Parked (conditional block) · Escalated-to-human
- **Trigger:** `/sprint-execute` selected BIN-275 (record `termsAcceptedAt`/`termsVersion`
  on first Google sign-in, mirroring the email/password `register()` path). Routed
  `top` → blind panel before building.
- **Stakeholders (panel, blind):** Legal/GDPR Counsel #5 (high) · DBA/Data-layer #27 (high).

## Context
`ensureUserProfile` (`src/contexts/AuthContext.tsx`) writes a new `users/{uid}` doc on
first Google sign-in **without** terms-acceptance fields; only `register()` records them.
The proposed fix added `termsAcceptedAt: serverTimestamp()` + `termsVersion` to the
new-doc branch and extracted the version literal to a shared `src/lib/legal.ts`. On the
surface a clean Tier-A logic change.

## Conflict
- **#27 (DBA)** cleared the technical premise: the `users/{uid}` doc has **no `hasOnly`
  field whitelist** (unlike watchlist/episodeProgress/etc.), so writing the two new fields
  will **not** permission-deny — `register()` already proves it. Shape is consistent
  (`serverTimestamp()` → `Timestamp` → `.toDate()`), creation-only (no backfill) matches
  the lazy-migration discipline. **No rules change needed; no hard objection.** But #27
  flagged the consent-UX question upward as out of its lane.
- **#5 (Legal) — conditional block.** The Google sign-in button fires from *above* the
  "eller" divider; the terms link, the acceptance checkbox, and the 13-year age gate live
  only inside the `mode === 'register'` form branch and **never render for the Google
  path**. Writing `termsAcceptedAt` on that silent creation records a timestamp for a
  consent the user **was never shown** — *fabricated evidence*, which under GDPR Art. 7(1)
  is **worse than the current honest absence**. Legal's verdict: the code fix is necessary
  plumbing but **must not ship without a visible terms + 13+-age notice at the Google
  button** (browse-wrap), and the age gate is *also* bypassed on the Google path today.

## Decision
**Park BIN-275 in `In Review`; do not build this run.** Legal's condition converts the
ticket from a pure Tier-A logic change into one that **requires a user-visible UI
touchpoint** (a Swedish notice + live terms/integritet links + 13+ confirmation at the
Google entry point) — a **Tier-B** change that needs Malin's visual sign-off and is
explicitly out of bounds for autonomous auto-ship. Shipping the timestamp alone is
rejected because Legal calls it actively harmful.

- **Deciding tier:** **tier 2 (Legal/privacy) governs.** Per the rubric, tier-2 timing
  and consent-model calls go to the human.
- **No backfill** of existing Google accounts (backdating unevidenced consent is the same
  fabrication risk); the existing cohort is caught forward by the re-prompt-on-version
  flow that `termsVersion` enables.

## Consequences
- BIN-275 parked In Review with the full conditions written into the ticket + Malin
  notified. Nothing shipped.
- The **age-gate-bypass on Google sign-in** surfaced as a distinct, arguably larger
  compliance gap → filed as a follow-up.
- The review **advises only** — no code was written for BIN-275.

## Escalated to human (tier 2, Legal/privacy)
> **For Malin:** BIN-275 can't ship as a silent backend timestamp. To record Google-SSO
> consent defensibly we must *show* a line at the Google button — e.g. *"Genom att
> fortsätta godkänner du Binges [användarvillkor] och [integritetspolicy] och intygar att
> du är minst 13 år."* — with live links. Decide: (a) ship terms-capture + this notice
> together (recommended), and (b) whether to also enforce/record the 13-year age check on
> the Google path in the same change or as a fast-follow.

## Decided by
Stakeholder panel synthesis (autonomous, non-halt rule) for the park decision; **Human
owner (Malin)** for the consent-model + age-gate questions above.
