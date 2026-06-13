# External Actions

Åtgärder som kräver access utanför repot (Firebase Console, gcloud,
Cloudflare, UptimeRobot, TMDB).

> **Kör-ordning + exakta kommandon:** se [`docs/EXTERNAL_ACTIONS_RUNBOOK.md`](../EXTERNAL_ACTIONS_RUNBOOK.md)
> — den här filen är status/checklista, runbooken är de körbara stegen.

---

## Insikter (intern analys-dashboard) — krävs innan /insikter visar riktig data

Kod + wiring är klar och deployad-redo (Fas 1). Följande måste göras manuellt
utanför repot:

- [ ] **Deploya function + rules FÖRST** — `deploy.yml` (push→main) deployar bara
      hosting. Kör manuellt: `firebase deploy --only functions:rollupInsights,functions:apiInsights,firestore:rules`
      (annars 404 på `/api/insights` + rollupen körs aldrig).
- [ ] **Function-secrets** — sätt:
      `firebase functions:secrets:set INSIGHTS_TOKEN` (generera en hemlig sträng),
      `firebase functions:secrets:set PLAUSIBLE_API_KEY` (skapas i plausible.io → Settings → API Keys),
      `firebase functions:secrets:set PLAUSIBLE_SITE_ID` (= `binge.nu`).
- [ ] **Plausible goals** — bekräfta att custom-events (`signed_up`, `title_added_watchlist`,
      `review_created`, `advisor_pause_taken`, `donate_clicked`, `signed_in`,
      `onboarding_completed`) är registrerade som goals i Plausible, annars 0 i goal-måtten.
- [ ] **Admin-flagga** — sätt `users/{din-uid}.isAdmin = true` i Firestore Console
      (görs bara manuellt — reglerna förbjuder klient-skrivning av fältet).
- [ ] **Cloud Scheduler** — `rollupInsights` (`onSchedule`) aktiverar Scheduler-API:t
      vid första deploy (Blaze krävs, redan på).
- [ ] **Verifiera** — gå till `binge.nu/insikter` inloggad som admin (eller
      `/insikter?token=<INSIGHTS_TOKEN>`); efter första rollup-körningen ska
      nuläges-måtten fyllas i.

Fas 2/3 (Web Vitals via Cloudflare RUM, Sentry-felfrekvens, drilldowns, CSV,
auto-refresh, "Egen…"-datumväljare) är medvetet uppskjutna — se
`docs/superpowers/specs/2026-06-02-binge-insikter-design.md`.

---

## Status per 2026-04-24 (verifierat via Chrome-MCP-sweep)

| Item | Status | Blockerare |
|------|--------|-----------|
| Firestore region `eur3` (EU multi-region) | ✅ Verifierat — GDPR-compliant | — |
| Firestore PITR | ❌ Kräver **Blaze-plan** | Billing-beslut |
| Schemalagda backups | ❌ Kräver **Blaze-plan** | Billing-beslut |
| Firebase App Check (reCAPTCHA v3) | ⏸ Partiellt — webapp listad som "Unregistered" | Kräver reCAPTCHA-sitekey från Google |
| Sentry DSN | ⏸ Inte provisionerat | Skapa projekt på sentry.io |
| Branch protection på `main` | ⏸ Inte aktiverat | GitHub Settings → Branches |
| Official TMDB logo | ⏸ Placeholder `public/tmdb-logo.svg` | Ladda ner från themoviedb.org |
| UptimeRobot monitor | ⏸ Inte skapat | Gratis, 5 min |

Billing-frågan är den enda verkliga blockeraren; alla andra är friktions-items.

---

## Blaze-upgrade eller inte?

**Spark (gratis) räcker för:**
- Nuvarande Firestore-användning (42K reads/701 writes per 7 dagar)
- Hosting
- Authentication
- Vanlig drift

**Blaze behövs för:**
- PITR (~$0.18/GiB/mån, just nu troligen < 10 MB = ~$0.01/mån)
- Schemalagda backups (~$0.03/GiB/mån)
- Cloud Functions (krävs för Sprint 10 monetization)
- Överstiga free tier (50K reads/20K writes per dag)

**Rekommendation:** Sätt en Firebase budget på 100 SEK/mån FÖRST (fail-closed
spärr), uppgradera sedan till Blaze. Kostnaden för en solo-app på den här
trafiknivån är < 5 SEK/mån i praktiken. Se §1.7a nedan för budget-setup.

---

## 1.1 — Firebase App Check (reCAPTCHA v3)

**Status:** Webappen är listad men `Unregistered`. Secret key saknas.
Site key behövs också för `NEXT_PUBLIC_APP_CHECK_SITE_KEY` env-var.

**Steg-för-steg:**

1. **Skapa reCAPTCHA v3-site** (gratis):
   - Gå till https://www.google.com/recaptcha/admin/create
   - Label: "Binge.nu"
   - reCAPTCHA type: **reCAPTCHA v3**
   - Domains: `binge.nu`, `binge-nu.web.app`, och `localhost` (för dev)
   - Acceptera villkoren → Submit
   - Spara **Site key** (publik) och **Secret key** (privat) på säker plats

2. **Registrera i Firebase App Check:**
   - Öppna https://console.firebase.google.com/project/binge-nu/appcheck/apps
   - Klicka `Register` bredvid `binge-nu-web`
   - Välj **reCAPTCHA** (inte Enterprise)
   - Paste in **Secret key** från steg 1
   - Token time to live: 1 day (default ok)
   - Save

