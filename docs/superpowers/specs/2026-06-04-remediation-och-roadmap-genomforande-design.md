# Spec: Genomför remediation- och roadmap-luckor

**Datum:** 2026-06-04
**Status:** Godkänd design → implementationsplan
**Källa:** Audit 2026-06-04 av samtliga planeringsdokument (SPRINT_7_PLAN, REMEDIATION_PLAN,
FUTURE_ROADMAP, streamingtjänster-redesign, insikter-spec, design-consistency-tier1,
DELETION_CANDIDATES, EXTERNAL_ACTIONS).

## Mål

Stäng samtliga delvis- och oimplementerade punkter från projektets planeringsdokument som är
åtgärdbara i repot, leverera en exekverbar runbook för extern infra, och en decomposition-brief
för de stora featurena. Efter denna omgång ska inga "påstått klara men ej byggda"-poster finnas
kvar i remediation- och design-consistency-planerna.

## Omfång

**Bygg nu (kod):** Workstream A (remediation/design/quick wins) + Workstream B (roadmap-finputs,
inkl. episod-release-push fullt ut).

**Dokument-leverans:** Workstream C (extern infra-runbook, körs av användaren) + Workstream D
(decomposition-brief för stora features).

**Uttryckligen utanför omfång (egna spec→plan-cykler senare):** dark mode (B12), PWA (B13),
CSV-import (B11), Paddle-betalning + paywall (B25–B27), native-appar (B14). Dessa beskrivs endast
i Workstream D.

---

## Workstream A — Repo-luckor & remediation

### A1. Legal & a11y

**A1.1 Skip-to-content-länk** (REMEDIATION 5.1, lagkrav EAA)
- Lägg en "Hoppa till innehåll"-länk först i `<body>` i `src/app/layout.tsx` (eller AppShell),
  `sr-only focus:not-sr-only`, som hoppar till `#main`.
- Ge huvud-`<main>` i AppShell `id="main"` + `tabindex={-1}`.
- Acceptans: Tab från sidladd visar länken; Enter flyttar fokus till innehållet.

**A1.2 Villkors-acceptans vid sign-up** (REMEDIATION 3.4)
- Lägg en obligatorisk checkbox i `src/app/login/page.tsx` (sign-up-läget): "Jag godkänner
  [användarvillkoren](/villkor) och [integritetspolicyn](/integritet)."
- Vid sign-up: spara `termsAcceptedAt` (serverTimestamp) + `termsVersion` (konstant, t.ex.
  `'2026-06-04'`) på user-doc.
- Lägg `termsVersion: string` i User-typen (`src/types/domain.ts`).
- Acceptans: sign-up blockeras tills checkbox + ålders-13 är ikryssade; user-doc får båda fälten.

**A1.3 `+`-bricka i ProvidersSection** (streamingtjänster-spec, rad 71–72)
- Sist i "Dina tjänster"-griden (när providers valda): en streckad `+`-bricka som
  `scrollIntoView({behavior:'smooth'})` till "Lägg till fler"-sektionen (via ref).
- Acceptans: klick scrollar mjukt till tillägg-griden; brickan har `aria-label="Lägg till fler tjänster"`.

**A1.4 ListPageClient → designade tillstånd** (design-consistency Task 11)
- I `src/components/pages/ListPageClient.tsx`: byt råa `text-text-muted`-divar mot `LoadingView`
  (laddning), `NotFound` (lista saknas), `EmptyState` (tom lista, med CTA tillbaka till bibliotek).
- Acceptans: ingen bare `Laddar…`/`hittades inte`-div kvar i filen.

**A1.5 Avatar-initial-fallback** (design-consistency Task 17, restpost)
- För saknade person-/cast-bilder i `MoviePageClient.tsx` + `TVShowPageClient.tsx`: rendera en
  initial-chip (`rounded-full`, neutral yta, personens initialer) i stället för tom/placeholder-ruta.
- Extrahera som liten delkomponent `src/components/ui/AvatarInitials.tsx` (testbar).
- Acceptans: person utan `profile_path` visar initialer; enhetstest för initial-derivering.

### A2. Säkerhet & rules

