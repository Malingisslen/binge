# Product Essence Report — Binge

A WHAT-the-product-IS brief for a designer with no codebase access.
Sourced from `CLAUDE.md`, `binge-spec-en.md`, `src/app/**`, `src/components/**`,
`src/hooks/**`, `src/contexts/**`, `src/lib/**`, `src/types/**`,
`functions/src/index.ts`, `firebase.json`, `docs/**`. No visual files
(`tailwind.config.ts`, `*.css`, `binge-v2.html`, theme tokens, mockup HTML,
`/public/og-image.svg`, brand colors) were read into this report.

---

## §1 — Product Identity

- **Name:** Binge (domain `binge.nu`).
- **Elevator pitch:** A Swedish-language tracker for movies and TV that
  answers two questions in one place: *"What am I watching, and where can I
  stream it in Sweden right now?"* It logs your library, tells you when the
  next episode airs, recommends what to watch next, and advises which paid
  streaming subscriptions are worth keeping this month versus pausing.
- **Brand etymology:** "Binge" — to watch large quantities of TV in one
  sitting. Conjugates naturally with the Swedish verb form ("att binga").
  The `.nu` ccTLD reads as the Swedish word *"nu"* ("now"), so the wordmark
  parses as "binge.now" — a verb plus an adverb, an invitation.
- **Stated mission / purpose:**
  - `CLAUDE.md`: *"Binge (binge.nu) is a Swedish media tracker for movies
    and TV shows. Users track what they're watching, want to watch, and
    have watched — with the killer feature being where each title is
    available on Swedish streaming services. Think Prisjakt for media:
    dense, functional, data-forward."*
  - `binge-spec-en.md` §Overview: *"Inspired by SideReel (TV episode
    tracking with weekly calendar) and Letterboxd (film logging), but with
    a Swedish angle: 'Where can I stream this in Sweden?'"*
  - `binge-spec-en.md` §Overview: *"The app is a personal tool, not a
    showcase."*

---

## §2 — The User

- **Audience:** Adult consumers in Sweden who watch enough to care about
  rotation between two-to-five paid streaming subscriptions
  (`docs/advisor-logic.md`, `src/components/settings/ProvidersSection.tsx`).
- **Single-user primary, with collaborative overlays:**
  - Each account is a personal library (`users/{uid}/watchlist/*` in
    `CLAUDE.md` §Data model).
  - Friends, follows, and reviews layer social activity on top
    (`src/hooks/useFriends.ts`, `useFollow.ts`, `useReviewSocial.ts`).
  - Permanent **groups** (households / friend circles) share a watchlist
    (`src/components/groups/GroupWatchlistTable.tsx`,
    `src/types/social.ts:Group`).
  - **Tillsammans** ("Together") sessions are ephemeral group picks for
    movie-night decisions, with vote/veto mechanics
    (`src/types/social.ts:TogetherSession,SessionParticipant,SessionSwipe`).
- **Use context:** Desk + couch + phone. Routes adapt to mobile via
  `MobileNav.tsx`; the app is a Cloudflare-fronted SPA installable as a PWA
  through Firebase Cloud Messaging service worker
  (`public/firebase-messaging-sw.js`).
- **Skill assumption:** Comfortable with data-dense interfaces. The product
  positions itself against *Prisjakt* — a Swedish price-comparison site
  known for spreadsheet-grade UI. Users are expected to read tables, parse
  episode codes (`S2E8`), and care about provider subscription mechanics.
- **Locale assumption:** Swedish residency. The TMDB region is hard-pinned
  to `SE` in `src/lib/tmdb/client.ts` and the provider catalog enumerates
  only Swedish services (`src/lib/tmdb/providers.ts`).

---

## §3 — Complete Feature Inventory

Routes confirmed in `src/app/`, page-clients in `src/components/pages/`,
behaviour in hooks, lib modules and contexts.

### 3.1 Auth, account & onboarding
- Email + password sign-up and sign-in (`src/app/login/page.tsx`,
  `src/hooks/useAuth.ts`, `src/contexts/AuthContext.tsx`).
- Google SSO (`CLAUDE.md` §Auth, `AuthContext.tsx`).
- Password strength meter (`src/components/auth/PasswordStrengthMeter.tsx`,
  `src/lib/passwordStrength.ts`).
- Email-verification banner with resend
  (`src/components/layout/EmailVerificationBanner.tsx`).