3. **Sätt env-var i produktion:**
   - Hosting-env-var (Firebase gör det automatiskt via `firebase functions:config`
     för Functions, men för static-hostade siter behöver vi bygga in den)
   - Lägg in **Site key** i din CI-miljö som `NEXT_PUBLIC_APP_CHECK_SITE_KEY`
   - För lokal dev: lägg i `.env.local` (redan dokumenterat i .env.local.example)

4. **Enforce på Firestore + Auth:**
   - Firebase Console → App Check → APIs-fliken
   - Klicka Firestore, klicka "Enforce"
   - Samma för Cloud Storage, Authentication, Realtime Database (om använda)
   - Förslag: enforce på Firestore först, observera 1 vecka, sedan resten

- [ ] 1. reCAPTCHA v3-site skapad
- [ ] 2. App Check registrerad med secret key
- [ ] 3. Site key satt som env-var + deployed
- [ ] 4. Enforce på Firestore

---

## 1.2 — Firestore PITR (Point-in-Time Recovery)

_**Blaze-plan required.**_

---

## 1.2 — Enable Firestore PITR (Point-in-Time Recovery)

**Why:** 7-day recovery window at minute granularity. Fixes 03 DR1
(CRITICAL data-loss risk). Cost: ~$0.18 / GiB / month.

**Blaze required.** Upgrade sker via Firebase Console → "Upgrade billing plan"
i vänsterspalten. Sätt budget-alert (§1.7a) FÖRST som skyddsnät.

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

**Why:** EU user data should reside in EU for GDPR.

**Verifierat 2026-04-24 via Firebase Console:** `eur3` (EU multi-region,
Belgien + Nederländerna). GDPR-compliant. Ingen migration behövs.

- [x] Region verified: **eur3**
- [x] Migration needed? **No**

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

## Sentry setup (Sprint 2 follow-up)

**Varför:** Sprint 2 integrerade `@sentry/react` men initialiseringen är
no-op tills `NEXT_PUBLIC_SENTRY_DSN` är satt.

**Steg:**

1. Skapa konto på https://sentry.io (free tier räcker — 5k events/mån)
2. Create Project → Platform: **Browser → JavaScript → Next.js**
3. Project name: `binge-nu`
4. Kopiera DSN (format: `https://<hash>@o<id>.ingest.sentry.io/<project>`)
5. Lägg in i GitHub Actions secrets som `NEXT_PUBLIC_SENTRY_DSN`
6. Lägg in `NEXT_PUBLIC_GIT_SHA` = `${{ github.sha }}` i `.github/workflows/deploy.yml` build-env
7. Trigger:a redeploy

- [ ] Sentry-projekt skapat
- [ ] DSN satt i GitHub secrets + CI miljö
- [ ] En test-exception rapporterad från produktion

---

## Branch protection (Sprint 2 follow-up)

**Varför:** CI-workflow finns men är inte enforcerande. En direct push till
main som failar lint kan fortfarande deploya om vi inte blocker.

**Steg:**

1. https://github.com/Malingisslen/binge/settings/branches
2. Add branch protection rule for `main`
3. Required status checks: `quality` (från ci.yml) — check "Require status checks to pass before merging"
4. Require pull request reviews: optional för solo
5. Include administrators: **on** — annars kan du själv bypassa av misstag

- [ ] Branch protection aktiverad på `main`
- [ ] Verifierat: direct-push utan PR failar

---

## Cloudflare Cache Rule för HTML (prestandaplan 2026-06-11, åtgärd 1b)

Kräver inloggning i Cloudflare-dashboarden (free plan räcker):

1. Caching → Cache Rules → Create rule, namn: `Edge-cache HTML kort`
2. When incoming requests match: Hostname equals `binge.nu`
3. Then: Eligible for cache, Edge TTL: **Override origin → 10 minutes**,
   Browser TTL: **Respect origin**
4. Under **Advanced options** i Cache Rule: sätt **Status Code TTL** till
   **no-cache för 4xx och 5xx** (eller motsvarande formulering i CF-UI:t) —
   annars edge-cacheas felstatus i 10 min. Bara 200-svar ska edge-cacheas.
5. Spara. `/commit`-skillen purgar redan hela zonen vid deploy, så regeln är
   säker — max 10 min stale efter en deploy som inte går via /commit.

Effekt: long-tail-HTML (alla rewrites till /_/index.html) serveras från
Cloudflare-edge (~0 ms origin-tid) istället för Fastly-MISS mot Firebase
(~235–275 ms extra TTFB, live-uppmätt).

---

## Sign-off

All items done? Update this file's status here:

- [ ] 1.1 App Check registered + enforced
- [ ] 1.2 PITR enabled
- [ ] 1.3 Region verified (record: ___)
- [ ] 1.6 Scheduled backups active
- [ ] 1.7a Firebase billing alert configured
- [ ] 1.7b UptimeRobot monitor live
- [ ] 1.5b Official TMDB logo in place
- [ ] Cloudflare settings sanity-checked
- [ ] Deployed + `curl -I` confirms security headers live
- [ ] Sentry DSN provisionerat + deployt
- [ ] Branch protection aktiverad på main

Date completed: ___________
