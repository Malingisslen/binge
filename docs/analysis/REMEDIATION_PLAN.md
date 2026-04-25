# Binge — Remediation Plan (Phase 2)

**Baserad på:** Phase 1-analys (rapporter raderade 2026-04-25 inför ev.
publik repo; promptarna i `docs/analysis/prompts/` kan regenerera dem).
**Datum:** 2026-04-20
**Omfattning:** Alla 190+ fynd från Phase 1, grupperade i 3 sprintar +
backlog.
**Mål:** Binge launch-legal efter Sprint 1, sustainable-to-operate efter
Sprint 2, competitive efter Sprint 3.

---

## Planens principer

1. **Launch-blockers först.** 8 CRITICAL + 7 HIGH från synthesis är
   icke-förhandlingsbara innan offentlig launch.
2. **Quick wins tidigt.** `npm audit fix`, enable PITR, verify region —
   minuter till timmar för hög inverkan.
3. **Gruppera relaterade fix.** Undvik att rita upp en Firestore-regel
   och sedan rita om den en vecka senare.
4. **Följ beroenden.** Tester kräver framework, delete-cascade kräver
   Cloud Functions eller batchad client-side, analytics kräver consent-
   banner (eller cookie-free alternativ).
5. **En sprint = max ~2 veckor fokuserat soloarbete.** Verkligt timing
   skiftar med distraktioner; siffrorna är *focused work*.
6. **Ingen omfattning-uppblåsning.** Om något kan deferreras utan
   risk, defer. Plan prioriterar *klarhet* över *fullständighet*.

---

## Sprint 1 — Launch-blockers (~60 h fokuserat arbete, ~2 kalenderveckor)

Mål: Binge är legalt launch-redo efter Sprint 1. Alla 8 CRITICAL + de 4
HIGH som har compliance/data-loss-risk.

### Dag 1 — Atomic quick wins (~4 h)

Kör i denna ordning; varje kan committas separat.

- [ ] **1.1** — `npm audit fix` → löser protobufjs CRITICAL CVE
  (cross-ref 05 V1). **5 min**
- [ ] **1.2** — Enable Firestore PITR:
  ```bash
  gcloud firestore databases update --database="(default)" \
    --project=binge-nu --enable-pitr
  ```
  (cross-ref 03 DR1). **5 min**
- [ ] **1.3** — Verify Firebase project region:
  - Firebase Console → Firestore → Settings → Location
  - Om US region: dokumentera i privacy policy (migrationsbeslut senare)
  - (cross-ref 02 G-5, 09 T-1, 11 FH-1). **5 min**
- [ ] **1.4** — Lägg till HTTP security headers i `firebase.json`
  (cross-ref 02 A5-1, 04 I3, 09 TP-2). **30 min**
  ```json
  "headers": [{
    "source": "**",
    "headers": [
      { "key": "Content-Security-Policy", "value": "..." },
      { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "X-Frame-Options", "value": "DENY" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
    ]
  }, {
    "source": "/_next/static/**",
    "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
  }]
  ```
  **Acceptance:** `curl -I https://binge.nu` visar alla headers.
- [ ] **1.5** — Lägg TMDB attribution + logga i footer
  (cross-ref 07 T-1, 11 TMDB-CRIT). **30 min**
  - Lägg svenska text: "Binge använder TMDB:s API men är inte godkänd
    eller certifierad av TMDB. Filmdata från themoviedb.org."
  - Hämta officiell TMDB-logga från https://www.themoviedb.org/about/logos-attribution
- [ ] **1.6** — Schedulerade Firestore-backuper
  (cross-ref 03 DR2). **30 min**
  ```bash
  gcloud firestore backups schedules create \
    --database="(default)" --project=binge-nu \
    --recurrence=daily --retention=14w
  ```
- [ ] **1.7** — Firebase billing-alert + UptimeRobot sign-up
  (cross-ref 03 I1, M3). **30 min**

### Dag 2 — Kärnproduktbuggar + re-render-ekonomi (~4 h)