- Multi-step onboarding wizard: welcome → pick providers → seed a few
  titles → genre calibration → done (`src/components/onboarding/OnboardingFlow.tsx`).
- Username claim (global reservation in `usernames/{username}`,
  `src/lib/firebase/username.ts`, `src/components/settings/UsernameSection.tsx`).
- Optional Firebase App Check via reCAPTCHA v3
  (`src/lib/firebase/appCheck.ts`).
- Terms acceptance gate at sign-up; stored as `termsAcceptedAt` + version
  on the user doc (`src/types/domain.ts:UserProfile`).

### 3.2 Personal library / watchlist
- Four-status model: `vill_se` (want to watch), `mina` (mine — TV in
  progress), `sedd` (seen — movies terminal), `avbruten` (dropped)
  (`src/lib/watchStatus.ts`, `src/types/domain.ts`).
- TV sub-states derived from progress and TMDB metadata:
  `aktiv` (behind), `ikapp` (caught up, returning), `avslutad` (ended)
  (`src/lib/watchStatus.ts`).
- Lazy schema migration from older statuses (e.g. `följer`, English v1
  enum) handled in `src/lib/watchStatus.migration.ts`.
- Per-title rating (half-stars 0.5 → 5.0, `src/components/title/RatingStars.tsx`).
- Free-text notes per title, ≤500 chars
  (`src/components/title/NotesTextarea.tsx`, `NotesBlock.tsx`).
- Per-title visibility override: private / friends / public
  (`src/types/domain.ts:ItemVisibility`).
- Auto-promotion: marking the first episode of a `vill_se` TV show as seen
  promotes it to `mina` (`src/contexts/WatchlistContext.tsx`).
- "Not interested" hide-list to suppress titles from recommendations
  (`src/contexts/NotInterestedContext.tsx`,
  `src/components/title/NotInterestedButton.tsx`).
- Rewatch count on each item (`src/types/domain.ts:WatchlistItem`).
- List routes:
  - `/my/series` — TV in `mina` with sub-tabs aktiv / ikapp / avslutad.
  - `/my/films` — terminal seen movies.
  - `/my/want-to-watch` — backlog.
  - `/my/avbrutna` — dropped.
  - `/my/all` — flat mix.
  - `/my/following` and `/my/watched` are 301-redirected legacy aliases
    (`firebase.json`).
- Default list view is table or grid, user-controlled in settings
  (`src/components/settings/DisplaySection.tsx`).

### 3.3 TV episode tracking
- Per-episode watched checkbox stored under
  `users/{uid}/episodeProgress/{tmdbId}` (`src/hooks/useEpisodeProgress.ts`).
- Season list with progress bar per season, mark-season-watched action
  (`src/components/tv/SeasonList.tsx`, `SeasonRow.tsx`, `EpisodeRow.tsx`,
  `SeasonEpisodePanel.tsx`).
- Inline expandable series detail panel in dashboard
  (`src/components/tv/SeriesDetail.tsx`).
- Group-aware episode-progress sync wrapper
  (`src/hooks/useEpisodeProgressWithSync.ts`).

### 3.4 Calendar
- Page `/calendar` with weekly and monthly views
  (`src/app/calendar/page.tsx`, `src/components/calendar/WeeklyCalendar.tsx`,
  `MonthlyCalendar.tsx`).
- Week navigation by ISO week label ("v12 ← → v14"), one entry per
  upcoming episode of tracked shows (`CalendarEntryItem.tsx`,
  `src/hooks/useCalendar.ts`).
- Dashboard "Upcoming cards" widget shows the next-airing episodes
  (`src/components/dashboard/UpcomingCards.tsx`).
- Empty-state: "Inga fler avsnitt denna vecka".

### 3.5 Title detail
- Movie detail page (`src/components/pages/MoviePageClient.tsx`).
- TV detail page (`src/components/pages/TVShowPageClient.tsx`).
- Season detail page (`SeasonPageClient.tsx`).
- Person detail page — actor/director filmography
  (`src/components/pages/PersonPageClient.tsx`).
- Provider browse page — every title from a specific service
  (`src/components/pages/ProviderPageClient.tsx`).
- Each detail surfaces: poster, year, runtime, genres, TMDB synopsis in
  Swedish, status button (`StatusButton.tsx`), rating stars, notes block,
  add-to-list / add-to-group, not-interested toggle, JSON-LD structured
  data for SEO (`src/components/title/JsonLd.tsx`), TMDB attribution
  (`src/lib/tmdb/attribution.ts`).
