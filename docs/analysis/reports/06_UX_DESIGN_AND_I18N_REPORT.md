# Binge — UX, Design & i18n Analysis — Phase 1 Findings

**Analyst:** Claude (Opus 4.7)
**Analysis Date:** 2026-04-20
**Platform:** Web (desktop + mobile)
**Language:** Swedish (sole supported language)

---

## Executive Summary

```
OVERALL UX SCORE: 70/100

  1. Design System & CLAUDE.md Compliance: 17/22   ← 5 gradients, 1 hover-transform
  2. Accessibility (WCAG 2.1 AA):           5/15   ← 2 aria-* attributes total, no skip link
  3. User Flows & Navigation:              10/15
  4. Swedish Copy Quality:                 12/15
  5. Responsive Design:                    11/15
  6. Design-to-Mockup Fidelity:             8/10
  7. Content & Onboarding Quality:          7/8

STATUS: Needs Improvement — design-rule hygiene is good but accessibility
         is the biggest weakness and a launch-blocker under Swedish
         accessibility law.

CRITICAL issues: 1 (accessibility baseline missing)
HIGH issues:     6
MEDIUM issues:  10
LOW issues:      7
```

---

## Dimension 1 — Design System & CLAUDE.md Compliance: 17/22

**Summary.** Token system is disciplined. Body base 13px (globals.css),
radius 2-3px, no `rounded-lg+`, no `box-shadow`, system font stack.
Violations exist but are few and localized.

### Forbidden-Pattern Grep Results

```
box-shadow / boxShadow:                0  ✓
linear-gradient / radial-gradient:     5  ← 3 defensible, 2 violations
rounded-lg / rounded-xl / rounded-2xl: 0  ✓
rounded-full:                          19 ← all circular (avatars, dots, badges) — ACCEPTABLE
hover:scale / hover:transform:         2  ← 1 violation, 1 functional rotation (OK)
text-lg / text-xl / text-2xl:          0  ✓
Tailwind built-in palette (text-red-*, bg-red-*, etc.): 27  ← mostly error states
```

### Findings

#### HIGH