**A2.1 `hasOnly`-fältvalidering** (REMEDIATION 4.2)
- I `firestore.rules`: lägg `request.resource.data.keys().hasOnly([...])` på write-paths som saknar
  det: `users/{uid}/watchlist/{id}`, `reviews/{id}`, `users/{uid}/episodeProgress/{id}`,
  `users/{uid}/notInterested/{id}`.
- Behåll befintliga typ-/ägarvillkor; lägg enbart till fält-whitelist.
- Acceptans: `@firebase/rules-unit-testing`-test som avvisar skrivning med okänt fält och tillåter
  giltig skrivning (se A5 — körs i emulator).

**A2.2 `npm audit fix`** (REMEDIATION 1.1 / SPRINT_7 exit)
- Kör `npm audit fix` för protobufjs-CVE:erna; committa uppdaterad `package-lock.json`.
- Om `fix` inte löser allt: dokumentera kvarvarande i spec-not + använd `--force` endast efter
  verifiering att build/test är grön.
- Acceptans: `npm audit --audit-level=high` ger 0 HIGH.

**A2.3 `npm audit`-grind i CI** (SPRINT_7 / REMEDIATION 7.5)
- Lägg steg `npm audit --audit-level=high` i `.github/workflows/ci.yml` efter install.
- Acceptans: CI failar på framtida HIGH-CVE.

### A3. Observability & SEO

**A3.1 Saknade analytics-events** (REMEDIATION 6.1)
- Lägg i event-unionen i `src/lib/analytics.ts`: `providers_selected`, `advisor_viewed`,
  `advisor_action_taken`, `search_submitted`, `status_changed`, `error_boundary_triggered`.
- Wire varje på respektive callsite (ProvidersSection, advisor-vy, sök, status-byte i
  WatchlistContext, error boundaries).
- Acceptans: typad `track()` accepterar de nya, anrop finns på callsites.

**A3.2 `Review`-JSON-LD** (REMEDIATION 10.3)
- Utöka `src/components/title/JsonLd.tsx` med `Review`-schema för publika recensioner på
  movie/tv-sidor (author, reviewBody, reviewRating).
- Acceptans: recension renderar giltig `Review`-JSON-LD; befintliga Movie/TVSeries oförändrade.

**A3.3 Segment-`error.tsx` × 4** (REMEDIATION 8.5)
- Lägg `error.tsx` för `src/app/movie/[id]/`, `tv/[id]/`, `grupper/[id]/`, `tillsammans/[id]/`
  (eller motsvarande catch-all-segment) med designat felläge (`danger`-token, retry-knapp,
  `error_boundary_triggered`-event från A3.1).
- Acceptans: kastat fel i en route visar segment-boundary, inte global.

### A4. Performance & data

**A4.1 Advisor fan-out-staggering** (REMEDIATION 9.6)
- I `useSubscriptionAdvisor.ts`: chunka TMDB-id-hämtningarna (befintlig 8-concurrent-semafor i
  `client.ts` finns redan — säkerställ att advisorn går via den och inte fyr av alla `useQueries`
  samtidigt utan tak). Lägg vid behov batchning/stagger.
- Acceptans: ingen burst > semafor-taket; advisorn avbryts korrekt vid navigation (AbortSignal).

**A4.2 `useInfiniteQuery` på obundna listor** (REMEDIATION 9.4)
- Inför `useInfiniteQuery` i `useReviews.ts` + `useLists.ts` med cursor (`startAfter`), behåll
  nuvarande `limit()` som sidstorlek. UI: "Visa fler"-knapp (befintligt `.btn btn-ghost`-mönster).
- Acceptans: lista laddar sida 1, "Visa fler" hämtar nästa cursor-sida.

**A4.3 `isPublic`-denormalisering** (REMEDIATION 9.3) — **lazy-on-write**
- När en titel/lista skrivs: spegla ägarens `isPublic` till subcollection-docen (ingen
  batch-migration — matchar projektets migrations-filosofi).
- Acceptans: ny/ändrad watchlist-doc får `isPublic`; läsare faller tillbaka på ägarens flagga om
  fältet saknas (bakåtkompatibelt).

### A5. Testinfra

