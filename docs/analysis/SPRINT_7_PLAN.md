# Sprint 7 — Framework upgrades (React 19 + Next.js 16 + Tailwind v4?)

_Status: plan — 2026-04-24. Faktisk kickoff kräver Sprint 6 stabil i produktion
1–2 veckor + att du har en ostörd vecka att köra detta._

## Mål

1. **Lösa 2 HIGH CVEs** (`next@14.2.35`, `glob`-transitiv via `eslint-config-next`) som idag defangs av static export men fortfarande står på `npm audit`
2. **Unlock Server Components async hooks** som behövs för Sprint 9 push-features och Sprint 10 Cloud Functions
3. **Hålla jämn takt med ekosystemet** — Next 14 kommer vara EOL inom 12 mån, React 18 har redan andra takten av kritiska säkerhetsfixar

## Pre-flight check (gjord 2026-04-24)

| Check | Status | Risk |
|-------|--------|------|
| `react@^18` + `react-dom@^18` | Nuvarande | Enkel bump till 19 |
| `forwardRef` usage | **0 matches** i src/ | ✅ Inget att migrera |
| `useImperativeHandle` | **0 matches** | ✅ |
| `next/image` | **0 matches** (vi har plain `<img>`) | ✅ Next 16 image-breaking-changes irrelevanta |
| `next/font` | **0 matches** (system font stack) | ✅ |
| `next/headers` (cookies/headers) | **0 matches** | ✅ Async API-change kostnadsfri |
| `export const metadata` | **20+ filer** (Sprint 3 layouts) | ⚠️ Next 16 stödjer detta — verifiera |
| `next/link` | 38 filer | ✅ API stabil |
| `output: 'export'` | ✅ | ⚠️ Verifiera att catch-all `[...path]/` fortfarande funkar |
| `@sentry/react@^10` | Nuvarande | ⚠️ Kolla peer-deps mot React 19 |
| `@tanstack/react-query@^5` | Nuvarande | ✅ React 19-kompatibel sedan v5.60 |
| `firebase@^12` | Nuvarande | ✅ React-agnostisk |

**Slutsats:** Migrationen är relativt ren. Mest risk ligger i peer-deps
(Sentry, bundle-analyzer, testing-library) och Next 16 static export-
beteende som kan ha subtila skillnader.

## Fas-plan

### Fas 0 — Förberedelser (~1 h)

- [ ] Pausa övrigt arbete på `main` 1 vecka (så vi kan revertera rent om Sprint 7 failar)
- [ ] Git tag: `pre-sprint-7` på sista main-commiten före kickoff
  ```bash
  git tag -a pre-sprint-7 -m "Sista stable main före React 19 + Next 16"
  git push origin pre-sprint-7
  ```
- [ ] Skapa feature-branch: `claude/sprint-7-frameworks`
- [ ] Säkerställ att 93 tester + typecheck + lint är gröna på main först
- [ ] Baseline Lighthouse-score på produktion (spara som jämförelse post-migration)

### Fas 1 — React 19 (~8 h)

**Prioritet:** lägst risk först. Reacts breaking changes i v19 är typ 90%
positiva för vårt usecase (auto-memoization, bättre error messages, use()-
hook).

```bash
# 1. Bump deps
npm install react@19 react-dom@19 @types/react@19 @types/react-dom@19

# 2. Peer deps check
npm install  # ska varna om inkompatibla peer deps (Sentry, etc)
```

**Verifierade peer-kompatibilitet (per 2026-04):**
- @testing-library/react@16+ stödjer React 19 ✅
- @tanstack/react-query@5.60+ stödjer React 19 ✅
- @sentry/react@10+ stödjer React 19 ✅
- firebase/react — ingen React-dep (Firebase UI-auth som har det är inte
  vi inne på) ✅

**Migrering som kan behövas:**

- [ ] `use()`-hook istället för mönster som idag kräver useEffect + setState
  runt promises. Våra callsites: INGA idag (React Query täcker detta).
  **Skip.**
- [ ] useCallback-auto-memoization: React 19 memoizerar function-refs mer
  aggressivt. De flesta useCallback kan tas bort, MEN det är opt-in via
  `experimental_useEffectEvent` eller `react-compiler`. Vi använder
  traditionell React 19 → ingen automatisk memoization utan compiler.
  **Ingen action.**
