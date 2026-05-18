# Product Essence Report — Binge

A WHAT-the-product-IS brief for a designer with no codebase access.
Sourced from `CLAUDE.md`, `binge-spec-en.md`, `src/app/**`, `src/components/**`,
`src/hooks/**`, `src/contexts/**`, `src/lib/**`, `src/types/**`,
`functions/src/index.ts`, `firebase.json`, `docs/**`.

This report is deliberately silent on layout, component vocabulary,
typography, colour, density, sizing, iconography, illustration, and any
other visual direction. Those decisions belong to the designer.

---

## §1 — Product Identity

- **Name:** Binge (domain `binge.nu`).
- **Elevator pitch:** A Swedish-language tracker for movies and TV that
  answers two questions in one place: *"What am I watching, and where can I
  stream it in Sweden right now?"* It logs the user's library, surfaces
  when the next episode airs, recommends what to watch next, and advises
  which paid streaming subscriptions are worth keeping this month versus
  pausing.
- **Brand etymology:** "Binge" — to consume large quantities of TV in one
  sitting; conjugates naturally with the Swedish verb form
  ("att binga"). The `.nu` ccTLD reads as the Swedish word *"nu"*
  ("now"), so the wordmark parses as "binge.now" — a verb plus an adverb,
  an invitation.
- **Stated mission / purpose:**
  - `CLAUDE.md` §Project Overview: *"Binge (binge.nu) is a Swedish media
    tracker for movies and TV shows. Users track what they're watching,
    want to watch, and have watched — with the killer feature being
    where each title is available on Swedish streaming services."*
  - `binge-spec-en.md` §Overview frames the proposition as the Swedish
    answer to *"Where can I stream this in Sweden?"*
  - The same document positions the product as a **personal tool, not a
    showcase** — built for repeat daily use, not for first-impression
    marketing.

---

## §2 — The User

- **Audience:** Adult consumers in Sweden who watch enough to care about
  rotating between two-to-five paid streaming subscriptions
  (`docs/advisor-logic.md`, `src/components/settings/ProvidersSection.tsx`).
- **Single-user primary, with collaborative overlays:**
  - Each account is a personal library
    (`users/{uid}/watchlist/*` in `CLAUDE.md` §Data model).
  - Friends, follows, and reviews layer social activity on top
    (`src/hooks/useFriends.ts`, `useFollow.ts`, `useReviewSocial.ts`).
  - Permanent **groups** (households, friend circles) share a watchlist
    (`src/types/social.ts:Group`,
    `src/components/groups/*`).
  - **Tillsammans** ("Together") sessions are ephemeral group picks for
    movie-night decisions, with vote and veto mechanics
    (`src/types/social.ts:TogetherSession,SessionParticipant,SessionSwipe`).
- **Use context:** The product is used both at a desk and on a sofa, on
  desktops, tablets, and phones. A dedicated mobile navigation surface
  exists alongside the desktop one
  (`src/components/layout/MobileNav.tsx`,
  `src/components/layout/Sidebar.tsx`).
- **Skill assumption:** The user is an adult who understands episode
  codes (`S2E8`), knows the names of Swedish streaming services, and is
  comfortable making subscription decisions in SEK. No tutorial or
  hand-holding tone in the running product.
- **Locale assumption:** Swedish residency. TMDB queries are pinned to
  `region=SE` / `watch_region=SE`, and the provider catalog enumerates
  only Swedish services (`src/lib/tmdb/client.ts`,
  `src/lib/tmdb/providers.ts`).

---

## §3 — Complete Feature Inventory

Routes confirmed in `src/app/`, page-clients in `src/components/pages/`,
behaviour in hooks, lib modules, and contexts. This section enumerates
capabilities only; how each capability surfaces is for the designer.

### 3.1 Auth, account & onboarding
- Email + password sign-up and sign-in (`src/app/login/page.tsx`,
  `src/hooks/useAuth.ts`, `src/contexts/AuthContext.tsx`).
