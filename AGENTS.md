# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Binge (binge.nu) is a Swedish media tracker for movies and TV shows. Users track what they're watching, want to watch, and have watched — with the killer feature being where each title is available on Swedish streaming services. Think Prisjakt for media: dense, functional, data-forward. The UI is in Swedish.

## Tech Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, React Query (TanStack Query v5)
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
npm test                  # Vitest run (81+ tests — pure-logic + hook scenarios)
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

Tre ställen hämtar `['tv', id]`-queries (useTVShow, useSubscriptionAdvisor,
useRevivalNudges). Om de registrerar olika `staleTime` slåss observers om
senaste värde. Lösning: `src/lib/tmdb/cacheTiers.ts` exporterar
`TMDB_STALE.TV_DETAIL`, `MOVIE_DETAIL`, `CATALOG`, `SEARCH`, `PERSON`, `GENRES`,
`PROVIDERS`. **Alla callsites för samma queryKey måste använda samma konstant.**

### TMDB rate-limit + AbortSignal

`src/lib/tmdb/client.ts` har en 8-concurrent-semaphore + 429 Retry-After-respekt
+ AbortSignal hela vägen. React Query's `ctx.signal` skickas vidare i alla
`useQuery`/`useQueries` så navigations-bort avbryter in-flight fetches.

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
'vill_se'   — vill se (både film + TV)
'mina'      — TV ONLY: i samlingen (sub-state derive:as från progress + TMDB)
'sedd'      — film ONLY: terminal (filmer går aldrig tillbaka)
'avbruten'  — gav upp (både film + TV)
```

**TV sub-state** (deriverat, aldrig sparat — beräknas via `tvSubState()` i
`src/lib/watchStatus.ts`):
- `aktiv`    — bakom på aireade avsnitt (har osedda S/E mot TMDB:s last_episode_to_air)
- `ikapp`    — caught up + Returning Series → väntar på nytt
- `avslutad` — caught up + Ended/Canceled → klar

**Designval:** TV är aldrig "klar" på samma sätt som film — show vaknar från
döden, får spinoffs, returnerar med nya säsonger. Därför har TV inget 'sedd'
slutläge; istället bor allt aktivt under 'mina' och sub-state ändras
automatiskt när TMDB:s last_episode_to_air rör sig. Endast film har 'sedd'
som terminal — film är klar när den är klar.

**Auto-promote:** `WatchlistContext.updateProgress` flyttar 'vill_se' → 'mina'
(TV) eller 'sedd' (film) automatiskt när användaren markerar sitt första
avsnitt sett. Tar bort manuellt status-byte.

**Migration** (lazy, klient-sidigt i `migrateStatus`, `src/lib/watchStatus.migration.ts`):
- 'följer' (TV) → 'mina'; 'följer' (film) → 'sedd' (rare)
- 'sedd' (TV) → 'mina'; 'sedd' (film) → 'sedd' (oförändrat)
- Engelska v1-schema (`watching`/`want_to_watch`/`watched`/`dropped`) hanteras samtidigt
- Firestore-docs skrivs aldrig om bara för migration — bara när användaren
  ändrar något på en titel skrivs den med nya schemat. Så Firestore kan
  innehålla 'följer'-strängar i mångmånader; läsare normaliserar.

**Routes:**
- `/my/series` — TV i 'mina' (sub-tabbar för aktiv/ikapp/avslutad i UI:n)
- `/my/films` — film i 'sedd'
- `/my/vill-se`, `/my/avbrutna`, `/my/all` — mixed
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

Direction H · "Schemat" — the shipped design. All tokens live in `globals.css :root`
and `tailwind.config.ts`. Key rules:

- **Must NOT look AI-generated.** No rounded cards with big shadows, no decorative gradients, no emoji in UI, no decorative badges.
- **Layout:** sticky horizontal top chrome — **no sidebar**. `AppTopbar` (brand · WeekStrip · search · avatar) with a horizontal `Subnav` directly below; `MobileTabBar` (5 tabs, fixed bottom) replaces the subnav on narrow screens. Main content in `.canvas` (max-width 1320px, centered).
- **Base font size:** 15px. **Font:** Albert Sans → `system-ui, -apple-system, "Segoe UI", sans-serif` fallback. (The mono font is being phased out — don't add `font-mono`/`var(--mono)`.)
- **Colors:** every value is an oklch CSS variable in `globals.css :root`, mirrored as Tailwind tokens. **No hex in component code.** Surfaces `--bg` (warm off-white) / `--bg-2` / `--surface`; text `--ink`/`--ink-2`/`--ink-3`; borders `--rule`/`--rule-2`.
- **Two-accent rule (don't break it):** `--acc` **saffran** = "now / live / decisive" (CTA buttons, live indicators, veto, brand mark); `--cal-*` **plum** = "today / time positioning" (WeekStrip today cell, calendar today column). Never mix them — saffran isn't "calendar", plum isn't "CTA".
- **Border radius:** `rounded-sm` 3px · `rounded`/`rounded-md` 6px · `rounded-lg` 8px. Poster thumbnails 3px, buttons 6px, cards/modals 6–8px, never more than 8px.
- **Shadows:** exactly two allowed — `shadow-lift` (card hover) + `shadow-pop` (popover). Everything else is flat; no `drop-shadow`, `filter: blur`, or arbitrary box-shadow.
- **Posters:** per-genre SVG duotone filters (`DuotoneFilters`, mounted once in AppShell); hover → `filter: none` reveals the original bitmap; film cards lift `translateY(-2px)` on hover (this transform is intentional).
- **Density:** a tool, not a marketing page — keep text sizes and margins compact. A guard test (`src/lib/design/consistency.test.ts`) fails the build if a page reintroduces the 18px-title anti-pattern.
- **No `next/image`** — static export has no image optimizer. All `<img>` have explicit `width`/`height` for CLS + `loading="lazy"` + `decoding="async"`.
- **TMDB attribution required** (`src/lib/tmdb/attribution.ts`); all UI text is Swedish.

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
- `docs/analysis/EXTERNAL_ACTIONS.md` — ops-referens: manuell functions/rules-deploy, secrets, Cloudflare-cache

## Sprint-historik

- **Sprint 1** — Launch-blockers (legal docs, a11y, analytics, design rules)
- **Sprint 2** — Quality foundation (Vitest, CI, Sentry, Firebase emulator, arkitektur-dekomp)
- **Sprint 3** — Growth + polish (SEO, sitemap, Schema.org, UGC moderation, onboarding)
- **Sprint 4** — Compliance + security (GDPR export, auth hardening, session/invite-token security)
- **Sprint 5** — Docs + DX (pågående)