- [ ] `forwardRef` deprekerad — ref är nu prop. **0 matches i vår
  kodbas**, skip.
- [ ] `React.createContext` → fortfarande stödd men `use(Context)` är
  smidigare. **Skip** (vi har 4 contexts som fungerar fint med
  useContext).

**Test-steg:**
1. `npm test` — 93 tester ska passera
2. `npm run typecheck` — @types/react 19 kan skärpa inferens
3. `npm run dev` — smoke-test: login, watchlist, advisor, tillsammans,
   grupp-sessioner, onboarding, admin-reports
4. Kolla Sentry DevTools-console för "React 19" deprecation-warnings

**Rollback:**
```bash
git checkout react-18-stable-deps  # tagga före bump
npm install
```

### Fas 2 — Next.js 16 (~16 h)

**Prioritet:** högre risk pga static export + catch-all.

```bash
# 1. Kör Next's codemod (auto-fix)
npx @next/codemod@latest upgrade latest

# 2. Uppdatera eslint-config-next till match
npm install eslint-config-next@16
```

**Förväntade breaking changes att hantera:**

- [ ] **`next.config.mjs`** — kolla att `output: 'export'` fortfarande
  stöds. Next 16 deprekerar vissa config-flaggor (kan visa deprecation-
  warnings).
- [ ] **Metadata-typ** — `export const metadata: Metadata` API stabil i 16.
  Vi har ~20 layouts som använder den.
- [ ] **Dynamic routes + static export** — `[...path]/` behöver
  `generateStaticParams` i 16 (redan fixat i 14 via `{ path: ['_'] }`).
  Verifiera att vår lösning funkar.
- [ ] **Rewrites i firebase.json** — SPA-rewrite `** → /index.html` är
  Firebase-side, inte Next — opåverkat.
- [ ] **`next/dynamic`** — Next 16 har potentiella ändringar i
  loading-behavior. Vår DynamicRouter har `{ ssr: false, loading: ... }`
  — test:a noga.
- [ ] **Sitemap-routen** — `src/app/sitemap.ts` använder `MetadataRoute`-
  typen. Kolla att den fortfarande genererar `/sitemap.xml` korrekt.

**Potentiella problem:**

1. **`async` metadata API-change**: Next 15+ kräver `await` på vissa
   dynamic-params. Vi har inga dynamic routes med `generateMetadata`, så
   inte relevant.
2. **Static export + `sitemap.ts`**: verifiera att dynamic sitemap (med
   TMDB-fetch) fortfarande fungerar vid build.
3. **Caching-ändringar**: Next 16 har nya cache-default (t.ex. fetch är
   no-cache by default). Vi använder React Query, inte Next's fetch-cache,
   så troligen opåverkat.

**Test-steg:**
1. `npm run typecheck`
2. `npm run build` — måste gå igenom utan errors
3. `npm run test` — 93 tester
4. Inspektera `out/` — alla förväntade sidor genererade?
5. Deploy till preview-channel (via GitHub Actions `preview.yml`) — testa
   från en annan dator/browser
6. **Hela app-sweep på preview:**
   - [ ] Landing + login (email + Google SSO)
   - [ ] Register → onboarding → watchlist-add
   - [ ] Movie + TV detail
   - [ ] Session / grupp / user-profile
   - [ ] Advisor + stats + calendar
   - [ ] Admin/reports (om admin-flagga finns på test-konto)
   - [ ] Data export
7. `npm audit` — 4 HIGH CVEs ska vara 0 HIGH

**Rollback:**
```bash
git revert <merge-commit>
firebase deploy --only hosting
# Cloudflare-purge
```

### Fas 3 — Tailwind v4 (conditional, ~8 h eller skip)

**Skippa om:** Tailwind v3 inte är EOL-aviserat vid tidpunkten.

**Kör om:** v3 har fått EOL-datum eller nya Tailwind-features behövs.

**Då:**
```bash
npx @tailwindcss/upgrade@next
```

**Breaking changes:**
- CSS-variabel-baserad theming — våra custom tokens i `tailwind.config.ts`
  migreras till `@theme` i CSS
