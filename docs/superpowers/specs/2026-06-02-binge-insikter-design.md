# Binge "Insikter" — intern analys-dashboard

**Datum:** 2026-06-02
**Status:** Design godkänd, inväntar spec-review före implementationsplan
**Referens:** synat.se/insikter + `C:\webbkollen\src\app\insikter` (samma mönster, portat)

## Sammanfattning

En privat, intern analys-dashboard för binge.nu — inte länkad i någon nav, `noindex`,
åtkomst endast för admin (`isAdmin`) eller via hemlig URL-token. Speglar arkitekturen
i webbkollens `/insikter`: ett deklarativt **metric-katalog-mönster** där varje mätvärde
är en `MetricDef` (format, trösklar, drilldown) och generiska komponenter (`MetricTile`,
`Donut`, `Funnel`, `TimeSeriesChart`, `TopList`, tabeller, `ExplainDrawer`) renderar allt
katalogdrivet.

Täcker fyra områden: **Tillväxt & engagemang**, **Produktanvändning**, **Trafik**,
**Drift & kostnad**.

## Mål och icke-mål

**Mål:**
- En sida (`/insikter`) som ger ägaren (Malin) överblick över tillväxt, produktanvändning,
  trafik och drift — utan att öppna fyra olika verktyg.
- Försumbar Firebase-kostnad (binge har 25 SEK/mån-tak). Tunga aggregat beräknas
  schemalagt, inte per sidladdning.
- Återanvändbart katalog-mönster så nya mätvärden kan läggas till med en katalogpost.

**Icke-mål:**
- Inte en publik/användarvänd vy. Ingen SEO, ingen meny-länk.
- Inte realtid. Nuläges-aggregat får vara upp till ~6 h gamla.
- Ingen exakt Firebase-faktureringsdata i v1 (saknar lätt API; ev. manuell notis).

## Arkitektur

Binge är static export (`output: 'export'`) — ingen Next.js-server. Tre backend-ytor i
`functions/` (firebase-functions v6, nodejs20):

### 1. `rollupInsights` — schemalagd (onSchedule)
- Kör var 6:e timme via Cloud Scheduler (`europe-west1`, samma region som befintliga functions).
- Admin-SDK. Aggregerar Firestore till **ett** dokument:
  - `insights/daily` — senaste snapshot (det `apiInsights` läser).
  - `insights/{YYYY-MM-DD}` — daglig historik (för trender i Fas 2). Liten skrivkostnad.
- Källor: `collectionGroup('watchlist')`, top-level `reviews/`, `sessions/`, `groups/`,
  `users/` (+ `episodeProgress`, `groups/*/members` vid behov).
- Self-report: rollupen skriver med hur många läsningar den gjorde (för kostnadssynlighet).

### 2. `apiInsights` — HTTP (onRequest)
- Bakom hosting-rewrite `/api/insights` (måste ligga **före** catch-allen `**` i `firebase.json`).
- Auth, två vägar (båda accepteras):
  1. `Authorization: Bearer <firebaseIdToken>` → verifiera via admin-SDK → kräv
     `users/{uid}.isAdmin === true`.
  2. `Authorization: Bearer <token>` där token matchar hemlig env-var
     `INSIGHTS_TOKEN` (URL-token-fallback).
  - 401 annars.
- Läser `insights/daily` (1 dokumentläsning), hämtar **live** från Plausible Stats API
  (trafik + custom-event-goals), ev. Sentry, slår ihop till `InsightsData`-JSON.
- Inga tunga Firestore-läsningar per besök → kostnad ≈ 1 läsning + externa HTTP-anrop.

### 3. `apiInsightsSegment` — HTTP (onRequest) — **Fas 3**
- Bakom `/api/insights/segment`. Drilldown-detaljer (som webbkollen).

### Frontend
- `src/app/insikter/page.tsx` → `InsikterClient` (porterad från webbkollen).
- Auth-tri-state: inloggad admin → ingen token behövs; annars läs `?token=` ur URL.
  `null` = ej hydrerad, `''` = ingen åtkomst (visa meddelande), annars autentiserad.
