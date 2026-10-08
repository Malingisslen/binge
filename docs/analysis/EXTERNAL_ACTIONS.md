# External Actions — ops reference

Evergreen reference for the things that **can't be done from the repo**: function secrets,
Cloudflare cache config, the third-party accounts each Cloud Function needs, and the
deploys that stay manual. `deploy.yml` (push → main) deploys the site, and before it the
rules, indexes and functions that changed (BIN-1426).

---

## Deploying functions, rules and indexes

`deploy.yml`'s `backend` job deploys them without an approval (BIN-1426, Malin's decision
2026-10-07); `docs/RUNBOOK.md` §6e covers what goes out and recovering.
The job finishes before the hosting job starts, so a new function is live before the site
that calls it — the order BIN-1118/1120/1259 (2026-09-20) had to get right by hand. The
reverse case still needs a decision: a rules change the OLD site cannot live with needs the
new client live first, so the client goes in an earlier push (BIN-540). The run summary
warns when rules and client code change in the same run.

The job deploys functions with `--only functions`. firebase skips a function only when its
hash is unchanged, and the hash includes the whole packaged source (firebase-tools 15.22.3,
`lib/deploy/functions/cache/applyHash.js`), so a source change redeploys every function.
The standing rule to deploy functions by exact name, never a blanket `--only functions`, is
struck. By hand, deploy what the failed run's summary names. Rules, indexes and every
function at once is Run workflow with `deploy_all_backend`; the site follows, as in any run.

Still by hand, because the job runs non-interactively and without `--force`: deleting a
function (firebase stops and prints the `functions:delete` commands), a new secret, a
trigger that needs a service the deploy account cannot enable, a new retry policy or a
raised minimum instance count, deleting an index (firebase only lists it), and a cleanup
policy for the function images when `gcf-artifacts` has none (firebase deploys the
functions, then fails). That policy is set once:
`firebase functions:artifacts:setpolicy --location europe-west1 --project binge-nu`. A
trigger that changes its event type is skipped with a warning rather than stopped; the run
summary says so, and a deploy by hand asks before migrating it.

**After any functions deploy, verify the scheduled jobs still exist** (`firebase functions:list`
+ Cloud Scheduler Console) — a missing one means a background job silently stopped:
`rollupInsights`, `episodeReleaseNotify`, `showReturnNotify`, `availableNotify`,
`retentionCleanup` (daily — GDPR retention), `reclaimOrphanFollows` (weekly),
`streamingOffersRefresh`, `cineasternaCatalogSync`.

Index builds are **async** — a scheduled job that reads a not-yet-`Enabled` collection-group
index logs errors until the build finishes (Firestore Console → Indexes). Several newer
functions **no-op silently without their secrets** (below) — set those first.

**When a new index is read by code that throws to a waiting caller, one run is wrong — push
the index on its own first (BIN-1147).** The warning above is scoped to a scheduled job,
which self-heals; but that is a proxy. The question that decides it is whether the call
site sits inside error isolation that defers to a later run, or throws to something
waiting. `retentionCleanup` has that isolation — one uid's failure defers that uid and
keeps its watch record. `handOverOwnedGroups` does not: the account-delete button awaits
it before its cascade, so an unbuilt index fails **every self-service account deletion**,
and the user is told nothing was deleted.

Push the `firestore.indexes.json` change alone; its run deploys `--only firestore:indexes`. Then confirm the index is actually built. The Console shows it, but
this is the checkable form — a `fieldOverrides` entry is NOT a composite index, so
`indexes composite list` will not show it:

```bash
gcloud firestore indexes fields describe <field> --collection-group=<collection> --project=binge-nu --format=json
```

Built means an entry with `"queryScope": "COLLECTION_GROUP"` and `"state": "READY"` —
`CREATING` means keep waiting. Then push the code that reads it.

The reverse order is safe when nothing new reads the index yet.

**Rollback.** Both halves are reversible. Revert the function source and push; the `backend`
job redeploys the functions, which is safe, since the old code never
issues the query. The index is removed by hand: drop its `fieldOverrides` entry and run
`firebase deploy --only firestore:indexes`, which asks before it deletes. Revert the
functions first or independently; an index left standing after a function revert is not
a correctness risk, but it does cost index maintenance on every write to that collection,
for everyone, until it is removed.

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
| Orphaned user DATA (BIN-1023) | `getUsers()` | `firebaseauth.users.get` — already held, no new scope | 2026-08-30, same permission as the row above it |

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

## Function secrets

Set via `firebase functions:secrets:set NAME` **before** deploying the function that reads it.

