# Handoff: Direction H — "Schemat"

A Swedish media-tracker UI, organised around the week. This handoff covers the full system: foundation tokens, six screens, the duotone treatment, and the two-accent semantic rule.

---

## About the design files

The files in `design-files/` are **design references created in HTML/CSS** — high-fidelity prototypes showing intended look, structure, and interaction. **Do not copy them verbatim** into the codebase.

Your job is to **recreate these designs in the target app's existing environment** (React + CSS-modules, Vue, SwiftUI, native, etc.) using its established patterns, component library, and conventions. If the project has no UI environment yet, choose what fits the stack — and apply the design tokens and patterns documented below.

Each HTML file:
- Links a shared stylesheet (`direction-h.css`) for tokens + topbar/subnav/chrome
- Has a small embedded `<style>` block for screen-specific layout
- Uses inline SVG `<filter>` definitions for the duotone image treatment
- Uses `picsum.photos` URLs as placeholder imagery — replace with real assets / placeholders from your codebase

---

## Fidelity

**High-fidelity.** Colors, type sizes, spacing, hover states, and interactions are intentional. Hex/oklch values, font weights, letter-spacing, and radii should be matched exactly. Component composition (e.g. the focal block on Hem, the event card on Kalender) is final.

---

## The system, in one paragraph