- [ ] **2.1** — Fixa `canonicalProviderId`-buggen på alla 18+ ställen
  (cross-ref 07 P-CRIT). **2 h**
  - Söka: `grep -rn "provider_id" src/ | grep -v canonicalProviderId`
  - Per site, wrappa `p.provider_id` i `canonicalProviderId(p.provider_id)`
    vid varje jämförelse mot `myProviders`.
  - **Speciellt:** `src/app/search/page.tsx:44`, `ProviderTag.tsx:13`,
    `TitleCard.tsx:56`, `RecommendationsSection.tsx:30`,
    `useNotifications.ts:72`.
  - **Acceptance:** en TV4-Play-titel där TMDB returnerar 1944 visar
    highlighting + filtrerar korrekt för en user med 489 (eller 1944) i
    `myProviders`.
  - **Bonus:** lägg till en ESLint-regel eller branded type
    `CanonicalProviderId` så framtida regressioner fångas.
- [ ] **2.2** — Memoize alla 3 context provider values
  (cross-ref 01 HIGH 1–4). **2 h**
  - `AuthContext.tsx:263` — wrappa i useMemo med alla callback-deps
  - `WatchlistContext.tsx:167` — samma
  - `ToastContext.tsx:29` — samma
  - Alla callbacks redan useCallback-stabila; detta är bara att
    komprimera till ett objekt.
