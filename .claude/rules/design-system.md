---
paths:
  - "src/**"
  - "*.css"
  - "tailwind.config.ts"
---

# Design Constraints

Direction H · "Schemat" — den shippade designen. Se `globals.css :root` och
`tailwind.config.ts` för alla tokens. Referens: `docs/design_handoff_direction_h_schemat/`.

## Layout

Sticky, horisontell toppkrom — **ingen sidebar**:
- `AppTopbar` (brand-logotyp · WeekStrip · sökfält · avatar) — `position: sticky; top: 0; z-index: 30`
- `Subnav` (Hem · Bibliotek · Kalender · Rekommendationer · Streamingrådgivaren · Vänner · Grupper) — horisontell länkrad direkt under topbar
- Huvudinnehållet i `.canvas` — `max-width: 1320px`, `margin: 0 auto`, `padding: 32px 40px 48px`
- Mobil: `MobileTabBar` (5-tabs, `position: fixed; bottom: 0`) ersätter subnav på smala skärmar

## Typografi

- **Basteckenstorlek:** `15px` på `html, body`
- **Sans:** Albert Sans (primär) → `system-ui, -apple-system, Segoe UI, sans-serif` som fallback
- **Mono:** `--mono` är alias för `--sans` — monospace-typsnittet (JetBrains Mono) fasas ut. Koda inte nytt med `font-mono`/`var(--mono)` — städas bort mekaniskt
- **Täthetskänsla:** verktyg, inte marknadsföringssida. Håll textstorlekar och marginaler kompakta

## Färgsystem

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

## Skuggor och djup

Exakt två tillåtna skuggor (definierade i `tailwind.config.ts`):
- `shadow-lift` — `0 4px 14px oklch(0 0 0 / 0.06)` — kort hover
- `shadow-pop` — `0 2px 8px oklch(0 0 0 / 0.04)` — popover

Allt annat är platt. Inga `drop-shadow`-, `filter: blur`- eller godtyckliga box-shadow-värden.

## Kantradie

- `rounded-sm` = 3px, `rounded` / `rounded-md` = 6px, `rounded-lg` = 8px
- Poster-thumbnails: 3px. Knappar: 6px. Modaler/kort: 6-8px. Aldrig mer än 8px.

## Posters och duotone

Posters renderas med per-genre duotone-filter via SVG-defs (`DuotoneFilters`, monteras en gång i `AppShell`). Åtta färgscheman: `duo-terra`, `duo-slate`, `duo-moss`, `duo-clay`, `duo-plum`, `duo-steel`, `duo-olive`, `duo-oxblood`.

- Hover på poster → `filter: none` (avslöjar original-bitmap) (momentant — SVG-filter→none kan inte interpoleras, så ingen transition).
- Hover på filmkort → `translateY(-2px)` på `.poster`. Denna transform är **avsiktlig** — den gamla "inget transform/scale på hover"-regeln gäller inte längre.

## Bygg en ny vy — kanonisk recept

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

## Generella designregler

- **Ser inte AI-genererat ut.** Inga runda kort med stora skuggor, inga dekorativa gradienter, inga emojis i UI, inga dekorativa badges
- **Ingen `next/image`** — static export har ingen bildoptimering. Alla `<img>` har explicit `width`/`height` för CLS + `loading="lazy"` + `decoding="async"`
- **TMDB-attribution krävs** — _"This product uses the TMDB API but is not endorsed or certified by TMDB"_ — konstanter i `src/lib/tmdb/attribution.ts`
- **Svenskt UI** — all användargränssnittstext på svenska
- **Ikoner:** `lucide-react`, alltid named imports inline (`import { Play } from 'lucide-react'`) och små — ingen sprite, ingen ikon-wrapper-komponent