- `useInsightsData(auth, range)` → `fetch('/api/insights')` med rätt `Authorization`-header,
  AbortSignal, stale-while-error (visa gammal data + felribbon).
- Följer binges designkanon: `PageHeader`, `LoadingView`, `EmptyState`/`NotFound`,
  två-accent-färger (saffran=CTA/nu, plum=tid), `danger`-token (inga råa röda),
  oklch-tokens, inga emojis i UI, `<img>` med explicit storlek. `usePageMeta(indexable=false)`.

### Säkerhet
- `firestore.rules`: neka all klient-läsning/skrivning av `insights/**`
  (endast functionen rör det via admin-SDK).
- `INSIGHTS_TOKEN` + `PLAUSIBLE_API_KEY` som function-secrets (inte i klientbundeln).

### Dataflöde
```
Cloud Scheduler ──▶ rollupInsights ──▶ Firestore: insights/daily (+ {date})
                                              │
Browser /insikter ──▶ /api/insights ──────────┤ (läser rollup, 1 read)
  (admin-login el. ?token)   │                ├──▶ Plausible Stats API (live)
                             │                └──▶ Sentry (live, valfritt, Fas 2)
                             ◀── InsightsData JSON
```

## Datakällor per område

| Område | Källa | Exempel |
|---|---|---|
| Tillväxt & engagemang | Plausible goals + Firestore | signups-trend, onboarding-funnel, totalt användare |
| Produktanvändning | Firestore-rollup | status-split, topp-titlar/tjänster/genrer, betygshistogram, sessioner |
| Trafik | Plausible Stats API (live) | sidvisningar, besökare, topp-sidor, hänvisare |
| Drift & kostnad | Plausible `query_error` + Sentry + rollup self-report | felfrekvens, läsräkning, (Web Vitals via CF RUM, Fas 2) |

Plausible-events som redan loggas (se `src/lib/analytics.ts`): `signed_up`, `signed_in`
(method), `title_added_watchlist` (mediaType, status), `first_title_added`,
`advisor_pause_taken`, `revival_nudge_shown/acted_on`, `review_created`,
`onboarding_completed` (step_reached), `donate_clicked`, `query_error` (scope, kind).

## Mätvärden (katalogposter), fasade

### Fas 1 — alla fyra områden basalt
**Översikt:** `totalUsers`, `newUsers` (trend, Plausible signed_up), `activeVisitors`
(Plausible), `totalTitlesTracked`, `totalReviews`, `titlesAddedTrend`.
**Tillväxt:** `signupsTrend` (tidsserie), `onboardingFunnel` (funnel, step_reached),
`signinMethodSplit` (donut google/email), `donateClicks`.
**Produktanvändning:** `statusDistribution` (donut), `mediaTypeSplit` (donut film/TV),
`topTrackedTitles` (toplist), `topProviders` (toplist), `topGenres` (toplist),
`ratingsHistogram` (histogram), `advisorPausesTrend`, `activeSessions`, `groupsCount`.
**Trafik (live):** `pageViews`, `visitors`, `avgSessionDuration`, `topPages`, `topReferrers`.

### Fas 2
Historik-trender från `insights/{date}`; `mobileShare`/`desktopShare` + `topCountries`
(Plausible); Web Vitals `lcpP75`/`inpP75`/`clsP75` (om Cloudflare RUM kopplas);
`queryErrorsByScope` (toplist); valfri `sentryErrorRate`; Firestore-läsräkning/kostnadsnotis.

### Fas 3
Drilldown-drawers via `/api/insights/segment`; CSV-export per tabell; auto-refresh-toggle;
anomali-banner.

## Filplan

