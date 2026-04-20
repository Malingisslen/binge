# UX, Design & i18n Analysis

**Prompt 06 of 11** | Consolidates: Design-rule compliance (CLAUDE.md),
Accessibility (WCAG 2.1 AA), User flows & navigation, Swedish i18n,
Responsive design, and Content quality (copy, empty states, errors)

---

## Mission

Analyst: **Claude (Opus 4.7)**

Deliver a world-class user experience for Binge, a Swedish-only web SPA
positioned as "Prisjakt for media". This prompt audits everything users
see, touch, and interact with: design consistency, CLAUDE.md rule
compliance, accessibility, Swedish copy quality, and responsive design
across desktop and mobile.

Binge has an unusually strict design vocabulary (documented in CLAUDE.md)
that is central to its positioning — "must NOT look AI-generated", dense
tool vs marketing site, 13px base, 2-3px radius, no shadows, specific
color palette, tiny provider pills. A design audit that doesn't enforce
those rules has failed.

**Scope boundaries** — topics owned by other prompts (do not duplicate):
- Performance (LCP, INP, bundle size) → 04
- Security rules, auth, GDPR service implementation → 02
- Test coverage and CI/CD → 03
- TMDB provider color correctness vs brand → 07 (provider palette accuracy)
- TMDB attribution wording → 11
- Competitive UX benchmarks (JustWatch, Letterboxd) → 10

---

## Two-Phase Approach

### Phase 1: Investigation and Documentation (current task)

No code changes. No design changes. Investigate and record findings only.

For every issue:
- File path and line number
- Severity: CRITICAL / HIGH / MEDIUM / LOW
- User impact description
- Effort estimate (hours / days)

### Phase 2: Improvement Plan (after Phase 1)

Analyze all findings together. Prioritize by user impact, effort, and
launch risk. Group related improvements. Produce a sequenced remediation
roadmap.

Phase 2 is a separate step; begin only after Phase 1 is 100% complete.

---

## Known Project Context

