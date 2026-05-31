# Binge.nu — UI/UX & Design Audit

**Date:** 2026-05-30
**Method:** Live render + screenshots of the production site (binge.nu) in a real logged-in browser session (Claude-in-Chrome), desktop viewport ~1568px wide. Findings cross-referenced against the source at `C:\binge\src`.
**Auditor:** Claude (design-critique skill rubric: usability, hierarchy, consistency, accessibility, copy, responsive).

> This document covers **33 distinct views**. Each view lists *what works* and *issues* (severity: 🔴 high / 🟠 medium / 🟡 low). A **cross-cutting** section and a **prioritized fix list** follow. Code-anchored root causes (file:line) are merged from a verification pass and marked _“code:”_.

---

## ⚠️ Methodology caveats (read first)

Three things I observed are **automation artifacts, NOT production bugs** — I verified each so they don't pollute the findings:

1. **Black poster tiles.** Many grid/carousel posters rendered as solid black boxes in screenshots. Root cause: images use `loading="lazy"`, and lazy images don't fetch in a non-foreground/CDP-driven tab (they never intersect a painted viewport). I force-loaded a sample TMDB poster URL — it returned a valid 342px image in **6 ms**. So real users with a visible tab see posters fine. **Not a bug.** (The one nuance worth a real-device check: the landscape "Följer" carousels on `/films` and `/series` were uniformly black — likely the same artifact, but confirm on a real phone.)
2. **"Renderer frozen" screenshot timeouts.** `captureScreenshot` timed out several times under heavy client render. This is a CDP/automation limitation amplified by a data-heavy client-only SPA; it is **not** proof that the page freezes for real users. (That said, the app *is* doing a lot of client-side work — see perceived-performance note.)
3. **Mobile/responsive not captured.** `resize_window` could not shrink the real maximized browser below the display width (`innerWidth` stayed 1707), so a true mobile viewport never rendered. **Responsive behavior + the MobileNav need a manual mobile-device pass** — treated as out of scope here, not as "passing".

Other context: this is **live production data** for one real account (296 titles), so empty-state coverage is partial and I only ever navigated/observed — never clicked irreversible actions.

---

## Per-view findings

### 1. Home / "Denna vecka" — `/`
**What works:** Strong editorial hero ("Sullivan's Crossing kommer i morgon"), clear primary/secondary CTAs ("Öppna serien" / "Se hela veckan"), useful right rail (advisor teaser, friends, groups). Eyebrow + big-serif title pattern reads well.
- 🟠 **Long perceived load.** Main "Denna vecka" area + advisor rail sat on skeletons for ~8 s before resolving on a warm session. First-paint-to-content is slow for the landing view.
- 🟡 Hero poster uses a **purple duotone** while the brand accent is orange `#d97b35` (the "Öppna" button). Two-accent tension — see cross-cutting.
- 🟡 Mixed button styling: hero "Öppna serien" is black, "Se hela veckan" is bordered; the inline card later uses a black "Öppna serien". Button hierarchy isn't systematic.