- "Similar / recommended" row at the bottom
  (`src/components/title/RecommendationsSection.tsx`).

### 3.6 Search & discovery
- Sidebar search box with debounced autocomplete dropdown
  (`src/components/search/SearchDropdown.tsx`, `src/hooks/useSearchBox.ts`,
  `useDebouncedValue.ts`).
- Full search results page `/search` (`src/app/search/page.tsx`).
- User search by username (`src/hooks/useUserSearch.ts`,
  `src/lib/firebase/userSearch.ts`).
- Provider search — discover what's on a given service
  (`src/hooks/useSearchProviders.ts`).
- Browse pages: `/films`, `/series`, `/discover`.

### 3.7 Recommendations engine
- Hub at `/recommendations` (`src/components/recommendations/RecommendationsHub.tsx`).
- Expanded view with filters (`RecommendationsExpanded.tsx`,
  `RecommendationsFilters.tsx`).
- Cascade composition (`src/lib/recommendations/rowComposition.ts`,
  `cascadePrioritizer.ts`, `seedAnalysis.ts`,
  `src/hooks/useRecommendationsCascade.ts`).
- Seven row generators:
  - Trending (`useRowTrending.ts`)
  - Upcoming releases (`useRowUpcoming.ts`)
  - Genre canon (`useRowGenreCanon.ts`)
  - Thematic / mood (`useRowThematic.ts`)
  - Similar to a recent favourite (`useRowSimilar.ts`)
  - Latest favourite-derived (`useRowLatestFav.ts`)
  - Filmography of a person the user has rated highly (`useRowPerson.ts`)
- Quick-rate modal feeds the taste vector when shown unrated titles
  (`src/components/recommendations/QuickRateModal.tsx`).
- Genre-preference calibration page `/kalibrera`
  (`src/app/kalibrera/page.tsx`,
  `src/components/settings/TasteDataSection.tsx`,
  `src/lib/taste/vector.ts`, `similarity.ts`, `stats.ts`, `backfill.ts`).
- Title filter respects user content-filter rules (latin-only, country
  blocklist) (`src/lib/utils/titleFilter.ts`).
- Revival nudge — re-prompts the user to resume a returning series
  (`src/components/dashboard/RevivalNudge.tsx`, `useRevivalNudges.ts`).

### 3.8 Subscription advisor (streaming-cost optimisation)
- Dashboard widget (`src/components/dashboard/SubscriptionAdvisorWidget.tsx`).
- Standalone page `/savings` with timeline + per-provider forecast
  (`src/components/savings/AdvisorTimeline.tsx`,
  `WillSeePerProvider.tsx`).
- Logic in `src/hooks/useSubscriptionAdvisor.ts`
  + `useSubscriptionAdvisor.helpers.ts`, documented in
  `docs/advisor-logic.md`.
- Recommends one of four primary actions: `pause`, `catchup`, `subscribe`,
  `idle` (`src/types/advisor.ts:PrimaryAction`).
- Tracks active pauses with savings accrued so far
  (`AdvisorTimeline.tsx`, `ProviderPauseState`).
- Monthly cost + tier per provider entered by the user
  (`src/components/settings/ProvidersSection.tsx`,
  `UserProfile.providerCosts`, `providerTiers`).
- Ads-tier providers excluded from advisor unless the user has an
  ad-supported subscription (`CLAUDE.md` §TMDB API).
- Most-used-provider summary (`MostUsedProvider`).

### 3.9 Custom lists
- Page `/my/lists` (`src/app/my/lists/page.tsx`,
  `src/components/pages/ListPageClient.tsx`).
- Create / curate titled lists with description, public toggle
  (`src/types/domain.ts:UserList`, `src/hooks/useLists.ts`).
- Add-to-list button on every title (`src/components/title/AddToListButton.tsx`).

### 3.10 Social — profiles, follows, friends, reviews, feed
- Public user profile `/user/{username}`
  (`src/components/pages/UserProfilePageClient.tsx`,
  `src/hooks/usePublicProfile.ts`).
- Friend system, requires mutual confirmation
  (`src/components/social/FriendButton.tsx`, `src/hooks/useFriends.ts`,
  `src/lib/firebase/friends.ts`, `src/app/my/friends/page.tsx`).
- Follow system (one-directional)
  (`src/components/social/FollowButton.tsx`, `src/hooks/useFollow.ts`,
  `useFollowList.ts`).