```
Project:             Binge (binge.nu — Swedish media tracker)
Framework:           Next.js 14 (App Router), Tailwind CSS
UI language:         Swedish (primary and only language at launch)
                     No i18n library installed (no next-intl, no react-intl,
                     no ICU). Strings are hardcoded Swedish in JSX.
Target platforms:    Web (desktop + mobile browsers)
                     Primary: Chrome, Safari, Firefox, Edge
                     No native mobile apps
Design mockup:       mockups/ directory contains reference HTML:
                       1-landing.html
                       2-dashboard.html
                       3-lists.html
                       4-advisor.html
                       5-patterns.html
                     Referenced in CLAUDE.md (binge-v2.html in older rev)

Design tokens (from tailwind.config.ts — confirmed):
  colors:
    page: '#eeece8'                ← page background
    surface: '#faf8f5'             ← card/table background
    surface-hover: '#f5f0ea'
    sidebar-bg: '#1e2028'          ← 210px fixed left sidebar
    accent: '#d97b35'              ← warm orange-brown
    text-primary: '#222'
    text-secondary: '#555'
    text-muted: '#999'
    text-sidebar: '#9a9aaa'
    text-sidebar-active: '#eee'
    sidebar-label: '#3e3e48'
    border-main: '#ddd'
    border-light: '#eee'
    border-table: '#f0eee8'
    season-done: '#2e7d32'
    cal-header: '#f5f3ee'

  fontSize (custom scale):
    xxs: 9px     ← provider tags, table header uppercase
    xs: 10px
    sm: 11px
    base: 12px
    md: 13px     ← default body

  borderRadius:
    sm: 2px
    DEFAULT: 3px
    (no larger values — enforced at token level ✓)

  width:
    sidebar: 210px

  animations:
    fade-in: 0.2s ease-out translateY(8px) → 0

Global CSS (src/app/globals.css):
  body: system-ui, -apple-system, "Segoe UI", sans-serif
        background #eeece8, color #222, font-size 13px, line-height 1.5
  scrollbar: width 6px, thumb #ccc radius 3px (WebKit + Firefox)

CLAUDE.md design rules (STRICT, auditable):
  ✗ MUST NOT look AI-generated
  ✗ NO rounded cards with shadows
  ✗ NO gradients
  ✗ NO emoji in UI
  ✗ NO decorative badges
  ✓ Fixed 210px dark sidebar (#1e2028) + scrollable main content
  ✓ Base font 13px
  ✓ System font stack only
  ✓ Border radius 2-3px MAX (never more)
  ✓ NO box-shadow anywhere
  ✓ NO transform/scale on hover
  ✓ Accent #d97b35
  ✓ Table headers: 9-10px uppercase, letter-spacing 0.5px, color #aaa
  ✓ Provider tags: 9px bordered pills, user's own services highlighted
                   with accent border/color
  ✓ Icons: Lucide React, small, inline only

Current UI surface (23 pages, ~70 components):
  Routes:
    / (dashboard)
    /search
    /movie/{id}, /tv/{id}, /person/{id}      (via [...path] catch-all)
    /films, /series                          (filter views)
    /discover, /recommendations
    /feed                                    (social)
    /my/all, /my/following, /my/lists, /my/want-to-watch, /my/watched
    /calendar                                (upcoming releases)
    /savings                                 (advisor detail)
    /stats
    /grupper, /grupper/ny, /grupper/{id}
    /tillsammans/ny, /tillsammans/{id}
    /kalibrera                               (taste calibration)
    /settings
    /login

  Shared components:
    WatchlistPage (614 lines)  — used by /my/* routes
    MediaTypePage              — used by /films, /series
    TitleCard, TitleGrid       — card-level rendering
    ProviderTag                — provider pill (KEY design element)
    StatusButton               — Följer/Vill se/Sedd toggle
    RatingStars
    RecommendationsSection

Accessibility baseline:
  Currently NO explicit accessibility infrastructure observed:
  - No aria-live regions for advisor / toast updates
  - Focus management on route changes: Next.js default (focuses body)
  - No skip-to-content link
  - No keyboard shortcut docs (but shortcuts may exist for search)
  - Color contrast: needs audit (warm accent #d97b35 on #eeece8 — likely borderline)

Swedish copy:
  - All UI strings in Swedish, hardcoded in JSX
  - Domain vocabulary: "Följer" (follow), "Vill se" (want to watch),
    "Sedd" (watched), "Avslutad" (ended), "Pågår" (ongoing),
    "Inställd" (canceled), "Under produktion" (in production)
  - TMDB status → Swedish mapping in src/lib/watchStatus.ts
  - No ICU plurals (would need if strings vary by count)
  - Dates: formatter? (investigate utils.ts)

Responsive:
  - Fixed 210px sidebar on desktop
  - On mobile: sidebar must collapse / hide (investigate layout.tsx
    and mobile behavior)
  - Tailwind default breakpoints (sm:640, md:768, lg:1024, xl:1280)

Generated file exclusions:
  .next/, node_modules/, out/, .firebase/
```

---

## Dimensions (7 total, weights sum to 100)

### 1. Design System & CLAUDE.md Rule Compliance — 22 points

**Goal:** Every screen follows the strict CLAUDE.md design rules. Zero
violations.

**This is Binge's most auditable dimension.** Every rule is specific and
machine-checkable. Unlike typical "design consistency" audits, this one
has pass/fail outcomes.

Investigate:

**1.1 Forbidden patterns — grep audit**

