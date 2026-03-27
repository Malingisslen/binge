# Binge — Product Specification

**Domain:** binge.nu

## Overview

Binge is a Swedish media tracker for movies and TV shows. Users track what they're watching, want to watch, and have watched — with the killer feature being where each title is available on Swedish streaming services.

Inspired by SideReel (TV episode tracking with weekly calendar) and Letterboxd (film logging), but with a Swedish angle: **"Where can I stream this in Sweden?"**

The app is a personal tool, not a showcase. It should feel like Prisjakt for media — dense, functional, data-forward.

---

## Tech Stack

### Frontend
- **Framework:** Next.js 14+ (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS — but used sparingly. System font stack, minimal border-radius, no decorative shadows. The design reference (see Frontend section) uses raw CSS; replicate that feel in Tailwind.
- **State management:** React Query (TanStack Query) for API calls, React Context for auth/user state
- **Icons:** Lucide React (small, inline only — no decorative icon use)

### Backend
- **Firebase Authentication** — Google login + email/password
- **Cloud Firestore** — Primary database for user data
- **Firebase Cloud Functions** — Scheduled jobs (notifications, new episode checks)
- **Firebase Cloud Messaging** — Push notifications (Phase 4)

### External API
- **TMDB (The Movie Database) API v3** — All movie/TV metadata
  - Search, details, images, genres, ratings
  - Watch providers per country (Sweden = `watch/providers?watch_region=SE`)
  - TV shows: seasons, episodes, air dates
  - Trending, popular, recommendations, similar

### Hosting
- **Firebase Hosting** — Static export of Next.js (same setup as synat.se)
- **Cloudflare** — CDN/proxy in front of Firebase Hosting (DNS, SSL, caching)
- **Domain:** binge.nu via Cloudflare (nameservers point there, A-record to Firebase)

Next.js runs as `next export` (static export). No server-side rendering — all data fetching is client-side via React Query. Cloud Functions handle scheduled jobs and optional API proxying.

---

## Frontend Design

### Design Principles

**THIS IS CRITICAL. Read carefully.**

The design must NOT look AI-generated. No generic rounded cards with subtle shadows. No gradient backgrounds. No emoji in UI. No decorative badges. No stat cards with icons. The design should feel like a real tool built by a developer who uses it daily.

Reference points: Prisjakt (data-dense Swedish tool), SideReel (functional TV tracker), Notion (clean database UI). NOT: Dribbble shots, Apple landing pages, Tailwind UI templates.

### Layout

The app uses a **fixed sidebar + scrollable main content** layout:

```
┌──────────┬──────────────────────────────────────────┐
│ SIDEBAR  │ TOPBAR (tabs + user)                     │
│ 210px    ├──────────────────────────────────────────┤
│          │                                          │
│ Logo     │ CONTENT                                  │
│ Search   │ - Weekly calendar                        │
│          │ - Watching table                         │
│ Nav      │ - Want to watch grid                     │
│ - Dash   │                                          │
│ - Explore│                                          │
│ - Cal    │                                          │
│          │                                          │
│ Lists    │                                          │
│ - Watch  │                                          │
│ - Want   │                                          │
│ - Seen   │                                          │
│ - Drop   │                                          │
│          │                                          │
│ Services │                                          │
│ - Netflix│                                          │
│ - Disney+│                                          │
│ - etc    │                                          │
│          │                                          │
│ Footer   │                                          │
└──────────┴──────────────────────────────────────────┘
```

### Color Palette

```css
/* Backgrounds */
--bg-page: #eeece8;          /* Warm light gray, main background */
--bg-surface: #faf8f5;       /* Panels, tables, calendar */
--bg-sidebar: #1e2028;       /* Dark sidebar */
--bg-sidebar-hover: rgba(255,255,255,0.02);
--bg-sidebar-active: rgba(217,123,53,0.07);
--bg-row-hover: #f5f0ea;     /* Table row hover */
--bg-calendar-header: #f5f3ee;

/* Text */
--text-primary: #222;
--text-secondary: #555;
--text-muted: #999;
--text-sidebar: #9a9aaa;
--text-sidebar-active: #eee;

/* Accent */
--accent: #d97b35;            /* Warm orange-brown, NOT bright orange */
--accent-border: #d97b35;

/* Borders */
--border: #ddd;
--border-light: #eee;
--border-table: #f0eee8;
--border-sidebar: rgba(255,255,255,0.05);

/* Status colors (used sparingly, only on provider tags) */
--provider-mine-border: #d97b35;
--provider-mine-text: #d97b35;
--season-done: #2e7d32;
```

### Typography

System font stack only. No Google Fonts.

```css
font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
```

- Base font size: 13px (not 14 or 16 — this is a dense tool)
- Table headers: 9-10px, uppercase, letter-spacing 0.5px, color #aaa
- Panel titles: 11-12px, font-weight 700, color #555
- Sidebar labels: 9px, uppercase, letter-spacing 1.5px, color #3e3e48
- Table body: 12px
- Title names in tables: 12px, font-weight 600

### Sidebar

- Width: 210px, fixed
- Dark background (#1e2028), light text (#9a9aaa)
- Logo "binge" in accent color (#d97b35), ".nu" in muted gray
- Small inline search input at top
- Navigation sections with uppercase labels (9px): "Översikt", "Samling", "Tjänster"
- Active item: left border accent + slightly tinted background
- Badge counts in accent color, right-aligned
- Services section at bottom: colored dots (actual brand colors) + name + count
- Footer: "Inställningar" link

### Top Bar

- Light background (#faf8f5), thin bottom border
- Horizontal text tabs: Dashboard, Kalender, Serier, Filmer
- Active tab: accent color + bottom border
- User avatar (small circle, 20px) + name, right-aligned
- No search here (search is in sidebar)

### Weekly Calendar (SideReel-inspired)

A plain 7-column grid showing which episodes air this week for tracked shows.

- Header row: abbreviated weekday + date (e.g. "tis 25"), today highlighted in accent
- One content row: each cell shows series name, episode code (S2E8), and streaming service name — or "—" if nothing
- Navigation: "← v12" and "v14 →" links
- Plain text, no cards, no colored backgrounds per show. Just data in a grid.

### Watching Table

The primary dashboard view. A standard HTML table, not cards.

Columns: poster thumbnail (26x39px) | Title + genre/year | Next episode (e.g. "S2E8") | Progress bar + count (e.g. "17/20") | Provider tag | Rating

- Progress bar: 48px wide, 3px tall, accent fill
- Provider tags: tiny bordered pills (9px font), "mine" highlighted with accent border/text
- Rows are clickable — clicking expands a detail panel below

Tab filters above: Alla / Serier / Film

### Expanded Series Detail (SideReel-inspired)

When a row in the watching table is clicked, a detail section expands below it (not a modal, not a separate page).

Contains:
- Poster (40x60px) + title + metadata + star rating + "Next unwatched: S2E8 (25 mars)"
- Action buttons: "Markera S2E8 sedd" (primary), "Anteckning", "Sluta följa"
- Season rows: season name + progress bar + count + button ("Sedd" green / "Fortsätt" accent)

This is directly inspired by SideReel's "More Seasons & Episodes" expandable section.

### Want to Watch Grid

A simple poster grid below the watching table.

- Grid columns: auto-fill, minmax(120px, 1fr)
- Each card: poster image (2:3 ratio) + title (10px, bold, truncated) + year + TMDB rating
- Provider tags overlaid on poster bottom-left corner (tiny, dark background, "mine" in accent)
- Tab filters: Alla / Mina tjänster

### Spacing and Sizing Rules

- Panel padding: 6-8px header, 8-12px body
- Table cell padding: 5-8px
- Gap between panels: 14px
- Border radius: 2-3px maximum. Never more.
- No box-shadow anywhere
- No transform/scale on hover — only background color change

### Mobile (< 768px)

- Sidebar collapses to hamburger menu
- Calendar switches to vertical list (one day per row)
- Table switches to card list view
- Poster grid: 2 columns

---

## TMDB API — Key Endpoints

Base URL: `https://api.themoviedb.org/3`

All calls require API key (v3 auth) or Bearer Token (v4 auth). Register free account at themoviedb.org.

### Search
```
GET /search/multi?query={query}&language=sv-SE&region=SE
```
Searches movies + TV + people simultaneously. Returns `media_type` per result.

### Movie Details
```
GET /movie/{movie_id}?language=sv-SE&append_to_response=watch/providers,recommendations,credits
```

### TV Series Details
```
GET /tv/{series_id}?language=sv-SE&append_to_response=watch/providers,recommendations,credits
```

### TV Season Details with Episodes
```
GET /tv/{series_id}/season/{season_number}?language=sv-SE
```

### Watch Providers (Sweden)
Included via `append_to_response=watch/providers`. Response has a `results.SE` key:
```json
{
  "results": {
    "SE": {
      "link": "https://www.themoviedb.org/movie/123/watch?locale=SE",
      "flatrate": [
        { "provider_id": 8, "provider_name": "Netflix", "logo_path": "/..." }
      ],
      "rent": [...],
      "buy": [...]
    }
  }
}
```

Categories:
- `flatrate` = Included in subscription (Netflix, Viaplay, etc.)
- `rent` = Digital rental
- `buy` = Digital purchase

### Trending & Popular
```
GET /trending/{media_type}/{time_window}?language=sv-SE
GET /movie/popular?language=sv-SE&region=SE
GET /tv/popular?language=sv-SE&region=SE
```

### Images
Base URL: `https://image.tmdb.org/t/p/`
Sizes: `w92`, `w154`, `w185`, `w342`, `w500`, `w780`, `original`

### TV Episode Air Dates (for calendar)
```
GET /tv/{series_id}?language=sv-SE&append_to_response=next_episode_to_air,last_episode_to_air
```
Returns `next_episode_to_air.air_date` which powers the weekly calendar.

### TMDB API Notes
- **Rate limit:** ~40 requests/second (generous)
- **Attribution required:** TMDB logo + "This product uses the TMDB API but is not endorsed or certified by TMDB"
- **Language:** `language=sv-SE` returns Swedish titles/descriptions when available, falls back to English
- **Watch provider data** comes from JustWatch and is generally reliable but may have slight delays

---

## Data Model (Firestore)

### Collection: `users`
```
users/{uid}
{
  displayName: string,
  email: string,
  photoURL: string | null,
  myProviders: number[],          // Array of TMDB provider_ids
  createdAt: Timestamp,
  updatedAt: Timestamp,
  notificationSettings: {
    newEpisodes: boolean,
    availableOnMyServices: boolean
  }
}
```

### Collection: `users/{uid}/watchlist`
```
users/{uid}/watchlist/{tmdbId}
{
  tmdbId: number,
  mediaType: "movie" | "tv",
  status: "watching" | "want_to_watch" | "watched" | "dropped",
  rating: number | null,          // 0.5-5.0 in half steps
  notes: string | null,           // Personal note / mini-review (max 500 chars)

  // Cached metadata (for fast list rendering without API calls)
  title: string,
  posterPath: string | null,
  releaseYear: number | null,

  // TV series only
  totalSeasons: number | null,
  lastWatchedSeason: number | null,
  lastWatchedEpisode: number | null,

  addedAt: Timestamp,
  updatedAt: Timestamp,
  watchedAt: Timestamp | null,
}
```

### Collection: `users/{uid}/episodeProgress`
```
users/{uid}/episodeProgress/{tmdbId}
{
  tmdbId: number,
  seasons: {
    [seasonNumber: string]: {
      [episodeNumber: string]: {
        watched: boolean,
        watchedAt: Timestamp | null
      }
    }
  }
}
```

### Why this structure
- `episodeProgress` is separate from `watchlist` to avoid huge documents for shows with 20+ seasons
- Cached metadata in watchlist items allows list rendering without TMDB API calls
- `myProviders` on user profile enables "show only what I can watch" filtering

### Firestore Indexes
```
Collection: users/{uid}/watchlist
  - status ASC, updatedAt DESC
  - mediaType ASC, status ASC
  - status ASC, rating DESC
```

### Firestore Security Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /users/{uid}/watchlist/{itemId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /users/{uid}/episodeProgress/{itemId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

---

## Swedish Streaming Services

These TMDB provider_ids are relevant for the Swedish market:

| Service | TMDB provider_id | Type |
|---------|-------------------|------|
| Netflix | 8 | flatrate |
| Amazon Prime Video | 119 | flatrate |
| Disney+ | 337 | flatrate |
| HBO Max | 384 | flatrate |
| Viaplay | 76 | flatrate |
| SVT Play | 520 | flatrate (free) |
| TV4 Play | 489 | flatrate/free |
| Apple TV+ | 350 | flatrate |
| Paramount+ | 531 | flatrate |
| Discovery+ | 510 | flatrate |
| Rakuten TV | 35 | rent/buy |
| Google Play Movies | 3 | rent/buy |
| Apple TV | 2 | rent/buy |

Verify at dev start:
```
GET /watch/providers/movie?language=sv-SE&watch_region=SE
GET /watch/providers/tv?language=sv-SE&watch_region=SE
```

---

## Routing

```
/                           → Dashboard (logged in) or Landing page (logged out)
/login                      → Login
/search?q={query}           → Search results
/movie/{tmdbId}             → Movie details
/tv/{tmdbId}                → Series details
/tv/{tmdbId}/season/{num}   → Season view with episode list
/calendar                   → Weekly calendar (full page)
/discover                   → Browse popular, trending, by genre
/discover/movies            → Browse movies
/discover/tv                → Browse TV
/my/watching                → My list: Currently watching
/my/want-to-watch           → My list: Want to watch
/my/watched                 → My list: Watched
/my/all                     → Full collection
/settings                   → Profile, my services, notifications
```

---

## Feature Spec by Phase

### Phase 1 — MVP (Core Tracking + Streaming Info)

#### 1.1 Authentication
- Google login (primary) + email/password
- Persistent session via Firebase Auth
- Protected routes: `/my/*`, `/settings`, `/calendar`
- Redirect to `/login` if not authenticated

#### 1.2 Search
- Search input in sidebar, always visible
- Debounced (300ms) with live suggestions dropdown (poster thumbnails + title + year + type badge)
- Enter → full search results page (`/search?q=...`)
- Uses TMDB `/search/multi`

#### 1.3 Dashboard (`/` for logged-in users)
- Weekly calendar showing air dates for tracked shows
- "Watching" table with all series/movies in watching status
- "Want to watch" poster grid below
- All sections have tab filters (Alla/Serier/Film) and "show all" links

#### 1.4 Movie Detail (`/movie/{tmdbId}`)
- Poster, title, year, runtime, genres
- TMDB rating
- Streaming info: "Stream on:" with provider names, grouped by flatrate/rent/buy
- User's providers highlighted
- Status button (add to watchlist with status selection)
- Rating (stars, 0.5-5.0)
- Notes field
- Cast & crew (top billed)
- Recommendations (horizontal scroll)
- Swedish synopsis from TMDB

#### 1.5 Series Detail (`/tv/{tmdbId}`)
- Same as movie plus:
- Season overview: list of all seasons with episode count, premiere date, progress bar
- Each season clickable → season view
- Status: Ongoing / Ended / Upcoming
- Next unwatched episode shown prominently

#### 1.6 Season View (`/tv/{tmdbId}/season/{num}`)
- Episode list with: number, title, air date, still image (thumbnail)
- Checkbox per episode: mark as watched
- "Mark all watched" per season (SideReel-style button)
- Progress bar (X/Y)

#### 1.7 Weekly Calendar (`/calendar` + dashboard widget)
- 7-day grid showing air dates for all tracked shows with status "watching"
- Shows: series name, episode code, streaming service
- Week navigation (previous/next)
- Data source: TMDB `next_episode_to_air` for each tracked series

#### 1.8 Watchlist & Tracking
- Status options: Watching / Want to Watch / Watched / Dropped
- Lists at `/my/*` with filter (movie/tv/all) and sort (recently added, title A-Z, rating, year)
- Table view (default) or poster grid view toggle

### Phase 2 — Personalization

#### 2.1 My Streaming Services
- In `/settings`: select which services you subscribe to (checklist with provider names)
- Everywhere streaming info is shown: highlight "your" services
- Filter in lists and discover: "Show only available on my services"

#### 2.2 Ratings
- Star rating 0.5-5.0 (half steps)
- Set inline on watchlist items or on detail page
- Displayed in watchlist views, sortable

#### 2.3 Notes
- Free text per title (max 500 chars)
- Displayed on detail page
- Editable inline

### Phase 3 — Discovery

#### 3.1 Explore Page (`/discover`)
- Trending now (TMDB trending)
- Popular movies / Popular TV
- Genre filter
- Sort: popularity, rating, date
- "Available on my services" toggle

### Phase 4 — Notifications

#### 4.1 New Episodes
- Cloud Function running daily (cron)
- Checks all series with status "watching" for all users
- Compares air_date with today
- Sends push or email notification

#### 4.2 Available on Your Services
- Periodic check (weekly) of titles with status "want_to_watch"
- Compares TMDB watch providers with user's `myProviders`
- Notifies if a title becomes available

---

## Directory Structure

```
binge/
├── src/
│   ├── app/
│   │   ├── layout.tsx                # Root layout: sidebar + main area
│   │   ├── page.tsx                  # Dashboard
│   │   ├── login/page.tsx
│   │   ├── search/page.tsx
│   │   ├── movie/[id]/page.tsx
│   │   ├── tv/[id]/page.tsx
│   │   ├── tv/[id]/season/[num]/page.tsx
│   │   ├── calendar/page.tsx
│   │   ├── discover/page.tsx
│   │   ├── my/
│   │   │   ├── watching/page.tsx
│   │   │   ├── want-to-watch/page.tsx
│   │   │   ├── watched/page.tsx
│   │   │   └── all/page.tsx
│   │   └── settings/page.tsx
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx           # Fixed sidebar with nav, services, search
│   │   │   ├── TopBar.tsx            # Tab bar + user area
│   │   │   └── MobileNav.tsx
│   │   ├── search/
│   │   │   └── SearchDropdown.tsx
│   │   ├── title/
│   │   │   ├── TitleCard.tsx         # Poster card for grids
│   │   │   ├── TitleGrid.tsx
│   │   │   ├── StatusButton.tsx
│   │   │   ├── RatingStars.tsx
│   │   │   └── ProviderTag.tsx
│   │   ├── tv/
│   │   │   ├── SeasonList.tsx
│   │   │   ├── SeasonRow.tsx         # Season with progress + "Watched" button
│   │   │   ├── EpisodeRow.tsx
│   │   │   └── SeriesDetail.tsx      # Expandable detail panel
│   │   ├── calendar/
│   │   │   └── WeeklyCalendar.tsx
│   │   └── dashboard/
│   │       ├── WatchingTable.tsx
│   │       └── WantToWatchGrid.tsx
│   │
│   ├── lib/
│   │   ├── firebase/
│   │   │   ├── config.ts
│   │   │   ├── auth.ts
│   │   │   └── firestore.ts
│   │   ├── tmdb/
│   │   │   ├── client.ts
│   │   │   ├── types.ts
│   │   │   └── providers.ts          # Swedish provider mapping + brand colors
│   │   └── utils.ts
│   │
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useWatchlist.ts
│   │   ├── useEpisodeProgress.ts
│   │   ├── useCalendar.ts            # Fetches air dates for tracked shows
│   │   └── useTMDB.ts
│   │
│   ├── contexts/
│   │   └── AuthContext.tsx
│   │
│   └── types/
│       └── index.ts
│
├── public/
├── .env.local
├── next.config.js                    # output: 'export' for static hosting
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Environment Variables

```env
# TMDB
NEXT_PUBLIC_TMDB_API_KEY=xxx
TMDB_API_READ_ACCESS_TOKEN=xxx          # For Cloud Functions

# Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=xxx
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=xxx
NEXT_PUBLIC_FIREBASE_PROJECT_ID=xxx
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=xxx
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=xxx
NEXT_PUBLIC_FIREBASE_APP_ID=xxx
```

---

## Dependencies

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "firebase": "^10.0.0",
    "@tanstack/react-query": "^5.0.0",
    "lucide-react": "^0.300.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/react": "^18.0.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.0.0",
    "postcss": "^8.0.0"
  }
}
```

---

## Non-Functional Requirements

- **Performance:** Lighthouse >90. Use Next.js Image for poster optimization.
- **SEO:** Static metadata and Open Graph tags per route. TMDB data rendered client-side.
- **Accessibility:** WCAG 2.1 AA minimum. Keyboard navigable. Focus visible.
- **Security:** Firestore rules (see above). TMDB API key is exposed client-side but read-only.
- **Error handling:** Graceful degradation if TMDB is down. Toast notifications for CRUD.
- **Caching:** React Query with staleTime 5 min for TMDB data.

---

## Sprint Plan (Phase 1)

### Sprint 1: Foundation (2-3 days)
1. Create Next.js project with TypeScript + Tailwind
2. Set up Firebase project (Auth + Firestore)
3. Implement AuthContext + Google login
4. Build Sidebar + TopBar layout (match design spec exactly)
5. Create TMDB API client with types

### Sprint 2: Search & Details (2-3 days)
1. Search input with debounced autocomplete
2. Search results page
3. Movie detail page with streaming providers
4. Series detail page with season overview
5. Season view with episode list

### Sprint 3: Tracking (2-3 days)
1. StatusButton component
2. Firestore CRUD for watchlist
3. List pages (`/my/*`) with filter and sort
4. EpisodeProgress — checkbox per episode
5. Mark full season as watched

### Sprint 4: Dashboard & Calendar (2-3 days)
1. Weekly calendar component
2. Dashboard with WatchingTable + WantToWatchGrid
3. Expandable SeriesDetail in table
4. Loading states, error handling, empty states
5. TMDB attribution in footer
6. Responsiveness pass

---

## Deployment (same pattern as synat.se)

### Firebase Hosting
```bash
next build && next export
firebase deploy --only hosting
```

### Firebase Config
```json
// firebase.json
{
  "hosting": {
    "public": "out",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  },
  "functions": { "source": "functions", "runtime": "nodejs20" }
}
```

### Cloudflare DNS
- A-record: `binge.nu` → `199.36.158.100` (Proxied)
- CNAME: `www` → `binge.nu` (Proxied)
- TXT: `binge.nu` → `hosting-site=<firebase-project-id>`
- TXT: `_acme-challenge` → (value from Firebase Console)

---

## Future Considerations (not in scope)

- Dark mode (Tailwind dark: variant)
- Social features (share lists, follow friends)
- Flutter mobile app (shared Firebase backend)
- Import from Trakt.tv, IMDb lists, Letterboxd, Filmtipset
- Year-in-review statistics
- Reminders ("New season of X starts in 3 days")
- Internationalization (change watch_region for other countries)
- PWA (installable via Service Worker)

---

## TMDB Attribution (required)

Must be visible in the app:

> This product uses the TMDB API but is not endorsed or certified by TMDB.

Plus TMDB logo (download from their press page). Place in sidebar footer or main footer.