- Google SSO (`CLAUDE.md` §Auth, `AuthContext.tsx`).
- Password strength validation (`src/lib/passwordStrength.ts`,
  `src/components/auth/PasswordStrengthMeter.tsx`).
- Email-verification flow with resend
  (`src/components/layout/EmailVerificationBanner.tsx`).
- Multi-step onboarding: welcome → pick subscribed providers → seed a
  few titles → genre calibration → finish
  (`src/components/onboarding/OnboardingFlow.tsx`).
- Username claim with global reservation
  (`usernames/{username}`, `src/lib/firebase/username.ts`,
  `src/components/settings/UsernameSection.tsx`).
- Optional Firebase App Check via reCAPTCHA v3
  (`src/lib/firebase/appCheck.ts`).
- Terms acceptance gate at sign-up; versioned `termsAcceptedAt` stored on
  the user document (`src/types/domain.ts:UserProfile`).

### 3.2 Personal library / watchlist
- Four-status model: `vill_se` (want to watch), `mina` (mine — TV in
  progress), `sedd` (seen — terminal for movies),
  `avbruten` (dropped) (`src/lib/watchStatus.ts`,
  `src/types/domain.ts`).
- TV sub-states derived from progress and TMDB metadata:
  `aktiv` (behind on aired episodes), `ikapp` (caught up, returning),
  `avslutad` (ended) (`src/lib/watchStatus.ts`).
- Lazy schema migration from older statuses (e.g. `följer`, English v1
  enum) in `src/lib/watchStatus.migration.ts`.
- Per-title rating from 0.5 to 5.0 in half-step increments
  (`src/components/title/RatingStars.tsx`).
- Free-text notes per title, capped at ~500 characters
  (`src/components/title/NotesTextarea.tsx`,
  `src/components/title/NotesBlock.tsx`).
- Per-title visibility override: private / friends-only / public
  (`src/types/domain.ts:ItemVisibility`).
- Auto-promotion: marking the first episode of a `vill_se` TV show as
  seen automatically advances it to `mina`
  (`src/contexts/WatchlistContext.tsx`).
- "Not interested" suppression to hide titles from recommendations
  (`src/contexts/NotInterestedContext.tsx`,
  `src/components/title/NotInterestedButton.tsx`).
- Rewatch counter on each item
  (`src/types/domain.ts:WatchlistItem`).
- Library routes:
  - `/my/series` — TV in `mina` with the three sub-states.
  - `/my/films` — terminal-seen movies.
  - `/my/want-to-watch` — backlog.
  - `/my/avbrutna` — dropped.
  - `/my/all` — every status combined.
  - `/my/following` and `/my/watched` are 301 redirects from the legacy
    English routes (`firebase.json`).

### 3.3 TV episode tracking
- Per-episode watched/unwatched marker stored under
  `users/{uid}/episodeProgress/{tmdbId}`
  (`src/hooks/useEpisodeProgress.ts`).
- Per-season progress and bulk "mark season watched" action
  (`src/components/tv/SeasonList.tsx`, `SeasonRow.tsx`,
  `EpisodeRow.tsx`, `SeasonEpisodePanel.tsx`).
- Series detail surface that reveals season and episode state
  (`src/components/tv/SeriesDetail.tsx`).
- Group-aware progress sync wrapper
  (`src/hooks/useEpisodeProgressWithSync.ts`).

### 3.4 Calendar
- `/calendar` route with weekly and monthly modes
  (`src/components/calendar/WeeklyCalendar.tsx`,
  `MonthlyCalendar.tsx`).
- Week navigation by ISO week label (e.g. "v12"),
  one entry per upcoming episode of tracked shows
  (`src/components/calendar/CalendarEntryItem.tsx`,
  `src/hooks/useCalendar.ts`).
- A home-screen surface for "what's coming up next"
  (`src/components/dashboard/UpcomingCards.tsx`).
- Empty state copy when the week has nothing left.