These must produce ZERO hits:
```
grep -rn "box-shadow\|boxShadow" src/                   # CLAUDE.md: no shadows
grep -rn "drop-shadow" src/
grep -rn "linear-gradient\|radial-gradient" src/        # no gradients
grep -rn "gradient-" src/                               # Tailwind gradient classes
grep -rn "rounded-lg\|rounded-xl\|rounded-2xl" src/     # radius > 3px
grep -rn "rounded-full" src/                            # circles may be OK for avatars — adjudicate
grep -rn "hover:scale\|hover:transform\|hover:rotate" src/  # no transform on hover
grep -rn "transition-transform" src/
grep -rn "🎬\|🎭\|📺\|⭐" src/                          # emoji in UI (spot-check; see Dim below)
```

Document every hit with file:line. Each is a CRITICAL design-rule violation.

**1.2 Border radius compliance**

Allowed: `rounded` (3px), `rounded-sm` (2px), `rounded-none`.
Not allowed: `rounded-md`, `rounded-lg`, etc.

- Grep for all `rounded-` variants in src/
- Verify all are `rounded`, `rounded-sm`, or `rounded-none`

**1.3 Color palette compliance**

Allowed colors (from tailwind.config.ts):
page, surface, surface-hover, sidebar-bg, accent, text-primary,
text-secondary, text-muted, text-sidebar, text-sidebar-active,
sidebar-label, border-main, border-light, border-table, season-done,
cal-header — plus Tailwind built-in grays (used sparingly).

- Grep for hardcoded hex colors in src/ — should be rare (only in
  providers.ts for brand colors, which is intentional)
- Grep for `text-red-`, `bg-blue-`, `text-green-` etc. — Tailwind built-ins
  are NOT in the design vocabulary and each usage should be reviewed
- Brand accent use: `text-accent` / `bg-accent` / `border-accent` is the
  ONLY accent-color mechanism

**1.4 Typography compliance**

- Base size is 13px (globals.css body). All other sizes from custom scale:
  xxs (9), xs (10), sm (11), base (12), md (13).
- Grep for `text-` size classes:
  Allowed: text-xxs, text-xs, text-sm, text-base, text-md
  Not allowed: text-lg, text-xl, text-2xl (design hint: do not shout)
- Exception: page titles may use a slightly larger size — document every
  instance for adjudication.

- Verify system font stack: globals.css specifies
  `system-ui, -apple-system, "Segoe UI", sans-serif`. No @font-face or
  webfont imports should exist.

**1.5 Icon discipline**

