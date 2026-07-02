# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working agreement

- **Solo, push-direct-to-main.** No PRs, no feature branches — commit and push to
  `main` (which deploys hosting via `deploy.yml`). The one exception: a genuinely
  risky migration (Firestore rules/schema/status-model) gets a written plan and an
  explicit go-ahead first.
- **Explain in product terms.** Malin directs the work but doesn't read code —
  describe changes by what they do for users and the trade-offs they carry, not by
  diff mechanics.
- **Minimize running costs.** Firebase is Blaze with a 25 SEK/mån cap. Prefer the
  lite TMDB queries on fan-out surfaces, respect the cache tiers, and flag anything
  that would add a paid service.
- **Testing honesty.** Tests prove intended behavior. Never weaken, skip, or rewrite
  an assertion just to go green — if a test fails, the production code is the suspect.

### Plan before large changes — and cast the role-org first

These two rules apply to **ad-hoc conversational requests**, not just `/sprint-execute`.
The sprint command already routes + convenes the panel before building (§1.5 + §2b);
this extends the same discipline to direct chat, closing the gap where the role-org only
joined planning inside a sprint.

**Always plan before a large change — no exceptions.** A change is "large" if it hits ANY
of: 3+ files; a new core module / service / hook / lib; an architectural or base-class
change; a "refactor" / "migrate" request; a multi-file codemod; or a **sensitive domain** —
for binge that means Firestore rules / indexes / schema or the watch-status model
(`firestore.rules`, `firestore.indexes.json`, `src/lib/watchStatus*`); auth
(`src/contexts/AuthContext.tsx`, Firebase Auth, `passwordStrength`); user data / GDPR /
privacy (account deletion, data export, retention, `src/lib/firebase/{userData,dataExport,groups}.ts`);
Cloud Functions / FCM / moderation (`functions/**`, `submitReport`); deploy / hosting /
Cloudflare-CDN config (`deploy.yml`, `firebase.json`); anything legal / privacy; or anything
that adds a paid service or moves Firebase cost (Blaze 25 SEK/mån cap). Large changes ALWAYS
get a written plan + approval before any Edit/Write — in ad-hoc chat, not just
`/sprint-execute`. Small, obvious, single-file fixes ship without ceremony — don't gold-plate.

**Cast stakeholders BEFORE planning (ad-hoc work, not just sprints).** The role-org must be
cast into planning the same way `/sprint-execute` Phase 1 (§1.5 route) + §2b (panel) does it
— not only inside the sprint command. For any large change OR any request touching a
sensitive domain, BEFORE writing the plan:
1. **Cast the panel** — run the committed router on the likely-touched paths to get the tier
   and owning role(s) + high-stakes core: `node docs/org/route.mjs <paths>` → `{ tier, panel,
   roles, highStakes, reason }` with `tier` ∈ `skip` / `medium` / `top`. Deterministic, cheap,
   no agents. (Same router `/linear` stamps with and `/stakeholder-review` convenes from — do
   not hand-roll a second risk judgment.)
2. **Convene the cast roles** — `medium` → one blind critique from the owning role; `top` →
   the full panel concurrently, each grounded in its dossier section of the role map
   (`docs/role-responsibilities.md §N` + `docs/org/world-watch/ROLE_WORLD_MODEL.md`), blind to
   the others (per the `/stakeholder-review` skill). Run critiques on **sonnet at low effort**;
   keep the commit-gate reviewers (`binge-code-reviewer` / `binge-security-reviewer` /
   `binge-test-reviewer`) on **opus** (see the global "Subagent model selection" rule).