- [ ] **2.3** — Rensa React Query cache vid sign-out
  (cross-ref 01 #13, 02 A-1). **30 min**
  ```ts
  const queryClient = useQueryClient();
  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    queryClient.clear();
  }, [queryClient]);
  ```
- [ ] **2.4** — Fix `deleteAccount` stale closure på `user.username`
  (cross-ref 01 #18, 02 A-2). **30 min**
- [ ] **2.5** — Fix `useEpisodeProgressWithSync` missing `episodeProgress` deps
  (cross-ref 01 #19). **30 min**

### Dag 3–7 — Legal docs sprint (~1 vecka)

Parallella workstreams om hjälp finns; annars sekventiellt.

- [ ] **3.1** — Draft svensk integritetspolicy
  (cross-ref 11 PP-CRIT, 09 L-CRIT). **3 dagar**
  - Skopa från 11-rapporten (10-punkts-lista)
  - Publicera på `/integritet`
  - Nämn IMY som tillsynsmyndighet
  - Lista alla tredjepartsprocessorer (Firebase/Google, Cloudflare, TMDB)
  - Dokumentera Firebase-region (från 1.3)
- [ ] **3.2** — Draft svensk Terms of Service
  (cross-ref 11 TOS-CRIT). **2 dagar**
  - Åldersgräns 13 (GDPR Art. 8 svensk implementation)
  - Jurisdiktion: svensk lag
  - User content ownership + Binges licens
  - TMDB-attribution referens
  - Publicera på `/villkor`
- [ ] **3.3** — Draft community guidelines
  (cross-ref 09 CG-1, 11 CG-CRIT). **2 h**
  - Kort dokument (~500 ord)
  - Publicera på `/community-guidelines`
- [ ] **3.4** — Sign-up T&C-acceptans
  (cross-ref 09 L-2, 11 TOS-2). **1 h**
  - Checkbox + länkar i `src/app/login/page.tsx` register-flöde
  - Spara `termsAcceptedAt`, `termsVersion` på user-doc
- [ ] **3.5** — Lägg åldersgräns-checkbox ("Jag är 13 år eller äldre")
  (cross-ref 09 Children-CRIT, 11). **30 min (bundled med 3.4)**
- [ ] **3.6** — Footer med legal-länkar
  (cross-ref 09 L-3, 11). **30 min**
  - `/integritet`, `/villkor`, `/community-guidelines`, `/kontakt`
  - TMDB-attribution här om inte redan placerad i 1.5

### Dag 8–9 — Account deletion + Firestore-regelhärdning (~2 dagar)

- [ ] **4.1** — Expandera account deletion cascade
  (cross-ref 02 G-3, 11 LC-1). **1 dag**
  - Fält som saknas just nu:
    - `reviews` where `uid == self` (+ deras subcollections likes/comments)
    - `lists` where `uid == self`
    - `users/*/followers/{self.uid}` (collection-group query)
    - `users/{self.uid}/following/*` (if missing — verify)
    - `groups/{groupId}.memberUids` där user är med → remove + update
    - `groups/{groupId}/members/{self.uid}` → delete
    - `sessions` där `hostUid == self.uid` (Tillsammans)
  - Använd flera batcher (Firestore 500-op limit)
  - Overväg flytta till Cloud Function om batchar blir många (Sprint 2)
  - **Acceptance:** manuellt test — skapa user, gör content överallt,
    ta bort kontot, verifiera alla collections genom Firestore Console
- [ ] **4.2** — Field validation på alla Firestore-regler
  (cross-ref 02 A1-1). **2–3 h**
  - För varje `match`-block, lägg till `request.resource.data.keys().hasOnly([...])`
    och per-fält typ/längd/range-checks
  - Exempel review:
    ```
    allow create: if request.auth != null
      && request.resource.data.uid == request.auth.uid
      && request.resource.data.keys().hasOnly(['uid','tmdbId','mediaType','rating','text','createdAt'])
      && request.resource.data.rating is int && request.resource.data.rating >= 0
      && request.resource.data.rating <= 10
      && request.resource.data.text is string && request.resource.data.text.size() < 5000
      && request.resource.data.createdAt == request.time;
    ```
- [ ] **4.3** — Username validation + case-normalisering
  (cross-ref 02 U-1). **1 h**
  - Client-side: lowercase + regex `/^[a-z0-9_]{3,30}$/` innan skrivning
  - Firestore-regel: `request.resource.data.uid == request.auth.uid`
    (finns) + `username.matches('^[a-z0-9_]{3,30}$')` tillägg

### Dag 10–12 — Accessibility baseline (~3 dagar)

EAA (SFS 2023:254) är tvingande sedan 2025-06-28 för konsumenttjänster.

- [ ] **5.1** — skip-to-content link
  (cross-ref 06 A-CRIT). **30 min**
  ```tsx
  // i layout.tsx före <body>
  <a href="#main" className="sr-only focus:not-sr-only fixed top-2 left-2 ...">
    Hoppa till innehåll
  </a>
  // Lägg id="main" på AppShell main-elementet
  ```
- [ ] **5.2** — `aria-live` i ToastContext
  (cross-ref 06 A-CRIT). **30 min**
  - Wrap toast-container i `<div role="region" aria-live="polite" aria-atomic="true">`
- [ ] **5.3** — `prefers-reduced-motion` respekt
  (cross-ref 06 A-CRIT). **30 min**
  - I `globals.css`:
    ```css
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
    }
    ```
- [ ] **5.4** — Audit 141 onClick sites — `<div onClick>` → `<button>`
  (cross-ref 06 A-CRIT). **1 dag**
  - Strategi: grep, sortera per fil, fixa filvis
  - Förvänta ~20–30 % är på fel element
- [ ] **5.5** — `aria-label` på icon-only buttons
  (cross-ref 06 A-CRIT). **1 dag**
  - Start: StatusButton, bookmark-ikoner, share-ikoner, filter-toggles
- [ ] **5.6** — Färgkontrast-audit + palette-migration
  (cross-ref 06 D3, A-CRIT). **1 dag**
  - Kör WebAIM Contrast Checker för varje token-par
  - Specifikt: `text-muted` (#999) på `page` (#eeece8) ≈ 2.8:1 = FAIL AA body
  - `accent` (#d97b35) på `page` ≈ 3.1:1 = FAIL AA body, endast large
  - Fix: antingen mörka `text-muted` till `#777` (4.5:1+) eller
    begränsa användning till "large text only" kontexter
  - Lägg token `error` / `error-bg` / `error-border` i `tailwind.config.ts`
    (för de 27 Tailwind-built-in röd/blå/grön-användningarna;
    cross-ref 06 D3)

### Dag 13–14 — Analytics + design-rule cleanup (~2 dagar)

- [ ] **6.1** — Integrera Plausible
  (cross-ref 08 E-CRIT, 09 C-1). **1 dag**
  - Välj Plausible (cookie-free, ingen consent-banner nödvändig enligt
    IMY-praxis)
  - Lägg till `<script defer data-domain="binge.nu" src="https://plausible.io/js/script.js">`
    i `layout.tsx`
  - Uppdatera CSP `script-src` + `connect-src` i `firebase.json` för
    plausible.io
  - Lägg till `src/lib/analytics.ts` med typad wrapper
  - Tagga de kritiska eventen:
    - `signed_up`, `signed_in`
    - `providers_selected` (count)
    - `first_title_added`
    - `title_added_watchlist` (status, mediaType)
    - `status_changed`
    - `advisor_viewed`, `advisor_action_taken`
    - `revival_nudge_shown`, `revival_nudge_acted_on`
    - `search_submitted` (utan query-text, bara query-length)
    - `error_boundary_triggered`
- [ ] **6.2** — Ta bort landing-page gradient
  (cross-ref 06 D1). **5 min**
  - `src/app/page.tsx:29`: ändra `bg-gradient-to-b from-[#1e2028] to-[#2a2a3a]`
    → `bg-[#1e2028]`
- [ ] **6.3** — Ta bort TitleCard hover-transform
  (cross-ref 06 D2). **5 min**
  - `src/components/title/TitleCard.tsx:39`: ta bort
    `transition-transform duration-150 hover:-translate-y-[1px]`
- [ ] **6.4** — Specifika svenska felmeddelanden ersätter "Något gick fel"
  (cross-ref 06 C1). **2 h**
  - 4+ sites: login, settings, grupper/ny, recommended copy in report

### Sprint 1 exit-kriterier

- [ ] Alla 10 CRITICAL-fynd åtgärdade
- [ ] Privacy policy + ToS + community guidelines publicerade
- [ ] `canonicalProviderId`-bugg stängd
- [ ] TMDB-attribution visible
- [ ] Security headers deployed
- [ ] Firestore PITR + scheduled backups aktiva
- [ ] Account deletion cascade fullständig
- [ ] Accessibility baseline: skip-link + aria-labels + kontrast
- [ ] Analytics samlar data

**Status efter Sprint 1: Binge är minimalt launch-legalt.**

---

## Sprint 2 — Quality foundation (~80 h fokuserat, ~2–3 kalenderveckor)

Mål: Binge är sustainable-to-operate. Tester + observability + CI-grindar
förhindrar regressioner; arkitektur-städning gör framtida arbete
snabbare.

### Vecka 1 — Tester + CI (~5 dagar)

- [ ] **7.1** — Installera Vitest + @testing-library/react + MSW
  (cross-ref 03 T1, 07 Dim 7). **2 h**
- [ ] **7.2** — Första 36 enhetstester på ren logik (~1 dag)
  - `airingState.ts` — 10 tester (varje TMDB-status + null/undefined)
  - `watchStatus.ts` — 8 tester (movie vs tv asymmetry)
  - `canonicalProviderId` + `getProvider` — 6 tester (known, alias, unknown)
  - `getDisplayTitle` — 12 tester (Latin, CJK, Cyrillic, null)
- [ ] **7.3** — Advisor-scenariotester (~2 dagar)
  - Golden scenarios från `useSubscriptionAdvisor`:
    - Tom myProviders → idle
    - 3+ unfinished → catchup
    - 1 paid, inget följer → pausable
    - 3+ red signals → combination
  - Revival-nudge false positive / negative fall
- [ ] **7.4** — Komponentstickprov (2–3 komponenter) (~0.5 dag)
  - StatusButton, ProviderTag, WatchlistPage filter
- [ ] **7.5** — CI-kvalitetsgrindar
  (cross-ref 03 B1, 03 T2). **1 dag**
  - PR-trigger i `.github/workflows/deploy.yml` (lint + typecheck + test)
  - Blocka deploy om någon fejlar
  - `npm audit --audit-level=high` som kvalitetsgrind
- [ ] **7.6** — Firestore rules-unit tests
  (cross-ref 03 T1 rules). **1 dag**
  - `@firebase/rules-unit-testing` är inte i `package.json` än — lägg till
  - Testa varje rule-path (get/list/write × owner/non-owner × isPublic)

### Vecka 2 — Observability + säkerhetshärdning (~3 dagar)

- [ ] **8.1** — Sentry gratis-tier
  (cross-ref 03 M1, 02 A9-1). **2 h**
  - `@sentry/nextjs` install + config
  - Samla JS-fel + unhandled rejections
  - Respektera consent (om den blivit tillagd; med Plausible-only kan
    Sentry enablas default)
  - Frontend ErrorBoundary → Sentry.captureException
- [ ] **8.2** — Global React Query onError
  (cross-ref 01 #14). **1 h**
  - I `Providers.tsx`:
    ```ts
    new QueryClient({
      queryCache: new QueryCache({ onError: (err, query) => { toast(...); Sentry.captureException(err); } }),
      ...
    })
    ```
- [ ] **8.3** — Dependabot config
  (cross-ref 05 S1, 03 S1). **15 min**
  - `.github/dependabot.yml` per 05-rapportens förslag
- [ ] **8.4** — Firebase emulator-config
  (cross-ref 03 W1). **30 min**
  - `firebase.json` → lägg `emulators:` block
  - Uppdatera README med `firebase emulators:start`
- [ ] **8.5** — Segment-level error.tsx
  (cross-ref 01 #16). **1 h**
  - Lägg `error.tsx` under `/grupper/[id]/`, `/tillsammans/[id]/`,
    `/tv/[id]/`, `/movie/[id]/`
- [ ] **8.6** — Segment-level staging / preview
  (cross-ref 03 B3, D1). **30 min**
  - Nytt workflow `.github/workflows/deploy-preview.yml` för PR-triggers
    med `channelId: pr-${{ github.event.number }}`
  - (Full staging-projekt defererat till Sprint 3 om behövs)

### Vecka 3 — Arkitektur + Firestore-kostnad (~5 dagar)

- [ ] **9.1** — Dekomponera `GroupPageClient.tsx` (908 rader)
  (cross-ref 01 #5). **1 dag**
  - Extrahera: `GroupHeader`, `GroupMemberList`, `GroupWatchlistTable`,
    `useGroupData` hook
- [ ] **9.2** — Dekomponera `WatchlistPage.tsx` (614 rader)
  (cross-ref 01 #9). **1 dag**
  - Extrahera: `WatchlistTableView`, `WatchlistGridView`,
    `WatchlistFilterBar`, `useWatchlistFiltering`
- [ ] **9.3** — Denormalisera `isPublic` på subcollections
  (cross-ref 04 F1). **1 dag**
  - Varje watchlist/following/review-doc får `isPublic` mirror
  - När user toggle:ar `isPublic` → backfill propagation (Cloud Function
    eller client batch)
  - Ta bort cross-doc `get()` i Firestore-regler för public-read-paths
  - **Kostnadspåverkan:** 2–3× read-cost reduktion på public-profile-views
- [ ] **9.4** — `limit()` + `useInfiniteQuery` på unbounded listor
  (cross-ref 04 F2). **1 dag**
  - `useLists` (alla lists for user)
  - `useReviews` (alla reviews on title)
  - `useReviewSocial` (alla comments)
  - Gruppernas watchlists
- [ ] **9.5** — TMDB rate-limit handling + AbortSignal
  (cross-ref 04 T2, T3, 07 I-3, I-4). **3 h**
  - Wrappa `tmdbFetch` med 429-handler: backoff + `Retry-After`
  - Acceptera + forwarda `AbortSignal` (React Query skickar en per query)
- [ ] **9.6** — Advisor fan-out staggering
  (cross-ref 04 P2, 07 I-3). **4 h**
  - Chunk `tmdbIds` i grupper om 10, stagger med 2 s mellanrum
  - Eller: använd cachat `tmdbStatus` först, TMDB-fetch endast för de
    som behöver färsk data
- [ ] **9.7** — Fix staleTime-konflikt mellan advisor + revival
  (cross-ref 01 #22, 04 T1). **30 min**
  - Olika query keys: `['tv', id, 'advisor']` vs `['tv', id, 'revival']`
    ELLER unify staleTime

### Sprint 2 exit-kriterier

- [ ] ≥ 50 enhetstester gröna i CI
- [ ] Firestore rules-tests gröna
- [ ] Sentry fångar errors i produktion
- [ ] CI blockar deploy vid lint/typecheck/test-fail
- [ ] 2 god-components dekomponerade
- [ ] Firestore rule-cost kollar bevisat reducerat
- [ ] TMDB fan-out hanterar 429 utan user-visible fel

---

## Sprint 3 — Growth + polish (~40 h, ~1 kalendervecka)

Mål: Binge är discoverable + har mekanismer för att tillväxa.

### Dag 1–2 — SEO + delning (~2 dagar)

- [ ] **10.1** — Dynamisk sitemap för title-pages
  (cross-ref 08 SEO-1). **1 dag**
  - `src/app/sitemap.ts` (Next.js dynamic sitemap generator)
  - Inkludera topp-N populära TMDB titel-IDs (eller top-scanned via
    analytics-data efter några veckor)
  - Bygger vid `next build` när static export körs
- [ ] **10.2** — Per-page metadata
  (cross-ref 08 SEO-3). **3 h**
  - `generateMetadata` på `/movie/[id]`, `/tv/[id]`, `/person/[id]`
  - Title: "{Title} ({Year}) — var kan jag streama? — Binge.nu"
  - Description: sammanfattning + providers
- [ ] **10.3** — JSON-LD structured data
  (cross-ref 08 SEO-2). **1 dag**
  - Schema.org `Movie` / `TVSeries` på detail pages
  - Schema.org `Review` när reviews visas publikt
  - `BreadcrumbList` med breadcrumb
- [ ] **10.4** — OG image + Twitter card
  (cross-ref 08 V-1, V-2). **1 h**
  - Global default: binge.nu OG-svg → PNG 1200x630
  - Uppdatera `layout.tsx` openGraph med images + twitter-card
  - Per-page dynamic OG-image for titles: defererat (dagar för static
    export); lämna till Sprint 4 / backlog

### Dag 3–5 — Onboarding + UGC-moderation (~3 dagar)

- [ ] **11.1** — Guided onboarding-flöde
  (cross-ref 08 O-1, 06 F1). **2 dagar**
  - Ny route `/onboarding/` med:
    1. Välkommen + value-prop-skärm
    2. Provider-val (pre-fylld med populäraste svenska tjänster)
    3. (valfritt) `/kalibrera`-länk
    4. Lägg till första titeln (med "Prova med [populär titel]"-förslag)
  - Första inloggning → redirect till onboarding
  - Spara `onboardingCompletedAt` på user
- [ ] **11.2** — Länka `/kalibrera` från onboarding + settings
  (cross-ref 08 O-3). **15 min**
- [ ] **11.3** — UGC report-mekanism
  (cross-ref 09 M-1). **1 dag**
  - Ny collection `reports/{reportId}` (admin-only via admin SDK)
  - UI: "Rapportera" på reviews, comments, usernames
  - Firestore rules för rapport-create (authed, rate-limited)
  - Admin-flöde via Firebase Console (moderation.md runbook)
- [ ] **11.4** — UGC block-mekanism
  (cross-ref 09 M-2). **1 dag**
  - `users/{uid}/blocked/{targetUid}` subcollection
  - Filter vid read-time (klient-side) i feed / reviews / follows

### Dag 6–7 — Image + performance polish (~2 dagar)

- [ ] **12.1** — Image-optimering på alla 28 `<img>`
  (cross-ref 04 P1, 06/04). **1 dag**
  - `loading="lazy"` på below-the-fold
  - Explicita `width`/`height` attribut (CLS-fix)
  - `srcSet` för responsiv w92/w154/w342 per kontext
  - `decoding="async"`
  - Context-lämplig storlek (w92 för thumbnails, w500 för heroes)
- [ ] **12.2** — TMDB /trending region=SE + /discover/tv region=SE
  (cross-ref 07 I-1, I-2). **15 min**
- [ ] **12.3** — Advisor-ads-bucket gating
  (cross-ref 07 A-2). **1 h**
  - Inkludera `ads` bucket bara när user har relevant subscription
- [ ] **12.4** — Advisor user-visible error state
  (cross-ref 07 R-1). **1 h**
  - Expose `hasError: boolean` i AdvisorResult
  - Widget-component renderar specifik empty-state vid fel

### Sprint 3 exit-kriterier

- [ ] Long-tail SEO-queries ("var streamar X") landar på title-pages
  med strukturerad data
- [ ] OG-kort visar preview i Slack/Twitter/WhatsApp
- [ ] Ny användare kompletterar onboarding
- [ ] Report + block mekanismer live
- [ ] Image-optimering klar → LCP förbättrad

---

## Backlog (defererat)

Dessa är inte launch-blockers men bör hanteras efterhand.

### Deps + framework upgrades (efter Sprint 2)

- [ ] **B1** — React 19 migration (1–2 dagar)
  (cross-ref 05 Complex)
- [ ] **B2** — Next.js 16 + eslint-config-next 16 (2–3 dagar efter B1)
  - Löser 4 HIGH CVEs (defanged av static export men fortfarande värt)
- [ ] **B3** — Tailwind v4 (defererat till när v3 EOL aviserats)

### Strukturella förbättringar

- [ ] **B4** — Dekomponera `settings/page.tsx` (493 rader) (1 dag)
- [ ] **B5** — Splitta `types/index.ts` (453 rader) i tmdb/advisor/
  domain/social (2 h)
- [ ] **B6** — Dynamic imports av heavy pages (3 h)
- [ ] **B7** — `@next/bundle-analyzer` för bundle-audits (30 min install)
- [ ] **B8** — React Query persist-client för offline (1 h)
- [ ] **B9** — `assertNever` helper + exhaustive switches (1 h)

### Produkt-features

- [ ] **B10** — Data export (JSON) — GDPR Art. 20 (1 dag)
  (cross-ref 02 G-2, 10 F-1, 11 LC-2)
- [ ] **B11** — Import från Trakt / Letterboxd / IMDb CSV (3–5 dagar)
  (cross-ref 10 F-2)
- [ ] **B12** — Dark mode (3–5 dagar) (cross-ref 10 F-3)
- [ ] **B13** — PWA install-to-home (1 vecka) (cross-ref 10 F-4)
- [ ] **B14** — Native apps (months) (cross-ref 10 M-1)
- [ ] **B15** — Web push för episode-releases (2–3 dagar)
  (cross-ref 08 N-2)
- [ ] **B16** — Notification preferences UI (1 dag) (cross-ref 08 N-3)

### TMDB + provider-katalog

- [ ] **B17** — HBO Max (384) vs Max (1899) unifiering eller dokumentation
  (30 min research + 30 min kod) (cross-ref 07 P-3)
- [ ] **B18** — C More legacy alias till TV4 Play om TMDB returnerar det
  (30 min) (cross-ref 07 P-4)
- [ ] **B19** — Provider-katalog market-completeness audit
  (1 h) (cross-ref 07 P-2)
- [ ] **B20** — Watchlist film providers freshness (Phase 3 cron?)
  (1 dag) (cross-ref 07 R-2)
- [ ] **B21** — Advisor PrimaryAction state-transition documentation
  (2 h) (cross-ref 07 A-1)
- [ ] **B22** — Recommendations filter-chain deep audit (1 h)
  (cross-ref 07 REC-1)

### Monetization (när user-decision fattas)

- [ ] **B23** — Ko-fi / Swish-donate-länk i footer (1 h — near-term)
- [ ] **B24** — Cloud Functions setup (förutsättning för anything paid)
  (1 vecka)
- [ ] **B25** — Payment integration (Paddle rekommenderat — 2–3 veckor)
- [ ] **B26** — Paywall UI + billing portal (1 vecka efter B25)
- [ ] **B27** — Subscription fields + rules (cross-ref 10 E-1, SCH-1) (2 h)

### Säkerhet + compliance (långsiktigt)

- [ ] **B28** — Firebase App Check (cross-ref 02 A7-3) (2 h)
- [ ] **B29** — Email verification på sign-up (cross-ref 02 A7-1) (1 h)
- [ ] **B30** — Password strength policy (cross-ref 02 A7-2) (30 min)
- [ ] **B31** — Invite token rotation för grupper (cross-ref 02 A4-1) (2 h)
- [ ] **B32** — Session expiry för Tillsammans (cross-ref 02 A4-1) (1 h)
- [ ] **B33** — Anonymization-vs-deletion policy för public UGC
  (cross-ref 11 LC-4) (design + docs)
- [ ] **B34** — Retention cleanup cron (gamla sessions, notifications)
  (cross-ref 11 LC-3) (förutsätter Cloud Functions)

### Dokumentation

- [ ] **B35** — Uppdatera CLAUDE.md (static export drift, auth stub,
  staleTime override) (cross-ref 01 #23-25) (30 min)
- [ ] **B36** — `docs/RUNBOOK.md` / incident playbooks (cross-ref 03 DR3) (2 h)
- [ ] **B37** — `docs/SLO.md` baseline när data finns (cross-ref 03 M4) (30 min)
- [ ] **B38** — `docs/moderation.md` admin-flöde (30 min)

### Marketing (efter launch)

- [ ] **B39** — Press-pitch-förslag: "Svenskar slösar X kr/år på oanvända
  streaming" (data-driven) (cross-ref 10 GTM-2)
- [ ] **B40** — Guide-content pipeline (1–2 artiklar/månad)

---

## Beroendegraf (förenklad)

```
Sprint 1 (launch-blockers)
  ├── Quick wins (deps, PITR, region, headers, attribution)
  ├── Core bugs (canonicalProviderId, signOut cache, contexts)
  ├── Legal docs
  │     └── Sign-up acceptance (depends on docs existing)
  ├── Delete cascade
  │     └── Field validation (rules change same sprint)
  ├── A11y baseline
  └── Analytics (Plausible — cookie-free, consent-independent)

Sprint 2 (quality foundation)
  ├── Tests + CI gates
  │     └── Förutsätter inget; kan starta tidigt
  ├── Observability (Sentry)
  │     └── Kan parallelliseras
  ├── Architecture decomposition
  │     └── God-components kan delas när som helst
  └── Firestore perf + cost
        └── Denormalize isPublic (förutsätter delete-cascade stabil)

Sprint 3 (growth)
  ├── SEO (beror på metadata + sitemap — kan köras parallellt)
  ├── Onboarding (beror på Sprint 1 sign-up + T&C)
  └── UGC moderation (beror på Sprint 1 rules stabilitet)

Backlog
  ├── React 19 → Next 16 (kronologiskt)
  ├── Data export / import (efter delete-cascade stabil)
  └── Monetization (efter Cloud Functions setup)
```

---

## Rekommenderat arbetsflöde

1. **Gör Sprint 1 i ordning.** Dag 1 quick wins ger mycket moral-boost +
   säkerhet för lågt effort. Dag 2 bugfixes ger real product correctness.
   Dag 3-7 docs är deg — starta tidigt, jobba parallellt med kod.
2. **Commita ofta.** Varje task i planen är i sig committable. Håll PRs
   små.
3. **Kör testerna INNAN du tar tag i Sprint 2 arkitekturstädning.**
   Utan tests är varje dekomposition en risk.
4. **Re-audita efter Sprint 1.** Kör om lint / tsc / `npm audit`
   mellan sprintar för att verifiera att inget regresserat.
5. **Uppdatera CLAUDE.md löpande.** Varje arkitekturbeslut → doc. Annars
   driver CLAUDE.md igen.
6. **Skriv en release-notering** (även om det bara är intern log) när
   varje sprint-exit-kriterium är uppnått.

---

## Sprint 1 — 30-sekunders-utgångspunkt

Om du bara har 1 vecka, gör detta i ordning:

1. **Dag 1 (3–4 h):** Alla quick wins (1.1–1.7) + context memoization (2.2)
   → eliminerar 6 CRITICAL på halv dag
2. **Dag 2 (2 h):** `canonicalProviderId`-fix (2.1) + signOut cache (2.3)
   → core product works correctly
3. **Dag 3–5:** Legal docs (3.1–3.6)
4. **Dag 6:** Account delete cascade (4.1) + field validation (4.2)
5. **Dag 7:** Accessibility-baseline (5.1–5.3 minimum)

Resten av Sprint 1-items kan defererat 1 vecka utan legal/data-loss-risk.

---

## Effort-summering

| Sprint | Omfattning | Focused work | Kalendertid (solo) |
|--------|-----------|--------------|-------------------|
| Sprint 1 | Launch-blockers | ~60 h | ~2 veckor |
| Sprint 2 | Quality foundation | ~80 h | ~2–3 veckor |
| Sprint 3 | Growth + polish | ~40 h | ~1 vecka |
| Backlog | Defererat | ~150 h | månader |
| **Till launch-redo** | Sprint 1 | | **~2 veckor** |
| **Till sustainable** | Sprint 1 + 2 | | **~5 veckor** |
| **Till competitive** | Sprint 1 + 2 + 3 | | **~6 veckor** |

---

## Parkera inget utan anledning

Om en punkt i planen känns för liten / stor / fel: ändra den. Planen
speglar analysen 2026-04-20. Verkligheten ändrar sig. Omprioritera
när användarfeedback, ny data, eller tidsbegränsningar dyker upp.

Principer som inte ska parkeras:
- Privacy policy / ToS / åldersgräns / TMDB-attribution / PITR →
  non-negotiable innan public launch
- `canonicalProviderId` → core product correctness
- Accessibility baseline → legal krav (EAA) + moraliskt
- Tester innan arkitektur-städning → regressionsskydd

Allt annat är öppet för omprioritering.

---

## Nästa steg

1. Läs igenom planen.
2. Bestäm: (a) kör hela Sprint 1, (b) komprimera till 30-sekund-
   versionen, eller (c) prioritera om efter egen bedömning.
3. När du bestämt dig, meddela mig vad du vill börja med — då slår jag
   på Phase 2-implementation på den första task:en.

Phase 1 är avslutat. Phase 2 är redo att köras.
