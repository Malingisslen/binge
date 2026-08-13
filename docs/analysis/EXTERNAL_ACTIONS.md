# External Actions — ops reference

Evergreen reference for the things that **can't be done from the repo**: manual
`firebase deploy` of functions/rules/indexes, function secrets, Cloudflare cache config,
and the third-party accounts each Cloud Function needs. `deploy.yml` (push → main) deploys
**hosting only** — everything below is manual.

---

## Manual deploy: functions + rules + indexes

`deploy.yml` never touches functions, `firestore.rules`, or `firestore.indexes.json`. After
changing any of them, deploy manually.

**Deploy the function(s) you changed by exact name** (targeted deploys are the standing rule
— never a blanket `--only functions`). But do **not** rely on a hand-maintained named-subset
list for a full rollout: that list drifted from the code before and silently dropped
`retentionCleanup` + `reclaimOrphanFollows`, so scheduled cleanup never went live. For a full
rollout deploy everything in one sweep:

```bash
firebase deploy --only functions,firestore:rules,firestore:indexes
```

**After any functions deploy, verify the scheduled jobs still exist** (`firebase functions:list`
+ Cloud Scheduler Console) — a missing one means a background job silently stopped:
`rollupInsights`, `episodeReleaseNotify`, `showReturnNotify`, `availableNotify`,
`retentionCleanup` (daily — GDPR retention), `reclaimOrphanFollows` (weekly),
`streamingOffersRefresh`, `cineasternaCatalogSync`.

Index builds are **async** — a scheduled job that reads a not-yet-`Enabled` collection-group
index logs errors until the build finishes (Firestore Console → Indexes). Several newer
functions **no-op silently without their secrets** (below) — set those first.

Post-deploy verification:
```bash
curl -I https://binge.nu | grep -iE "content-security-policy|strict-transport|x-content-type|x-frame|referrer-policy|permissions-policy"
firebase functions:log --only episodeReleaseNotify   # expect the "episodeNotify done {...}" line
firebase functions:log --only retentionCleanup       # see the IAM check below
```

**retentionCleanup needs IAM roles no other function needs.** It is the only place in
`functions/` that calls Auth *user-management* APIs. Everything else only does
`verifyIdToken`, which is offline against public keys and needs no permission. Without the
permissions below on the runtime service account, the calls throw, nothing is deleted, and
**the deploy stays green** — they are only exercised at runtime.

| Sweep | API | Permission | Verified |
|---|---|---|---|
| Revoked push tokens (BIN-848) | `getUsers()` | `firebaseauth.users.get` | 2026-08-10, present via `roles/editor` |
| Orphaned auth accounts (BIN-816) | `listUsers()`, `deleteUsers()` | `firebaseauth.users.get` + `firebaseauth.users.delete` | 2026-08-13, present via `roles/editor` |

**Check the permission, not the outcome.** The first version of this said "check the first
run's log line: `orphanAuthAccounts > 0` must be matched by `deletedOrphanAuthAccounts > 0`".
That is unfalsifiable here and would have sat unverified indefinitely: Binge has three auth
accounts, all three have profiles, so the sweep finds nothing and logs `orphanAuthAccounts:
0` every night forever. A zero that means "nothing to do" is indistinguishable from a zero
that means "the permission is missing" — the BIN-849 shape, one level up. An acceptance
criterion that depends on the guarded event happening cannot be met when the guarded event
is rare, which is exactly when you most want the guard to work.

The static check has no such dependency and is three commands:

```bash
# 1. which service account does the function run as?
gcloud functions describe retentionCleanup --region=europe-west1 --gen2   --project=binge-nu --format="value(serviceConfig.serviceAccountEmail)"
# → 879931819959-compute@developer.gserviceaccount.com

# 2. which roles does it hold?
gcloud projects get-iam-policy binge-nu --flatten="bindings[].members"   --filter="bindings.members:879931819959-compute@developer.gserviceaccount.com"   --format="value(bindings.role)"
# → roles/editor, roles/eventarc.eventReceiver, roles/run.invoker

# 3. does that role carry the permission?
gcloud iam roles describe roles/editor --format="value(includedPermissions)"   | tr ';' '
' | grep firebaseauth.users.delete
# → firebaseauth.users.delete
```

