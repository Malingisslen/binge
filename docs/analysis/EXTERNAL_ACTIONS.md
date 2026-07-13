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
```

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
