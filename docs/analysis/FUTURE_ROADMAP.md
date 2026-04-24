# Binge — Future Roadmap (Sprint 4+)

_Status: 2026-04-24. Sprints 1–3 landade. Denna plan organiserar all
återstående backlog från REMEDIATION_PLAN.md + mockup-redesign + externa
åtgärder i en realistisk följd för en solo-utvecklare._

## Planens principer

- **Compliance före comfort** — legala krav (GDPR Art. 20, auth-hygien)
  kommer före refaktorerings-nöjen.
- **Låsta beroenden först** — framework-upgrades blockerar inte löpande
  arbete men de unlockar Cloud Functions + paid features, så lägg dem
  tidigt när en ledig vecka uppstår.
- **Design-bollen kontrolleras före implementation** — mockups/ måste
  review:as som en visionsexercise innan sprint 8 skopas.
- **External prerequisites parkeras inte** — Firestore PITR, EU-region,
  Sentry DSN är halvtimmes-jobb vardera men blockerar riktig observability
  och DR-garantier.

## Prioriteringsordning (sammanfattning)

| # | Sprint | Tema | Effort | Trigger |
|---|--------|------|--------|---------|
| 4 | Compliance + security | GDPR-export, auth-hardening, App Check | ~40 h | Legal-skyldighet Art. 20 |
| 5 | Docs + dev experience | CLAUDE.md, runbook, types-split, bundle | ~16 h | Halvdag när resten väntar |
| 6 | Arkitektur + polish | settings-dekomp, dynamic imports, offline | ~24 h | Efter Sprint 4 stabiliserats |
| 7 | Framework upgrades | React 19 + Next 16 + Tailwind v4 | ~40 h | Dedikerad vecka, löser 4 HIGH CVEs |
| 8 | Mockup-driven redesign | Nya vyer från mockups/ | ~2–3 v | Efter design-review |
| 9 | Growth features | Import, dark mode, push | ~2 v | Post-framework, pre-monetization |
| 10 | Monetization | Paddle + paywall (om beslutad) | ~4–5 v | När user-beslut fattas |
| 11+ | PWA + native | Install-to-home + native apps | månader | Långsiktigt |

## External prerequisites — gör dessa NU

Dessa tar totalt ~45 min och blockerar Sprint 4–5:

- [ ] **Firestore PITR** (se EXTERNAL_ACTIONS.md §1.2) — 7-dagars recovery
  window till ~$0.18/GiB/mån. Behövs innan Sprint 4 data-export (B10)
  kan testas mot en säker baseline.
- [ ] **EU-region-verifiering** — GDPR-krav. Om `us-central1` idag →
  migration separat spår.
- [ ] **Sentry DSN** — provisionera projekt på sentry.io, sätt
  `NEXT_PUBLIC_SENTRY_DSN` i Firebase Hosting-miljö. Sprint 2 8.1 är
  no-op tills detta sker.
- [ ] **Branch protection på `main`** — required status check = CI
  workflow. Gör våra kvalitetsgates faktiskt enforcerande.
- [ ] **UptimeRobot eller liknande** (5 min) — enkla up/down-alerts på
  binge.nu + binge-nu.web.app.

---

## Sprint 4 — Compliance + security closure (~40 h, 1 vecka)

**Mål:** Binge uppfyller GDPR-krav och auth-ytan är härdad mot de vanligaste
abuse-vektorerna.

### Dag 1–2 — GDPR data-portabilitet (~10 h)

- [ ] **B10** — Data export (JSON) — GDPR Art. 20 (1 dag)
  - `src/app/settings/` → "Exportera min data"-knapp
  - Samlar: profile-doc, watchlist, episodeProgress, reviews, lists,
    notInterested, following, followers, notifications
  - Genererar `binge-export-{uid}-{date}.json` klient-side via blob+download
  - Inkludera schema-version, README, TMDB-attribution
  - Dokumentera format i `docs/data-export-format.md`