CLAUDE.md: Lucide React, small, inline only.
- Grep for Lucide imports — all from `lucide-react`
- No raw SVG icons in JSX (unless they're Lucide re-exports)
- Icon sizes: small (size={12} / {14} / {16}), never decorative-large
  unless on empty states

**1.6 Sidebar structure**

- Fixed 210px width (w-sidebar in Tailwind)
- Dark background (sidebar-bg)
- Verify src/components/layout/ structure matches this
- Mobile collapse strategy

**1.7 Table header discipline**

- 9-10px uppercase, letter-spacing 0.5px, color #aaa
- Search every <th> / table header in src/components/
- Verify class: typically `text-xxs uppercase tracking-wider text-[#aaa]`
  or similar

**1.8 Provider tag discipline (key design element)**

- ProviderTag.tsx: verify implementation
- Size: 9px (text-xxs)
- Bordered pill
- User's own services: accent border + accent text color
- Non-owned: neutral border + text
- No background fill for non-owned (avoid visual heaviness)

**1.9 Emoji audit**

- Grep for emoji characters in TSX files (not test data, not dev comments)
- Known allowed: none in UI (CLAUDE.md rule)
- If any found, CRITICAL finding per instance

**1.10 Decorative badge audit**

- "New!" stickers, "Pro" pills, colored status dots beyond functional use
- Border + small text is the only decoration allowed
- Document every non-compliant badge

**Output:** CRITICAL list of every design-rule violation with file:line.

---

### 2. Accessibility (WCAG 2.1 AA) — 15 points

**Goal:** Usable by all users. WCAG 2.1 Level AA compliance on all public
surfaces.

Investigate:

**2.1 Color contrast**

Against page background #eeece8 and surface #faf8f5:
- Body text (#222): high contrast ✓ (>12:1)
- Secondary text (#555): ≈ 7:1 ✓
- Muted text (#999): ≈ 3:1 — borderline for body; OK for large text
- Accent #d97b35 on #eeece8: calculate — likely 3:1, borderline. MAY FAIL
  AA for body text; passes for large text.
- Table headers #aaa on #faf8f5: ≈ 2.5:1 — likely FAILS AA even for large.
  But these are uppercase labels, not prose. Adjudicate.
- Sidebar text #9a9aaa on #1e2028: calculate
- Sidebar active #eee on #1e2028: high contrast ✓

- Use https://webaim.org/resources/contrastchecker/ for every token pair
- Document every failing or borderline pair

**2.2 Keyboard navigation**

- Every interactive element reachable by Tab?
- Focus-visible styles on every focusable element?
  (Next.js default is browser focus ring — verify custom styles don't
  remove outline without replacement)
- Skip-to-content link on dashboard?
- Modals / dialogs: focus trapped? Escape closes?
- Search-as-you-type: results navigable with arrow keys + Enter?

**2.3 Screen reader support**

- Icon-only buttons: aria-label present? (StatusButton, bookmarks, etc.)
- Tables: <th scope="col"> or similar?
- Advisor / dashboard widgets: aria-live="polite" for updates?
- Toast notifications: aria-live="assertive" for errors?
- Route changes: focus management / announcement?
  (Next.js App Router default: scrolls to top, focuses body — verify)

**2.4 Touch targets (mobile)**

- Minimum 44x44 CSS px per WCAG 2.5.5 (Level AAA) / Apple HIG
- Tailwind-merge-small pills may be smaller — verify
- Dense UI can still meet this via padding
- Document touch-target violations per component

**2.5 Text scaling**

- Does the UI handle 200% browser zoom without breaking?
- Fixed-height elements (tables, sidebar) must accommodate larger text

**2.6 Motion**

- Animations minimal (fade-in only in tailwind.config)
- Respect `prefers-reduced-motion`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .animate-fade-in { animation: none; }
  }
  ```
- Currently expected: not honored. Flag as MEDIUM.

**2.7 Form labels**

- Every input has an associated <label> (not just placeholder)
- Error messages linked via aria-describedby
- Required fields marked with aria-required

**2.8 Heading hierarchy**

- One <h1> per page
- No h1 → h4 skips
- Headings describe page structure, not visual weight

**Output:** WCAG 2.1 AA checklist with pass/fail per criterion. Specific
violations with file:line references.

---

### 3. User Flows & Navigation — 15 points

**Goal:** Intuitive navigation. Minimal steps for core tasks.

Investigate:

**3.1 Core user-journey step counts**

Map each critical flow:
- Sign up / sign in: steps
- Onboard (pick providers, initial taste): steps
- Add title to watchlist: steps from dashboard to confirmation
- Mark episode watched: steps within a TV detail page
- Find what to watch tonight (Tillsammans flow): steps
- Get advisor recommendation: steps
- Delete account: steps (also cross-ref 02 for actual deletion)

For each, identify friction points (unnecessary confirmations, redundant
data entry, unclear next steps).

**3.2 Dashboard hierarchy**

CLAUDE.md describes dashboard: Prisjakt-like density. What's above the fold?

Verify:
- What does the dashboard show to a new user (empty state)?
- What does it show to a heavy user (40 följer + 50 watchlist)?
- Does the advisor widget jump / shift content below it?
- Are upcoming cards prioritized above stats?

**3.3 Empty states**

Every list must have a meaningful empty state. Swedish + actionable.

Audit:
- Watchlist empty (new user): "Inga titlar än — sök och lägg till din första"
- Calendar empty: "Inga kommande avsnitt"
- Recommendations empty: "Vi behöver mer data — betygsätt några titlar först"
- Discover with filter: "Inga titlar matchar dina filter"
- Following empty: "Du följer inga serier ännu"
- Search no results: "Hittade inga träffar för '...'"
- Advisor empty (no providers configured): "Lägg till dina streamingtjänster
  i inställningarna"

For each empty state, verify:
- Swedish copy is natural and actionable
- Primary action is obvious
- Visual is not just plain text (small icon / illustration acceptable)

**3.4 Loading states**

- Skeleton UI matching final layout?
- Spinners only for operations < 1s expected? (Skeletons for longer loads)
- Search: typing debounce + loading indicator?
- Advisor: loading state distinct from empty state?

**3.5 Error states**

- User-friendly Swedish error messages (no tech jargon)
- Inline form validation with specific, actionable messages
- Retry mechanism on network errors

**3.6 Navigation patterns**

- Sidebar navigation clarity (labels, active state, 210px constraint)
- Mobile navigation (burger? bottom tab bar? sidebar overlay?)
- Back button behavior (browser back works correctly on all routes?)
- Deep links (can I bookmark /tv/12345 and open directly?)

**3.7 Search UX**

- Search visible from anywhere or only on /search?
- Keyboard shortcut to focus search (Cmd/Ctrl+K)?
- Search results: mixed media types (multi) — clear visual distinction?
- Recent searches / autocomplete?

**Output:** User-journey maps with step counts. Friction points per flow.
Missing loading / empty / error states with file references. Navigation
audit.

---

### 4. Swedish Copy Quality — 15 points

**Goal:** Swedish UI copy that is natural, consistent, and respects the
"Prisjakt for media" positioning (functional, direct, no marketing fluff).

Investigate:

**4.1 Hardcoded strings audit**

All UI strings are hardcoded in JSX (no i18n layer).

- Grep for all user-visible strings in src/components/ and src/app/
- Pattern: Text content between JSX tags, string values in title=, aria-label=,
  placeholder=, tooltip=, error messages
- Classify each string as:
  - Navigation (menu labels, links)
  - Action (button text)
  - Status / label (form labels, table headers)
  - Empty state / info
  - Error / feedback
  - Content / prose

**4.2 Swedish correctness**

- Spelling: any obvious typos? (Tool: manual review, maybe a spellchecker)
- Grammar: consistent Swedish grammar
- Swedish-specific conventions:
  - Decimal separator: comma (99,90 kr) not period
  - Currency: "kr" / "SEK" — which does Binge use? (tailwind config
    doesn't say; tokens check provider prices — they're numbers)
  - Date format: "19 april 2026" or "2026-04-19" (Swedish preference:
    ISO-like YYYY-MM-DD is common technical format; prose uses month name)
  - Time: 24-hour
- Swedish character handling: å, ä, ö rendered correctly everywhere
  (UTF-8 assumed; verify no mojibake in hardcoded strings)

**4.3 Tone consistency**

CLAUDE.md: "Prisjakt for media: dense, functional, data-forward".

- Is the tone consistent? (functional, direct, no exclamations, no
  marketing flourish like "Upptäck magin!" — bad)
- Swedish formality: "du" form throughout (Swedish standard informal) —
  verify no accidental "Ni" forms
- Terminology consistency: "Sedd" vs "Sett" vs "Har sett" — pick ONE
- "Vill se" standardized — check
- "Följer" vs "följer" — case-sensitive choices

**4.4 Pluralization**

Swedish plurals are less irregular than English but still matter:
- 1 avsnitt, 2 avsnitt (same form — easy)
- 1 säsong, 2 säsonger (different — needs conditional)
- 1 film, 2 filmer
- 1 serie, 2 serier

Search for count-dependent strings:
- Grep for `${count}` + a word, verify pluralization handled
- If ICU not installed, is the handling ad-hoc conditional?

**4.5 Date / time / number formatting**

- Search for Date.toLocaleString / toLocaleDateString usage
- Verify locale='sv-SE' is passed
- Relative time strings: "igår", "i förrgår", "för 3 dagar sedan" — ad-hoc?
- Release dates: "Kommer 15 maj" — check conversion from TMDB ISO dates

**4.6 Provider and brand names**

- Provider names: use brand-canonical casing
  - "Netflix" not "netflix"
  - "HBO Max" not "HBO max"
  - "Viaplay" not "ViaPlay"
  - "SVT Play" not "SVTPlay"
- Provider short names (providers.ts) match brand

**4.7 Swedish TMDB fallback**

TMDB's sv-SE data has gaps:
- Some titles have no Swedish synopsis (English used?)
- Some titles have Swedish poster, others only English
- Is the fallback chain predictable and documented? (Cross-ref 07 Dim 3
  for getDisplayTitle — this prompt owns DISPLAY; 07 owns the LOGIC)

**4.8 Error message quality**

Audit every error message:
- Actionable: "Kontrollera internetuppkopplingen och försök igen"
  NOT: "Ett fel inträffade" (vague)
- Swedish: no English slip-through
- Consistent tone (not panicked, not overly apologetic)

**Output:** Hardcoded string inventory with file:line + category. Swedish
correctness findings. Tone consistency audit. Pluralization audit.
Date / number formatting audit. Provider name audit. Error message quality.

---

### 5. Responsive Design — 15 points

**Goal:** Excellent experience on every screen size.

Investigate:

**5.1 Breakpoints**

Tailwind defaults: sm:640, md:768, lg:1024, xl:1280, 2xl:1536.

- Grep for responsive classes: `sm:`, `md:`, `lg:`, `xl:`
- Count how many per component — components without ANY responsive
  modifiers may break on mobile

**5.2 Sidebar on mobile**

- Desktop: 210px fixed sidebar (sidebar-bg)
- Mobile: should collapse / hide, typically behind a hamburger or drawer
- Verify layout.tsx handles mobile
- Is there a bottom navigation bar on mobile? (Common for "table-heavy"
  Prisjakt-style apps)

**5.3 Table vs card views**

WatchlistPage (614 lines) supports table + grid views.
- Is table usable on mobile (horizontal scroll? sticky first column?)
  Or does it switch to card view automatically below a breakpoint?
- Verify switch is ergonomic, not accidental

**5.4 Dense dashboard on mobile**

- Dashboard has multiple widgets (WatchingTable, UpcomingCards, RevivalNudge,
  SubscriptionAdvisorWidget, etc.)
- Stacking order on mobile (most important first)
- Scrolling model (long scroll vs tabs)

**5.5 Form layouts**

- Settings page (493 lines) — multi-column on desktop, single-column on
  mobile
- Provider selection grid — responsive?
- Tier selection — readable on small screens?

**5.6 Interactive elements**

- Touch target sizes (cross-ref 2.4)
- Hover states that don't work on mobile — ensure tap alternatives
- Long-press context menus — iOS Safari behavior

**5.7 Viewport meta tag**

- Verify <meta name="viewport" content="width=device-width, initial-scale=1">
  in app/layout.tsx (Next.js default provides this)
- No user-scalable=no (accessibility anti-pattern)

**5.8 Orientation**

- Portrait vs landscape on phone
- Tablet portrait + landscape
- Desktop window resize: any layout break points?

**Output:** Responsive coverage per page. Mobile-specific issues. Sidebar
collapse strategy. Table → card transitions.

---

### 6. Design-to-Mockup Fidelity — 10 points

**Goal:** Implementation matches the design mockups in mockups/.

Investigate:

**6.1 Mockup coverage**

Mockups exist for:
- 1-landing.html
- 2-dashboard.html
- 3-lists.html
- 4-advisor.html
- 5-patterns.html

For each, compare the mockup's visual to the current implementation:
- Layout structure
- Component sizes and positions
- Spacing (is it the same proportion?)
- Interactive patterns (hover, selected states)

**6.2 Patterns library accuracy**

5-patterns.html is presumably a design-system reference. Verify:
- Every pattern in the mockup exists in the code
- Every implemented component traces back to a pattern (no ad-hoc UI)
- Patterns that should be reused are actually reused (not re-implemented)

**6.3 Mockup staleness**

- When were mockups last updated? (git log mockups/)
- Do they reflect current product scope? (Tillsammans, groups, feed — are
  these in the mockups?)
- If mockups are ahead of implementation: feature backlog
- If mockups are behind: update mockups or document divergence

**Output:** Mockup-to-implementation fidelity matrix. Divergences classified
as "implementation ahead", "mockup ahead", or "bug".

---

### 7. Content & Onboarding Quality — 8 points

**Goal:** New users understand what Binge is and how to use it within
30 seconds of landing.

Investigate:

**7.1 Landing page (if exists) / logged-out experience**

- What does a first-time visitor see?
- Is the value prop clear in Swedish? ("Hantera vad du vill se, vad du
  har sett, och var du kan se det — allt i ett verktyg")
- Call-to-action: obvious sign-up / login button?
- Privacy policy + ToS links in footer?

**7.2 First-run experience (after sign-up)**

- Provider selection: is it onboarded gracefully?
  (Currently settings page — is there a streamlined onboarding flow?)
- Taste calibration (/kalibrera) — timing and purpose
- Ghost / placeholder content to guide the empty dashboard?

**7.3 Tooltip / help coverage**

- Are complex UI elements explained? (What does "Pause" mean in advisor?
  What's "Följer" vs "Vill se" for a movie?)
- Inline help or a help center page?

**7.4 Confirmation / undo**

- Destructive actions confirmed? (Delete watchlist item, leave group)
- Undo available? (Toast with "Ångra"?)

**7.5 Feature discovery**

- Tillsammans (watch-together) — how does a user discover it?
- Groups — same question
- Advisor — is there a promo / tutorial?

**Output:** Landing + onboarding + help coverage assessment. Feature
discovery audit. Destructive action safeguards.

---

## Investigation Process

### Stage 1: Visual & Design Audit (2h)

1. Grep audits (forbidden classes, colors, font sizes, emoji)
2. Tailwind config cross-check against CLAUDE.md
3. Global CSS review (globals.css)
4. Component inventory (src/components/) — is there a consistent pattern?

### Stage 2: Mockup Comparison (1.5h)

5. Open each mockups/ HTML and compare to current implementation
6. Document fidelity matrix
7. Note mockup-vs-product staleness

### Stage 3: Accessibility Audit (2h)

8. Color contrast calculations
9. Keyboard navigation walk-through (spot-check 5 critical flows)
10. Screen reader spot-check (VoiceOver / NVDA simulation)
11. Touch target audit
12. Motion + reduced-motion audit

### Stage 4: Flow & Copy Audit (2h)

13. Walk core user journeys
14. Empty / loading / error state coverage
15. Swedish string audit (copy, tone, grammar, dates, numbers)
16. Tooltip / help coverage

### Stage 5: Responsive Audit (1h)

17. Breakpoint coverage per page
18. Sidebar mobile behavior
19. Table → card transitions
20. Form layouts on mobile

### Stage 6: Report Compilation (1h)

21. Score each dimension
22. Compile findings with file:line references
23. Classify by severity (CRITICAL / HIGH / MEDIUM / LOW)
24. Overall score out of 100

---

## Output Format

### Executive Summary

```
BINGE UX, DESIGN & i18n ANALYSIS — PHASE 1 FINDINGS
======================================================
Analysis Date: [Date]
Analyst: Claude (Opus 4.7)
Platform: Web (desktop + mobile)
Language: Swedish (sole supported language)

OVERALL UX SCORE: X/100

  1. Design System & CLAUDE.md Compliance:  X/22
  2. Accessibility (WCAG 2.1 AA):           X/15
  3. User Flows & Navigation:               X/15
  4. Swedish Copy Quality:                  X/15
  5. Responsive Design:                     X/15
  6. Design-to-Mockup Fidelity:             X/10
  7. Content & Onboarding Quality:          X/8

STATUS: [Excellent | Good | Needs Improvement | Critical Issues]

CRITICAL issues: X found  (design-rule violations from CLAUDE.md)
HIGH issues:     X found
MEDIUM issues:   X found
LOW issues:      X found

TOP 5 UX RISKS:
1. [Description]
2. [Description]
3. [Description]
4. [Description]
5. [Description]
```

### Per-Dimension Report

For each dimension:
- 2–3 sentence summary
- Issues grouped by severity (CRITICAL / HIGH / MEDIUM / LOW)
- Each issue: title, file:line, user impact, current vs expected, effort
- Quick wins list at the end

### Specialized Sections

- **CLAUDE.md compliance scorecard:** rule × pass/fail × violations
- **Accessibility scorecard:** WCAG 2.1 AA criterion × pass/fail
- **Color contrast table:** token pair × ratio × AA pass/fail
- **Hardcoded string inventory:** by category × count × sample
- **Responsive coverage matrix:** page × breakpoint × pass/fail
- **Mockup fidelity matrix:** mockup × implementation-status × divergence
- **User journey maps:** flow × steps × friction points

### Improvement Roadmap

- **Sprint 1**: CRITICAL design-rule violations, WCAG failures, broken flows
- **Sprint 2**: Accessibility gaps, Swedish copy polish
- **Sprint 3**: Responsive issues, mockup drift
- **Backlog**: Nice-to-have, advanced features

---

## Scoring Guide

| Score | Rating | Interpretation |
|-------|--------|----------------|
| 90–100 | Excellent | Minor polish. Design-system rigor maintained. |
| 75–89 | Good | Targeted improvements, no urgency. |
| 60–74 | Acceptable | Prioritized remediation within 2 sprints. |
| 40–59 | Needs Work | Significant remediation required. |
| 0–39 | Critical | UX fundamentals broken. CLAUDE.md violations. |

### Per-Dimension Scoring Criteria

| Dimension | Top Tier (85%+) | Mid (50–84%) | Low (<50%) |
|-----------|-----------------|--------------|------------|
| CLAUDE.md Compliance (22) | Zero violations, token system respected | Few violations | Widespread violations |
| Accessibility (15) | WCAG 2.1 AA pass | Most criteria pass | Major barriers |
| Flows (15) | Core < 5 steps, complete states | Reasonable flows | Broken states |
| Swedish Copy (15) | Natural tone, consistent, correct | Some inconsistencies | Marketing-speak or errors |
| Responsive (15) | All pages mobile-usable | Most, some broken | Desktop-only |
| Mockup Fidelity (10) | Implementation matches | Minor drift | Major divergence |
| Onboarding (8) | Clear first-run, good empty states | OK | Confusing |

---

## Phase 1 Completion Checklist

Investigation and documentation only. No code or design changes.

- [ ] CLAUDE.md rule compliance audit (every rule × pass/fail)
- [ ] Forbidden-class grep audit (box-shadow, gradients, rounded-lg, emoji)
- [ ] Color contrast calculations for every token pair
- [ ] Accessibility WCAG 2.1 AA checklist
- [ ] User flow maps for critical tasks
- [ ] Empty / loading / error state coverage per page
- [ ] Hardcoded Swedish string inventory
- [ ] Swedish copy tone + grammar audit
- [ ] Pluralization audit
- [ ] Date / number / currency formatting audit
- [ ] Responsive breakpoint coverage per page
- [ ] Mobile sidebar behavior audit
- [ ] Mockup-to-implementation fidelity matrix
- [ ] Landing / onboarding / help coverage
- [ ] All issues classified by severity with effort estimates
- [ ] Overall score calculated (X/100)
- [ ] ZERO code changes made

**Phase 1 output:** Comprehensive UX, design, and i18n findings report.
**Phase 2 input:** Use this report to create the prioritized improvement plan.