**A5.1 MSW** (REMEDIATION 7.2)
- Installera `msw`, sätt upp `src/test/server.ts` (node-server) + handlers för TMDB-endpoints.
- Koppla in i vitest-setup; migrera minst advisor-/TMDB-beroende hook-test till MSW-mocks.
- Acceptans: minst ett hook-test kör mot MSW; `npm test` grön.

### A6. Dokumentation

**A6.1 CLAUDE.md → Next 16 / React 19** (SPRINT_7 post)
- Uppdatera stack-raden och ev. andra referenser från "Next.js 14" → "Next.js 16 (App Router) +
  React 19".

**A6.2 SLO.md Lighthouse-baseline** (SPRINT_7 / B37)
- Kör Lighthouse mot prod/preview, fyll i `docs/SLO.md` TBD-värden (LCP, CLS, TBT, perf-score).

---

## Workstream B — Roadmap-finputs

**B1. Provider-data** (FUTURE_ROADMAP B17/B18)
- `src/lib/tmdb/providers.ts`: byt namn id:384 "HBO Max" → "Max" (behåll alias `[1899]`).
- Lägg C More-legacy-id som alias på TV4 Play (id:489) via `canonicalProviderId`.
- Acceptans: Max visas en gång; C More-titlar mappas till TV4 Play. Enhetstest för båda.

**B2. assertNever-migrering** (FUTURE_ROADMAP B9, restpost)
- Migrera kvarvarande exhaustiva switchar (watchStatus, advisor-states m.fl.) till `assertNever`
  i default-grenen.
- Acceptans: `tsc` fångar icke-uttömmande switch; inga nya `default: return null`-tysta grenar.

**B3. invite-token ålders-badge + auto-rotering** (FUTURE_ROADMAP B31) — **lazy-on-read**
- I gruppens panel (`GroupSidePanels.tsx`): visa ålders-badge på inbjudningslänk
  (`inviteTokenRotatedAt` → "Länken är N månader gammal").
- Auto-rotera lazy: om ägaren öppnar panelen och token är > 30 dagar gammal sedan senaste
  aktivitet, rotera (anropa befintlig `rotateInviteToken()`). Ingen cron.
- Acceptans: gammal token får badge; öppning efter 30 dgr roterar och uppdaterar `inviteTokenRotatedAt`.

**B4. Episod-release-push** (FUTURE_ROADMAP B15) — **full design + bygg**

*Syfte:* pusha FCM när ett nytt avsnitt släppts för en serie en användare följer.

*Datakälla & filtrering (kostnadsoptimering):*
- Schemalagd Cloud Function `episodeReleaseNotify`, region `europe-west1`, `every 6 hours`.
- Läs endast serier i substate `'ikapp'` (caught up + Returning Series → väntar på nytt) — dessa
  är de enda som kan ha ett *nytt* avsnitt att notifiera om. Härleds via samma `tvSubState()`-logik
  som klienten (delas till `functions/`).
- För varje unik serie: hämta TMDB `last_episode_to_air`. Om dess `id` ≠ sparat
  `lastNotifiedEpisode` på serien → ny release.

*Notifiering:*
- För varje berörd användare med serien i `'mina'`/`'ikapp'` och episod-notiser påslagna
  (`NotificationsSection`-preferens): skapa inbox-notis + skicka FCM via befintlig
  `messaging`-infra.
- Skriv `lastNotifiedEpisode = last_episode_to_air.id` (dedupe; idempotent vid omkörning).

*Preferens-respekt:*
- Återanvänd notif-preferensfält; lägg `episodeReleases: boolean` om det saknas (default på).

*Acceptans:*
- Pure-logic (vilka serier kvalar, dedupe-beslut) extraheras och enhetstestas utan Firebase.
- Funktionen exporteras från `functions/src/index.ts`; kräver manuell deploy (se Workstream C).
- Vid omkörning utan ny TMDB-data skickas inga dubbletter.

---

## Workstream C — Extern infra-runbook (leverans: `docs/EXTERNAL_ACTIONS_RUNBOOK.md`)

Exakt steg-för-steg som användaren kör. Innehåll:

1. **Deploya insikter + episod-push:**
   `firebase deploy --only functions:rollupInsights,functions:apiInsights,functions:episodeReleaseNotify,firestore:rules`