A Swedish media tracker built around the **ISO week** instead of the streaming-app "for-you" channel. A persistent 7-day strip sits at the top of every page. Today is marked with a **plum** wash and a 2px plum rule. Live/decisive moments (tonight's airing episode, a primary CTA, a veto vote) are marked with **saffran**. Real TMDB-style posters and stills are processed through one of eight **muted duotone tones** when used for *identification* (in lists, grids, library, calendar) — and shown **raw** when used for *preview* (episode stills, trailers, gallery, cast). Hairline rules, tabular numbers, no shadows, no gradients.

---

## Design tokens

All colours are `oklch()`. Map to your codebase's existing token system; **don't introduce a parallel one** unless the codebase has none.

### Surfaces

| Token | Value | Role |
|---|---|---|
| `--bg` | `oklch(0.985 0.003 90)` | Page background — warm off-white |
| `--bg-2` | `oklch(0.968 0.004 90)` | Slight depth (alternating rows, headers) |
| `--surface` | `oklch(1 0 0)` | Cards, panels |

### Ink (text)

| Token | Value | Role |
|---|---|---|
| `--ink` | `oklch(0.18 0.006 80)` | Primary text, headlines |
| `--ink-2` | `oklch(0.42 0.008 80)` | Secondary text, body copy |
| `--ink-3` | `oklch(0.60 0.010 80)` | Tertiary, meta, captions |

### Rules (borders)

| Token | Value | Role |
|---|---|---|
| `--rule` | `oklch(0.88 0.006 80)` | Primary 1px borders, dividers |
| `--rule-2` | `oklch(0.94 0.005 80)` | Secondary dividers (between list rows) |

### Accents — two distinct semantic colors

**Saffran (`--acc-deep` / `--acc-soft`)** — means **"live / now / decisive"**:
- Primary CTAs (`btn.acc`)
- Tonight's airing episode (on episode lists and "tonight" event cards)
- Veto vote indicator
- Brand mark (10×10 saffran square)
- "Klar att väljas" confirmation

| Token | Value |
|---|---|
| `--acc` | `oklch(0.72 0.14 75)` |
| `--acc-deep` | `oklch(0.55 0.13 70)` |
| `--acc-soft` | `oklch(0.955 0.04 75)` |

**Plum (`--cal-deep` / `--cal-soft`)** — means **"today / picker / time position"**:
- Today's column in the week strip + week board
- Week number `v12` indicator
- Today cell in month grid
- "Idag · ikväll" badges in the calendar (`is-tonight` event card)
- Any "current item is here" picker indicator

| Token | Value |
|---|---|
| `--cal-deep` | `oklch(0.48 0.11 300)` |
| `--cal-soft` | `oklch(0.945 0.045 300)` |

> **Why two accents.** Saffran is for *what's happening now* (an action, a live event). Plum is for *where in time the user currently is* (the today picker). Keeping them visually distinct prevents the calendar UI from drowning every page in one warm tone.

### Duotone palette (imagery)

Eight muted tones, one per genre/category. Each tone has an SVG filter that maps any source bitmap to a 2-color duotone. Apply via `<img>` inside a parent with `.duo-{name}` class.

| Class / token | Value | Genre / role |
|---|---|---|
| `--duo-terra` | `oklch(0.62 0.08 30)` | Drama, family, period |
| `--duo-slate` | `oklch(0.42 0.06 240)` | Krim, noir, thriller |
| `--duo-moss` | `oklch(0.50 0.06 150)` | Nature, documentary, biographical |
| `--duo-clay` | `oklch(0.62 0.07 80)` | Comedy, youth, light |
| `--duo-plum` | `oklch(0.40 0.07 300)` | Mystery, fantasy, supernatural |
| `--duo-steel` | `oklch(0.45 0.05 200)` | Sci-fi, tech, future |
| `--duo-olive` | `oklch(0.55 0.06 120)` | Reality, sport, lifestyle |
| `--duo-oxblood` | `oklch(0.38 0.05 20)` | Horror, action, intense |

**Implementation note.** The duotone is a real CSS `filter: url(#duo-X)` referencing an inline SVG `<filter>` block at the top of each page. The filter is a `feColorMatrix` luminance pass + `feComponentTransfer` that maps black→shadow-color and white→highlight-color. Copy the filter block from any of the design files (top of `<body>`, inside `<svg width="0" height="0">`).

If your codebase strips SVG defs or uses a strict CSP, alternatives:
1. Render bitmaps server-side already duotoned (recommended for production — `sharp` or `ImageMagick` can do it)
2. Use CSS `filter: grayscale() sepia() hue-rotate()` chains as approximation (less accurate)

### Radii

| Element | Radius |
|---|---|
| Posters | `3px` |
| Cards, panels, tiles | `6–8px` (use `6px` for inner cards, `8px` for outer containers) |
| Chips, pills, avatars | `999px` |
| Inputs | `6px` |
| Brand square | `1px` (almost-sharp) |

### Type

Two families, no more.

```css
--sans: "Albert Sans", system-ui, sans-serif;  /* weights 400/500/600/700 */
--mono: "JetBrains Mono", monospace;           /* weights 400/500/600 */
```

Typographic scale (used across all screens):

| Use | Family | Size | Weight | Letter-spacing | Line-height |
|---|---|---|---|---|---|
| Hero h1 | sans | `clamp(56px, 7vw, 88px)` | 600 | `-0.04em` | `0.95` |
| Page h1 (canvas) | sans | `44px` | 600 | `-0.035em` | `1.0` |
| Section h2 | sans | `28–32px` | 600 | `-0.025em` | `1.1` |
| Card h3 | sans | `17–22px` | 600 | `-0.02em` | `1.1` |
| Standfirst / body | sans | `15.5–18px` | 400 | normal | `1.45–1.55` |
| Card title | sans | `13.5–14px` | 600 | `-0.015em` | `1.2` |
| Meta / mono | mono | `10.5–12px` | 400–500 | `0.04–0.14em` | `1.4` |
| Kicker / label | mono uppercase | `10–11px` | 400 | `0.14–0.18em` | `1.2` |

**Always set `font-feature-settings: "tnum" 1`** on anything showing numbers in a column (stats, prices, counts, dates).

### Spacing

No formal scale — use:
- `4px` — between adjacent text lines inside a label
- `6–8px` — within a card (between title and meta)
- `14–22px` — between cards / panels
- `36–48px` — between sections
- `64–96px` — between major page regions

### Shadows

**No drop shadows by default.** Two exceptions:

```css
/* Card hover lift */
box-shadow: 0 4px 14px oklch(0 0 0 / 0.06);

/* Sticky/popover */
box-shadow: 0 2px 8px oklch(0 0 0 / 0.04);
```

### Layout grid

Max page width: `1320px` with `40px` horizontal padding. Topbar grid: `200px 1fr 240px` (brand / week strip / search+avatar).

---

## Screens

The system has six screens. Each is its own HTML file in `design-files/`. Brief spec for each:

### 01 — Hem (`direction-h-hem.html`)
**Purpose.** Front room. The user lands here, sees the week up top, sees what's airing tonight in a focal block, scans the rest of the week and a right-rail of "other people + money".

**Key components:**
- **Topbar** — brand · 7-day week strip · search + avatar
- **Subnav** — Hem · Bibliotek · Kalender · Rekommendationer · Sparande · Vänner · Grupper
- **Page header** — crumb (mono uppercase) → h1 (52px, max 22ch) → standfirst (16px, max 60ch) → action row
- **Focal block** — a 21:9 episode still (duotone-terracotta) with a 92×138px poster overlapping the bottom-left. Meta column with chips, title (h2 32px), synopsis, stats row. CTA column on the right. Bottom: an `ikapp`-progress strip — horizontal bar + E01-E08 tick row + "1 avsnitt efter · 52 min för att hinna ifatt" caption
- **"Senare i veckan" filmstrip** — 5 cards in a grid, each a 2:3 duotone poster + title + meta (day · S/E · channel)
- **Right rail tiles:**
  - *Sparande* — Big number (`458 kr`), explanation, 12-month bar chart, active pause card (dashed border) with resume button
  - *Vänner senast* — 4 sentences with avatar circles, mono timestamps, inline `rate` chips
  - *Grupper* — 3 rows with status dot (animated pulse on `Familjen Lund · 4 i rummet · röstar nu`)

### 02 — Kalender (`direction-h-kalender.html`)
**Purpose.** The week strip *opens up*. Each day a column, each tracked episode a rich card.

**Key components:**
- **Week board** — 7 columns. Today column has the plum wash + 2px top rule. Each card is vertical: 16:9 episode still at top (duotone), body with title + meta (S/E · time · channel) + 2-line synopsis (`-webkit-line-clamp: 2`) + inline trailer + reminder buttons. Tonight episode card has `box-shadow: inset 3px 0 0 var(--cal-deep)` left edge.
- **Badges on stills** — small mono uppercase chips top-left of the still: `premiär`, `ny ikväll`, `säsongsfinal`, `film`. Background `oklch(0 0 0 / 0.62)`, white text, `backdrop-filter: blur(2px)`
- **Month strip** — 5-week grid below the board with ISO week numbers in the left rail. Episodes shown as 14×4px colored pills using duotone tones (genre-coded). Today cell has plum wash.
- **Action row** — `v11 ← v12 · idag → v13` pill nav · "Hoppa till idag" / "Lägg till påminnelse" · vecka/månad/lista view toggle
- **Legend strip** at bottom of month grid: small swatch + tone name + genre

### 03 — Rekommendationer (`direction-h-recs.html`)
**Purpose.** Seven labelled rows of recs. Every row says **why**.

**Key components:**
- **Quick-rate banner** at top — large card with poster + name + synopsis + 4 buttons (Sedd / Inte sedd / Inte intresserad / Hoppa över)
- **7 row categories**, each:
  - Header: number (mono) · h3 title · `why` line in mono · `visa fler →` link
  - 6-card grid (poster 2:3 + title + sub + per-card rationale on hover)
- **Card hover state:**
  - Border darkens, slight lift (`translateY(-2px)`)
  - Scrim gradient overlay on poster
  - 3 action buttons appear at bottom: "lägg i bibliotek" (+ icon) · "betygsätt" · "inte intresserad" (× icon)
  - Rationale line fades in below sub: `matchar Bron · 87%`

### 04 — TV-detalj (`direction-h-detail.html`)
**Purpose.** The detail page. Where the duotone/raw boundary is explicit.

**Rules visible on the page itself:**
- Hero poster (top-left) — **duotone** (identification)
- Trailer, episode stills, gallery, cast portraits — **raw** (preview)
- "Liknande serier" row at the bottom — **duotone again** (navigation again)

**Key components:**
- Hero block — duotone poster · big title · chips (active / SVT · 2024– / drama-thriller) · synopsis · stats (S2E05 / 8 · 4,5 · 52 min · SVT Play) · CTA column
- Trailer overlay — 16:9 raw video frame with circular play button (64px white circle, ink-colored triangle)
- Episode list — table-like rows: `120px still · 56px code · title+synopsis · 70px runtime · 30px ✓`. Tonight row has plum wash.
- Gallery — 5-image asymmetric grid (2fr 1fr 1fr × 2 rows, with one tall 1×2)
- Cast — 6 circular headshots, raw
- Reviews — `80px meta · text body` rows
- "Din anteckning" — left-rule quote
- Similar series at bottom — duotone grid

### 05 — Tillsammans (`direction-h-tillsammans.html`)
**Purpose.** Live voting session for what to watch tonight as a group.

**Key components:**
- **Presence strip** — host avatar + 3 member avatars, pill format. Host avatar uses saffran bg.
- **Session config card** — max runtime · only-on-shared-services · session ID · ends-at
- **Candidate cards** — 3 candidates, each with poster + meta + reason ("varför detta?"), vote row (5 dots, fills as people vote), vote buttons (Ja / Nej / Veto). Leader (4/4 ja) gets a saffran 3px inset shadow + "Klar att väljas →" line.
- **Vetoed line** — strike-through title + saffran "VETO · Johan" annotation

### 06 — Mobile (`direction-h-mobile.html`)
**Purpose.** Three phone screens side-by-side: Hem, Bibliotek, Tillsammans.

**Key components:**
- Phone frame: `390 × 844px` (iPhone 14), dark bezel, 14px corner radius
- **Status bar** — minimal time/signal/battery
- **Compressed week strip** — 7 cells with day label + number + presence dot (filled = has episode). Today gets plum wash + 2px plum top rule.
- **Bottom tab nav** — 5 icons, **Sök at center** (the deliberate platform inversion: search lives in the thumb zone)
- Same `is-tonight` saffran treatment on the tonight episode card
- Voting screen mirrors desktop Tillsammans but stacked

---

## Interaction patterns

### Hover-to-reveal (the duotone affordance)
Every duotone-treated image lifts its filter on hover so reviewers/users can see the original bitmap. A tiny white dot appears bottom-right as affordance.

```css
.poster img, .ev .px img, [class*="duo-"]:has(> img) > img {
  transition: filter 220ms cubic-bezier(0.2, 0, 0, 1);
}
.poster:hover img, .ev .px:hover img, [class*="duo-"]:has(> img):hover > img {
  filter: none !important;
}
```

This is a design-review affordance. In production, decide if you want to keep it (good for users to "preview the real photo") or remove it (cleaner).

### Card hover
All cards lift slightly + darken border on hover. Transition: `140ms` for both properties. Slight `translateY(-1px to -2px)`.

### Today highlight (the picker)
The plum-tone today wash appears on:
- Week strip cell (`.topbar .week .day.today`)
- Week board column (`.week-board .col.today`)
- Month grid cell (`.month-grid .dcell.today`)
- Mobile week strip (`.m-week .d.today`)

Always: plum-soft background + plum-deep label/text + 2px plum-deep top rule (`::before`).

### Live/now indicators (saffran)
- Episode airing tonight on Hem: pulsing saffran dot + "ikväll · 21:00" badge with saffran bg
- Episode list row (tonight): saffran soft bg
- Veto vote dot: saffran
- Primary CTA (`btn.acc`): saffran bg, white text
- "Klar att väljas →" line: saffran

A subtle `pulse` keyframe animation on the live dot:
```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
/* duration: 1.6s ease-in-out infinite */
```

### Primary buttons (`.btn.acc`)
Saffran background, saffran border, white text. Use sparingly — one per page, only for the page's primary action.

---

## State management

The HTML files are static prototypes. The behaviors that need state in production:

| Screen | State |
|---|---|
| Hem | `tonightEpisode` (series + episode + airTime) · `weeklyEpisodes[]` · `friends[]` activity feed · `savingsThisMonth` + `pausedServices[]` · `activeGroupSessions[]` |
| Kalender | `currentWeek` (ISO) · `weekEpisodes[]` keyed by day · `monthGrid` (5×7) · viewMode (`week` / `month` / `list`) |
| Recs | `categories[]` with `seedTitle`, `rationale`, `items[]` · `quickRateQueue[]` · `userTaste` vector · per-category `dismissed` flag |
| Detail | `series` (full record) · `episodes[]` with `watched`, `airDate`, `runtime` · `cast[]` · `similarSeries[]` · user's `note`, `rating`, `review` |
| Tillsammans | `session` (host, members, presence) · `candidates[]` with `votes[]` per-member · `vetoed[]` · derived `leader` |
| Mobile | Same as desktop screens, but compressed views |

### Real-time
Tillsammans is real-time (live voting). Use websocket or server-sent events. Vote dots fill as people vote. Presence pills update on join/leave.

---

## Assets

**Placeholder imagery.** All `<img>` tags reference `picsum.photos/seed/...` URLs. Replace with:
- TMDB API for poster/still/cast images in production
- Your codebase's existing image-loading component (lazy-load, blur-up, etc.)

**Fonts.** Both fonts are on Google Fonts:
```html
<link href="https://fonts.googleapis.com/css2?family=Albert+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```
For production, self-host with proper subsetting. Albert Sans is by Indian Type Foundry, OFL-licensed. JetBrains Mono is by JetBrains, OFL-licensed.

**SVG filters.** The duotone `<filter>` defs are inline in each HTML file (top of `<body>`). For React, create a single `<DuotoneFilters />` component that renders the SVG defs once at the app root, then any `<img>` with `filter: url(#duo-terra)` will pick them up.

**Icons.** Trailer-play, reminder-bell, plus, ×: inline SVGs in HTML. Replace with your icon library (lucide-react, heroicons, etc.) at equivalent sizes (11–12px). Strokes 1.2–1.4.

---

## File map

```
design-files/
├── direction-h.css              # Shared tokens, topbar, subnav, chrome, hover-reveal
├── direction-h-index.html       # Project landing — overview + screen previews + roadmap
├── direction-h-hem.html         # 01 · Hem (front room)
├── direction-h-kalender.html    # 02 · Kalender (week board + month context)
├── direction-h-recs.html        # 03 · Rekommendationer (7 labelled rows)
├── direction-h-detail.html      # 04 · TV-detalj (duotone/raw boundary)
├── direction-h-tillsammans.html # 05 · Tillsammans (live voting)
└── direction-h-mobile.html      # 06 · Mobile (3 phone screens)
```

Start with `direction-h.css` to understand the tokens. Then open `direction-h-index.html` for the system overview. Then look at each screen file. Tokens repeat by name across files.

---

## Anti-patterns (do not introduce)

These were explicitly avoided in the design. Maintain that:

- ❌ Gradients (none used)
- ❌ Drop shadows (only subtle hover lifts)
- ❌ Decorative SVG illustrations
- ❌ Emoji
- ❌ Inter, Roboto, system-ui or other trendy/default fonts
- ❌ Infinite scrolls or "for you" channels
- ❌ Recommendation rows without rationale
- ❌ Rounded-corner left-border colored callout blocks (an AI-slop trope)
- ❌ More than two semantic accent colors
- ❌ Stylized icon sets (use thin-stroke geometric only)

---

## Implementation notes for Claude Code

1. **Start by mapping the design tokens to the codebase's existing system.** If there's a `tokens.ts` / `theme.ts` / Tailwind config, add the new tokens there with the same semantic names (`accent-decisive`, `accent-picker`, `duo-terra`, etc.). Don't create a parallel system.

2. **Build the chrome first** — Topbar with week strip, Subnav. That's the spine. Every screen reuses it. Make it a single component (`<AppChrome>` or similar) that takes children.

3. **Build the duotone filter component** — `<DuotoneFilters />` rendered once at app root. Then `<DuotonePoster src={url} tone="terra" />` is a wrapper that applies `filter: url(#duo-terra)`.

4. **Episode card on Kalender is the most reusable component.** Build it well — it's used on Hem (filmstrip variant), Kalender (full variant), Detail (episode list row variant), Mobile (compressed variant). Same conceptual primitive, different sizes.

5. **The two accents are easy to mix up.** Add lint rules or a comment in the theme file:
   - `--acc-deep` → only for "live / decisive / now"
   - `--cal-deep` → only for "today / picker / time-position"

6. **Ask before implementing animations.** The hover-reveal, the pulse, the card lift are described above. Real interaction work (voting dot fill, week strip transition, etc.) likely needs design follow-up.

7. **Swedish copy is intentional.** Don't translate to English unless asked. The tone is bone-dry and specific; preserve it.

8. **Tabular numbers everywhere stats appear.** This is a small detail that makes the whole thing feel like a system.

---

## Open questions for the developer to surface back

These are decisions the designer (and product) should make before shipping:

1. **Duotone in production.** Server-side baked (best perf, fixed assignment) vs. CSS filter at runtime (flexible, slower)?
2. **Hover-to-reveal in production.** Keep for users, or only in design-review mode?
3. **Tonight episode badge — saffran or plum?** Currently the calendar uses plum for "tonight is today's airing slot", but a separate live indicator might use saffran. Confirm with designer.
4. **Mobile breakpoints.** The phone frame in the design is iPhone 14 (390×844). What breakpoint(s) does the codebase target?
5. **Episode countdown.** Real-time? Polling? Push?

---

*Generated from the Direction H design conversation. The HTML prototypes are the source of truth for visual fidelity — refer to them when in doubt.*