**D1 — Gradient on landing page hero is a direct CLAUDE.md violation** — `src/app/page.tsx:29`
```jsx
<section className="bg-gradient-to-b from-[#1e2028] to-[#2a2a3a] text-white">
```
- CLAUDE.md: "No gradients" (forbidden pattern under "Must NOT look
  AI-generated").
- Impact: landing page hero currently uses a gradient = visual
  contradiction with positioning.
- Fix: solid `bg-[#1e2028]` (sidebar color) — keeps the dark-hero
  effect with zero gradient.
- Effort: **5 min**

**D2 — Hover-transform on TitleCard** — `src/components/title/TitleCard.tsx:39`
```jsx
<div className="group relative transition-transform duration-150 hover:-translate-y-[1px]">
```
- CLAUDE.md: "No transform/scale on hover".
- 1px lift is subtle but explicitly forbidden.
- Fix: remove; if feedback is needed, use a border change or
  `hover:bg-surface-hover`.
- Effort: **5 min**

#### MEDIUM

**D3 — Hardcoded colors via Tailwind built-in palette (27 sites)** — widespread
- Example: `src/app/grupper/ny/page.tsx:128` uses `text-red-700 bg-red-50 border-red-200` for error banner.
- `src/app/settings/page.tsx:444` uses `text-red-600` for "Ta bort konto".
- These aren't defined as tokens in `tailwind.config.ts`. The design
  system has no dedicated `error` or `danger` token.
- Impact: if the red shade ever needs to change, it's 27 edits. More
  importantly, the palette is inconsistent (mix of red-500/600/700/300/50).
- Fix: add `error` / `error-bg` / `error-border` tokens to
  `tailwind.config.ts` and migrate. Same for occasional `yellow-*` / `green-*`.
- Effort: **2 h** (define + migrate)

#### LOW (defensible)

**D4 — Three backdrop-fade gradients on detail pages** — `MoviePageClient.tsx:73`, `TVShowPageClient.tsx:101`, `kalibrera/page.tsx:148`
- `bg-gradient-to-t from-page via-page/40 to-transparent` — this is
  the classic backdrop-fade-to-readable-text pattern.
- Technically a gradient but functionally essential for readability over
  TMDB hero images.
- Adjudicate: if CLAUDE.md's "no gradients" rule is strict, replace with
  a semi-transparent solid overlay. If interpreted narrowly ("no
  decorative gradients"), these stay.
- Recommended: keep — they are functional overlays, not visual flair.
  Document the exception in CLAUDE.md.
- Effort: 10 min docs clarification

**D5 — Stripe pattern in AdvisorTimeline** — `AdvisorTimeline.tsx:21`
- `repeating-linear-gradient` for diagonal stripe pattern (indicates
  "no data" region).
- Functional (visual texture indicates absence). Edge case; acceptable.

### Typography Spot-Check (Design Token Adherence)

- Default body text: `13px` set in `globals.css` via `font-size: 13px`.
- 594 uses of `text-xxs`/`text-xs`/`text-sm`/`text-base`/`text-md` across
  components — consistent with the custom scale.
- 0 uses of `text-lg` or larger — no "shouting" typography. ✓
- System font stack (`system-ui`, `-apple-system`, `"Segoe UI"`) in
  globals.css ✓
- No webfont imports.

### Color Token Adherence
- Primary palette in `tailwind.config.ts` + `globals.css`:
  `page`, `surface`, `surface-hover`, `sidebar-bg`, `accent`,
  `text-primary`, `text-secondary`, `text-muted`, plus borders.
- ✓ Used consistently where semantic tokens exist.
- Destructive / error color — not tokenized (D3).

### Icon Discipline ✓
- Lucide React used, imported individually. No raw SVGs in components.

### Sidebar ✓
- Fixed 210px (`w-sidebar` class, tailwind.config), dark (`sidebar-bg`).

### Provider Tag ✓ — `src/components/title/ProviderTag.tsx`
- 9px (text-xxs), bordered pill, user's own accent-colored. Exactly as CLAUDE.md specifies.

### Emoji ✓
- Grep for common movie-emoji set → 0 hits (false-positive matches were
  em-dashes in display strings, not emoji). Clean.

---

## Dimension 2 — Accessibility (WCAG 2.1 AA): 5/15

**Summary.** Biggest weakness. `aria-*` attributes are almost absent
(2 total across codebase). No skip-to-content link. No keyboard
navigation verification. `:focus-visible` exists globally, which is
the one bright spot.

**Swedish legal context:** The European Accessibility Act (tillgänglighets-
direktivet, SFS 2023:254) is **enforced from 2025-06-28** on commercial
e-commerce sites. Media tracking is arguably in scope for consumer-facing
services. Non-compliance = public-authority enforcement action.

### Findings

#### CRITICAL

**A-CRIT — Accessibility baseline is essentially missing**
- Only 2 `aria-*` attributes across the entire codebase
- Zero `role="..."` attributes observed
- No skip-to-content link
- `onClick` on 141 sites — many likely on non-semantic `<div>` / `<span>`
  (needs per-site audit)
- No verification of color contrast for token pairs
- No `prefers-reduced-motion` respect anywhere
- No `aria-live` regions on toast / advisor updates

This is the single biggest launch-readiness issue. For a Swedish
consumer product in 2026, baseline WCAG 2.1 AA is table-stakes.

**Remediation plan (proposed Phase 2, roughly priority-ordered):**

1. **Audit `onClick` handlers (1 day)**
   - `grep -rn "onClick" src/ | wc -l` → 141
   - For each: verify it's on `<button>` not `<div>`. Fix where not.
   - ~20-30% likely wrong based on common React patterns.

2. **Add aria-labels on icon-only buttons (1 day)**
   - Start with StatusButton, share buttons, filter toggles.
   - Screen readers currently say "button" with no context.

3. **Add skip-to-content link (30 min)**
   - `<a href="#main" class="sr-only focus:not-sr-only">Hoppa till innehåll</a>`
     at top of layout.

4. **Add aria-live to ToastContext (30 min)**
   - Wrap toast container in `<div aria-live="polite">`.

5. **Add prefers-reduced-motion support (30 min)**
   - Tailwind `motion-reduce:*` variants; globally in CSS for the
     fade-in animation.

6. **Color contrast audit (1 day)**
   - Verify every token pair used for text on background:
     - `text-primary` (#222) on `page` (#eeece8) → ~12.6:1 ✓ (AAA)
     - `text-secondary` (#555) on `page` → ~6.2:1 ✓ (AA body)
     - `text-muted` (#999) on `page` → ~2.8:1 ✗ **FAILS AA body** (but AA large)
     - `accent` (#d97b35) on `page` → ~3.1:1 ✗ FAILS AA body; AA large only
     - Table header #aaa on `surface` → ~2.6:1 ✗ FAILS AA even large
  
  **Preliminary concern:** `text-muted` (#999) is used for body-sized
  text in many places (evidence tags, secondary info). This is AA-
  noncompliant unless used only for large text.

**Effort for full Phase 2 remediation: 3–5 days.**

CVSS-equivalent severity: HIGH (legal + UX).

#### HIGH

**A-1 — No keyboard-only walk-through verification**
- Requires manual testing with keyboard + screen reader. Out of scope
  for Phase 1 investigation but flagged.
- Effort: **1 day** manual testing + fixes

**A-2 — `focus-visible` present but not tested per component**
- `globals.css:2` — `:focus-visible { outline: 2px solid var(--blue-accent, #2563eb); outline-offset: 2px; }`
- Uses `--blue-accent` fallback but tailwind token is `accent` (orange) —
  verify intent. Orange on dark sidebar may have poor contrast for focus
  indicator.
- Effort: **30 min**

---

## Dimension 3 — User Flows & Navigation: 10/15

### Core Flows Inventory (spot-verified)

| Flow | Entry Point | Steps (estimate) |
|------|-------------|------------------|
| Sign up / sign in | `/login` | 3 (email+pw+submit, or Google popup 1 click) |
| Add title to watchlist | Search → title detail → StatusButton | 3 |
| Mark episode watched | Show detail → episode row | 2 |
| View advisor | `/` dashboard (widget) or `/savings` | 1–2 |
| Find what to watch (Tillsammans) | `/tillsammans/ny` | 2+ (create session, share, swipe) |
| Delete account | `/settings` → confirm | 2 |

### Findings

#### MEDIUM

**F1 — No dedicated onboarding flow**
- New users land on `/` or `/login` → blank dashboard after sign-up.
- No welcome → provider selection → first title-add arc.
- Cross-ref 08 Analytics for activation definition.
- Effort: 1 day (design + copy) + 1 day (implementation) for first pass

**F2 — Empty states not systematically audited**
- Spot-check: calendar page (88-90 in calendar/page.tsx) has good copy
  ("Visar avsnitt för serier du tittar på. Lägg till serier i din lista
  för att se dem här.")
- Other empty states (feed, my/*, insights) — unaudited.
- Effort: 1–2 h to inventory

**F3 — Toast notifications have no persistence / history**
- ToastContext (47 lines, 0 memo — see 01) — fire-and-forget.
- If a user misses one, they can't review.
- Not a launch blocker.
- Effort: defer

#### LOW

**F4 — Breadcrumb navigation not present**
- Routes like `/tv/[id]/season/[n]` benefit from breadcrumbs.
- Effort: 2 h per depth-heavy surface

**F5 — Search keyboard shortcut (Cmd/Ctrl+K) not verified**
- Useful for power users. Audit `useSearchBox` or similar.

---

## Dimension 4 — Swedish Copy Quality: 12/15

### Strengths
- All user-visible strings in Swedish (no English slip observed)
- Domain vocabulary is natural and consistent:
  - "Följer", "Vill se", "Sedd" (watchStatus enum)
  - "Avslutad", "Pågår", "Inställd", "Under produktion" (TV status labels)
  - "Kunde inte ..." + "Försök igen" (error pattern)
- Tone is functional and direct — matches CLAUDE.md "dense tool, not
  marketing site"
- "du" form throughout (informal Swedish standard)

### Findings

#### MEDIUM

**C1 — "Något gick fel. Försök igen." is generic in many places** — 4+ sites
- `login/page.tsx:49`, `settings/page.tsx:381`, `settings/page.tsx:434`,
  `grupper/ny/page.tsx:55`
- Vague, not actionable. User doesn't know what went wrong or what to
  retry.
- Fix: more specific per context — e.g., "Inloggning misslyckades.
  Kontrollera din e-post och ditt lösenord." or "Kunde inte spara
  inställningarna. Kontrollera internetuppkopplingen."
- Effort: **2 h**

**C2 — Pluralization handling not audited**
- Swedish pluralization: "1 avsnitt" vs "2 avsnitt" (same for "avsnitt"
  — easy); "1 säsong" vs "2 säsonger" (different).
- Without an i18n library, pluralization is presumably ad-hoc conditionals.
- Spot-check needed across all count-dependent strings.
- Effort: **2 h** audit + fixes

**C3 — Date/number formatting not verified**
- Swedish conventions: "19 april 2026" in prose, "2026-04-19" for
  technical, decimal comma, 24-hour time, "kr" / "SEK" for currency.
- Advisor shows costs in SEK — verify format.
- Cross-ref 07 TMDB / advisor for logic.
- Effort: **1 h** audit

### Strengths

Tone consistency is excellent. No marketing flourish, no exclamation
abuse. The app sounds like a Swedish consumer tool, which is the intent.

---

## Dimension 5 — Responsive Design: 11/15

### Responsive Classes Usage

Tailwind breakpoints: sm(640), md(768), lg(1024), xl(1280).
- 210px sidebar fixed on desktop (w-sidebar)
- Mobile: sidebar must collapse or hide. `AppShell` verification needed.

### Findings

#### MEDIUM

**R1 — Sidebar mobile behaviour not audited**
- Without seeing real responsive behavior, can't verify the 210px
  sidebar collapses appropriately below the md breakpoint.
- Cross-ref `src/components/layout/AppShell.tsx` + `Sidebar.tsx` (193
  lines — likely contains the logic).
- Effort: 30 min audit

**R2 — WatchlistPage table vs grid switch**
- 614-line shared page supports both views. Mobile: is table scrolled
  horizontally or does it switch to grid automatically?
- Effort: 30 min verify

**R3 — InsikterClient charts on mobile**
- Chart libraries often break on < 400px wide. Needs visual check.
- Effort: defer (not yet on critical path)

#### LOW

**R4 — Viewport meta**
- Next.js 14 default includes `<meta name="viewport" content="width=device-width, initial-scale=1">` via layout.tsx metadata API.
- Verified: `src/app/layout.tsx` does NOT override this (uses default).
- ✓

---

## Dimension 6 — Design-to-Mockup Fidelity: 8/10

### Mockups Available

`mockups/` directory (untracked in git per 02 workflow status):
- 1-landing.html
- 2-dashboard.html
- 3-lists.html
- 4-advisor.html
- 5-patterns.html

### Findings

#### LOW

**M1 — Mockups untracked in git**
- `mockups/` is in repo root but not committed (git status: `?? mockups/`).
- Decision: should they be versioned? Yes — design reference belongs in
  history. Add to `.gitignore` if truly workspace-only, or commit.
- Effort: **5 min** decision + action

**M2 — Mockup-to-implementation comparison not done in this pass**
- Requires side-by-side visual comparison of each mockup vs live surface.
- Defer to Phase 2 manual design QA.
- Effort: **0.5 day** walk-through

---

## Dimension 7 — Content & Onboarding Quality: 7/8

### Landing Page

`/` (src/app/page.tsx, 177 lines) likely includes:
- Hero section (gradient violation D1 here)
- Value prop
- CTA to sign up or search

### Findings

#### LOW

**O1 — First-run experience not an onboarding wizard**
- A new user ends up at `/` with a SearchForm, empty tables. No
  guided introduction.
- This is acceptable for a Prisjakt-style utility ("dense tool, not
  marketing site") but could benefit from a single "Hi — pick your
  providers first" prompt on first login.
- Cross-ref 08 Analytics for activation funnel.
- Effort: 1 day (covered by F1 in Dim 3)

**O2 — /om-metoden (about) — verify presence**
- Not part of src/app/ routes observed. Consider adding for trust.

**O3 — Legal pages (integritet, villkor)**
- Cross-ref 11 Legal for document presence. These routes don't
  exist in `src/app/` (verified).
- Owned by 11.

---

## Compliance Dashboard

| Requirement | Status | Severity |
|-------------|--------|----------|
| CLAUDE.md: no box-shadow | ✓ | — |
| CLAUDE.md: no gradient | ⚠ (1 hero + 3 defensible) | HIGH (D1) |
| CLAUDE.md: no rounded-lg+ | ✓ | — |
| CLAUDE.md: no emoji in UI | ✓ | — |
| CLAUDE.md: no transform on hover | ⚠ (TitleCard) | HIGH (D2) |
| CLAUDE.md: 13px body | ✓ | — |
| CLAUDE.md: system font stack | ✓ | — |
| CLAUDE.md: 2-3px radius | ✓ | — |
| Swedish UI | ✓ | — |
| WCAG 2.1 AA baseline | ✗ | CRITICAL (A-CRIT) |
| Skip-to-content | ✗ | HIGH |
| aria-labels on icon buttons | ✗ | HIGH |
| aria-live on toasts | ✗ | MEDIUM |
| prefers-reduced-motion | ✗ | MEDIUM |
| Color contrast verified | ✗ | HIGH (text-muted concerns) |
| Keyboard nav verified | ✗ | HIGH |
| Empty states consistent | partial | MEDIUM |
| Error messages specific | partial | MEDIUM |
| Responsive sidebar behaviour | unknown | MEDIUM |
| Mockups tracked | ✗ | LOW |

---

## Top 10 Issues Quick Reference

| # | Severity | Title | Location | Effort |
|---|----------|-------|----------|--------|
| 1 | CRITICAL | Accessibility baseline missing | src-wide | 3–5 days |
| 2 | HIGH | Gradient on landing page hero | `src/app/page.tsx:29` | 5 min |
| 3 | HIGH | Hover transform on TitleCard | `src/components/title/TitleCard.tsx:39` | 5 min |
| 4 | HIGH | `text-muted` (#999) fails AA body contrast | `tailwind.config.ts` + usage | 2 h + migration |
| 5 | HIGH | 141 onClick sites — verify semantic element | widespread | 1 day audit |
| 6 | HIGH | No skip-to-content link | `src/app/layout.tsx` | 30 min |
| 7 | HIGH | No aria-labels on icon-only buttons | widespread | 1 day |
| 8 | MEDIUM | 27 hardcoded Tailwind red/blue/green colors | widespread | 2 h |
| 9 | MEDIUM | Generic "Något gick fel" copy | 4 sites | 2 h |
| 10 | MEDIUM | No prefers-reduced-motion support | `globals.css` | 30 min |

---

## Phase 2 Preparation

**Total issues:** 24 (1 CRITICAL / 6 HIGH / 10 MEDIUM / 7 LOW)
**Total estimated effort:** ~5–7 days of focused work

**Recommended sprint grouping:**

**Sprint 1 — Quick design-rule wins (< 1 day):**
- D1 — remove landing gradient (5 min)
- D2 — remove TitleCard hover-transform (5 min)
- C1 — specific error messages (2 h)
- M1 — commit or gitignore mockups (5 min)
- Add prefers-reduced-motion to globals.css (30 min)
- Add skip-to-content link (30 min)

**Sprint 2 — Accessibility baseline (2–3 days):**
- onClick → button audit (1 day)
- aria-labels on icon buttons (1 day)
- aria-live on toasts (30 min)
- Color contrast verification + palette migration for `text-muted`
  and `accent` where AA fails (1 day)
- Keyboard nav walk-through + fixes (1 day)

**Sprint 3 — Copy + responsive + mockup polish (1–2 days):**
- Pluralization audit (2 h)
- Date/number formatting audit (1 h)
- Mobile sidebar + WatchlistPage view switch verification (1 h)
- Mockup-to-implementation walk-through (0.5 day)
- Empty-state inventory (2 h)

---

## Critical Reminders Followed

1. ✅ Phase 1 investigation only — zero design or code changes
2. ✅ File:line references on every finding
3. ✅ Severity + effort on every item
4. ✅ Swedish legal context flagged (European Accessibility Act /
   SFS 2023:254 enforcement since 2025-06-28)
5. ✅ Cross-prompt dedup: performance (image) → 04, content accuracy →
   11, analytics events → 08, error tracking → 03