Run 2026-08-13: **all three pass.** Re-run them if the function is ever moved to a
dedicated, least-privileged service account — that is exactly when this breaks, and the log
line will not tell you.

**This batch needs BOTH halves deployed, in this order.** `functions/**` changed, so
`deploy.yml`'s drift guard fails the push-triggered hosting job **by design** — a red
workflow next to a green tree reads as "shipped" and is not:

1. `firebase deploy --only functions:retentionCleanup` — the server half (both sweeps).
2. Re-run `deploy.yml` via **workflow_dispatch** — the client half (the limbo screen, the
   write chokepoint, the username uid-query). Until this lands, a marked session is not
   blocked from writing and an aborted deletion still resurrects the profile.

No rules or index deploy is needed: `usernames` already carries `allow read: if true`
(covering `list`) and `firestore.indexes.json` has no `fieldOverrides` for it.

**Runtime reading of the orphan-auth sweep** (diagnosis, not acceptance — the permission is
verified statically above). On a `retentionCleanup done` line: if `orphanAuthAccounts > 0`
is ever matched by `deletedOrphanAuthAccounts: 0`, either the permission was revoked (look
for `deleteUsers batch failed` with `auth/insufficient-permission`) or the blast-radius
ceiling fired (`orphan auth sweep exceeded its ceiling`, which deletes nothing on purpose).
`checkedAuthAccounts: -1` or `orphanAuthSkippedProfileBatches: -1` means the scan never
ran, so the zero says nothing at all. This matters beyond tidiness:
`docs/data-retention-policy.md` states, as fact, that an aborted deletion is a *documented
delay* rather than an Art. 17 breach — and that statement is only true while this sweep
actually deletes.

Accept the sweep as live only on a `retentionCleanup done` line carrying BOTH
`skippedAuthBatches: 0` AND `checkedUids > 0`. Either alone is insufficient: the scan
returns early when no `fcmTokens` doc exists anywhere, logging `skippedAuthBatches: 0`
without having asked Auth anything. `checkedUids` is how many uids were actually put to
Auth; `skippedAuthBatches: -1` means the whole scan died.

- Don't wait a day — Cloud Scheduler → `firebase-schedule-retentionCleanup-europe-west1`
  → **Force run**.
- `checkedUids: 0` **with `skippedAuthBatches: 0`**? No device has a push token at all.
  Tick push in Inställningar on one device, then force-run again. (`checkedUids: 0` with
  `-1` is the dead-scan case above, not this one.)
- **Checked 2026-08-10: the role is already there.** The runtime service account is the
  project's default compute SA, which holds `roles/editor`, and `roles/editor` includes
  `firebaseauth.users.get` (verified with `gcloud iam roles describe roles/editor`). So no
  grant was needed on this project. Re-check only if the function is ever moved to a
  dedicated, least-privileged service account — that is exactly when this breaks.
- Denied? One `getUsers batch failed, skipping` error per batch with
  `auth/insufficient-permission`. Grant the runtime service account
  `roles/firebaseauth.viewer` (read-only, contains `firebaseauth.users.get`) and re-run.
  The other four sweeps are unaffected — each is caught independently.

## Function secrets

Set via `firebase functions:secrets:set NAME` **before** deploying the function that reads it.

| Secret | Used by | Notes |
|---|---|---|
| `INSIGHTS_TOKEN` | `/api/insights` | bearer token for admin-bypass |
| `PLAUSIBLE_API_KEY`, `PLAUSIBLE_SITE_ID` | insights rollup | site id = `binge.nu` |
| `TMDB_API_KEY` | `episodeReleaseNotify` etc. | same value as `NEXT_PUBLIC_TMDB_API_KEY`, but functions need it as a secret |
| `OMDB_API_KEY` | `titleRatings` | OMDb free tier 1,000/day |
| `MOTN_API_KEY` | `streamingOffersRefresh` | RapidAPI (Movie of the Night), free 100/day |
| `ADMIN_UID` | MOTN + Cineasterna crons | rot/warn notifications target `users/{ADMIN_UID}` |

