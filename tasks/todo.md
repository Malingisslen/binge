# BIN-360 — "släpps idag" FCM push on SE digital release date

**Status:** APPROVED by Malin 2026-07-11 ("build now"). Full plan + PE critique folded:
`~/.claude/plans/binge-bin360-release-push.md`. Domain: Cloud Functions + FCM (sensitive) →
binge-security-reviewer at commit gate. Deploy = Tier-D manual `firebase deploy --only functions`.

## Approach B (chosen): single-pass, structural dedup
Extend the live `availableNotify` scheduled job — it already scans watchlist for `vill_se ∪ mina`:
1. **Release phase first** — for `vill_se` MOVIES in that scan, fetch SE type-4 digital date; if == today
   (Europe/Stockholm), write a "släpps idag" inbox card per owner (uses each owner's OWN title) and push
   it to those with `pushEnabled` (the Bevaka-släpp tap is consent, no new toggle; the card itself is
   pushEnabled-independent like episodeNotify). At-most-once is **per-user**, keyed on the release inbox
   doc's existence (no per-title marker — so a mid-day bevakare is still caught next run). Owners fanned out
   with Promise.allSettled. Collect the notified `(uid,tmdbId)` set.
2. **Availability phase** (existing) — runs after, SKIPS any `(uid,tmdbId)` in that set. → exactly one push,
   release always wins, guaranteed by execution order in ONE process (no cron-timing assumption).

## Files
- `functions/src/releaseNotify/logic.ts` — NEW pure (no firebase-admin/functions import): `seDigitalReleaseDates`,
  `releasesDigitallyToday(results, today)` (zero entries → false; multiple → fire if ANY == today),
  `stockholmDateString(now)` (Intl tz, DST-safe).
- `functions/src/releaseNotify/logic.test.ts` — NEW root-vitest: zero/one/multiple type-4, non-SE, DST anchor.
- `functions/src/releaseNotify/tmdb.ts` — NEW dedicated `GET /movie/{id}/release_dates`, 10s AbortSignal,
  null-on-failure. Mirror `availableNotify/tmdb.ts`.
- `functions/src/availableNotify/index.ts` — add release phase + skip-set threading into `processTitle`.
- `src/hooks/useNotifications.ts` — add `'digital_release'` to the kind union + preserve in coercion.
- `src/components/layout/TopbarActions.tsx` — render `digital_release` meta ("Släpps idag").

## Acceptance (Malin + PE binding — see plan file)
- Exactly ONE push (structural dedup); no new toggle (pushEnabled only); dedicated release_dates endpoint;
  logic handles zero/multiple type-4 SE entries w/ tests; DST-safe date; security-reviewer passes.

## Out of scope
TV episode pushes (episodeNotify's job); the Bevaka-släpp button; any rules change (Admin SDK bypasses rules).
