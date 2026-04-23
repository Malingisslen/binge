# External Actions — Sprint 1, Day 1

These steps require access outside this repo (Firebase Console,
gcloud CLI, Cloudflare, UptimeRobot, TMDB). They cannot be scripted
from the codebase. Run each, then check off.

Total time: ~45 min.

---

## 1.2 — Enable Firestore PITR (Point-in-Time Recovery)

**Why:** 7-day recovery window at minute granularity. Fixes 03 DR1
(CRITICAL data-loss risk). Cost: ~$0.18 / GiB / month.

**How:**

```bash
# Verify current status first
gcloud firestore databases describe --database="(default)" \
  --project=binge-nu --format="value(pointInTimeRecoveryEnablement)"

# Enable (only if status is DISABLED)
gcloud firestore databases update --database="(default)" \
  --project=binge-nu \
  --enable-pitr
```

Alternative via Firebase Console:
1. https://console.firebase.google.com/project/binge-nu/firestore
2. Settings → Point-in-time Recovery → Enable

**Verification:** re-run the describe command; expect
`POINT_IN_TIME_RECOVERY_ENABLED`.

- [ ] PITR enabled and verified

---

## 1.3 — Verify Firebase project region

**Why:** EU user data should reside in EU for GDPR. Unverified
currently. Cross-ref 02 G-5, 09 T-1, 11 FH-1.

**How:**

```bash
gcloud firestore databases describe --database="(default)" \
  --project=binge-nu --format="value(locationId)"
```

Or via Firebase Console → Firestore → Settings → Location.

**Expected (EU-friendly):**
- `europe-west1` (Belgium)
- `europe-west3` (Frankfurt)
- `europe-west4` (Netherlands)
- `eur3` (multi-region EU)

**If US region (`us-central1`, `nam5`, etc.):**
- Data physically in US → SCC disclosure required in privacy policy
- Document the region; migration is a multi-week project (Firestore
  databases are immutable — requires creating a new project + data
  export/import). Defer to Phase 3 unless compliance audit demands it.

**Result to document in privacy policy (Sprint 1 Day 3-7):**

- [ ] Region verified: ___________________
- [ ] Migration needed? Yes / No

---

## 1.6 — Firestore scheduled backups

**Why:** PITR covers 7 days; scheduled backups cover longer (14 weeks).
Fixes 03 DR2.

**How:**

```bash
# Daily backup with 14-week retention
gcloud firestore backups schedules create \
  --database="(default)" \
  --project=binge-nu \
  --recurrence=daily \
  --retention=14w

# Verify
gcloud firestore backups schedules list \
  --database="(default)" \
  --project=binge-nu
```

Backups stored automatically in Google Cloud. No separate GCS bucket
config needed for the schedule itself.

- [ ] Daily backup schedule created
- [ ] Schedule visible in `backups schedules list`

---

## 1.7 — Alerting setup

### 1.7a — Firebase billing alert

**Why:** Avoid surprise bill if Blaze plan is active or gets triggered
(e.g., large Scrapfly-adjacent usage). Fixes 03 I1.

**How via GCP Console:**

1. https://console.cloud.google.com/billing → select billing account
2. Budgets & alerts → Create Budget
3. Scope: project `binge-nu`
4. Amount: 200 SEK / month (starting threshold — adjust per comfort)
5. Thresholds: 50 %, 90 %, 100 %
6. Notification: email (developer's)

- [ ] Budget created for binge-nu
- [ ] 50/90/100 % alerts configured
- [ ] Test email received

### 1.7b — UptimeRobot (uptime monitor)

**Why:** Detect downtime. Free tier: 50 monitors, 5-min checks. Fixes
03 M3.

**How:**

1. Sign up at https://uptimerobot.com (free account)
2. Add New Monitor:
   - Type: HTTP(s)
   - URL: `https://binge.nu`
   - Friendly Name: "Binge landing page"
   - Monitoring Interval: 5 min
3. Add alert contact: email
4. Optional 2nd monitor: `https://binge.nu/discover/` or another
   content-heavy route

- [ ] UptimeRobot account created
- [ ] Monitor(s) configured
- [ ] Test alert verified

---

## 1.5b — Official TMDB logo

The repo includes a placeholder at `public/tmdb-logo.svg`. Replace it
with the official logo.

**How:**

1. Visit https://www.themoviedb.org/about/logos-attribution
2. Download "The Movie Database Short Logo" in SVG (color on colored
   background variant works well over the #fcfbf9 / #eeece8 footer).
3. Save as `C:\binge\public\tmdb-logo.svg` (overwrite placeholder).
4. Verify in browser: footer shows real TMDB logo.

- [ ] Official TMDB logo downloaded and placed

---

## Verification after all external actions

```bash
# Firestore
gcloud firestore databases describe --database="(default)" \
  --project=binge-nu

# Should show:
#   locationId: europe-west1 (or equivalent EU)
#   pointInTimeRecoveryEnablement: POINT_IN_TIME_RECOVERY_ENABLED

gcloud firestore backups schedules list \
  --database="(default)" \
  --project=binge-nu

# Should list 1 daily schedule with 14w retention
```

```bash
# Deployed security headers (after committing + deploying firebase.json)
curl -I https://binge.nu

# Should include:
#   content-security-policy: ...
#   strict-transport-security: max-age=63072000; includeSubDomains; preload
#   x-frame-options: DENY
#   x-content-type-options: nosniff
#   referrer-policy: strict-origin-when-cross-origin
#   permissions-policy: ...
```

---

## Cloudflare verification (quick sanity check — no code change)

While you're in ops-mode, verify these Cloudflare settings at
https://dash.cloudflare.com → binge.nu:

- [ ] SSL/TLS mode: **Full (strict)** (not "Flexible")
- [ ] "Always Use HTTPS": **On**
- [ ] Automatic HTTPS Rewrites: **On**
- [ ] Rocket Loader: **Off** (breaks React)
- [ ] Brotli compression: **On**
- [ ] Auto Minify: HTML/CSS/JS on (low risk, small gain)

No code changes required. Flag issues if any.

---

## Sign-off

All items done? Update this file's status here:

- [ ] 1.2 PITR enabled
- [ ] 1.3 Region verified (record: ___)
- [ ] 1.6 Scheduled backups active
- [ ] 1.7a Firebase billing alert configured
- [ ] 1.7b UptimeRobot monitor live
- [ ] 1.5b Official TMDB logo in place
- [ ] Cloudflare settings sanity-checked
- [ ] Deployed + `curl -I` confirms security headers live

Date completed: ___________