### 3.5 Title detail surfaces
- Movie detail (`src/components/pages/MoviePageClient.tsx`).
- TV detail (`src/components/pages/TVShowPageClient.tsx`).
- Season detail (`SeasonPageClient.tsx`).
- Person detail — filmography for an actor or director
  (`PersonPageClient.tsx`).
- Provider detail — every title on a given streaming service
  (`ProviderPageClient.tsx`).
- Each detail surface carries: poster, year, runtime, genres, Swedish
  synopsis, watch-status control, rating, notes, add-to-list,
  add-to-group, not-interested toggle, structured data for SEO
  (`src/components/title/JsonLd.tsx`), and TMDB attribution
  (`src/lib/tmdb/attribution.ts`).
- A "similar / recommended" cluster appears at the end of each detail
  (`src/components/title/RecommendationsSection.tsx`).

### 3.6 Search & discovery
- Title search with debounced live suggestions
  (`src/components/search/SearchDropdown.tsx`,
  `src/hooks/useSearchBox.ts`,
  `src/hooks/useDebouncedValue.ts`).
- Full-page search results at `/search`.
- User search by username
  (`src/hooks/useUserSearch.ts`,
  `src/lib/firebase/userSearch.ts`).
- Provider-scoped discovery — browse everything on a chosen service
  (`src/hooks/useSearchProviders.ts`).
- Broader browse routes: `/films`, `/series`, `/discover`.

### 3.7 Recommendations engine
- Hub at `/recommendations`
  (`src/components/recommendations/RecommendationsHub.tsx`).
- Expanded view with filters (`RecommendationsExpanded.tsx`,
  `RecommendationsFilters.tsx`).
- Cascade composition (`src/lib/recommendations/rowComposition.ts`,
  `cascadePrioritizer.ts`, `seedAnalysis.ts`,
  `src/hooks/useRecommendationsCascade.ts`).
- Seven categories of recommendation feed into the cascade:
  - Trending (`useRowTrending.ts`).
  - Upcoming releases (`useRowUpcoming.ts`).
  - Genre canon (`useRowGenreCanon.ts`).
  - Thematic / mood (`useRowThematic.ts`).
  - Similar to a recent favourite (`useRowSimilar.ts`).
  - Latest-favourite-derived (`useRowLatestFav.ts`).
  - Filmography of a person the user has rated highly
    (`useRowPerson.ts`).
- A quick-rating prompt for unrated titles, feeding the taste vector
  (`src/components/recommendations/QuickRateModal.tsx`).
- Genre-preference calibration route `/kalibrera`
  (`src/components/settings/TasteDataSection.tsx`,
  `src/lib/taste/vector.ts`, `similarity.ts`, `stats.ts`,
  `backfill.ts`).
- Content-filter rules applied to all recommendations: hide non-Latin
  titles, hide titles from chosen origin countries
  (`src/lib/utils/titleFilter.ts`).
- Revival nudge that re-prompts the user to resume a series that has
  returned with new episodes
  (`src/components/dashboard/RevivalNudge.tsx`,
  `src/hooks/useRevivalNudges.ts`).

### 3.8 Subscription advisor (streaming-cost optimisation)
- Home-screen advisor surface
  (`src/components/dashboard/SubscriptionAdvisorWidget.tsx`).
- Standalone `/savings` route with timeline and per-provider forecast
  (`src/components/savings/AdvisorTimeline.tsx`,
  `WillSeePerProvider.tsx`).
- Logic in `src/hooks/useSubscriptionAdvisor.ts` and its helpers,
  documented in `docs/advisor-logic.md`.
- Recommends one of four primary actions: `pause`, `catchup`,
  `subscribe`, `idle` (`src/types/advisor.ts:PrimaryAction`).
- Tracks active pauses with savings-accrued-so-far
  (`ProviderPauseState`, `ActivePause`).
- Monthly cost and tier per provider, supplied by the user
  (`UserProfile.providerCosts`, `providerTiers`).
- Ad-supported tiers excluded from advice unless the user has an
  ad-tier subscription (`CLAUDE.md` §TMDB API).