Cineasterna reuses `TMDB_API_KEY` (for `/find`) + `ADMIN_UID`; no new external account.

**Admin flag** (`/insikter` + `/admin/reports`): set `users/{your-uid}.isAdmin = true` in the
Firestore Console — rules forbid client writes to the field.

## Known exceptions (load-bearing)

- **npm audit:** `npm audit --audit-level=high` = **0 HIGH**. Two **moderate** postcss
  advisories remain; the fix requires a `next` major downgrade, so they are a **consciously
  accepted exception**. The CI gate uses `--audit-level=high`, so moderate does not fail it.
- **C More provider-id 1759:** TMDB fully retired C More (folded into TV4 Play) and no longer
  lists it, so the id could not be live-confirmed. `1759` is the historical id and **no active
  provider uses it**, so the alias `1759 → 489` (`canonicalProviderId`) is zero-collision — it
  only catches old stored `watch/providers` payloads.

## Open infra items (verify status; genuinely maybe-undone)

| Item | Status | Blocker |
|---|---|---|
| Firestore region `eur3` (EU multi-region) | ✅ Verified — GDPR-compliant | — |
| Firestore PITR (7-day recovery) | ❔ Blaze-gated; not confirmed enabled | billing decision |
| Scheduled backups (14-week) | ❔ Blaze-gated; not confirmed enabled | billing decision |
| UptimeRobot monitor on `https://binge.nu` | ❔ not confirmed | free, 5 min setup |
| Official TMDB logo (replace `public/tmdb-logo.svg`) | ❔ placeholder | download from TMDB brand page |

App Check (reCAPTCHA v3, monitoring mode) and Sentry are **live**. PITR/backups are enabled
via Firebase Console → Firestore → Backups (`gcloud firestore databases update --enable-pitr`
/ `backups schedules create --recurrence=daily --retention=14w`); set a budget alert first.

## Cloudflare Cache Rule for HTML — as-built (recreate exactly)

Active in the Cloudflare dashboard (free plan). If it must ever be rebuilt:

- **Name:** `Edge-cache HTML kort` · Order: First
- **Match:** `(http.host eq "binge.nu" and not starts_with(http.request.uri.path, "/_next/") and not starts_with(http.request.uri.path, "/api/"))`
  — the `/_next/` exclusion is **critical**, else immutable static assets get downgraded to a
  10-min edge TTL. `/api/` excludes the functions endpoint.
- **Cache eligibility:** Eligible for cache.
- **Edge TTL:** *Ignore cache-control header and use this TTL* → **10 minutes**. (Origin sends
  `no-cache` from `firebase.json`, so "ignore" is required for the edge to cache at all.)
- **Status-code TTL:** `>= 400` → **No store** (4xx/5xx never cached at edge).
- **Browser TTL:** **Respect origin TTL** ← GOTCHA: leave this unset and CF falls back to the
  *zone* Browser Cache TTL (4h) and sends `max-age=14400` to browsers instead of origin's
  `no-cache`. Must be set explicitly.

Verified live: `/calendar/` → `Cache-Control: no-cache, must-revalidate` + `Cf-Cache-Status: HIT`
(edge caches, browser revalidates); `/_next/static/*.js` → `public, max-age=31536000, immutable`
+ HIT (untouched). Effect: long-tail HTML serves from the CF edge (~0 ms origin) instead of a
Fastly MISS to Firebase (~235–275 ms extra TTFB). Only `/commit` purges the whole zone on deploy,
so a non-`/commit` deploy is at most 10 min stale (browsers revalidate immediately anyway).

## Blaze vs Spark

Spark (free) covers current Firestore usage, hosting, and auth. Blaze is needed for Cloud
Functions (all the crons above), PITR/backups, and exceeding the free tier. At this traffic a
solo app costs < 5 SEK/mån in practice; the 25 SEK/mån budget (50/90/100% alerts) is the
fail-closed guard.