```
src/app/insikter/
  page.tsx                 # statisk route, renderar InsikterClient, noindex-meta
  InsikterClient.tsx       # sektioner + token/admin-guard (porterad)
  api.ts                   # fetchInsights() (+ fetchSegment i Fas 3)
  insights.types.ts        # InsightsData-form (speglar functions/src/insights/types.ts)
  state/
    useDateRange.ts        # 24h/7d/30d/90d/egen
    useInsightsData.ts     # fetch + abort + stale-while-error
    InsightsContext.tsx    # provider så komponenter slår upp på metricKey
  metrics/
    types.ts               # MetricKey, MetricDef, format, thresholds, drilldown
    catalog.ts             # METRICS-katalogen (binge-mätvärden)
    explanations.ts        # ExplainDrawer-texter
  components/
    MetricGrid.tsx · MetricTile.tsx · TimeSeriesChart.tsx · Donut.tsx ·
    Funnel.tsx · Histogram.tsx · TopList.tsx · Toolbar.tsx · RangePicker.tsx ·
    ExplainDrawer.tsx · format.ts · index.ts

functions/src/
  insights/
    types.ts               # InsightsData (källa; speglas i frontend)
    rollup.ts              # onSchedule — Firestore-aggregat → insights/daily
    api.ts                 # onRequest — auth + rollup-läsning + Plausible-merge
    plausible.ts           # Plausible Stats API-klient (server-side)
  index.ts                 # + export const rollupInsights, apiInsights

firebase.json              # + { "source": "/api/insights", "function": "apiInsights" } FÖRE "**"
firestore.rules            # + match /insights/{doc=**} { allow read, write: if false; }
```

## Komponentgränser

- **Katalogen (`metrics/catalog.ts`)** är enda sanningskällan för vad som visas och hur.
  Komponenter är dumma och katalogdrivna — lägg till ett mätvärde = en katalogpost
  (+ ev. ett fält i `InsightsData` och en rad i rollup/api).
- **`functions/src/insights/`** är helt frikopplat från frontend; kontraktet är
  `InsightsData`-JSON. Typen dupliceras (liten) för att inte koppla ihop de två TS-projekten.
- **Auth-verifiering** isolerad i `apiInsights` — frontend vet bara "har åtkomst / inte".

## Felhantering

- `apiInsights`: 401 vid ogiltig auth; om Plausible/Sentry-anrop fallerar → returnera
  rollup-datan ändå med `partial: true`-flagga, frontend visar felribbon men behåller data.
- Frontend: `isFirstLoad && loading` → `LoadingView`; fel utan data → `EmptyState` med
  retry; fel med gammal data → dimmad dashboard + felribbon (stale-while-error).
- Rollup: om en collectionGroup-query fallerar, skriv ändå delresultat med `partial`-flagga
  och logga via `functions.logger`.

## Test

- Pure-logic i functions: aggregerings-helpers (status-split, histogram-bucketing,
  funnel-beräkning) extraheras och enhetstestas (Vitest-mönstret binge redan använder).
- Frontend: `MetricTile`-formattering + tröskelfärg, `useDateRange`, token/admin-guard-logik.
- Speglar webbkollens test-layout (`__tests__` per modul).

## Öppna frågor / externa åtgärder (kräver access utanför repot)

1. **Plausible API-nyckel** — måste skapas i plausible.io-kontot (Settings → API Keys) och
   sättas som function-secret `PLAUSIBLE_API_KEY`. Site-domän = `binge.nu`.
2. **Plausible goals** — custom-events behöver troligen vara registrerade som "goals" i
   Plausible för att frågas ut per event-namn via Stats API. Verifiera vilka som redan finns.
3. **`INSIGHTS_TOKEN`** — generera en hemlig token, sätt som function-secret.
4. **Cloud Scheduler** — schemalagd function kräver att Scheduler-API:t är på (Blaze, redan på).
5. **Din uid** — bekräfta att `users/{din-uid}.isAdmin === true` är satt (annars sätt det).
6. **Web Vitals (Fas 2)** — kräver Cloudflare RUM/Web Analytics-API; bekräfta om det ska kopplas.
7. **Sentry (Fas 2)** — felfrekvens kräver Sentry-API-token; valfritt.

Dessa loggas även i `docs/analysis/EXTERNAL_ACTIONS.md` vid implementation.