- [ ] **B33** — Anonymisering-vs-radering-policy för publik UGC (design + docs, 2 h)
  - Beslut: när ett konto raderas, vad händer med publika reviews/comments?
    Alternativ: (a) hård radering (risk för trådfel), (b) anonymisera
    displayName → "Borttagen användare", (c) hybrid baserat på engagement
  - Dokumentera i `docs/data-retention-policy.md` + Integritetspolicyn
  - Uppdatera `deleteAccount`-cascade i AuthContext att matcha beslutet

### Dag 3 — Auth-hardening (~6 h)

- [ ] **B29** — Email-verification på sign-up (1 h)
  - `sendEmailVerification(user)` efter `createUserWithEmailAndPassword`
  - UI: banner "Bekräfta e-post" + resend-knapp i settings
  - Ingen gating initialt (friktion > abuse-risk för oss idag)
- [ ] **B30** — Password strength policy (30 min)
  - zxcvbn eller enkel heuristik (min 8 tecken, inte top-10k)
  - Realtidsfeedback på register-form
- [ ] **B28** — Firebase App Check (2 h)
  - reCAPTCHA v3 för web
  - Enforce på Firestore + Auth
  - Rollbar plan: enforce:false first, observe 1 vecka, sedan enforce

### Dag 4 — Session + group security (~4 h)

- [ ] **B31** — Invite-token rotation för grupper (2 h)
  - Auto-rotate invite-token 30 dagar efter senaste användning
  - UI: "Generera ny"-knapp i GroupSettingsModal (finns redan — lägg
    till lastRotatedAt-fält + badge "länken är 6 månader gammal")
- [ ] **B32** — Session-expiry för Tillsammans (1 h)
  - `expiresAt`-fält finns redan på sessions
  - Cron för delete (kräver Cloud Functions → se Sprint 10)
  - Klient-side filter: ignorera `expiresAt < now`-sessions vid read
  - Visa "Session utgången"-state istället för data

### Dag 5 — External + verification (~4 h)

- [ ] Firestore PITR enable (external, 30 min)
- [ ] EU-region verify (external, 30 min)
- [ ] Sentry DSN provisionering + deploy-test (1 h)
- [ ] End-to-end test av deleteAccount-cascade med anon-policy
- [ ] Update `integritet/page.tsx` med retention + anonymization

### Exit-kriterier

- [ ] GDPR Art. 20 data export fungerar end-to-end
- [ ] Email-verification + password-strength live
- [ ] App Check i enforce-läge (eller dokumenterad rollback-plan)
- [ ] Session/invite token-rotation logik i produktion
- [ ] Firestore PITR + Sentry DSN aktiverade

---

## Sprint 5 — Documentation + developer experience (~16 h, 2–3 dagar)

**Mål:** Framtida-Malin (eller framtida-Claude) kan navigera projektet utan
att läsa all källkod.

### Dag 1 — Dokumentation-pass (~8 h)

- [ ] **B35** — Uppdatera `CLAUDE.md` (30 min)
  - Static export drift (catch-all `/[...path]/`-mönster + usePageMeta)
  - Auth-stub-loss (AuthContext är nu fullt aktiv, inte stub)
  - staleTime override och TMDB_STALE-constants
  - Block/report-moderation + admin-flöde via Firebase Console
  - Emulator setup + `npm run emulators`
- [ ] **B38** — `docs/moderation.md` admin-runbook (30 min)
  - Hur man läser `reports/` i Firebase Console
  - När man actionerar vs dismissar
  - Delete-kaskad för bannad användare
  - Status-maskin för report-flödet
- [ ] **B36** — `docs/RUNBOOK.md` incident playbooks (2 h)
  - "Firestore nere" → observability + rollback
  - "TMDB nere" → graceful degradation
  - "Spam-våg av reports" → throttle + block
  - "Försvunna rader" → PITR recovery-procedur
  - Sentry-alert → var man börjar debugga
- [ ] **B37** — `docs/SLO.md` baseline när data finns (30 min)
  - Tomt skeleton nu; fyll i efter 2 veckor med Plausible+Sentry-data
