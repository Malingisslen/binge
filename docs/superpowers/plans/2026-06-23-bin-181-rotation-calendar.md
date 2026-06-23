# BIN-181 — dated cancel/resubscribe calendar + realized-savings ledger

**Status:** Tier-A logic shipped — `src/lib/advisor/rotationCalendar.ts` (dated
cancel/resume events + projected savings) and `src/lib/advisor/savingsLedger.ts`
(year-to-date + per-provider rollup), both pure + fully tested. Remaining: hook wiring
(Tier-B), calendar UI (Tier-B, sign-off), FCM reminder function (Tier-D, deploy).

## The one sentence

Turn the advisor's nudge into an executed plan: *"Pausa Viaplay nu, återkom 12 aug när
nästa avsnitt kommer — spara ~158 kr"*, written into a personal rotation calendar with
FCM reminders on both ends, plus a running ledger ("Du har sparat 2 094 kr i år").

## Why only Binge

The dead-zone (nothing you follow airs on a service) is computed from air-date gaps of
*your* followed shows × *each* service. Letterboxd/Trakt can't — no costs, no per-show
provider join. Binge has TMDB last/next-episode × per-show provider = the exact join.

## What already exists (don't rebuild)

- `rotationPlan()` (BIN-92) — month-by-month "rotate one service" planner.
- `providerPauses` (inline on `users/{uid}`) + `resumeProvider()` (AuthContext) writing
  `users/{uid}/pauseHistory/{id}` with `savedAmount = round(cost * days / 30)`.
- `usePauseHistory()` — realtime ledger listener (`totalSaved`).
- `useAdvisorTimeline` / `useUpcomingShowsForAdvisor` — per-provider upcoming episodes
  (filtered to `kind==='episode'`), incl. `trailingQuietWeeks` (the dead-zone signal).
- `src/lib/renewal.ts` — `nextRenewalDate(billingDay, from)` (cancel-before-charge dating).
- **Shipped this run:** `buildRotationCalendar(states, { today })` → dated cancel/resume
  events + `projectedSavings`; `rollupSavingsLedger(entries, { today })` → `savedThisYear`
  + `byProvider` + `rotationCount` + `longestPauseDays`. Both deterministic, tested.

## Build sequence

### A. Hook: feed live advisor data → `buildRotationCalendar` (Tier-B)
- `useRotationCalendar()`: assemble `RotationProviderState[]` from the advisor —
  per subscribed provider: `monthlyCost` (providerCosts ?? default), `billingDay`
  (`providerRenewalDays[pid]`), `quietWeeks` (from `useUpcomingShowsForAdvisor`
  `trailingQuietWeeks` per provider), and `nextAiringDate` (earliest upcoming followed
  episode air date on that provider). Pass `today = new Date()`. Returns the calendar.
- `useSavingsLedger()`: map `usePauseHistory().history` → `LedgerInput[]` and call
  `rollupSavingsLedger` with `today = new Date()`. (The hook injects the clock; the lib
  stays pure.)

### B. Calendar + ledger UI (Tier-B, sign-off)
- On the Streamingrådgivaren page: a "Rotationskalender" block listing each entry as a
  dated cancel/resume pair card ("Pausa {shortName} {cancel.date} · Återkom {resume.date}
  · spara {projectedSavings} kr"), color-coded to the provider. Open pauses show
  "~{monthlyCost} kr/mån" instead of a total.
- A "Sparat hittills"-ledger: `savedThisYear` headline ("Du har sparat {x} kr i år genom
  rotation"), `byProvider` breakdown, `rotationCount`. Extends the existing pause-history
  sidebar block.
- Honest copy: "Binge kan inte säga upp åt dig — vi påminner, du klickar." No fake agency.
- Follow the canonical view recipe (PageHeader/EmptyState, design tokens, sv copy).
- A per-entry "Lägg till påminnelse" toggle that writes the user's opt-in (drives C).

### C. FCM reminders on both ends (Tier-D — deploy-gated)
- New scheduled function `rotationReminderNotify` in `functions/src/rotationReminder/`,
  mirroring `episodeReleaseNotify`:
  - `onSchedule('every 24 hours')`, region europe-west1, `secrets: [TMDB_API_KEY]`.
  - Read users who opted into rotation reminders + their `providerPauses` /
    confirmed rotation schedule. For each: if a cancel/resume date is within the next
    ~1 day, send via `sendPushToUser` ("Dags att pausa {service}" / "{service} är värt det
    igen — {title} är tillbaka").
  - Dedup marker collection `rotationReminderState/{uid}_{providerId}_{eventDate}`
    (at-most-once, advance regardless of FCM outcome — same contract as the others).
- **Persistence:** store the user-confirmed schedule + reminder opt-in as an inline
  field on `users/{uid}` (e.g. `rotationSchedule: { providerId, cancelDate, resumeDate,
  remind }[]`) — no `firestore.rules` change needed (owner-write covers user-doc fields).
  If a separate `rotationReminderState` top-level collection is added, add an admin-write
  rules stanza (manual rules deploy).
- Deploy: `export { rotationReminderNotify } from './rotationReminder'` in
  `functions/src/index.ts`; **manual `firebase deploy --only functions`** (not in deploy.yml).

## Acceptance criteria
1. `buildRotationCalendar` emits, for a 6-week dead-zone provider with a known billing day
   and a future air date, a cancel event on the next renewal and a resume on the air date,
   with prorated `projectedSavings`. ✅ (tested)
2. `rollupSavingsLedger` reports `savedThisYear` filtered by resume year + a per-provider
   breakdown sorted by saved desc. ✅ (tested)
3. (UI) The rådgivare shows dated pause/resume cards and a "sparat i år" headline.
4. (FCM) A reminder fires once per cancel and once per resume within ~24h of the date,
   never twice for the same event (dedup marker).
