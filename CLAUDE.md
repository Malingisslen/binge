# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Binge (binge.nu) is a Swedish media tracker for movies and TV shows. Users track what they're watching, want to watch, and have watched — with the killer feature being where each title is available on Swedish streaming services. Think Prisjakt for media: dense, functional, data-forward. The UI is in Swedish.

## Tech Stack

- **Frontend:** Next.js 14+ (App Router), TypeScript, Tailwind CSS, React Query (TanStack Query v5)
- **Auth/DB:** Firebase (Authentication, Cloud Firestore, Cloud Functions, Hosting)
- **External API:** TMDB API v3 — all movie/TV metadata, Swedish watch providers
- **Hosting:** Firebase Hosting (static export) behind Cloudflare CDN
- **Icons:** Lucide React (small, inline only)
- **Utilities:** clsx + tailwind-merge

## Commands

```bash
npm run dev          # Next.js dev server (http://localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
firebase deploy --only hosting   # Deploy to Firebase Hosting
firebase deploy --only functions # Deploy Cloud Functions
```

All data fetching is client-side via React Query — no SSR. Static export (`output: 'export'`) is commented out in next.config.mjs because dynamic routes (`/movie/[id]`, `/tv/[id]`) don't support it without pre-rendering. Enable it only for deployment with a catch-all route approach, or deploy using `next start` instead.

## Architecture

**Client-side only SPA** using Next.js App Router for routing, but no server-side rendering. All TMDB data is fetched client-side with React Query (staleTime 5 min). Auth state managed via React Context (`AuthContext`).

### Key directories
- `src/app/` — App Router pages (dashboard, search, movie/tv detail, calendar, my lists, settings)
- `src/components/` — Organized by feature: layout/, search/, title/, tv/, calendar/, dashboard/
- `src/components/WatchlistPage.tsx` — Shared list page used by all `/my/*` routes (table + grid views, filter, sort)
- `src/lib/firebase/` — Firebase config (stub — not yet connected)
- `src/lib/tmdb/` — TMDB API client (`client.ts`), types, Swedish provider mapping with brand colors (`providers.ts`)
- `src/hooks/` — Custom hooks: useAuth, useWatchlist, useEpisodeProgress, useCalendar, useTMDB
- `src/contexts/` — AuthContext (currently stub with demo user)

### Current state
- Auth: stub (demo user, no Firebase). Needs Firebase Auth integration.
- Watchlist/EpisodeProgress: local in-memory state. Needs Firestore integration.
- Dynamic routes use server page → client component pattern (e.g., `page.tsx` → `MoviePageClient.tsx`) for compatibility.

### Data model (Firestore)
- `users/{uid}` — Profile, `myProviders` (array of TMDB provider_ids), notification settings
- `users/{uid}/watchlist/{tmdbId}` — Tracked titles with status (watching/want_to_watch/watched/dropped), cached metadata, rating, notes, TV progress
- `users/{uid}/episodeProgress/{tmdbId}` — Per-episode watched state, separate from watchlist to avoid huge documents

### TMDB API
- Always use `language=sv-SE` and `watch_region=SE` for Swedish content
- Watch providers via `append_to_response=watch/providers`, key is `results.SE`
- Provider categories: `flatrate` (subscription), `rent`, `buy`
- Image base URL: `https://image.tmdb.org/t/p/{size}/`
- Attribution required: "This product uses the TMDB API but is not endorsed or certified by TMDB"

## Design Constraints

The design mockup is in `binge-v2.html` — replicate that feel exactly. Key rules:

- **Must NOT look AI-generated.** No rounded cards with shadows, no gradients, no emoji in UI, no decorative badges
- **Layout:** Fixed 210px dark sidebar (#1e2028) + scrollable main content
- **Base font size:** 13px (dense tool, not a marketing site)
- **Font:** System font stack only (`system-ui, -apple-system, "Segoe UI", sans-serif`)
- **Border radius:** 2-3px maximum, never more
- **No box-shadow anywhere**, no transform/scale on hover
- **Accent color:** #d97b35 (warm orange-brown)
- **Page background:** #eeece8, surfaces: #faf8f5, sidebar: #1e2028
- **Table headers:** 9-10px uppercase, letter-spacing 0.5px, color #aaa
- **Provider tags:** Tiny bordered pills (9px), user's own services highlighted with accent border/color

## Environment Variables

```
NEXT_PUBLIC_TMDB_API_KEY
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
TMDB_API_READ_ACCESS_TOKEN          # Cloud Functions only
```

## Deployment

Same pattern as synat.se: `next build && next export` → Firebase Hosting (`public: "out"`) → Cloudflare proxy (DNS, SSL, caching). SPA rewrites all routes to `/index.html`.