- [ ] README.md polering + TMDB-attribution + contribution-notes (1 h)
- [ ] Kör analys-systemet igen — jämför score mot baseline 56/100 (2 h)
  - Skriv delta-report: vad löstes, vad är kvar, nya upptäckter

### Dag 2 — Code-hygiene (~4 h)

- [ ] **B5** — Splitta `types/index.ts` (453 rader) (2 h)
  - `types/domain.ts` — WatchlistItem, UserProfile, Review, UserList
  - `types/tmdb.ts` — TMDB*-interfaces
  - `types/advisor.ts` — AdvisorResult, PrimaryAction, ProviderAdvisory
  - `types/social.ts` — Group*, Session*, ReviewComment
  - `types/index.ts` behåller bara re-exports för bakåtkompat
- [ ] **B9** — `assertNever` helper + exhaustive switches (1 h)
  - `src/lib/assertNever.ts` + migrera ~5 switch statements
  - WatchStatus, PrimaryAction-kind, ReportReason är prime candidates

### Dag 3 — Observability + UX polish (~4 h)

- [ ] **B7** — `@next/bundle-analyzer` (30 min)
  - `npm install -D @next/bundle-analyzer`
  - `ANALYZE=true npm run build` genererar `.next/analyze/`
  - Dokumentera i `docs/performance.md`
- [ ] **B23** — Ko-fi/Swish-donate-länk i footer (1 h)
  - Diskret länk i Footer.tsx "Stötta projektet"
  - Plausible-event på klick (`donate_clicked`)
  - Inget payment här, bara externa länkar
- [ ] **B19** — Provider-katalog market-completeness audit (1 h)
  - Cross-check SWEDISH_PROVIDERS mot TMDB /watch/providers/tv?region=SE
  - Flagga saknade tjänster (t.ex. Filmstaden Play, Joyn om relevant)
  - Research-dokument, inte nödvändigtvis kod
- [ ] **B21** — Advisor PrimaryAction state-transition docs (2 h)
  - `docs/advisor-logic.md` med state-graf: idle → pause → catchup →
    subscribe → idle
  - Förklara tröskel-beslut (CATCHUP_THRESHOLD, 30-dagars window)
  - Används vid framtida refaktorer att inte bryta user-expectation

### Exit-kriterier

- [ ] CLAUDE.md reflekterar nuvarande arkitektur
- [ ] Ny analys-körning visar ≥75/100 (upp från 56)
- [ ] Bundle-storlek audited och dokumenterad
- [ ] types/ splittad, inga breaking changes
- [ ] Dokumentations-coverage för moderation + incident-response

---

## Sprint 6 — Arkitektur + performance polish (~24 h, 3–4 dagar)

**Mål:** Tekniska skulder från snabb utveckling städas, appen laddar snabbare
och är offline-capable.

### Dag 1 — Stora komponent-dekompositioner (~8 h)

- [ ] **B4** — Dekomponera `settings/page.tsx` (493 rader) (1 dag)
  - Samma mönster som WatchlistPage/GroupPageClient
  - `settings/ProfileSection.tsx`, `ProvidersSection.tsx`,
    `DisplaySection.tsx`, `ContentFilterSection.tsx`, `TasteDataSection.tsx`,
    `DeleteAccountSection.tsx`, `UsernameSection.tsx`
  - Settings/page.tsx kvar som orchestrator + layout

### Dag 2 — Performance ~8 h

- [ ] **B6** — Dynamic imports av heavy pages (3 h)
  - `SavingsPage` (AdvisorTimeline + charts)
  - `StatsPage` (genre-maps + charts)
  - `FeedPage` (stora komponenter)
  - `next/dynamic` med `ssr: false` + fallback-skeleton
  - Mät bundle-delta i `@next/bundle-analyzer`
- [ ] **B8** — React Query persist-client för offline (1 h)
  - `@tanstack/query-sync-storage-persister`
  - localStorage-persist av alla queries (max 24 h)
  - Mjukar upp "Firestore nere" + gör första laddning snabb
- [ ] Prefetch-audit (2 h)
  - Hover-prefetch på title-cards → useMovie/useTVShow prime
  - Görs automatiskt av React Query med `prefetchQuery` på hover
