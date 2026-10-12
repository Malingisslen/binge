# Månadsnotans notis den 1:a (BIN-1449, package M)

Malin 2026-10-07: yes to a bell notice on the 1st; wording A, her text:
"Du har streamat klart i september. Se vad varje tjänst kostade per avsnitt."
No amount in it, so the server never repeats the price calculation.
Backend now deploys automatically from main (Djupgranskning, 2026-10-07).

## What
A scheduled function `monthlyBillNotify` (functions/src/monthlyBillNotify/), cron `0 9 1 * *`
Europe/Stockholm, europe-west1. It writes one bell card per qualifying user:
`users/{uid}/notifications/monthly-bill-<yyyy-mm>` via `create()` (idempotent: a retry
never doubles it or marks a read card unread), `{kind:'system', title:'Din streaming i
september', body:<Malin's text>, actionUrl:'/savings/', read:false, createdAt}`.
Bell only, no push (same promise as weeklyDigest). The deterministic id is the dedup; no
state collection.

## Who qualifies (the same rule as when Rådgivaren shows the bill)
1. Has a service that cost money last month: a `myProviders` id (aliases folded to the
   catalog id) whose chosen tier, else own price, else catalog price is above zero, and
   that was not paused the whole month (active `providerPauses` or a `pauseHistory` entry
   covering every day). When a price exists, a campaign above zero still running on the
   month's last day replaces it, as on the client.
2. Checked something off last month:
   - a film: watchlist range on `watchedAt` in the month, kept only if `mediaType ==
     'movie'`, not dropped, and a status the client reads as seen (legacy names too); or
   - an episode: any `episodeProgress` doc with an episode `watched: true` and its
     `watchedAt` in the month, for a show whose watchlist row (`tv_N`, or a legacy bare `N`)
     still exists. Progress docs are read 200 at a time and the read stops at the first hit.
   Films first; episodes only read when no film qualified.
`src/lib/advisor/monthlyBillNotify.parity.test.ts` runs both rules over the same users.

## Cost
One pass a month. Reads: every user doc (projected with select), and for users with a
paid service their pauseHistory, one bounded watchlist query and their episodeProgress
docs. No new paid service, no new index, no rules change (Admin SDK).

## Pieces
- `functions/src/monthlyBillNotify/logic.ts` (pure), tested in `logic.test.ts`.
- `functions/src/shared/providerPaid.ts`: which catalog prices are above zero, with a
  parity test against `SWEDISH_PROVIDERS`.
- `functions/src/shared/inboxCard.ts`: the bell write, shared with rotationReminder.
- `functions/src/monthlyBillNotify/index.ts`: the scan, users paged with a cursor, each
  user in its own try/catch, a summary log line.
- Export in `functions/src/index.ts`; workflow map flow + universe entry (own commit).
- GDPR: writes only a notification doc under the user, which export/delete already cover.

## Not done
No toggle in settings: a bell-only card once a month. Say so to Malin.