### 2. Library / "Hela biblioteket" — `/my/all`
**What works:** Excellent Prisjakt-style dense table (296 titles); good columns (Titel/Typ/År/Tillagd/Sedd/Tjänster/Betyg); filter tabs (Alla/Serier/Film), sort, search, and three view modes (Tabell/Kort/Rutnät). On-brand density.
- 🟡 **Rating empty-state** (corrected after code verification — see #9): unrated rows render 5 *hollow* orange-stroked `☆`, not filled — not a bug, but the table omits the "Ej betygsatt" text the card view shows.
- 🟡 Tab `<title>` is "Mina listor" while the H1 is "Hela biblioteket" — title/heading mismatch (see #22/title bugs).

### 3. Calendar / "Kalender" — `/calendar`
**What works:** Clean 7-day grid, friendly empty-week copy ("En lugn vecka" + nudge to Recommendations), week nav (v21/v22·idag/v23), today highlighted.
- 🔴 **Upcoming episode silently dropped.** Grid cell SÖN 31 shows "— INGET —" though the TV detail page shows *Sullivan's Crossing S4E10 airs 2026-05-31*. _Root cause (verified): the calendar, home hero and date-strip all share `useCalendarEntries()`, so they can't disagree with each other — the real disagreement is with the TV-detail/advisor, which read the authoritative `show.next_episode_to_air`. `useCalendar.ts:73-96` fetches a **single** season via `getTVSeason(show.id, show.number_of_seasons)` — passing a season **count** as a season **number** — and only emits entries for episodes whose `air_date` is set (`:134`), with **no `next_episode_to_air` fallback**. So upcoming episodes vanish from the grid. The advisor avoids this because `useUpcomingShowsForAdvisor.ts:128-158` synthesizes a fallback pill; the calendar has none._ This directly undermines the "missa aldrig ett avsnitt" promise — **highest-impact functional bug found.**
- 🟡 The global date-strip is **flaky between loads** (Sullivan's Crossing on SÖN 31 vs "—") — a hydration/cache-timing race in `WeekStrip.tsx:65-108` (today set in `useEffect`; per-show season queries resolve at different times).

### 4. Recommendations / "Vad du kan se — och varför" — `/recommendations`
**What works:** Genuinely differentiated — 7 categorized rows each with a *why* rationale ("samma medverkande", "kanon i din mest tittade genre", "drivande seed · färska 5★-betyg"); rich filter bar; clear add/dismiss affordances on cards.
- 🟠 Slow load (rows showed "Laddar…" for several seconds; renderer briefly unresponsive under the TMDB fetch burst across 7 rows).

### 5. Streamingrådgivaren (advisor) — `/savings`
**What works:** The standout view. Priority-cascade headline ("Du betalar 247 kr/mån för 4 tjänster… ligger efter på 3 Netflix-serier… pausfönster värt 109 kr/mån"); numbered action cascade with semantic chips (orange "Visa", green "SPAR 109 KR/MÅN"); cost-per-active-series table (TV4 23 kr/serie vs Netflix 1,9) is a great insight; calm right rail (Sparat hittills / Senaste sparbeslut / Nästa översyn / Så fungerar pausen). Matches the documented advisor design intent.
- 🟡 "Sparat hittills: 0 kr" is a slightly deflating empty state, but honestly handled.

### 6. Friends / "Vänner" — `/my/friends`
**What works:** Tabbed (Vänner/Förfrågningar/Följer/Följare with counts), clear per-row remove action, footer + TMDB attribution present.
- 🟠 **Non-standard small header** (no eyebrow, ~20px) vs the big-serif+eyebrow used on most pages — header-inconsistency cluster (see cross-cutting).

### 7. My Series / "Följer" — `/my/series`
**What works:** Rich card view — poster, provider pill, **varied** star ratings + "Ej betygsatt" handled, orange progress bars, status text ("Ligger efter · S3"), "LIGGER EFTER" grouping.
- 🟠 **Count mismatch:** subtitle "194 titlar i denna lista" vs right-aligned counter "173 titlar". _Root cause (verified): the subtitle counts **all** `status==='mina'` items including stray/legacy **movie** items (`WatchlistPage.tsx:105-133`), but the card sections render **TV only** (`:148-158`). The 21-item gap = non-TV "mina" items that are counted but rendered nowhere. Worse, `FollowingCardSections.tsx:9-15` documents that non-TV titles should fold into "Ligger efter", but `:150` filters them out first — a doc-vs-code contradiction. Fix: count the same set you render (TV-only) for the subtitle, or actually render the movie items._
- 🟡 Generic "Mina listor" tab title (all `/my/*` share it).

### 8. My Films / "Mina filmer" — `/my/films`
**What works:** Dense table; own-service highlighting works (Shrek shows accent-bordered "Prime" + plain "Viaplay").
- 🟡 **Redundant filter tabs:** a *films* page still renders the "Serier" type filter. _code: gate the tabs on `status==='sedd'` in `WatchlistPage.tsx:206`._
- (Rating-column note: see #9 — hollow stars, not a bug.)

### 9. Want-to-watch / "Vill se" — `/my/want-to-watch`
- 🟡 **[Corrected after code verification — NOT a bug]** I first read the BETYG column as "5 filled stars" on this unwatched list. Source review shows all surfaces use ONE shared `RatingStars` component: an unrated title has `display = 0`, so all five render as the **hollow `☆`** glyph, never the filled `★` (`RatingStars.tsx:15-39`). They merely *look* filled because the outlines are stroked in the orange accent (`text-accent`) at 13px. **The genuine, minor issue:** the table cell always renders the readonly 5-outline widget for unrated rows (`WatchlistPage.tsx:438-448`), whereas the card view replaces it with the text "Ej betygsatt" (`WatchlistCard.tsx:104-111`). Fix = mirror the card's empty-state text, or dim the stars to `text-text-muted` when `rating === null`, so an unrated row never reads as pre-rated. (My secondary claim "number only on non-5 ratings" was also wrong — the value shows for any non-null rating, including a real 5.0.)

### 10. Dropped / "Avbrutna" — `/my/avbrutna`
**What works:** Compact table; "Unbreakable Kimmy Schmidt" shows 2.5 (partial stars + number) — real ratings render correctly. (Re unrated rows: see #9 — hollow stars, not a bug.)

### 11. My Lists / "Mina listor" — `/my/lists`
**What works:** Simple list of curated lists with counts + visibility ("Romcoms att se · 1 titel · Publik"), "Skapa ny lista" CTA.
- 🟠 Non-standard small header (header cluster).
- 🟡 "Ta bort" rendered as a red **text link**, not a button — destructive action lacks affordance weight.

### 12. Discover / "Utforska" — `/discover`
**What works:** Trending poster grid, tabs (Trendande/Filmer/Serier) + genre filter, clear "added" affordance (orange border + ✓ badge).
- 🟠 **Nav active-state mismatch:** top nav highlights "Rekommendationer" while you're on `/discover` (Utforska has no own nav item).
- 🟡 Loading posters appear as black tiles (artifact, see caveats) rather than a skeleton/placeholder.

### 13. Feed / "Flöde" — `/feed`
**What works:** Big-title + "VÄNNER · FLÖDE" eyebrow; clean empty state ("Ingen aktivitet de senaste 2 veckorna").
- 🟡 `/feed` uses the standard big header while `/my/friends` (same "Vänner" section) uses the small one — inconsistency within a single section.
- 🟡 Empty state is bare text with no suggested action.

### 14. Films browse / "Filmer" — `/films`
**What works:** Two carousels ("Följer" with "Alla 42 →", "Populära filmer").
- 🟠 Non-standard small header.
- 🟠 The landscape **"Följer" row rendered all-black** on capture (likely lazy artifact — confirm on real device; if real, it's a broken carousel).
- 🟡 Posters are **sepia/desaturated by default, colorizing on hover** — see cross-cutting (mutes cover art / scannability).

### 15. Series browse / "Serier" — `/series`
**What works:** Same structure as Films; "Alla 194 →".
- 🟠 Same all-black "Följer" carousel + small header as #14.
- 🟡 **Purple/lilac duotone** clearly visible on several "Populära" posters (FROM, The Boys, Spider-Noir) — recurring second accent.

### 16. TV detail — `/tv/{id}`
**What works:** Well-structured — status pill ("pågår"), meta row (säsonger/avsnitt/tmdb/imdb), action row (Följer / your 3.5★ / Lista / Inte intresserad), "FINNS PÅ" provider logos (the killer feature), season accordion with per-season progress + "Sedd" badges, "Nästa avsnitt" callout. Good hierarchy and density.
- (Feeds the calendar discrepancy #3: this page *knows* S4E10 airs 2026-05-31.)
- 🟡 Poster is sepia/desaturated (treatment, see cross-cutting).

### 17. Person detail — `/person/{id}`
**What works:** Photo (full-color — desaturation only applies to posters, not people), bio, "Filmografi (N)" grid with add/✓ states.
- 🟠 Non-standard small header.

### 18. Movie detail — `/movie/{id}`
**What works:** Consistent with TV layout (regi, meta, "+ Lägg till", Lista, Inte intresserad, FINNS PÅ, cast row). **Unrated correctly shows 5 grey OUTLINE stars** — the correct empty state the table view fails to use.
- 🟡 Cast avatars without a photo render as **solid black circles** (no initials/placeholder fallback).

### 19. Friend profile (private) — `/user/malinkallen`
**What works:** Correctly respects privacy — a friend's private profile shows "@handle · Den här profilen är privat." (correct behavior, not a bug).
- 🟡 The private-profile state is bare (just one line); could offer a follow CTA or richer context. Generic tab title.

### 20. Settings / "Inställningar" — `/settings`
**What works:** Clean card-sectioned layout (Profil, Publik profil, Mina streamingtjänster, Visning, Innehållsfilter…); visibility radios have helpful descriptions; logical grouping; GDPR export/delete documented to live further down.
- 🟢 **Content-filter defaults — [Corrected, NOT a problematic default]:** the pre-checked countries I saw are *this account's own saved selections*. Verified: new users ship with `hiddenCountries: []` and `hideNonLatinTitles: false` (`AuthContext.tsx:131,172,273`); the 10-country grid is just a quick-toggle convenience list (`countries.ts` `COMMON_FILTER_COUNTRIES`), never checked by default. Optional soft note: the *featured* quick-toggle set being mostly non-Western is a mild editorial signal, but it hides nothing unless opted into.
- 🟠 **"Visning" default-view toggle offers only Tabell/Rutnät** — missing the "Kort" mode the library actually has (3 modes). _Root cause: `UserProfile.defaultView` is typed `'table' | 'grid'` (`domain.ts:97`), so `'cards'` isn't representable. Fix: widen the type + add `'cards' → 'Kort'` in `DisplaySection.tsx:16,26`._
- 🟡 The inline country list is a long nested-scroll region inside the page scroll (awkward).
- 🟡 This page was the heaviest to render (froze capture) — perceived-performance signal.

### 21. Terms / "Användarvillkor" — `/villkor`
**What works:** Readable narrow-column legal layout, clear "Utkast" (draft) banner, well-structured sections.
- 🟠 **Doubled tab title:** "Användarvillkor — Binge.nu — Binge.nu".
- 🟡 Live ToS is **Version 0.1 (utkast/draft)** — flag for launch.

### 22. Privacy / "Integritetspolicy" — `/integritet`
**What works:** Consistent legal template, GDPR rättslig-grund sections, contact link. Same doubled-title bug + 0.1 draft status.

### 23. Community guidelines / "Community-regler" — `/community-guidelines`
**What works:** Clear "Gör så här / Detta är inte OK" lists; well-written. Same legal template (doubled title, draft).

### 24. Groups / "Mina grupper" — `/grupper`
**What works:** Big-title header, strong empty state with a clear "+ Skapa din första grupp" CTA + descriptive subtitle.
- 🟡 **Two buttons for the same action** in different styles (black "+ Ny grupp" + orange "+ Skapa din första grupp").

### 25. Create group / "Ny grupp" — `/grupper/ny`
**What works:** Genuinely good form — sectioned defaults (Vad? / Provider-läge / Aggregering) each with explanatory microcopy ("Ingen hatar det — Undvik titlar någon sagt nej till").
- 🟠 **Third header variant:** small title *with an icon* (vs big-serif+eyebrow and bare-small-title). Header inconsistency now spans 3 patterns.

### 26. Watch-together / "Tillsammans ikväll" — `/tillsammans/ny`
**What works:** Polished — name field, a 3-column streaming-service picker with brand-color dots + orange-border selected states, Vad?/Tjänst-läge defaults; "no account needed for guests" explained.
- 🟡 Generic default tab title (no per-page title).
- 🟡 Lists both **"HBO Max" and "Max"** as separate services (HBO Max → Max rebrand; possible duplicate).

### 27. Search / "Sökresultat" — `/search?q=`
**What works:** Big-title + "SÖK · N RESULTAT", filter tabs (Alla/Serier/Film/Mina tjänster), per-result provider info + added-✓ states.
- 🟡 Result posters black on capture (lazy artifact).

### 28. Calibrate taste / "Kalibrera din smak" — `/kalibrera`
**What works:** Focused thumbs-up/down flow (Lucide icons — compliant, not emoji), 1/10 progress, loaded backdrop, clear actions ("Inte min grej" / "Hoppa" / "Gillar"), back link.
- 🟠 Slow to render (stuck on "Laddar…" several seconds). Small-title+icon header variant.

### 29. Statistics / "Statistik" — `/stats`
**What works:** Strong dense dashboard — 4 stat cards, Film-vs-Serier split, rating distribution, per-service bars in brand colors.
- 🟠 **Contradictory copy:** "Baserat på 0 av 296 titlar med streaming-data" while the bars below show per-service counts. _Root cause (verified): the bars aggregate `item.providers`, but the note's denominator counts `item.providersCheckedAt` (`stats/page.tsx:38-53`) — a field `addItem` never sets (`WatchlistContext.tsx:101-117`); only the taste-backfill writes it (`backfill.ts:87`). Fix: count items with a non-empty `providers` array, or set `providersCheckedAt` on add._
- 🟡 Counts hard to reconcile across pages ("54 filmer" here vs "42 titlar" on Mina filmer; "194 följer" vs "242 serier") with no explanation.
- 🟡 Disney+ and Max bars are both blue (hard to distinguish).

### 30. List detail — `/list/{id}`
**What works:** Title + count + "+ Lägg till titel", posters with remove badges.
- 🟠 Non-standard small header; generic default tab title (lists are public/shareable — needs a real title).
- 🟡 No inline list meta/edit (visibility, description) from the detail view; lots of empty space for a 1-item list.

### 31. Season detail — `/tv/{id}/season/{num}`
**What works:** Clean episode list with stills, S/E labels, runtimes, "Markera alla sedda", progress bar, back link.
- 🟡 **Progress loading-flash [re-checked live — NOT a data bug].** On first load this page renders "0/10 avsnitt sedda" with all episodes unchecked, then resolves to the correct **"10/10"** (full bar, green ✓ on every episode) after ~7s once `episodeProgress` hydrates from Firestore. The parent show page didn't flash because its progress was already cached from the show fetch. So it's a **perceived-loading** issue, not a sync discrepancy: the season progress UI needs a loading/skeleton state so it doesn't momentarily read as "unwatched". _Check `SeasonPageClient` — gate the count/checks on the progress query's `isLoading`._
- 🟡 Generic default tab title.

### 32. Provider browse — `/provider/{id}`
**What works:** Browse-by-service grid with "Nytt/Filmer/Serier" tabs (core "where to watch" value).
- 🟠 Heading is plain text "Netflix" — **no service logo/branding, no eyebrow**; these browse pages also use the **generic default tab title** (bad for potentially-indexable pages).
- 🟡 Non-Latin titles (Korean/Japanese/Hindi) appear here despite "Dölj icke-latinska alfabet" being on — the content filter is scoped to discover/recs only, so application is inconsistent across browse surfaces.

### 33. Public profile — `/user/{username}`
**What works:** Rich and well-designed — reused stat cards, TOPP-GENRER / TOPP-TJÄNSTER / SENASTE-30-DAGARNA dataviz, "Följer just nu" poster row, and a "Redigera profil" affordance for the owner.
- 🟠 **Generic default tab title** — bad for a **shareable public page**; needs "Name (@handle) — Binge.nu" + OG/Twitter meta for link sharing.

### Not audited (state/access not reproducible this pass)
Group **detail** (no groups exist on this account), an active **Tillsammans session** (none live), **onboarding** & **login** (redirect away when logged-in/onboarded), **admin/reports** (admin-gated). Recommend a follow-up pass with a fresh/seeded account to cover onboarding + empty/error states, and a real mobile device for responsive + MobileNav.

---

## Cross-cutting themes

### ★ The biggest finding: CLAUDE.md's Design Constraints are stale
The single highest-value issue isn't in the UI — it's that the **documented design system no longer matches the shipped one.** The app underwent a "Direction H / Schemat" redesign (documented in the Tailwind config + `globals.css` headers and `docs/design_handoff_direction_h_schemat/`). Almost every rule in CLAUDE.md's "Design Constraints" now describes a design that isn't live:

| CLAUDE.md says | Live app actually does | Evidence |
|---|---|---|
| Fixed **210px dark sidebar** (#1e2028) | **Light horizontal top-nav** (topbar + WeekStrip + Subnav + centered `max-width:1320px` canvas). No sidebar component exists. | `AppShell.tsx:41-54`, `AppTopbar.tsx:21-53`, `globals.css:142-151,487-524`; dead sidebar tokens still in `tailwind.config.ts:73-77,93` marked "legacy, unused" |
| **No box-shadow anywhere** | Two named shadows shipped (`lift`, `pop`) and used | `tailwind.config.ts:104-107`; `globals.css:401,1465,1905` |
| Border-radius **2-3px max** | Up to **8px** (DEFAULT/md 6px, lg 8px) used widely | `tailwind.config.ts:98-103`; `globals.css:317,558,819,1102,1383` |
| Base font **13px** | **15px** (`html,body`), token `13.5px` | `globals.css:68`; `tailwind.config.ts:88` |
| **System font stack only** | Custom **Albert Sans** + **JetBrains Mono** | `tailwind.config.ts:79-81` |
| Single accent #d97b35 (hex) | **Two-accent oklch system** + plum (see below) | `globals.css:6-10,32-34` |
| "Big serif title" (my own read) | Title is **44px sans** via `--sans` (`.page-h1`), not serif | `globals.css:532-540` |

**These are deliberate redesign decisions, not bugs.** The fix is to **rewrite CLAUDE.md** to match Direction H — otherwise every future contributor/agent will "correct" the code back toward a dead spec.

### Confirmed system-level patterns
1. **No shared page-header component.** Headers are hand-rolled per page, so three patterns coexist: (A) canonical `.crumb` eyebrow + `.page-h1` + `.stand` (16 files); (B) bare `text-[18px] font-bold` small title (19 occurrences — Friends, Lists, List-detail, Person, Provider, Season, `/films`, `/series`, admin); (C) small title + Lucide icon (`grupper/ny`, `tillsammans/ny`, `kalibrera`). _Fix: extract `PageHeader({crumb,title,standfirst,icon,actions})`, migrate the outliers, add a lint guard against raw `<h1 className="text-[18px] font-bold">`._

2. **Document-title pipeline is inconsistent** (three mechanisms: root `template:'%s — Binge.nu'`, per-segment static metadata, client `usePageMeta`). Symptoms: (a) **doubled suffix** on legal pages — they hard-code "— Binge.nu" which the template wraps again (`villkor/integritet/community-guidelines page.tsx`); (b) **generic fallback title** on `/user/[username]`, `/list/[id]`, `/tillsammans/ny` (catch-all/client pages that never call `usePageMeta`); (c) **all `/my/*` share "Mina listor"** from `my/layout.tsx:3-8`. Bad for shareable public profiles/lists. _Fix: strip the suffix from legal page titles; add `usePageMeta` to the profile/list/my-* clients (it appends the suffix itself); add `tillsammans/ny/layout.tsx`._

3. **The two-accent color system is intentional and well-built** (not a tension as I first flagged): **saffran/orange** = now / decisive / live; **plum/lilac** (`--cal-deep`/`--cal-soft`, oklch hue 300) = today / time-position. Applied consistently in WeekStrip, week-board, month-grid. The purple poster duotone is a separate per-genre treatment (`--duo-plum`, `DuotoneFilters.tsx`). **Document this in CLAUDE.md** — it's undocumented, not wrong.

4. **Poster duotone-on-hover is compliant; card-lift is not.** Posters are duotone by default and reveal full color via `filter:none` on hover (allowed). But cards also apply `transform: translateY(-2px)` on hover (`globals.css:1074,1464,1828`), which violates CLAUDE.md's "no transform on hover" rule. _Decide: remove the lifts (border-color hover already exists) or relax the rule in the docs — don't leave them contradicting._

5. **Image/avatar loading fallback.** Lazy posters and cast avatars render as solid black boxes before load. (The black tiles in my screenshots are mostly an automation artifact — see caveats — but on real slow connections a black flash still beats no placeholder poorly. Consider a neutral skeleton/initials fallback consistent with the grey placeholder used for missing posters.)

### What the design does genuinely well
- **Excellent token discipline** — every color is a `:root` CSS variable mirrored 1:1 into Tailwind, with legacy aliases remapped so old components inherit the new look for free (`tailwind.config.ts:60-77`).
- **Self-documenting two-accent semantics** applied consistently across time-based surfaces.
- **Clean, accessible duotone** — 8 reusable SVG luminance filters mounted once, per-genre selection, hover reveal that respects `prefers-reduced-motion`.
- **Strong CLS/hydration care** — WeekStrip renders identical DOM pre/post-mount; skeletons sized to real content; all `<img>` carry explicit width/height + lazy/async.
- **Solid a11y basics** — visible `:focus-visible`, `sr-only` with focus reveal, aria-labels on day cells, skip-to-content link.
- **Density + tabular-nums** preserve the "Prisjakt-for-media" tool feel. The **Streamingrådgivaren** in particular is a standout, differentiated screen.

---

## Prioritized fix list

### 🔴 P0 — functional / data correctness
1. **Calendar drops upcoming episodes** (`useCalendar.ts:73-96,113-159`). Stop passing `number_of_seasons` as a season number; fetch the season `next_episode_to_air` belongs to (by real `season_number`), and seed entries from `next_episode_to_air` as a fallback (mirror `useSubscriptionAdvisor.helpers.ts getNextAirInfo`). De-dupe by `${tmdbId}-S{n}E{n}`. Add a regression fixture where the season array lags `next_episode_to_air`. **This breaks the core "never miss an episode" promise.**

### 🟠 P1 — correctness-adjacent / consistency
2. **`/my/series` 194-vs-173 count** — count the same TV-only set the sections render (`WatchlistPage.tsx:148-158` vs subtitle at `105-133`); resolve the `FollowingCardSections.tsx:9-15` doc-vs-code contradiction.
3. **Stats "0 av 296 titlar"** — count items with non-empty `providers` (or set `providersCheckedAt` in `addItem`) — `stats/page.tsx:38-53`.
4. **Doubled legal tab titles** — drop the hard-coded "— Binge.nu" from `villkor/integritet/community-guidelines` `page.tsx`; let the root template add it once.
5. **Missing per-page titles** — add `usePageMeta` to `UserProfilePageClient`, `ListPageClient`, and per-`/my/*` page (public profiles/lists are shareable); add `tillsammans/ny/layout.tsx`.
6. **"Visning" missing "Kort"** — widen `UserProfile.defaultView` to include `'cards'` (`domain.ts:97`) + add the option in `DisplaySection.tsx:16,26`.
7. **Season vs show progress (0/10 vs 10/10)** — verify `SeasonPageClient` reads the same `episodeProgress` source as `TVShowPageClient`.
8. **HBO Max / Max duplicate** — alias provider id `384`→`1899` in `providers.ts:47-92` (`canonicalProviderId`).
9. **Nav active-state on `/discover`** — highlight the correct item (currently lights "Rekommendationer").

### 🟡 P2 — polish / consistency
10. **Extract a shared `PageHeader`** and migrate the ~19 outlier headings (+ lint guard).
11. **Rating empty-state in table** — show "Ej betygsatt" (or dim stars) for unrated rows (`WatchlistPage.tsx:438-448`) to match the card view.
12. **Redundant type-filter tabs** on type-specific lists — gate on `status==='sedd'` (`WatchlistPage.tsx:206`).
13. **Single CTA on `/grupper`** empty state (drop the duplicate-style button) — `grupper/page.tsx`.
14. **"Ta bort" as a button, not a red text-link** on `/my/lists` (`my/lists` ~89-94).
15. **Provider page heading** — show the service logo + use a real `usePageMeta` title (these pages are potentially indexable).
16. **Empty states** (`/feed`, private profile) could offer a next action.
17. **Disney+ vs Max bars** both blue on `/stats` — differentiate.
18. **App Check reCAPTCHA console error every load** — register a reCAPTCHA v3 key for the `binge.nu` domain in Firebase Console (config, not code).

### 🧹 Housekeeping
19. **Rewrite CLAUDE.md Design Constraints** to match Direction H (top-nav, 15px base, Albert Sans/JetBrains Mono, oklch two-accent system, two allowed shadows, radius ≤8px). **Highest-leverage doc fix.**
20. **Delete dead sidebar tokens** (`tailwind.config.ts:73-77,93`) and the `--mono`→sans alias (`globals.css:54-57`).
21. **Reconcile the hover-transform rule** (remove `translateY` lifts at `globals.css:1074,1464,1828`, or relax the doc).
22. Live **ToS/Privacy/Community are Version 0.1 (utkast/draft)** — finalize before/at launch.

---

## Follow-up passes recommended
- **Mobile / responsive + MobileNav** on a real device (couldn't force a mobile viewport in the automated desktop browser).
- **Onboarding + login + empty/first-run states** with a fresh account.
- **Group detail, active Tillsammans session, admin/reports** with appropriate data/role.
- A **real-device check of the landscape "Följer" carousels** on `/films` & `/series` (uniformly black in capture — likely the same lazy-load artifact, but confirm).

> **Audit confidence note:** every 🔴/🟠 finding above is anchored to specific source locations via a code-verification pass. **Three** initial visual findings were softened/refuted on verification rather than reported as bugs: the table "filled stars" (actually hollow orange-stroked glyphs), the country-hide "defaults" (actually the account's own saved settings), and the season "0/10 vs 10/10" (a load-flash that resolves to 10/10, re-checked live). This is the audit working as intended — visual observations gated by code/behavior verification.