- [ ] Lighthouse-baseline (2 h)
  - Kör Lighthouse på startsidan + /discover + /movie/detail
  - Dokumentera scores i `docs/performance.md`

### Dag 3 — Långsiktig UGC-hygien ~6 h

- [ ] **B34** — Retention cleanup cron (design, 2 h)
  - Gamla sessions > 30 dagar → delete
  - Gamla notifications > 90 dagar → delete
  - Krävs Cloud Functions → beror på Sprint 10 förutsättning
  - Skriv bara design-dokumentet nu, implementering senare
- [ ] Admin-UI för reports-moderation (1 dag)
  - Enkelt gate:at admin-flöde på `users/{uid}` med `isAdmin: true`
  - `/admin/reports/` lista + action-buttons (action / dismiss)
  - Inte för publik launch; bara för att Malin själv ska slippa
    Firebase Console

### Dag 4 — Final polish ~2 h

- [ ] Replace remaining TODOs across codebase — scan + triage
- [ ] package.json audit — remove unused deps
- [ ] firebase.json CSP-härdning: ta bort 'unsafe-inline' om möjligt

### Exit-kriterier

- [ ] Ingen fil > 400 rader (grep-checka post-sprint)
- [ ] Bundle-size minskat med ≥20% jämfört med Sprint 5
- [ ] Offline-first-beteende verifierat (Chrome DevTools offline)
- [ ] Admin-UI tillgängligt för reports-moderering

---

## Sprint 7 — Major framework upgrades (~40 h, 1 vecka)

**Mål:** React 19 + Next.js 16 + Tailwind v4 (om EOL-aviserat) → löser 4
HIGH CVEs (defanged av static export men ändå värt) och ger tillgång till
Server Components + async hooks som behövs för Sprint 9 push-features.

### Dag 1–2 — React 19 migration (B1)

- [ ] React 19 + react-dom 19 uppgradering
- [ ] Migrate `useCallback`-dependencies där React 19 auto-memoizerar
- [ ] Test-suite validering (vitest körs)
- [ ] Ersätt useEffect-patterns med `use()` där passande
- [ ] Forward-ref-ändringar (ref är nu prop i React 19)

### Dag 3–4 — Next.js 16 migration (B2)

- [ ] `next@16` + `eslint-config-next@16`
- [ ] Läs migration guide, kör codemods
- [ ] Static export → verifiera att `[...path]/` fortfarande funkar
- [ ] Cookies / headers API-ändringar om vi använder dem
- [ ] CI-body `npm run build` → ska ge clean output
- [ ] Deploy till preview channel, testa hela appen
- [ ] `npm audit` → verifiera att 4 HIGH CVEs är lösta

### Dag 5 — Tailwind v4 (B3, conditional)

- [ ] Endast om v3 har EOL-aviserats — annars skippas
- [ ] Om ja: migration via `@tailwindcss/upgrade` CLI
- [ ] Verifiera alla custom colors + spacing tokens

### Exit-kriterier

- [ ] `npm audit` rapporterar 0 HIGH-severity issues
- [ ] 81 tester grön
- [ ] Production deploy funkar
- [ ] Lighthouse-score minst lika bra som före

---

## Sprint 8 — Mockup-driven redesign (~2–3 veckor)

**Mål:** Omsätta design-visionen i `mockups/` till produktion.

### Pre-work (1–2 dagar) — Design review

- [ ] Öppna varje mockup i browsern, ta skärmdumpar
- [ ] Sida-vid-sida jämförelse mot nuvarande UI
  - `1-landing.html` vs nuvarande `/login/` + `/`
  - `2-dashboard.html` vs `/`
  - `3-lists.html` vs `/my/*`
  - `4-advisor.html` vs `/savings/`
  - `5-patterns.html` — komponentbibliotek, mappa mot current
- [ ] Gap-analys per skärm:
  - Nya komponenter som behövs
  - Borttagna/omdesignade komponenter
  - Interaktionsmönster
- [ ] Skapa `docs/redesign-spec.md` med wireframe-translations