| Secret | Used by | Notes |
|---|---|---|
| `INSIGHTS_TOKEN` | `/api/insights` | bearer token for admin-bypass |
| `TMDB_API_KEY` | `episodeReleaseNotify` etc. | same value as `NEXT_PUBLIC_TMDB_API_KEY`, but functions need it as a secret |
| `OMDB_API_KEY` | `titleRatings` | OMDb free tier 1,000/day |
| `MOTN_API_KEY` | `streamingOffersRefresh` | RapidAPI (Movie of the Night), free 100/day |
| `ADMIN_UID` | | rot/warn notifications target `users/{ADMIN_UID}` |

Cineasterna reuses `TMDB_API_KEY` (for `/find`) + `ADMIN_UID`; no new external account.

**Admin flag** (`/insikter` + `/admin/reports`): set `users/{your-uid}.isAdmin = true` in the
Firestore Console — rules forbid client writes to the field.

## Known exceptions (load-bearing)

- **npm audit:** the deploy's audit step is **advisory at every severity** — it cannot fail a
  build. Read the mechanism rather than the flag: the step ends in an unconditional `exit 0`
  on every branch, and the comment above it names BIN-1028 as the change that removed the
  last blocking audit gate.

  ```
  grep -n -A28 "Audit (high" .github/workflows/deploy.yml
  ```

  Three claims that used to sit here are **struck 2026-09-20**, each measured false that day:
  that the command returned no HIGH findings; which moderate advisories made up the remainder;
  and that `--audit-level=high` is what keeps a moderate from failing the build. The flag only
  sets an exit code the step then discards. Do not read a count here — run it:

  ```
  npm audit
  npm audit --omit=dev --audit-level=high
  ```

  The second is the one that answers whether anything reaches a visitor. `.github/dependabot.yml`
  carries the dated reasoning for the eslint chain, and BIN-658 the trade-off.
  When the first lists findings the second does not, this traces one to the dependency that
  pulls it in — put each package name `npm audit` printed in place of `<package>`:

  ```
  npm ls <package> --all
  ```
- **C More provider-id 1759:** TMDB fully retired C More (folded into TV4 Play) and no longer
  lists it, so the id could not be live-confirmed. `1759` is the historical id and **no active
  provider uses it**, so the alias `1759 → 489` (`canonicalProviderId`) is zero-collision — it
  only catches old stored `watch/providers` payloads.

## Egen räkning för Insikter (BIN-1438)

Insikter läser händelserna ur `eventStats/{YYYY-MM-DD}`, som den anropbara `recordEvent`
skriver. Det finns inget externt konto att konfigurera: ordförrådet (vilka händelser och
egenskaper som räknas) står i `functions/src/eventStats/logic.ts`. Tills `recordEvent`,
`apiInsights` och reglerna är driftsatta sväljer klienten felet.

Aktiva användare och pushmärkningen ligger i `rollupInsights` och `sendPushToUser`, som
driftsätts med `deploy.yml`:s `backend`-jobb (BIN-1426).

## Open infra items (verify status; genuinely maybe-undone)

| Item | Status | Blocker |
|---|---|---|
| Firestore region `eur3` (EU multi-region) | ✅ Verified — GDPR-compliant | — |
| Firestore PITR | ✅ `POINT_IN_TIME_RECOVERY_ENABLED`, `versionRetentionPeriod: 604800s` (mätt 2026-09-17) | — |
| Scheduled backups | ✅ one `dailyRecurrence` schedule, `retention: 8467200s` (mätt 2026-09-17) | — |
| UptimeRobot monitor on `https://binge.nu` | ❔ not confirmed | free, 5 min setup |
| Official TMDB logo (replace `public/tmdb-logo.svg`) | ❔ placeholder | download from TMDB brand page |

App Check (reCAPTCHA v3, monitoring mode) and Sentry are **live**. De två raderna ovan
härleds om med:

```bash
gcloud firestore databases describe --database='(default)' --project=binge-nu \
  --format='value(pointInTimeRecoveryEnablement,versionRetentionPeriod)'
gcloud firestore backups schedules list --database='(default)' --project=binge-nu
gcloud firestore backups list --location=eur3 --project=binge-nu
```

`backups list` kräver databasens location (`eur3`), inte standardregionen.

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

**This section makes no claim about which plan the project is on.** BIN-1198: the sentence
that used to open it did, and it named the wrong one. The claim is STRUCK rather than
restated. Read the plan and the budget cap where they are stated rather than from a sentence
here; derive where that is:

```
grep -rn "Blaze" CLAUDE.md docs/RUNBOOK.md
```