- Activity feed `/feed` showing follows' activity
  (`src/app/feed/page.tsx`).
- Reviews per title, with `spoiler` flag, text body, attached rating
  (`src/types/domain.ts:Review`, `src/components/title/ReviewList.tsx`,
  `src/hooks/useReviews.ts`).
- Likes on reviews (subcollection doc-id = uid for cheap lookup,
  `CLAUDE.md` §Data model).
- Comments on reviews (`src/types/domain.ts:ReviewComment`,
  `src/hooks/useReviewSocial.ts`).
- Block a user (`src/hooks/useBlockedUsers.ts`,
  `users/{uid}/blocked/{targetUid}`).
- Profile stats panel: count of seen movies, TV shows, average rating,
  taste vector summary (`src/components/social/ProfileStatsPanel.tsx`).
- Friends-only watchlist visibility tier
  (`src/types/domain.ts:ItemVisibility`).

### 3.11 Groups (households / friend circles)
- `/grupper` and `/grupper/ny`
  (`src/components/pages/GroupPageClient.tsx`,
  `src/components/groups/*`).
- Owner + members, role enum
  (`src/types/social.ts:Group, GroupRole, GroupMember`).
- Shared group watchlist with per-member ratings
  (`GroupWatchlistTable.tsx`, `GroupWatchlistItem`).
- Group settings modal (`GroupSettingsModal.tsx`).
- Invite by link; only the hash of the invite token is stored, plaintext
  lives only in the shared URL (`src/types/social.ts:Group.inviteTokenHash`,
  `src/lib/groupInviteCache.ts`).
- Group session history listing past Tillsammans picks
  (`GroupSessionHistoryPanel.tsx`).
- Group defaults for new Tillsammans sessions
  (`GroupDefaults`).
- Push notifications to group members on session picks (Cloud Function).

### 3.12 Tillsammans — movie-night decision sessions
- Route `/tillsammans/ny` to start, `/tillsammans/{id}` to join
  (`TillsammansSessionPageClient.tsx`).