### Implementation (2 v)

Bryt ut per-skärm enligt gap-analys. Typisk kadens:
- Ny skärm → nytt Tailwind-tema om behövs
- Komponent-inventory uppdatering
- A/B via feature flag för att kunna rulla tillbaka
- Visual regression screenshots före/efter

### Exit-kriterier

- [ ] Alla 5 mockup-skärmar implementerade i produktion
- [ ] Inga regressions i 81 tester
- [ ] Accessibility audit (WCAG 2.1 AA) body-scan
- [ ] Before/after-screenshots i `docs/redesign-spec.md`

---

## Sprint 9 — Growth features (~2 veckor)

**Mål:** Låsta user-retention-features som kräver Sprint 7 framework-upgrade.

### Vecka 1 — Import + notifications

- [ ] **B11** — Import från Trakt / Letterboxd / IMDb CSV (3–5 dagar)
  - CSV-parser + mappning till WatchlistItem
  - UI: /settings/import med drag-drop + preview
  - Batch-write i chunks om 450 (Firestore-gräns)
  - Dedupe via tmdbId
  - Fail-safe: visa vilka titlar som failat (no TMDB match)
- [ ] **B15** — Web push för episode-releases (2–3 dagar)
  - VAPID-nycklar + Firebase Cloud Messaging
  - `Notification.requestPermission()` i settings (opt-in)
  - Cloud Function trigger (kräver B24 från Sprint 10 för prod — eller
    enkelt client-side schema-check)
  - UI: notification-preferences (per-provider, per-series, global)
- [ ] **B16** — Notification preferences UI (1 dag)
  - Redan har `notificationSettings` på UserProfile — bygg UI för att
    toggla `newEpisodes` + `availableOnMyServices`

### Vecka 2 — UX-förbättringar

- [ ] **B12** — Dark mode (3–5 dagar)
  - Tailwind `dark:` med CSS variables
  - System-pref default, manual override via settings
  - Paletten från mockup 5-patterns.html om applicable
  - Testa alla sidor mot dark-mode color-contrast-audit
- [ ] **B17** — HBO Max (384) vs Max (1899) unifiering (30 min research + 30 min kod)
- [ ] **B18** — C More legacy alias till TV4 Play (30 min)
- [ ] **B20** — Watchlist film providers freshness (1 dag)
  - Cron-pattern: refresh provider-array på filmer > 90 dagar gamla
- [ ] **B22** — Recommendations filter-chain deep audit (1 h)

### Exit-kriterier

- [ ] Användare kan importera från Trakt/Letterboxd
- [ ] Web push fungerar på Chrome + Firefox
- [ ] Dark mode stabilt på alla sidor
- [ ] Provider-katalog up-to-date

---

## Sprint 10 — Monetization (~4–5 veckor, ENDAST om user-beslut fattas)

**Mål:** Kunna ta emot betalningar för premium-features (om det blir aktuellt).

### Pre-beslut — Strategi

- [ ] Avgörande: donate-first (Ko-fi) vs paid subscription?
- [ ] Om paid: free-tier vs trial-tier? Vad är paid gate:at bakom?
  - Förslag: core är free forever (watchlist + TMDB + providers)
  - Paid: grupp-sessions, taste-match > 10 friends, unlimited lists

### Vecka 1 — Cloud Functions foundation (B24)

- [ ] Firebase Cloud Functions setup
- [ ] Deploy pipeline (separat från hosting)
- [ ] Environment-config + secrets management
- [ ] Första funktionen: send-welcome-email (smoke test)

### Vecka 2–3 — Payment integration (B25)

- [ ] Paddle sandbox-setup (rekommenderat för EU VAT-handling)
- [ ] Paddle webhook → Cloud Function → update `users/{uid}/subscription`
- [ ] Checkout-integration i frontend
- [ ] Test-kort end-to-end flow

### Vecka 4 — Paywall + billing (B26 + B27)