3. **Fold their conditions into the plan as binding acceptance criteria**, then present it. An
   unresolved high-stakes conflict — a block from a high-stakes-core role (Security #4 / DPO #6
   / Legal #5), or anything legal / privacy / interpretive — gets surfaced to Malin IN the
   plan, never buried.

`skip` tier (doc-only / trivial) → no panel, plan normally. This closes the only gap: the
diff-review half already runs via the commit-gate specialists, and the `ExitPlanMode` hook
already *suggests* the panel on high-stakes plans; this adds the **cast + plan** halves to
direct requests.

## Project Overview

Binge (binge.nu) is a Swedish media tracker for movies and TV shows. Users track what they're watching, want to watch, and have watched — with the killer feature being where each title is available on Swedish streaming services. Think Prisjakt for media: dense, functional, data-forward. The UI is in Swedish.

## Tech Stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, React Query (TanStack Query v5)
- **Auth/DB:** Firebase (Authentication + Cloud Firestore + Cloud Functions). Blaze-plan (pay-as-you-go, 25 SEK/mån cap med 50/90/100% alerts). Functions-koden bor i `functions/src/index.ts` och kompileras till `functions/lib/`. Används bl.a. för FCM push-notifs.
- **External API:** TMDB API v3 — all movie/TV metadata, Swedish watch providers
- **Hosting:** Firebase Hosting (static export `output: 'export'`) behind Cloudflare CDN
- **Observability:** Sentry (opt-in via `NEXT_PUBLIC_SENTRY_DSN`), Plausible (cookie-free)
- **Icons:** Lucide React (small, inline only)
- **Testing:** Vitest + @testing-library/react + jsdom
- **Utilities:** clsx + tailwind-merge

## Commands

```bash
npm run dev               # Next.js dev server (http://localhost:3000)
npm run build             # Production build (static export → out/)
npm run start             # Serve production build
npm run lint              # ESLint
npm run typecheck         # tsc --noEmit
npm test                  # Vitest run (1000+ tests — pure-logic + hook scenarios)
npm run test:watch        # Vitest in watch mode
npm run emulators         # Firebase Auth (9099) + Firestore (8080) emulators
firebase deploy --only hosting            # Deploy static site
firebase deploy --only firestore:rules    # Deploy Firestore rules
firebase deploy --only hosting,firestore:rules   # Deploy both
```

## Architecture

**Client-side only SPA** via Next.js App Router + `output: 'export'`. All data
is fetched client-side with React Query. Auth-state via `AuthContext` (riktig
Firebase Auth, inte stub).

### Static-export gotcha: dynamic routes via catch-all

Dynamiska routes (`/movie/:id`, `/tv/:id`, `/person/:id`, `/user/:username`,
`/grupper/:id`, `/tillsammans/:id`) kan inte pre-renderas utan ett
`generateStaticParams`, och vi vill inte lista alla TMDB-ids vid build. Lösningen:

- `src/app/[...path]/page.tsx` renderar `CatchAllClient` som dispatchar till rätt
  client-komponent via URL-segment
- `src/components/pages/DynamicRouter.tsx` är dispatch-punkten
- Firebase Hosting rewrite: `**` → `/index.html` så alla URLs landar i SPA:n
- Metadata för dynamiska routes sätts klient-sidigt via `usePageMeta`-hook
  (uppdaterar `document.title` + `<meta>`-taggar i DOM)

Lägg **inte** till en ny dynamisk route utan att uppdatera både
DynamicRouter.tsx + firebase.json rewrite.

### Key directories
- `src/app/` — App Router pages + segment layouts med metadata
- `src/components/layout/` — Sidebar, TopBar, MobileNav, Footer, AppShell, error boundaries
- `src/components/pages/` — Client-side page-komponenter (Movie/TV/Person/Group/User/Tillsammans)
- `src/components/watchlist/`, `groups/`, `onboarding/`, `moderation/` — domän-kluster
- `src/contexts/` — AuthContext, WatchlistContext, NotInterestedContext, ToastContext
- `src/hooks/` — Custom hooks (useAuth, useWatchlist, useTMDB, useSubscriptionAdvisor m.fl.)
- `src/lib/firebase/` — Firebase config + delade data-collectors (`userData.ts`, `dataExport.ts`, `reports.ts`, `groups.ts`, `sessions.ts`)
- `src/lib/tmdb/` — TMDB-klient + providers + cacheTiers (delade staleTime-konstanter)
- `src/lib/` — Pure helpers (airingState, watchStatus, passwordStrength, sessionTiming, analytics, sentry)

### TMDB staleTime — dela via `TMDB_STALE`

Flera hooks kan registrera samma queryKey — då MÅSTE de använda samma
`TMDB_STALE`-konstant (annars slåss observers om senaste värde):

- `['tv', id]` (full detalj, append_to_response): useTVShow + QuickAddButton
  + StatusButton → `TMDB_STALE.TV_DETAIL`
- `['tv-lite', id]` (bas + watch/providers): useCalendar + useSubscriptionAdvisor
  → `TMDB_STALE.LITE_DETAIL`
- `['movie', id]` (full detalj): useMovie → `TMDB_STALE.MOVIE_DETAIL`
- `['movie-lite', id]` (bas + release_dates + providers): useCalendar
  → `TMDB_STALE.LITE_DETAIL`

Fan-out-ytor (kalender/rådgivare, en query per bibliotekstitel) ska använda
lite-varianterna (`getTVShowLite`/`getMovieLite` i `src/lib/tmdb/client.ts`) —
fulla detaljsvar är 5–10× större och hör hemma på titelsidor.

**React Query-persist (`shouldPersistQuery` i `src/lib/queryClient.ts`):**
persisterar BARA små, delade katalog-queryer (`genres-*`, `trending`,
`popular-*`, `discover-*`). Per-titel-data persisteras ALDRIG — den skalar med
bibliotekets storlek och sprängde 5 MB-localStorage-taket i produktion. Detta
gäller `tv-lite`/`movie-lite`/`tv-season` OCH `watch-providers` (sistnämnda är
per-titel multi-country, ~40 KB/titel — stod för 1396 av 1409 KB efter att
tv-lite togs bort). Per-titel-data re-fetchas billigt (gated) och watchlist-datan
är redan momentan via Firestores IndexedDB-cache, så återbesök är snabba ändå.

### TMDB rate-limit + AbortSignal

`src/lib/tmdb/client.ts` har en 8-concurrent-semaphore + 429 Retry-After-respekt
+ AbortSignal hela vägen. React Query's `ctx.signal` skickas vidare i alla
`useQuery`/`useQueries` så navigations-bort avbryter in-flight fetches.

### Kalender — källor + entry-modell

`useCalendar` (`src/hooks/useCalendar.ts`) bygger kalendern från två källor:
- **serier i 'mina'** (inkl. ej påbörjade) → alla avsnitt (show-detail + säsong),
  med "markera sedd"-toggel för alla — att bocka av E1 från kalendern är hur
  man börjar på en ej påbörjad serie
- **filmer i 'vill_se'** → svenskt digitalt släppdatum (`release_dates`, type 4 SE),
  bara framtida datum

`CalendarEntry` (`src/lib/calendar/types.ts`) är en **diskriminerad union** över
`kind: 'episode' | 'movie'`. Per-kind-logik (nyckel, länk, badge, meta-rad,
watched-behörighet) bor i `src/lib/calendar/entry.ts` — använd `entryKey`/
`entryHref`/`entryMetaLine`/`entryBadge`/`canMarkWatched` i konsumenter istället
för att gren på `kind` direkt. Räkning (avsnitt/film/premiär/final) via
`src/lib/calendar/summary.ts`. Rådgivar-hooks (`useAdvisorTimeline`,
`useUpcomingShowsForAdvisor`) filtrerar till `kind === 'episode'` — filmsläpp
hör inte hemma i prenumerations-timelines.

### Data model (Firestore)

```
users/{uid}                               — profil, preferenser, termsAcceptedAt, onboardingCompletedAt
users/{uid}/watchlist/{tmdbId}           — status (vill_se/mina/sedd/avbruten), rating, providers, isPublic (denormaliserad)
users/{uid}/episodeProgress/{tmdbId}     — per-avsnitt watched-state
users/{uid}/notInterested/{tmdbId}       — gömda titlar från rekommendationer
users/{uid}/notifications/{notifId}      — inbox
users/{uid}/blocked/{targetUid}          — blockerade användare
users/{uid}/following/{targetUid}        — följ-out
users/{uid}/followers/{followerUid}      — följ-in (speglad)

reviews/{reviewId}                       — top-level, public read
reviews/{id}/likes/{uid}                 — doc-id = uid (för enkel is-liked-lookup)
reviews/{id}/comments/{commentId}        — public read

lists/{listId}                           — kurerade titellistor, isPublic på dokument-nivå
sessions/{sessionId}                     — Tillsammans-sessioner, expiresAt + 7 dagar
sessions/{id}/participants/{pid}
sessions/{id}/swipes/{tmdbId}

groups/{groupId}                         — permanenta grupper, inviteToken + inviteTokenRotatedAt
groups/{id}/members/{uid}
groups/{id}/watchlist/{tmdbId}

usernames/{username}                     — global username-reservation, värdet är { uid }
reports/{reportId}                       — UGC-moderation, create-only från klient, admin-läses via Console
```

### Delad Firestore-helper: `collectUserDataSnapshots`

`src/lib/firebase/userData.ts` konsumeras av både `buildUserExport` (GDPR Art.
20 export) och `deleteAccount` (konto-radering). Om du lägger till en ny
user-owned subcollection: uppdatera den här helpern så båda flödena får med
den.

### WatchStatus + TV sub-states (TV-aware schema)

```
'vill_se'   — vill se (ENDAST film sedan 2026-06; TV-vill_se lazy-migreras till 'mina')
'mina'      — TV ONLY: följer (UI "Följer"; läge derive:as från progress + TMDB)
'sedd'      — film ONLY: terminal (filmer går aldrig tillbaka)
'avbruten'  — gav upp (både film + TV)
```

**TV sub-state** (deriverat, aldrig sparat — beräknas via `tvSubState()` i
`src/lib/watchStatus.ts`; biblioteket använder den persisted-fields-only
varianten `librarySubState()` i `src/lib/libraryView.ts`):
- `ej_paborjad` — följs men inget avsnitt markerat (ingen progress)
- `aktiv`    — bakom på aireade avsnitt (har osedda S/E mot TMDB:s last_episode_to_air)
- `ikapp`    — caught up + Returning Series → väntar på nytt
- `avslutad` — caught up + Ended/Canceled → klar

**Designval:** TV är aldrig "klar" på samma sätt som film — show vaknar från
döden, får spinoffs, returnerar med nya säsonger. Därför har TV inget 'sedd'
slutläge; istället bor seriens HELA liv under 'mina' (från ej påbörjad till
avslutad) och läget ändras automatiskt när progress eller TMDB:s
last_episode_to_air rör sig. "Vill se en serie" ÄR att följa den — knappen
heter "Följ" (CTA-verb), chipen "Följer". Endast film har 'sedd' som terminal
och 'vill_se' som bookmark — film är klar när den är klar.

**Progress ändrar aldrig status.** `WatchlistContext.updateProgress` skriver
bara lastWatched-fälten; läget (ej_paborjad → aktiv/ikapp) härleds. Den gamla
auto-promote-flytten vill_se → mina togs bort 2026-06.

**Ej påbörjad nycklar beteende på flera ställen** — använd progress
(`lastWatchedSeason == null`), inte status: rådgivaren behandlar dem som
will see-ankare (`splitTvByProgress`), Tillsammans behåller dem som
sessionskandidater (`libraryExclusionIds`), taste-vikterna ger dem
vill_se-nivå, och episodeNotify skickar inga pushar för dem.

**Migration** (lazy, klient-sidigt i `migrateStatus`, `src/lib/watchStatus.migration.ts`):
- 'vill_se' (TV) → 'mina' (landar som ej_paborjad); 'vill_se' (film) → oförändrat
- 'följer' (TV) → 'mina'; 'följer' (film) → 'sedd' (rare)
- 'sedd' (TV) → 'mina'; 'sedd' (film) → 'sedd' (oförändrat)
- Engelska v1-schema (`watching`/`want_to_watch`/`watched`/`dropped`) hanteras samtidigt
- Firestore-docs skrivs aldrig om bara för migration — bara när användaren
  ändrar något på en titel skrivs den med nya schemat. Så Firestore kan
  innehålla 'följer'/'vill_se'-strängar på serier i mångmånader; läsare normaliserar.

**Routes:**
- `/my/series` — TV i 'mina' (sektioner: ligger efter/pågående/ej påbörjade/avslutade)
- `/my/films` — film i 'sedd'
- `/my/vill-se` — väljaren ("vad ska du se ikväll?"): filmer i 'vill_se' + serier
  i 'mina' utan progress. Ingen statushantering — `VillSePickerPage`, inte WatchlistPage.
- `/my/avbrutna`, `/my/all` — mixed
- Gamla `/my/following` → 301 → `/my/series` (firebase.json redirects)
- Gamla `/my/watched` → 301 → `/my/films`

### TMDB API
- Always use `language=sv-SE` och `watch_region=SE` för svenskt innehåll
- `region=SE` + `watch_region=SE` på `/discover/movie` + `/discover/tv`
- Watch providers via `append_to_response=watch/providers`, key `results.SE`
- Provider categories: `flatrate`, `free`, `ads`, `rent`, `buy`
  - `ads` filtreras bort i advisor om användaren inte har någon ads-tjänst
- Image base: `https://image.tmdb.org/t/p/{size}/`
- Attribution required: _"This product uses the TMDB API but is not endorsed or certified by TMDB"_ — konstanter i `src/lib/tmdb/attribution.ts`

### Provider mapping

`src/lib/tmdb/providers.ts` har `SWEDISH_PROVIDERS` + `canonicalProviderId()`.
TMDB returnerar ibland samma tjänst under flera ids (t.ex. TV4 Play = 489 +
alias 1944). `canonicalProviderId` normaliserar så vi inte visar en tjänst
två gånger.

### UGC-moderation

- **Rapportering:** `reports/{reportId}` top-level. Klient kan bara create,
  aldrig read. Admin-flöde via Firebase Console (se `docs/moderation.md`).
- **Blockering:** `users/{uid}/blocked/{targetUid}` subcollection. Klient-side
  filter i review-list, feed, kommentarer. Hygien-nivå (inte säkerhetsgräns).

### Auth

- Firebase Auth är riktigt aktivt (inte längre stub)
- Google SSO + email/password (med password-strength-validation via
  `src/lib/passwordStrength.ts`)
- Email-verification skickas vid sign-up; banner i AppShell med resend-knapp
- Firebase App Check är opt-in via `NEXT_PUBLIC_APP_CHECK_SITE_KEY`
  (reCAPTCHA v3) — no-op utan site key, säker default

## Design Constraints

Direction H · "Schemat" — den shippade designen. Se `globals.css :root` och
`tailwind.config.ts` för alla tokens. Referens: `docs/design_handoff_direction_h_schemat/`.

### Layout

Sticky, horisontell toppkrom — **ingen sidebar**:
- `AppTopbar` (brand-logotyp · WeekStrip · sökfält · avatar) — `position: sticky; top: 0; z-index: 30`
- `Subnav` (Hem · Bibliotek · Kalender · Rekommendationer · Streamingrådgivaren · Vänner · Grupper) — horisontell länkrad direkt under topbar
- Huvudinnehållet i `.canvas` — `max-width: 1320px`, `margin: 0 auto`, `padding: 32px 40px 48px`
- Mobil: `MobileTabBar` (5-tabs, `position: fixed; bottom: 0`) ersätter subnav på smala skärmar

### Typografi

- **Basteckenstorlek:** `15px` på `html, body`
- **Sans:** Albert Sans (primär) → `system-ui, -apple-system, Segoe UI, sans-serif` som fallback
- **Mono:** `--mono` är alias för `--sans` — monospace-typsnittet (JetBrains Mono) fasas ut. Koda inte nytt med `font-mono`/`var(--mono)` — städas bort mekaniskt
- **Täthetskänsla:** verktyg, inte marknadsföringssida. Håll textstorlekar och marginaler kompakta

### Färgsystem

Alla färgvärden är oklch CSS-variabler i `globals.css :root`, speglade som Tailwind-tokens i `tailwind.config.ts`. Inga hexvärden i komponentkod.

**Ytor:**
- `--bg` / `bg` — varm off-white (sida)
- `--bg-2` / `bg-2` — alternativa rader, headers
- `--surface` / `surface` — kort, paneler
- `--ink` / `ink` — primär text; `--ink-2` / `ink-2` — sekundär; `--ink-3` / `ink-3` — dämpad
- `--rule` / `rule` — kantlinjer; `--rule-2` / `rule-2` — lättare

**Tvåaccentregel (bryt den inte):**
- `--acc` / `acc`, `--acc-deep` / `acc-deep`, `--acc-soft` / `acc-soft` — **saffran** = "nu / live / avgörande" (CTA-knappar, live-indikatorer, veto, brand-mark)
- `--cal-deep` / `cal-deep`, `--cal-soft` / `cal-soft` — **plum** = "idag / tidpositionering" (WeekStrip today-cell, kalender today-kolumn)

Blanda dem inte. Saffran är inte "kalender" och plum är inte "CTA".

### Skuggor och djup

Exakt två tillåtna skuggor (definierade i `tailwind.config.ts`):
- `shadow-lift` — `0 4px 14px oklch(0 0 0 / 0.06)` — kort hover
- `shadow-pop` — `0 2px 8px oklch(0 0 0 / 0.04)` — popover

Allt annat är platt. Inga `drop-shadow`-, `filter: blur`- eller godtyckliga box-shadow-värden.

### Kantradie

- `rounded-sm` = 3px, `rounded` / `rounded-md` = 6px, `rounded-lg` = 8px
- Poster-thumbnails: 3px. Knappar: 6px. Modaler/kort: 6-8px. Aldrig mer än 8px.

### Posters och duotone

Posters renderas med per-genre duotone-filter via SVG-defs (`DuotoneFilters`, monteras en gång i `AppShell`). Åtta färgscheman: `duo-terra`, `duo-slate`, `duo-moss`, `duo-clay`, `duo-plum`, `duo-steel`, `duo-olive`, `duo-oxblood`.

- Hover på poster → `filter: none` (avslöjar original-bitmap) (momentant — SVG-filter→none kan inte interpoleras, så ingen transition).
- Hover på filmkort → `translateY(-2px)` på `.poster`. Denna transform är **avsiktlig** — den gamla "inget transform/scale på hover"-regeln gäller inte längre.

### Bygg en ny vy — kanonisk recept

Varje routad vy ska följa samma mönster:
- **Rubrik:** `PageHeader` (`src/components/layout/PageHeader.tsx`) — aldrig en rå
  `text-[18px] font-bold`-titel. Ger `.crumb`-ögonbryn + 44px `.page-h1` + `.stand`.
- **Laddning:** `LoadingView` (`src/components/ui/LoadingView.tsx`) — inte en bar
  "Laddar…"-sträng.
- **Tomt / saknas:** `EmptyState` / `NotFound` (`src/components/ui/`) — designat
  tillstånd med nästa-steg-CTA, inte bar text.
- **Felfärger:** `danger`-token (`--danger` / `bg-danger-soft` / `text-danger-ink` /
  `.btn-danger`) — aldrig råa Tailwind-röda (`text-red-*`, `bg-red-*`).

En guard-test (`src/lib/design/consistency.test.ts`) failar om en
`src/components/pages/*`-klient återinför 18px-titel-antimönstret.

### Generella designregler

- **Ser inte AI-genererat ut.** Inga runda kort med stora skuggor, inga dekorativa gradienter, inga emojis i UI, inga dekorativa badges
- **Ingen `next/image`** — static export har ingen bildoptimering. Alla `<img>` har explicit `width`/`height` för CLS + `loading="lazy"` + `decoding="async"`
- **TMDB-attribution krävs** — _"This product uses the TMDB API but is not endorsed or certified by TMDB"_ — konstanter i `src/lib/tmdb/attribution.ts`
- **Svenskt UI** — all användargränssnittstext på svenska

## Environment Variables

```
NEXT_PUBLIC_TMDB_API_KEY
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID

# Valfritt — no-op utan värde:
NEXT_PUBLIC_SENTRY_DSN                   # Error tracking
NEXT_PUBLIC_APP_ENV                      # development / preview / production
NEXT_PUBLIC_GIT_SHA                      # Sentry release tag
NEXT_PUBLIC_APP_CHECK_SITE_KEY           # reCAPTCHA v3 site key
NEXT_PUBLIC_FIREBASE_USE_EMULATOR        # true → connect to local emulators
```

Se `.env.local.example` för dev-setup.

## Deployment

`next build` (med `NODE_OPTIONS=--max-old-space-size=4096`) → static export
till `out/` → Firebase Hosting (`public: "out"`) → Cloudflare proxy.
SPA-rewrite `**` → `/index.html`.

**Byggtids-TMDB (SEO-pre-rendering):** `/{tv,movie,person}/[id]` pre-renderas
för ~25k populära titlar (`generateStaticParams`). Varje sida gör ett
TMDB-anrop vid byggtid. Två skydd (se `src/lib/tmdb/buildFetch.ts` +
`buildCache.ts`):
- **AbortSignal.timeout (20s)** på alla byggtids-anrop → ingen sida når Next
  60s-tak; exporten kan aldrig avbrytas av en strypt fetch (otursdrabbade
  sidor får tunn metadata, bygget förblir grönt).
- **Fil-cache `.tmdb-cache/`** (TTL 7 dagar) persistas mellan CI-körningar via
  `actions/cache`. Kod-deployer hämtar därför nästan inga titlar (cache-träff)
  → ingen strypning, snabb deploy. Veckovis schemalagd deploy (cron i
  `deploy.yml`) sätter en stor `TMDB_BUILD_REFRESH_BUDGET` (+ längre timeout)
  och hämtar färsk metadata för alla stale titlar.

Skär **inte** ner pre-render-antalet för att fixa byggtid — catch-all-skalet är
`noindex` by default, så en icke-pre-renderad titel indexeras opålitligt
(endast efter JS-hydrering). Mekaniken är fixad; täckningen ska behållas.

GitHub Actions-workflows:
- `ci.yml` — lint + typecheck + test + build på PR:s och non-main pushes
- `deploy.yml` — kvalitetsgrindar + deploy live på push till main
- `preview.yml` — ephemeral preview-channel per PR (7-dagars TTL)

## Testing

Vitest kör 1000+ tester. Pure-logic helpers är extracted från hooks för att
kunna testas utan Firebase-imports i test-miljön (se
`useSubscriptionAdvisor.helpers.ts` och `sessionTiming.ts`-mönstret).

## Dokumentation

- `docs/data-export-format.md` — GDPR export JSON-schema
- `docs/data-retention-policy.md` — radering + anonymisering-policy
- `docs/moderation.md` — admin-runbook för reports (Sprint 5)
- `docs/RUNBOOK.md` — incident-playbooks (Sprint 5)
- `docs/analysis/REMEDIATION_PLAN.md` — sprintplan 1–3
- `docs/analysis/FUTURE_ROADMAP.md` — sprintplan 4+
- `docs/analysis/EXTERNAL_ACTIONS.md` — saker som kräver access utanför repot

## Sprint-historik

- **Sprint 1** — Launch-blockers (legal docs, a11y, analytics, design rules)
- **Sprint 2** — Quality foundation (Vitest, CI, Sentry, Firebase emulator, arkitektur-dekomp)
- **Sprint 3** — Growth + polish (SEO, sitemap, Schema.org, UGC moderation, onboarding)
- **Sprint 4** — Compliance + security (GDPR export, auth hardening, session/invite-token security)
- **Sprint 5** — Docs + DX (pågående)

## Workflow map freshness

`docs/workflow-map.html` (interactive, JSON-driven) documents the PWA/Firebase flows.
CI + deploy fail if a path it references stops existing (`node scripts/check-workflow-map.mjs`).
A PostToolUse hook stamps `.claude/state/workflow-map-stale.json` when mapped code is edited.
**If that flag exists:** re-trace ONLY the flows whose nodes match the flag's `triggers`,
update the map's `<script id="data">` JSON (nothing else), run the linter, delete the flag,
commit the map. Don't rebuild the map; don't ignore the flag.