- `@tailwind base/components/utilities` → `@import "tailwindcss"`
- Custom utilities via `@utility` syntax
- **Test varje sida visuellt** efter migration

### Fas 4 — Deploy + monitoring (~2 h)

- [ ] Merge till main efter alla 3 faser gröna
- [ ] Push → deploy.yml auto-körs + CI-gate
- [ ] Deploy till prod via `firebase deploy`
- [ ] Cloudflare cache purge
- [ ] Lighthouse-baseline om: jämfört mot Fas 0
- [ ] Sentry-watch 24h efter deploy — leta efter nya error patterns
- [ ] UptimeRobot-alert-check (när den är uppsatt — se EXTERNAL_ACTIONS)

## Risker + mitigations

| Risk | Sannolikhet | Impact | Mitigation |
|------|-------------|--------|-----------|
| Static export `[...path]` bryter i Next 16 | Medium | Kritisk | Test:a lokalt + preview-channel innan merge |
| Sentry @10 inkompatibel med React 19 | Låg | Hög | Peer-deps-check i Fas 1; uppgradera Sentry till @11+ om behövs |
| Vitest + @vitejs/plugin-react inkompat | Låg | Medium | Uppgradera dessa om deras React-dep pekar på 18 |
| Subtila render-bugs från React 19 auto-batching | Medium | Låg | Testa state-interactions i advisor + tillsammans-session |
| Next codemod förstör något | Låg | Medium | Git-branch, granska varje codemod-ändring i diff |
| Firebase Hosting har storleksgräns | Låg | Låg | Nuvarande bundle 88 kB shared, långt under |
| Användare cachar gamla chunks (HTTP cache) | Hög | Låg | `firebase.json` sätter `Cache-Control: no-cache` på `.html` + Cloudflare purge täcker resten |

## Exit-kriterier

- [ ] `npm audit` rapporterar 0 HIGH-severity issues
- [ ] 93 tester gröna (vitest)
- [ ] `npm run typecheck` rent
- [ ] `npm run lint` rent (0 errors)
- [ ] `npm run build` ger samma routes som idag, utan regressions i size
- [ ] Preview-channel manual-testad på hela appen
- [ ] Deploy till prod utan errors
- [ ] Sentry-watch 24h visar inga nya error-patterns
- [ ] Lighthouse-score lika bra eller bättre än pre-migration baseline

## Estimerad tid

| Fas | Effort | Cumulative |
|-----|--------|-----------|
| 0 Förberedelser | 1 h | 1 h |
| 1 React 19 | 8 h | 9 h |
| 2 Next.js 16 | 16 h | 25 h |
| 3 Tailwind v4 (conditional) | 0–8 h | 25–33 h |
| 4 Deploy + monitoring | 2 h | 27–35 h |

**Realistic total:** 27 h (utan Tailwind), 35 h (med). Plan för 40 h i
kalendern för buffer.

## Vad händer om Sprint 7 inte passar tidsschemat?

Framework-upgrades blockerar inte löpande arbete — de är en "teknisk-
vilorum"-sprint. Om det drar ut:

- CVE:erna är defanged av static export (ingen server att attackera)
- Ekosystemet rör sig långsamt; Next 15 EOL kommer troligen 2026-08+
- Sprint 8 (mockup-redesign) + Sprint 9 (growth) beror inte strikt på
  detta

**Rekommendation:** lägg Sprint 7 när du HAR en ostörd vecka, inte
tvinga in den mellan andra saker. Migration-surprises äter mer kalendertid
än labbtid.

## Post-Sprint 7 items

När detta är live:
- Uppdatera `CLAUDE.md`: "Next.js 16 (App Router)..." + "React 19"
- Uppdatera `docs/SLO.md` Lighthouse-baseline med post-migration-siffror
- Lägg till `npm audit` step i `.github/workflows/ci.yml` som hård gate
  (förhindrar regression tillbaka till HIGH CVEs)
- Överväg att aktivera React Compiler via `babel-plugin-react-compiler`
  för auto-memoization (opt-in feature i React 19)

---

_Planen uppdateras när Sprint 7 faktiskt kickar igång — t.ex. om Next 17
släpps innan vi kör detta kan plan:n skala direkt till 17 istället för 16._