2. **Secrets:** `firebase functions:secrets:set INSIGHTS_TOKEN` / `PLAUSIBLE_API_KEY` / `PLAUSIBLE_SITE_ID`.
3. **Plausible:** registrera mål (events från A3.1).
4. **Admin-flagga:** sätt `users/{uid}.isAdmin = true` i Firestore Console.
5. **Sentry DSN:** provisionera + sätt `NEXT_PUBLIC_SENTRY_DSN` i hosting-env.
6. **App Check:** registrera reCAPTCHA v3, sätt `NEXT_PUBLIC_APP_CHECK_SITE_KEY`, enforce.
7. **Firestore PITR + schemalagda backups** (Blaze).
8. **Branch protection** på `main` (kräv CI grön).
9. **Billing-alert** + **UptimeRobot**-monitor.
10. **Officiell TMDB-logo** (ersätt platshållare).
11. **Verifiering:** `curl -I` säkerhetsheaders, `binge.nu/insikter` post-deploy.

Varje steg: kommando + förväntat utfall + hur man verifierar.

---

## Workstream D — Decomposition-brief (leverans: `docs/analysis/BIG_FEATURES_BRIEF.md`)

För varje stor feature: problem, scope, beroenden, grov effort, "egen spec krävs". Täcker:
- **B12 Dark mode** — token-strategi (oklch-varianter), `prefers-color-scheme` + toggle, flash-prevention. ~1 vecka.
- **B13 PWA** — `manifest.json`, full service worker (Workbox) sär från FCM-SW, install-banner. ~1 vecka.
- **B11 CSV-import** — Trakt/Letterboxd/IMDb-parsers, titel-matchning mot TMDB, dedupe, dry-run-UI. ~1–2 veckor.
- **B25–B27 Paddle + paywall** — Paddle-integration, webhook-function, `plan`/`renewsAt`-fält,
  paywall-grindar, billing-portal. Störst; juridik + Cloud Functions. Flera veckor.
- **B14 Native** — React Native/Capacitor-utvärdering. Månader; eget projekt.

---

## Tekniska vägval (sammanfattning)

| Beslut | Val | Motivering |
|---|---|---|
| `isPublic`-denorm | Lazy-on-write | Matchar CLAUDE.md migrations-filosofi; ingen batch |
| Episod-push | Schemalagd CF, `'ikapp'`-filtrering | Håller Firestore-läsningar minimala (~0 kr) |
| invite-token auto-rotering | Lazy-on-read | Undviker extra cron/Blaze-kostnad |
| `useInfiniteQuery` | reviews + lists, behåll `limit()` | Minsta ingrepp, befintligt sidmönster |
| Testdisciplin | TDD för all ren logik | Helpers/resolvers/dedupe testas utan Firebase |

## Teststrategi

- Ren logik (helpers, initial-derivering, episod-dedupe, provider-alias) → Vitest, test-först.
- Firestore-rules → `@firebase/rules-unit-testing` mot emulator (kräver Java-PATH, se memory).
- Verifiering efter varje fas: `npm run typecheck && npm run lint && npm test && npm run build` grön.

## Sekvensering (faser)

1. **Fas 1 — A1 + A6** (legal/a11y quick wins + docs): låg risk, högt värde, snabbt.
2. **Fas 2 — A2** (rules + audit): säkerhet före vidare bygge.
3. **Fas 3 — A3 + A4** (observability + performance).
4. **Fas 4 — A5** (MSW testinfra).
5. **Fas 5 — B1 + B2 + B3** (provider-data, assertNever, invite-token).
6. **Fas 6 — B4** (episod-push, tyngst, egen verifiering).
7. **Fas 7 — C + D** (runbook + brief, dokument-leverans).

Varje fas avslutas med full verifiering + commit. Externa åtgärder (Workstream C) körs av
användaren efter att koden är mergad.

## Definition of Done

- Alla A- och B-poster implementerade, verifierade och committade.
- `npm run typecheck && npm run lint && npm test && npm run build` grön.
- `docs/EXTERNAL_ACTIONS_RUNBOOK.md` + `docs/analysis/BIG_FEATURES_BRIEF.md` levererade.
- REMEDIATION_PLAN + design-consistency-plan har inga kvarvarande "påstått klara men ej byggda"-poster.