- "Most-used provider" summary (`MostUsedProvider`).

### 3.9 Custom lists
- `/my/lists` route (`src/components/pages/ListPageClient.tsx`).
- Create, title, describe, and curate ordered title collections;
  toggle public or private (`src/types/domain.ts:UserList`,
  `src/hooks/useLists.ts`).
- Add-to-list action from any title surface
  (`src/components/title/AddToListButton.tsx`).

### 3.10 Social — profiles, follows, friends, reviews, feed
- Public profile at `/user/{username}`
  (`src/components/pages/UserProfilePageClient.tsx`,
  `src/hooks/usePublicProfile.ts`).
- Mutual-friend relationships
  (`src/components/social/FriendButton.tsx`,
  `src/hooks/useFriends.ts`,
  `src/lib/firebase/friends.ts`,
  `src/app/my/friends/page.tsx`).
- One-directional follow relationships
  (`src/components/social/FollowButton.tsx`,
  `src/hooks/useFollow.ts`,
  `src/hooks/useFollowList.ts`).
- `/feed` route showing activity from followed users
  (`src/app/feed/page.tsx`).
- Reviews per title, with spoiler flag, body text, and an attached
  rating (`src/types/domain.ts:Review`,
  `src/components/title/ReviewList.tsx`,
  `src/hooks/useReviews.ts`).
- Likes on reviews (subcollection keyed by liker uid).
- Comments on reviews (`src/types/domain.ts:ReviewComment`,
  `src/hooks/useReviewSocial.ts`).
- Block another user
  (`src/hooks/useBlockedUsers.ts`,
  `users/{uid}/blocked/{targetUid}`).
- Per-user statistics summary on profile
  (`src/components/social/ProfileStatsPanel.tsx`).
- Friends-only visibility tier on watchlist items.

### 3.11 Groups (households / friend circles)
- `/grupper` and `/grupper/ny` routes
  (`src/components/pages/GroupPageClient.tsx`).
- Owner plus members; role enum
  (`src/types/social.ts:Group`, `GroupRole`, `GroupMember`).
- Shared group watchlist with per-member ratings
  (`GroupWatchlistItem`).
- Group settings surface (`GroupSettingsModal.tsx`).
- Invite by URL link; only the hash of the invite token is stored,
  plaintext lives only inside the shared URL
  (`Group.inviteTokenHash`, `inviteTokenRotatedAt`,
  `src/lib/groupInviteCache.ts`).
- Group session history listing previous Tillsammans picks
  (`GroupSessionHistoryPanel.tsx`,
  `GroupSessionHistoryEntry`).
- Group defaults for new Tillsammans sessions (`GroupDefaults`).
- Push notification to group members on a fresh session pick (Cloud
  Function).

### 3.12 Tillsammans — movie-night decision sessions
- `/tillsammans/ny` to start a session,
  `/tillsammans/{id}` to join
  (`TillsammansSessionPageClient.tsx`).