- Provider mode: **intersect** (only on everyone's services) or **union**
  (`src/types/social.ts:ProviderMode`).
- Aggregation strategy: `least_misery` / `average` / `fair`
  (`AggregationStrategy`).
- Media filter: movie / tv / both, optional max-runtime cap
  (`SessionConfig`).
- Anonymous participants supported (`SessionParticipant.uid` may be null).
- Vote kinds: `yes`, `no`, `veto` (limited vetoes per participant).
- Session lifecycle: `active` → `resolved` (host picked) → `expired`
  (auto-expiry, retained 7 days per `CLAUDE.md` §Data model).
- Candidate generation from intersection of taste vectors
  (`src/lib/together/matching.ts`, `candidates.ts`,
  `src/hooks/useSessionTasteVectors.ts`).

### 3.13 Stats
- `/stats` — personal viewing statistics
  (`src/app/stats/page.tsx`).
- Backed by aggregated taste data and watchlist counts
  (`src/lib/taste/stats.ts`, `src/components/ui/StatCard.tsx`).

### 3.14 Notifications
- In-app inbox subcollection `users/{uid}/notifications/{notifId}`
  (`src/hooks/useNotifications.ts`).
- Bell-dropdown "new since last seen" anchored on
  `UserProfile.lastNotificationsSeenAt`.
- Push via Firebase Cloud Messaging, opt-in toggle
  (`UserProfile.notificationSettings.pushEnabled`,
  `src/hooks/useFcmToken.ts`, `src/lib/firebase/messaging.ts`,
  `public/firebase-messaging-sw.js`,
  `docs/push-notifications-setup.md`).
- Push triggers (Cloud Functions, `functions/src/index.ts`):
  - **onFriendRequestCreate** — "Anna vill bli vän."
  - **onSessionPickCreate** — "Anna valde 'Den nya filmen'."
- Email notification preferences for new-episode-airs and
  available-on-my-services (`UserProfile.notificationSettings.newEpisodes`,
  `availableOnMyServices`).
- Token cleanup on send-failure.

### 3.15 Settings
Section components in `src/components/settings/`:
- **ProfileSection** — display name, bio, default visibility.
- **UsernameSection** — claim / change username.
- **ProvidersSection** — pick subscribed services, set monthly cost &
  tier per provider, view active pauses.
- **DisplaySection** — table vs grid default.
- **ContentFilterSection** — hide non-Latin titles, country blocklist
  (`hiddenCountries`).
- **NotificationsSection** — push toggle, email toggles.
- **TasteDataSection** — re-run genre calibration, view taste vector.
- **DataExportSection** — GDPR export
  (`src/lib/firebase/dataExport.ts`, `docs/data-export-format.md`).
- **DeleteAccountSection** — irrevocable cascade delete
  (`docs/data-retention-policy.md`).
- **CollapsibleSection**, **SettingsCard** — section primitives.

### 3.16 Legal & consent
- `/villkor` — Terms of Service.
- `/integritet` — Privacy Policy.
- `/community-guidelines` — Community guidelines for UGC.
- Versioned acceptance stored on the user doc.
- Layouts wrapped by `LegalPageShell.tsx`.

### 3.17 Moderation
- User-side: "Report" action via `UgcActionsMenu.tsx`, writes a
  create-only document into top-level `reports/{reportId}`
  (`src/lib/firebase/reports.ts`).
- Block list, friend remove, per-comment delete-mine.
- Admin: `/admin/reports` reads the queue
  (`src/app/admin/reports/page.tsx`), gated by `UserProfile.isAdmin`
  flag (Console-set only, enforced by Firestore rules).
- Runbook: `docs/moderation.md`.

### 3.18 Operations / SEO / system states
- Sentry error tracking (opt-in) (`src/lib/sentry.ts`).
- Plausible analytics, cookieless (`src/lib/analytics.ts`).
- Session timing instrumentation (`src/lib/sessionTiming.ts`).
- Segment error boundary (`src/components/layout/SegmentError.tsx`).
- Empty / loading / error states throughout (`EmptyState.tsx`,
  "Laddar…", "Inga träffar").
- TMDB rate-limit + 429-Retry-After respect with 8-concurrent semaphore
  + abort-on-navigate (`src/lib/tmdb/client.ts`).
- Catch-all SPA router with `usePageMeta` for client-side `<title>` and
  meta-tags (`src/components/pages/DynamicRouter.tsx`,
  `src/hooks/usePageMeta.ts`).
- robots.txt + JSON-LD for crawlers (`public/robots.txt`,
  `src/components/title/JsonLd.tsx`).
- TMDB attribution surface required everywhere TMDB data is shown
  (`src/lib/tmdb/attribution.ts`, `public/tmdb-logo.svg`).

---

## §4 — Domain Content Shapes

Sourced from `src/types/domain.ts`, `social.ts`, `advisor.ts`,
`CLAUDE.md` §Data model.

### WatchlistItem (`users/{uid}/watchlist/{tmdbId}`)
- Identity: `tmdbId`, `mediaType` (`movie` | `tv`).
- State: `status`, `rating` (null or 0.5–5.0), `notes` (≤500 chars),
  `dropped`, `rewatchCount`.
- Cached TMDB metadata: `title`, `posterPath`, `releaseYear`,
  `totalSeasons`, `genreIds`, `tmdbStatus`.
- Progress: `lastWatchedSeason`, `lastWatchedEpisode`.
- Providers: `providers[]` (TMDB provider ids), `providersCheckedAt`.
- Privacy: `visibility` ∈ {private, friends, public} or null = inherit.
- Timestamps: `addedAt`, `updatedAt`, `watchedAt`.
- **Smallest instance:** a movie just added as `vill_se` — tmdbId, type,
  status, title, posterPath, addedAt — ~8 fields populated.
- **Largest realistic instance:** an active long-running series (e.g.
  20 seasons), `mina` status, with rating, long notes, all providers
  populated, friends-visibility override, multiple genre ids, full
  timestamp set — ~22 populated fields.
- **Scale per user:** 0 → low thousands. Typical heavy user 200–800
  titles; the data model is dimensioned for it.

### EpisodeProgress (`users/{uid}/episodeProgress/{tmdbId}`)
- One document per tracked show, nested `seasons[n][e] = { watched, watchedAt }`.
- **Smallest:** S1E1 watched, nothing else — one nested object.
- **Largest:** an ongoing 20-season series with 400+ episodes — one doc
  can grow to hundreds of leaves. The schema explicitly splits this from
  WatchlistItem to keep doc sizes manageable
  (`binge-spec-en.md` §Why this structure).
- **Scale per user:** equal to count of distinct TV shows ever tracked.

### UserProfile (`users/{uid}`)
- Identity: `displayName`, `email`, `photoURL`, `username`, `bio`.
- Visibility default: `defaultVisibility`.
- Subscriptions: `myProviders[]`, `providerCosts{}`, `providerTiers{}`,
  `providerPauses{}` (each with `pausedAt`, `resumeAt`).
- Preferences: `defaultView`, `hideNonLatinTitles`, `hiddenCountries[]`,
  `calibrationGenres{}`, `notificationSettings` (3 booleans).
- Compliance: `termsAcceptedAt`, `termsVersion`,
  `onboardingCompletedAt`, `lastNotificationsSeenAt`, `isAdmin`.
- **Smallest:** fresh sign-up — display name, email, defaults.
- **Largest:** power user — 5 providers with costs + tiers + pauses, 4
  hidden countries, calibration genres for 18 TMDB genre ids, push
  enabled.

### Review (top-level `reviews/{reviewId}`)
- Fields: `id`, `uid`, `tmdbId`, `mediaType`, `text`, `spoiler`,
  `rating`, denormalised `displayName` + `username`, `createdAt`,
  `updatedAt`.
- Plus subcollections `likes/{uid}` and `comments/{commentId}`.
- **Scale:** 0 → tens per user; thousands per popular title.

### UserList (`lists/{listId}`)
- Fields: `title`, `description`, `isPublic`, `items[]` (each: tmdbId,
  mediaType, title, posterPath, addedAt).
- **Scale:** typical user 0–10 lists; lists hold 5–200 items.

### Group (`groups/{groupId}` + members + watchlist)
- Top-level: `name`, `ownerUid`, `memberUids[]`, `defaults`,
  `inviteTokenHash`, `inviteTokenRotatedAt`.
- Members subcollection: per-member `providers[]`, role, joinedAt,
  notifications boolean.
- Group watchlist items carry `memberRatings{}` map.
- **Scale:** 2–15 members per group is the realistic band (household,
  friend circle).

### TogetherSession (`sessions/{sessionId}`)
- `config` (provider mode, aggregation, media type, runtime cap, allow
  asymmetry).
- `candidates[]` — pre-computed list of up to ~N titles with poster,
  year, runtime, genres, providers.
- `participants/{pid}` subcollection with vetoRemaining count.
- `swipes/{tmdbId}` with `votes: Record<participantId, 'yes'|'no'|'veto'>`.
- `status`, `expiresAt` (TTL of 7 days post-resolution).
- **Scale per user:** ephemeral — old sessions auto-prune.

### AdvisorResult (derived, in-memory)
- A computed bundle of per-provider advisories, save totals, primary +
  secondary action, active pauses, most-used-provider, set of
  unfinishedTmdbIds (`src/types/advisor.ts`).
- Not stored — computed each session.

---

## §5 — Platform Reach

- **Primary target:** Responsive web (desktop + tablet + phone) served
  as a static export of Next.js behind Cloudflare CDN
  (`next.config.mjs` declares `output: 'export'`, hosting config in
  `firebase.json`).
- **PWA-adjacent:** A Firebase Cloud Messaging service worker is
  shipped (`public/firebase-messaging-sw.js`) which enables web-push
  notifications on supported browsers.
- **Mobile web is a first-class surface:** dedicated
  `src/components/layout/MobileNav.tsx` and explicit mobile cases in
  `binge-spec-en.md` §Mobile.
- **No native apps** in this repo (no `/ios`, `/android`, `/macos`,
  `/windows`, `/linux`, `/electron`, `pubspec.yaml` or `Cargo.toml`).
  `binge-spec-en.md` §Future Considerations lists a Flutter app as
  out-of-scope.
- **Backend:** Firebase (Auth, Firestore, optional App Check, Cloud
  Functions in `europe-west1` for push fan-out only).

---

## §6 — Language & Locale

- **Primary language: Swedish (sv-SE).** All user-facing copy is
  Swedish. TMDB queries are pinned to `language=sv-SE`,
  `region=SE`, `watch_region=SE` (`CLAUDE.md` §TMDB API).
- **No i18n bundle is present.** No `.arb`, `.po`, or `locale.json`
  files were found; copy is inlined in JSX. English appears only in
  developer documentation (`binge-spec-en.md`) and code comments.
- **Layout-pressure characteristics of Swedish:**
  - Compound nouns can be long ("Streamingrådgivare",
    "Standardsynlighet", "Användarinställningar"). Plan for
    label widths roughly 1.2× English equivalents.
  - Modal verbs and politeness levels are short ("Spara", "Avbryt",
    "Logga in") so primary buttons stay tight.
  - Letters å, ä, ö are common and must be preserved in any condensed
    or display fonts.
- **Numerals / dates:** ISO weeks ("v12"), Swedish month names ("25
  mars"), comma as decimal separator implied by locale.
- **Currency:** SEK monthly costs for streaming subscriptions
  (`UserProfile.providerCosts`, `advisor` UI).
- **Right-to-left:** not in scope.

---

## §7 — Tone & Brand Signals

The voice is **utilitarian, second-person-singular ("du"), Swedish-direct,
slightly dry**. It treats the user as an adult who already knows what TV
is and doesn't need cheering. No exclamation marks in default copy, no
emoji, no anthropomorphised "we", no marketing froth.

Representative strings (source citations after each):

1. *"Välkommen till Binge.nu. Håll koll på vad du tittar på och se var
   filmer och serier finns att streama i Sverige. Låt oss sätta upp ditt
   konto på 60 sekunder."*
   — `src/components/onboarding/OnboardingFlow.tsx:107`. Functional welcome:
   states what the product is, what it'll do, time cost. No flourish.

2. *"Logga in på Binge.nu för att tracka vad du tittar på och se var
   titlarna finns att streama."*
   — `src/app/login/layout.tsx:5`. Loan-word *tracka* signals casual
   familiarity, not formality.

3. *"Inga fler avsnitt denna vecka"*
   — `src/components/dashboard/UpcomingCards.tsx:67`. Plain statement,
   no apology, no illustration prompt.

4. *"Kan pausas"* / *"Ej tecknad"*
   — `src/components/savings/AdvisorTimeline.tsx:240`,
   `WillSeePerProvider.tsx:60`. Two-word labels — financial-tool register.

5. *"Anna vill bli vän."* / *"Anna valde 'Den nya filmen'."*
   — `functions/src/index.ts` push templates. Subject-verb-object
   notifications, no greeting, no emoji.

Tonal anchors named in `binge-spec-en.md` §Frontend Design:
*Prisjakt* (Swedish price-comparison), *SideReel* (functional TV
tracker), *Notion* (clean database UI). Explicit anti-anchors named:
*"NOT: Dribbble shots, Apple landing pages, Tailwind UI templates."*

---

## §8 — Constraints That Inform Design

### Accessibility
- Stated target: WCAG 2.1 AA (`binge-spec-en.md` §Non-Functional
  Requirements: *"Accessibility: WCAG 2.1 AA minimum. Keyboard navigable.
  Focus visible."*).
- Screen-reader-only table headers component exists
  (`src/components/ui/SrOnlyTableHeader.tsx`), implying tables are a
  core surface and a11y of dense tabular data was a deliberate concern.
- Sprint 1 in `CLAUDE.md` §Sprint-historik notes a11y as a launch
  blocker. Implication: keyboard parity for every action that has a
  mouse path.

### Regulatory / consent
- **GDPR-compliant:** machine-readable data export (Article 20) via
  `src/lib/firebase/dataExport.ts`, schema in
  `docs/data-export-format.md`. Right-to-erasure flow in
  `DeleteAccountSection.tsx`, policy in `docs/data-retention-policy.md`.
- **Terms / privacy gating:** versioned `termsAcceptedAt` recorded on
  the user profile.
- **Cookieless analytics** via Plausible (`src/lib/analytics.ts`); no
  consent banner is required for that surface.
- **Content moderation pipeline** (`docs/moderation.md`) is in place for
  UGC (reviews, comments, list titles, group names, usernames, bios).

### Performance / device
- **Static SPA** — page nav is instant, all data fetched client-side.
- **No `next/image`** because of static export — every `<img>` must
  carry explicit width/height + `loading="lazy"` + `decoding="async"`
  (`CLAUDE.md` §Design Constraints). The designer must spec image
  dimensions, not optimisation.
- **TMDB rate-limited at 8 concurrent requests** with 429-Retry-After
  respect (`src/lib/tmdb/client.ts`) — dense list screens may stream in
  visibly, so empty / skeleton states matter.
- **Lighthouse >90** is a stated target (`binge-spec-en.md`
  §Non-Functional Requirements).

### Real-time / collaboration
- **Tillsammans sessions** are real-time: votes from multiple
  participants update a shared candidate list. Designer should plan for
  presence, mid-session participant joins, vote-collision states.
- **Group watchlists** are shared but eventually consistent — no
  conflict-resolution UI required, but multi-user state needs to be
  legible (who added what, who rated what).

### Cost / external dependencies
- TMDB attribution string + logo are legally required wherever TMDB
  data is shown (`src/lib/tmdb/attribution.ts`).
- No backend AI — the recommendations engine is heuristic, not LLM-based.
- Cloud Functions are deliberately minimal (free-tier-friendly) — push
  fan-out only; everything else runs in the client.

---

## §9 — AI / ML Surfaces

This product **does not call any LLM**. It has no chat affordance,
streaming token UI, or "AI" label. There are, however, three personalised
inference surfaces a designer should treat with the same care:

1. **Taste vector.** A genre-weighted profile derived from the user's
   ratings, builds the basis for "Du gillar X" rows
   (`src/lib/taste/vector.ts`, `useTasteVector.ts`,
   `useRecommendationsCascade.ts`). The vector is editable / recalibratable
   via `/kalibrera`. Designer obligations: explain the *why* behind a
   recommendation, show what the system thinks the user likes, let the
   user correct it.

2. **Cascade recommendations.** A composer that interleaves seven row
   types (trending, upcoming, genre canon, thematic, similar to
   favourite, latest favourite, person filmography) and prioritises by
   the user's seeds. Designer obligations: each row needs an inspectable
   label (why this row exists), and individual cards need quick "not
   interested" + quick-rate affordances to feed back into the model
   (`QuickRateModal.tsx`, `NotInterestedButton.tsx`).

3. **Subscription advisor.** A rules-based recommender that proposes
   pause / catchup / subscribe / idle actions and quantifies the SEK
   savings (`docs/advisor-logic.md`, `useSubscriptionAdvisor.ts`).
   Designer obligations: this is financial advice — the user must see
   the underlying titles driving each suggestion, be able to dismiss /
   override, and the timeline of next air-dates that justifies a pause.
   Confidence isn't probabilistic but the rationale is auditable; the
   UI should expose that audit trail.

There are no streaming responses, no token costs, no rate-limited LLM
gating, no "AI is thinking" states.

---

## §10 — Anti-patterns to Avoid

This is a Swedish power-user media tracker that overlaps three categories
(tracker / streaming-guide / personal-finance-adjacent). Avoid:

1. **Streaming-service brand cosplay.** No Netflix-style giant hero
   posters with autoplay backdrops, no Disney+ tile shelves, no
   HBO Max gradient overlays. The product *talks about* these services;
   it must not *look like* any of them.

2. **Star-rating fetishism.** Don't make 5-star widgets the visual
   centrepiece. The product is about library state and availability —
   the rating is a small input, not a Letterboxd-style identity badge.

3. **Cinema / film-noir mood.** No moody dark themes, projector beams,
   film-reel ornaments, popcorn iconography, clapperboard motifs, vintage
   marquee fonts. The product is a tool, not a film-club brochure.

4. **Genre-coloured cards.** Don't tint recommendation cards by genre
   (red for horror, pink for romance, etc.). It conflicts with the
   neutral-density aesthetic and burns retinas at 200 titles per page.

5. **AI-product clichés.** No purple gradients, no sparkle icons, no
   "✨ AI recommendations", no emoji-as-icon, no "Hej 👋" microcopy. The
   product explicitly disowns this register
   (`binge-spec-en.md` §Design Principles: *"design must NOT look
   AI-generated."*).

6. **Marketing-site visual register.** No oversized hero, no rotating
   testimonial carousels, no "Get started — it's free" with confetti.
   Logged-out landing must read like the inside of the app.

7. **English defaultism in mockups.** Designer copy must be Swedish from
   the first wireframe — *Mina serier*, *Vill se*, *Avbrutna*,
   *Tillsammans*, *Kalibrera* are product nouns, not translations of
   English originals.

8. **Decorative empty-states.** No "Looks empty in here 🍿" illustrations.
   The pattern is a one-line statement of fact ("Inga fler avsnitt denna
   vecka") plus, where actionable, a single text link to the next step.

9. **Modal-heavy flows.** Tracking actions (mark season watched, set
   rating, change status) should resolve inline next to the title, not
   stack modals. The existing pattern is an expandable detail row under
   the table; respect it conceptually even if the visual changes.

10. **Finance-app green/red.** The savings advisor must not lean on
    Robinhood-style green-up / red-down. Saving money on a subscription
    isn't a stock price; treat it as informational, not celebratory.

---

*End of report. Compiled from repository contents under
`/home/user/binge` at branch
`claude/product-essence-report-L20AH`.*