- [ ] Subscription-fält på UserProfile: `plan`, `renewsAt`, `canceledAt`
- [ ] Firestore-rules för paid-features
- [ ] Paywall-UI när free-användare hittar paid-feature
- [ ] Billing portal (Paddle's default räcker initialt)
- [ ] Analytics: plausible `upgrade_clicked` / `upgrade_completed`

### Vecka 5 — Launch + support

- [ ] Pricing-page
- [ ] Terms of service-uppdatering för betalda tjänster
- [ ] Refund-policy (EU 14-dagars cooling-off)
- [ ] Support-dokumentation (hur avslutar man?)

### Exit-kriterier

- [ ] End-to-end paid user-flow fungerar
- [ ] Webhooks hanterar renewals + refunds
- [ ] Paywall syns bara för free-users som försöker nå paid-feature
- [ ] Billing-portal + support-email live

---

## Sprint 11+ — PWA + native (långsiktigt)

### B13 — PWA install-to-home (1 vecka)

- [ ] manifest.json + service worker
- [ ] Offline-first via Workbox (bygger vidare på Sprint 6 B8)
- [ ] Install-banner + app-ikon
- [ ] Test på iOS Safari + Android Chrome

### B14 — Native apps (months)

- [ ] Overvägande: React Native vs Capacitor vs wrapper
- [ ] Capacitor är enklast om PWA:n är stabil
- [ ] Native features: push-notifications (Firebase Cloud Messaging),
  share-sheet, calendar-sync
- [ ] App Store + Play Store-submission

---

## Beroendegraf (förenklad)

```
External: PITR, EU-region, Sentry DSN, branch protection  [do now]
    ↓
Sprint 4 (Compliance) ←───────────────────┐
    ↓                                      │
Sprint 5 (Docs/DX) [kan göras parallellt]  │
    ↓                                      │
Sprint 6 (Arkitektur)                      │
    ↓                                      │
Sprint 7 (Frameworks) ─────────┐           │
    ↓                           ↓          │
Sprint 8 (Mockups)   Sprint 9 (Growth)    │
    ↓                           ↓          │
    └──────────┬────────────────┘          │
               ↓                           │
     Sprint 10 (Monetization) ─────────────┤
               ↓                           │
     Sprint 11+ (PWA/native) ←─────────────┘
```

## Sprint-val — strategi-råd

**Om resurstight:** Gör externals + Sprint 4 + Sprint 5. ~2 veckor totalt.
Det stänger compliance-gapet och dokumenterar för framtida dig.

**Om medium tid:** Ovanstående + Sprint 6 + Sprint 7. ~1 månad. Nu är
tekniska skulder städade och frameworks uppgraderade.

**Om du vill launcha offentligt:** Ovanstående + Sprint 8 (mockup-redesign).
~6 veckor. Nu har du ett polerat v2 att visa.

**Om tillväxt är mål:** Ovanstående + Sprint 9. ~2 månader. Import +
push + dark mode drar in och behåller användare.

**Om ekonomi är mål:** Sprint 10 triggas när du fattat product-
strategy-beslut. Parkera tills det finns.

## Effort-summering

| Sprint | Effort | Kumulativt |
|--------|--------|-----------|
| External | ~45 min | ~45 min |
| 4 Compliance | ~40 h | ~41 h |
| 5 Docs/DX | ~16 h | ~57 h |
| 6 Arkitektur | ~24 h | ~81 h |
| 7 Frameworks | ~40 h | ~121 h |
| 8 Mockups | ~80–120 h | ~200–240 h |
| 9 Growth | ~60–80 h | ~260–320 h |
| 10 Monetization | ~160–200 h | ~420–520 h |
| 11+ PWA+native | månader | — |

## Nästa steg

1. Kör externals-listan (45 min)
2. Välj Sprint 4 eller Sprint 5 att börja med
   - Sprint 4 om GDPR-exponering oroar dig
   - Sprint 5 om du vill "känna" projektet städat innan större arbete
3. Efter varje sprint: committ/merge/push/deploy/purge-cykeln

---

_Planen är levande. När Sprint N är klar, uppdatera status + prognostisera
om tidsestimat stämmer mot verklighet._