- Provider mode: **intersect** (only titles on everyone's services) or
  **union** (`ProviderMode`).
- Aggregation strategy: `least_misery` / `average` / `fair`
  (`AggregationStrategy`).
- Media-type filter (movie / tv / both) and optional maximum runtime
  (`SessionConfig`).
- Anonymous participants supported
  (`SessionParticipant.uid` may be null).
- Vote kinds: `yes`, `no`, `veto`, with a limited number of vetoes per
  participant.
- Lifecycle: `active` → `resolved` (host commits a pick) → `expired`
  (auto-purge after seven days).
- Candidate set computed from the intersection of participants' taste
  vectors (`src/lib/together/matching.ts`,
  `candidates.ts`,
  `src/hooks/useSessionTasteVectors.ts`).

### 3.13 Stats
- `/stats` route — personal viewing statistics
  (`src/components/ui/StatCard.tsx`,
  `src/lib/taste/stats.ts`).

### 3.14 Notifications
- In-app inbox at `users/{uid}/notifications/{notifId}`
  (`src/hooks/useNotifications.ts`).
- "New since last seen" counter anchored on
  `UserProfile.lastNotificationsSeenAt`.
- Web push via Firebase Cloud Messaging, opt-in
  (`notificationSettings.pushEnabled`,
  `src/hooks/useFcmToken.ts`,
  `src/lib/firebase/messaging.ts`,
  `public/firebase-messaging-sw.js`,
  `docs/push-notifications-setup.md`).
- Push events sent by Cloud Functions (`functions/src/index.ts`):
  - `onFriendRequestCreate` — friend request received.
  - `onSessionPickCreate` — group member picked a title in a
    Tillsammans session.
- Email-notification preferences for new-episode-airs and
  available-on-my-services (`notificationSettings.newEpisodes`,
  `availableOnMyServices`).
- Invalid-token cleanup on push send-failure.

### 3.15 Settings
Capabilities, grouped by section (`src/components/settings/`):
- **Profile** — display name, bio, default visibility.
- **Username** — claim or change username.
- **Providers** — pick subscribed services, set monthly cost and tier
  per provider, manage active pauses.
- **Display** — default browsing mode preference.
- **Content filter** — hide non-Latin titles, hide titles from
  blocklisted origin countries (`hiddenCountries`).
- **Notifications** — push toggle, email toggles.
- **Taste data** — re-run genre calibration, inspect the taste vector.
- **Data export** — GDPR Article-20 machine-readable export
  (`src/lib/firebase/dataExport.ts`,
  `docs/data-export-format.md`).
- **Delete account** — irrevocable cascade delete
  (`docs/data-retention-policy.md`).

### 3.16 Legal & consent
- `/villkor` — Terms of Service.
- `/integritet` — Privacy Policy.
- `/community-guidelines` — community guidelines for UGC.
- Versioned acceptance recorded on the user document.

### 3.17 Moderation
- User-side: a report action that writes a create-only document to
  `reports/{reportId}`
  (`src/components/moderation/UgcActionsMenu.tsx`,
  `src/lib/firebase/reports.ts`).
- Block list, friend-remove, delete-mine-only on comments.
- Admin route `/admin/reports` reads the queue, gated by
  `UserProfile.isAdmin` (Console-set only, enforced by Firestore
  rules).
- Operational runbook in `docs/moderation.md`.

### 3.18 Operations, SEO, system states
- Sentry error tracking, opt-in (`src/lib/sentry.ts`).
- Plausible analytics, cookieless (`src/lib/analytics.ts`).
- Session-timing instrumentation (`src/lib/sessionTiming.ts`).
- Segment-level error boundary
  (`src/components/layout/SegmentError.tsx`).
- Empty, loading, and error states are first-class concerns; standard
  Swedish strings exist for each (e.g. "Laddar…", "Inga träffar").
- TMDB request scheduling with an 8-concurrent semaphore and
  429 / Retry-After respect, plus abort-on-navigate
  (`src/lib/tmdb/client.ts`). Dense pages can stream in over a noticeable
  interval — the product needs legible interim states.
- Catch-all SPA routing with client-side `<title>` and meta-tag updates
  (`src/components/pages/DynamicRouter.tsx`,
  `src/hooks/usePageMeta.ts`).
- `robots.txt` and per-title JSON-LD for search-engine crawlers.
- TMDB attribution must appear wherever TMDB data is shown
  (`src/lib/tmdb/attribution.ts`).

---

## §4 — Domain Content Shapes

Sourced from `src/types/domain.ts`, `social.ts`, `advisor.ts`,
and `CLAUDE.md` §Data model.

### WatchlistItem (`users/{uid}/watchlist/{tmdbId}`)
- Identity: `tmdbId`, `mediaType` (`movie` | `tv`).
- State: `status`, `rating` (null or 0.5–5.0), `notes` (≤500 chars),
  `dropped`, `rewatchCount`.
- Cached TMDB metadata: `title`, `posterPath`, `releaseYear`,
  `totalSeasons`, `genreIds`, `tmdbStatus`.
- Progress: `lastWatchedSeason`, `lastWatchedEpisode`.
- Providers: `providers[]` (TMDB provider ids), `providersCheckedAt`.
- Privacy: `visibility` ∈ {private, friends, public} or null = inherit
  profile default.
- Timestamps: `addedAt`, `updatedAt`, `watchedAt`.
- **Smallest realistic instance:** a movie just added as `vill_se` —
  tmdbId, type, status, title, posterPath, addedAt — ~8 populated
  fields.
- **Largest realistic instance:** an active long-running series with
  rating, long notes, all providers populated, friends-visibility
  override, multiple genre ids, full timestamp set — ~22 populated
  fields.
- **Scale per user:** 0 → low thousands. A heavy user holds 200–800
  titles; the data model is dimensioned for it.

### EpisodeProgress (`users/{uid}/episodeProgress/{tmdbId}`)
- One document per tracked show, nested
  `seasons[n][e] = { watched, watchedAt }`.
- **Smallest:** a single episode watched.
- **Largest:** an ongoing 20-season series with 400+ episodes; one
  document can carry hundreds of leaves. The schema separates this from
  the watchlist item specifically to keep document sizes manageable
  (`binge-spec-en.md` §Why this structure).
- **Scale per user:** equal to the count of distinct TV shows ever
  tracked.

### UserProfile (`users/{uid}`)
- Identity: `displayName`, `email`, `photoURL`, `username`, `bio`.
- Default visibility: `defaultVisibility`.
- Subscriptions: `myProviders[]`, `providerCosts{}`,
  `providerTiers{}`, `providerPauses{}` (each with `pausedAt`,
  `resumeAt`).
- Preferences: `defaultView`, `hideNonLatinTitles`,
  `hiddenCountries[]`, `calibrationGenres{}`, `notificationSettings`
  (three booleans).
- Compliance: `termsAcceptedAt`, `termsVersion`,
  `onboardingCompletedAt`, `lastNotificationsSeenAt`, `isAdmin`.
- **Smallest:** a fresh sign-up.
- **Largest:** five providers each with cost, tier, and a pause state;
  several hidden countries; calibration weights for the ~18 TMDB genre
  ids; push enabled.

### Review (top-level `reviews/{reviewId}`)
- Fields: `id`, `uid`, `tmdbId`, `mediaType`, `text`, `spoiler`,
  `rating`, denormalised `displayName` + `username`, `createdAt`,
  `updatedAt`.
- Subcollections: `likes/{uid}`, `comments/{commentId}`.
- **Scale:** 0 → tens per user; potentially thousands per popular
  title.

### UserList (`lists/{listId}`)
- Fields: `title`, `description`, `isPublic`,
  `items[]` (each: tmdbId, mediaType, title, posterPath, addedAt).
- **Scale:** typical user holds 0–10 lists; lists carry 5–200 items.

### Group (`groups/{groupId}` + members + watchlist)
- Top-level: `name`, `ownerUid`, `memberUids[]`, `defaults`,
  `inviteTokenHash`, `inviteTokenRotatedAt`.
- Members subcollection: per-member `providers[]`, role, joinedAt,
  notifications boolean.
- Group watchlist items carry a `memberRatings{}` map.
- **Scale:** typically 2–15 members per group (household, friend
  circle).

### TogetherSession (`sessions/{sessionId}`)
- `config` — provider mode, aggregation, media type, runtime cap,
  allow-asymmetry flag.
- `candidates[]` — pre-computed titles with poster, year, runtime,
  genres, providers.
- `participants/{pid}` subcollection with remaining-veto count.
- `swipes/{tmdbId}` with `votes: Record<participantId, VoteKind>`.
- `status`, `expiresAt` (TTL of seven days post-resolution).
- **Scale per user:** ephemeral — old sessions auto-prune.

### AdvisorResult (derived, in-memory)
- A computed bundle of per-provider advisories, savings totals,
  primary plus secondary recommended action, active pauses,
  most-used-provider, and a set of `unfinishedTmdbIds`
  (`src/types/advisor.ts`).
- Not persisted — recomputed each session.

---

## §5 — Platform Reach

- **Primary target:** Responsive web served as a static export of
  Next.js behind Cloudflare CDN (`next.config.mjs` declares
  `output: 'export'`; hosting in `firebase.json`).
- **PWA-adjacent:** a Firebase Cloud Messaging service worker ships
  with the app (`public/firebase-messaging-sw.js`), enabling web push
  on supported browsers.
- **Mobile web is a first-class surface:** a dedicated mobile
  navigation surface exists alongside the desktop one
  (`src/components/layout/MobileNav.tsx`).
- **No native applications** in this repository: there is no `/ios`,
  `/android`, `/macos`, `/windows`, `/linux`, `/electron`,
  `pubspec.yaml`, or `Cargo.toml`. `binge-spec-en.md` §Future
  Considerations lists a Flutter app as explicitly out of scope.
- **Backend:** Firebase — Auth, Firestore, optional App Check, and
  Cloud Functions running in `europe-west1` for push fan-out only.

---

## §6 — Language & Locale

- **Primary and only language: Swedish (sv-SE).** All user-facing
  copy is in Swedish. TMDB requests are pinned to `language=sv-SE`,
  `region=SE`, `watch_region=SE` (`CLAUDE.md` §TMDB API).
- **No i18n bundle is present** — no `.arb`, `.po`, or `locale.json`
  files exist; copy is inlined in JSX. English appears only in
  developer documentation (`binge-spec-en.md`) and code comments.
- **Numerals and dates:** ISO weeks ("v12"), Swedish month names
  ("25 mars"), comma as decimal separator.
- **Currency:** SEK monthly costs for streaming subscriptions
  (`UserProfile.providerCosts`).
- **Right-to-left:** not in scope.

---

## §7 — Tone & Voice (Copywriting)

This section describes the *voice* of the product's copy, not its
visual presentation.

The voice is **utilitarian, second-person-singular ("du"),
Swedish-direct, slightly dry**. It treats the user as an adult who
already knows what TV is and doesn't need to be cheered on. It states
facts, names actions, and stops.

Representative strings, with source citations:

1. *"Välkommen till Binge.nu. Håll koll på vad du tittar på och se var
   filmer och serier finns att streama i Sverige. Låt oss sätta upp
   ditt konto på 60 sekunder."*
   — `src/components/onboarding/OnboardingFlow.tsx:107`. A functional
   welcome: what the product is, what it will do, time cost.

2. *"Logga in på Binge.nu för att tracka vad du tittar på och se var
   titlarna finns att streama."*
   — `src/app/login/layout.tsx:5`. The loan-word *tracka* signals
   casual familiarity rather than formality.

3. *"Inga fler avsnitt denna vecka"*
   — `src/components/dashboard/UpcomingCards.tsx:67`. Plain statement
   with no apology when there is nothing to show.

4. *"Kan pausas" / "Ej tecknad"*
   — `src/components/savings/AdvisorTimeline.tsx:240`,
   `WillSeePerProvider.tsx:60`. Two-word advisory labels, in a
   financial-tool register.

5. *"Anna vill bli vän." / "Anna valde 'Den nya filmen'."*
   — `functions/src/index.ts` push templates. Subject-verb-object
   notifications with no greeting and no decorative language.

---

## §8 — Constraints That Inform Design

### Accessibility
- Stated target: **WCAG 2.1 AA**, keyboard-navigable, focus-visible
  (`binge-spec-en.md` §Non-Functional Requirements).
- Sprint 1 in `CLAUDE.md` §Sprint-historik treats accessibility as a
  launch blocker — every interaction with a pointer path must have a
  keyboard equivalent.
- The codebase includes screen-reader-only header support for tabular
  content (`src/components/ui/SrOnlyTableHeader.tsx`), signalling that
  data-heavy surfaces were a deliberate a11y concern.

### Regulatory / consent
- **GDPR-compliant:** machine-readable data export (Article 20) via
  `src/lib/firebase/dataExport.ts` (schema in
  `docs/data-export-format.md`); right-to-erasure flow in
  `src/components/settings/DeleteAccountSection.tsx`
  (policy in `docs/data-retention-policy.md`).
- **Terms / Privacy gating:** versioned acceptance recorded on the
  user document at sign-up.
- **Cookieless analytics** via Plausible; no consent banner is
  required for that surface.
- **Content moderation pipeline** in place for UGC — reviews,
  comments, list titles, group names, usernames, bios
  (`docs/moderation.md`).

### Performance / device
- **Static SPA** — navigation between routes is instant; all data
  fetching is client-side via React Query.
- **No `next/image`** because of static export — every image carries
  explicit width and height in markup
  (`CLAUDE.md` §Design Constraints). The product cannot rely on a
  server-side image optimiser.
- **TMDB rate-limited** at 8 concurrent requests with `Retry-After`
  respect (`src/lib/tmdb/client.ts`). Dense pages may resolve over a
  perceptible interval — loading and partial-result states matter.
- **Lighthouse > 90** is the stated performance target
  (`binge-spec-en.md` §Non-Functional Requirements).

### Real-time / collaboration
- **Tillsammans sessions** are real-time: votes from several
  participants update a shared candidate set. The product must
  legibly express presence, mid-session joins, and vote-collision
  states.
- **Group watchlists** are shared but eventually consistent — no
  conflict-resolution interaction is required, but multi-user state
  must remain readable (who added what, who rated what).

### Cost / external dependencies
- TMDB attribution string plus logo are legally required wherever
  TMDB data is shown (`src/lib/tmdb/attribution.ts`,
  `public/tmdb-logo.svg`).
- No backend AI calls; the recommendations engine is heuristic, not
  LLM-based.
- Cloud Functions are deliberately minimal (free-tier-friendly) —
  push fan-out only; all other logic runs in the client.

---

## §9 — AI / ML Surfaces

This product **does not call any LLM**. It has no chat affordance, no
streaming-token interaction, and no "AI" label anywhere in the
product. It does, however, ship three personalised inference surfaces
that warrant the same care as LLM features:

1. **Taste vector.** A genre-weighted profile derived from the user's
   ratings; powers personalised recommendation categories
   (`src/lib/taste/vector.ts`, `src/hooks/useTasteVector.ts`,
   `src/hooks/useRecommendationsCascade.ts`). The vector is editable
   and recalibratable via `/kalibrera`. Product obligations: the
   user should be able to see what the system thinks they like, and
   correct it.

2. **Cascade recommendations.** A composer that interleaves seven
   categories of recommendation (trending, upcoming, genre canon,
   thematic, similar to a favourite, latest favourite, person
   filmography) and prioritises by the user's seeds. Product
   obligations: each category surfaces with a labelled rationale, and
   individual titles expose quick-rate and not-interested affordances
   that feed back into the model
   (`src/components/recommendations/QuickRateModal.tsx`,
   `src/components/title/NotInterestedButton.tsx`).

3. **Subscription advisor.** A rules-based recommender that proposes
   pause / catchup / subscribe / idle actions and quantifies the SEK
   savings (`docs/advisor-logic.md`,
   `src/hooks/useSubscriptionAdvisor.ts`). Product obligations: this
   is financial advice — the user must see the underlying titles
   driving each recommendation, be able to override or dismiss it,
   and inspect the upcoming-air-date timeline that justifies a pause.
   The reasoning is fully auditable; the experience must expose that
   audit trail rather than ask the user to trust a verdict.

There are no token costs, no rate-limited model gating, and no
"thinking" interim states.

---

*End of report. Compiled from repository contents under
`/home/user/binge` on branch
`claude/product-essence-report-L20AH`. Visual direction is
deliberately omitted — those decisions belong to the designer.*
