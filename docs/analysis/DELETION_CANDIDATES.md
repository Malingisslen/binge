# Raderbara filer — granskningsrapport

> Genererad 2026-05-30. **Inget har raderats.** Detta är en granskningslista.
> Metod: `git ls-files`-inventering + referenssökning (ripgrep) + manuell verifiering
> av varje hög/medel-kandidat. Vid osäkerhet → låg säkerhet.

## Sammanfattning

- **371** trackade filer. `src/` = 283 (app-kod), resten är docs (31),
  design-files (20), public (5), functions (5), scripts (3), config (~20 i roten).
- **Ingen uppenbar skräp** (`.bak`/`.tmp`/`.orig`/`~`/`.DS_Store`/dubbletter): 0 träffar.
- **Ingen bekräftad död kod i `src/`.** En basename-import-heuristik flaggade 10
  filer (`*PageClient.tsx`, `sitemap.ts`, `dataExport.ts`, `assertNever.ts`,
  `DuotonePoster.tsx`) — men **alla 10 visade sig användas** via `DynamicRouter`-
  dispatch eller Next.js-filkonventioner. Inga av dem är kandidater.
- Alla verkliga kandidater ligger **utanför `src/`**: historiska specar,
  design-utforskningar och engångs-scripts. Eftersom det är läsbara artefakter
  (inte `import`-ad kod) är "oreferererad" svag signal → mest **låg** säkerhet.

---

## Kandidater per kategori (sorterat på säkerhet)

### Skräp
*Inga.* Repot är rent — inga backup-/temp-/orig-filer, inga namngivna dubbletter.

### Död config
*Inga bekräftade.* Alla config-filer i roten (`tsconfig`, `eslint.config.mjs`,
`next.config.mjs`, `postcss.config.mjs`, `tailwind.config.ts`, `vitest.*`,
`firebase.json`, `.firebaserc`, `firestore.*`) används av sina respektive verktyg.
Inga dubbla configs (en enda eslint/tsconfig).

### Oanvänd asset

| Fil | Skäl | Säkerhet |
|-----|------|----------|
| `design-files/screenshots/v1-per-serie.png` | Designutforsknings-screenshot, ej refererad i kod/docs. Ren referensbild. | **medel** |
| `design-files/screenshots/v2-veckokort.png` | Som ovan. | **medel** |
| `design-files/screenshots/v3-enkellinje.png` | Som ovan. | **medel** |
| `design-files/screenshots/v4-visuell.png` | Som ovan. | **medel** |
| `design-files/favicon-options/concept-1..5.svg` (5 st) | Favicon-koncept; vald favicon bor i `src/app/icon.svg`. Konceptutkast. | **medel** |

*Behåll (ej kandidat):* `public/og-image.svg` (refereras 8 ggr — layout, JsonLd,
movie/tv/person-metadata, FCM-sw), `public/tmdb-logo.svg`, `public/robots.txt`,
`public/llms.txt`, `src/app/icon.svg`, `src/app/apple-icon.png`.

### Stale / dubblerad dokumentation

| Fil | Skäl | Säkerhet |
|-----|------|----------|
| `design-files/direction-h-*.html` (7 st) + `direction-h.css` | "Direction H"-designutforskning (statiska mockups). `binge-v2.html` är den valda referensen (länkas från CLAUDE.md + AGENTS.md). Direction-H är ej länkad. | **medel** |
| `design-files/savings-versions.html` | Designvariant-mockup, ej länkad. | **medel** |
| `design-files/favicon-options/preview.html` | Preview-sida för favicon-koncepten ovan. | **medel** |
| `binge-spec-en.md` | Ursprunglig engelsk spec, rörd **endast i initial commit** (2026-03-27), aldrig sedan. Oreferererad. Ersatt av CLAUDE.md + `binge-v2.html`. | **medel** |
| `docs/analysis/prompts/` (13 filer) | Engångs-analyssystem (12 promptfiler + orchestrator + META_GENERATOR) från april. Genererade rapporterna är redan destillerade till `REMEDIATION_PLAN.md`/`FUTURE_ROADMAP.md`. | **låg** |
| `docs/analysis/SPRINT_7_PLAN.md` | Sprintplan; ej länkad från CLAUDE.md (där 1–4+ nämns). Kan vara aktuell. | **låg** |
| `docs/superpowers/plans/2026-04-25-recommendations-redesign.md` | Engångs-plan-artefakt (superpowers), endast självreferens. | **låg** |
| `docs/superpowers/specs/2026-04-25-recommendations-redesign.md` | Tillhörande spec-artefakt. | **låg** |
| `docs/ai-optimering.md` | Oreferererad kunskapsdoc. | **låg** |
| `docs/provider-catalog-audit.md` | Oreferererad audit-doc. | **låg** |
| `docs/advisor-logic.md` | Oreferererad (men beskriver levande advisor-logik). | **låg** |
| `docs/tillsammans-roadmap.md` | Oreferererad roadmap-doc. | **låg** |
| `docs/SLO.md`, `docs/voice-and-tone.md`, `docs/push-notifications-setup.md`, `docs/retention-cleanup-design.md` | Oreferererade kunskapsdocs — läses av människor, inte importeras. Svag radera-signal. | **låg** |

*Behåll (länkade från CLAUDE.md/AGENTS.md):* `RUNBOOK.md`, `moderation.md`,
`data-export-format.md`, `data-retention-policy.md`,
`analysis/REMEDIATION_PLAN.md`, `analysis/FUTURE_ROADMAP.md`,
`analysis/EXTERNAL_ACTIONS.md`. `binge-v2.html` (visuell referens — länkad).

### "Död" kod (engångs-scripts)

| Fil | Skäl | Säkerhet |
|-----|------|----------|
| `scripts/gen-apple-icon.mjs` | Engångsgenerator som producerade `src/app/apple-icon.png` (redan committad). Ej i `package.json`, oreferererad. Behövs bara vid ny rebranding. | **låg** |

*Behåll:* `scripts/serve-spa.mjs` (refereras i `.gitignore` som del av Lighthouse-
audit-flödet), `scripts/test-rules.mjs` (används av `npm run test:rules`).

---

## Rekommendation

Säkrast att börja med (om något ska bort): **design-utforskningarna** —
`design-files/direction-h-*`, `savings-versions.html`, `favicon-options/`,
`screenshots/` — och `binge-spec-en.md`. Dessa är rena historiska artefakter vars
syfte är uppfyllt. Allt under `docs/` är låg säkerhet eftersom det är
människoläsbar kunskap; "oreferererad" betyder inte oanvänd för dokumentation.

**`src/` ska lämnas orört** — ingen bekräftad död kod hittades.
