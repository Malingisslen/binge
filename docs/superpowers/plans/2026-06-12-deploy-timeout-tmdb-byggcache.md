# Deploy-timeout-fix + TMDB-byggcache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sluta fela/timeouta deployer som pre-renderar ~25k titelsidor — utan att skära ner SEO-täckningen — genom (1) en byggtids-deadline på TMDB-anrop och (2) en fil-baserad TMDB-byggcache som gör att kod-deployer återanvänder titeldata istället för att hämta om allt.

**Architecture:** Tre lager, var för sig shippbara. **Steg 1** ger varje byggtids-TMDB-anrop en `AbortSignal.timeout` så ingen sida kan nå Next 60s-tak → exporten avbryts aldrig (otursdrabbade sidor shippar med tunn metadata istället för att fälla bygget). **Steg 2** lägger en fil-cache (`.tmdb-cache/`) runt detalj-fetcharna med TTL + bust-flagga; **steg 3** persistar den + `.next/cache` mellan CI-körningar via `actions/cache` och lägger en veckovis schemalagd refresh som bust:ar cachen. Resultat: kod-deployer hämtar nästan inga titlar (cache-träff) → ingen strypning → ingen timeout, och alla pre-renderade sidor behålls.

**Tech Stack:** Next.js 16 (`output: 'export'`), React 19, TypeScript, Node 20 (CI), Vitest, GitHub Actions.

**Bakgrund / rotorsak (läs först):**
- `src/app/{tv,movie,person}/[id]/page.tsx` har `generateStaticParams` + `dynamic = 'force-static'`. Varje deploy pre-renderar ~25k sidor, var och en med ≥1 live-TMDB-anrop vid byggtid (`getTVShow`/`getMovie`/`getPerson` via Reacts `cache()`).
- TMDB-klienten ([src/lib/tmdb/client.ts](src/lib/tmdb/client.ts)) har en modulnivå-semafor `MAX_CONCURRENT = 8`. 3 Next-workers × 8 = 24 samtidiga anrop → TMDB stryper → fetchar köar bakom semaforen. En sida som väntar förbi 60s fälls av Next (3 försök, sen avbryts hela exporten). Felet är icke-deterministiskt (sidan `/tv/287641` var ett offer, inte orsak).
- Pre-renderingen är INTE kosmetisk: catch-all-skalet är `noindex` by default ([src/hooks/usePageMeta.ts](src/hooks/usePageMeta.ts)); en icke-pre-renderad titel blir indexerbar först efter JS-hydrering + lyckad klient-fetch. Därför skär vi INTE ner sidantalet — vi fixar mekaniken.

**Filöversikt:**
- Skapa `src/lib/tmdb/buildFetch.ts` — byggtids-fetch-wrapper: `AbortSignal.timeout` (steg 1) + cache-komposition (steg 3). Server-only (importeras bara från route-filer).
- Skapa `src/lib/tmdb/buildFetch.test.ts` — tester.
- Skapa `src/lib/tmdb/buildCache.ts` — fil-cache (read/write/TTL/bust). Server-only, `node:fs`.
- Skapa `src/lib/tmdb/buildCache.test.ts` — tester.
- Modifiera `src/app/tv/[id]/page.tsx`, `src/app/movie/[id]/page.tsx`, `src/app/person/[id]/page.tsx` — route `cachedGetX` + `generateStaticParams`-fetchar går via buildFetch/buildSignal.
- Modifiera `src/lib/tmdb/client.test.ts` — abort-bevistest (eller skapa om saknas).
- Modifiera `.gitignore`, `.github/workflows/deploy.yml`.
- Modifiera `CLAUDE.md`, `src/lib/tmdb/seoCoverage.ts` (kommentar), `docs/RUNBOOK.md`.

**Verifieringskommandon:**
- `npx vitest run <fil>` — enskild testfil
- `npm test` / `npm run typecheck` / `npm run lint`

---

### Task 1: Byggtids-deadline (säkerhetsnät mot 60s-taket)

**Files:**
- Create: `src/lib/tmdb/buildFetch.ts`
- Create: `src/lib/tmdb/buildFetch.test.ts`
- Modify: `src/app/tv/[id]/page.tsx:36` + `generateStaticParams`
- Modify: `src/app/movie/[id]/page.tsx:41` + `generateStaticParams`
- Modify: `src/app/person/[id]/page.tsx:34` + `generateStaticParams`

- [ ] **Step 1.1: Skriv failing test**

`src/lib/tmdb/buildFetch.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { fetchForBuild, buildSignal, BUILD_FETCH_TIMEOUT_MS } from './buildFetch';

describe('buildSignal', () => {
  it('returnerar en AbortSignal', () => {
    const sig = buildSignal();
    expect(sig).toBeInstanceOf(AbortSignal);
    expect(sig.aborted).toBe(false);
  });

  it('exponerar en rimlig timeout-konstant (<= 30s, < Next 60s-tak)', () => {
    expect(BUILD_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(BUILD_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

describe('fetchForBuild', () => {
  it('anropar fetchern med id och en abort-signal', async () => {
    const fetcher = vi.fn(async (_id: number, _opts?: { signal?: AbortSignal }) => ({ ok: true }));
    const result = await fetchForBuild(fetcher, 1438);
    expect(result).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [id, opts] = fetcher.mock.calls[0];
    expect(id).toBe(1438);
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
  });

  it('propagerar fetcher-fel (sidan faller då tillbaka på tom metadata)', async () => {
    const fetcher = vi.fn(async () => { throw new Error('aborted'); });
    await expect(fetchForBuild(fetcher, 1)).rejects.toThrow('aborted');
  });
});
```

- [ ] **Step 1.2: Kör — FAIL.** Run: `npx vitest run src/lib/tmdb/buildFetch.test.ts` → FAIL (modul saknas)

- [ ] **Step 1.3: Implementera `buildFetch.ts`**

```ts
// Byggtids-wrapper runt TMDB-detalj-fetchar (server-only, importeras bara från
// route-filernas generateStaticParams/generateMetadata/page).
//
// Varför: build:en pre-renderar ~25k titelsidor, var och en med ett TMDB-anrop.
// Under last stryper TMDB och anropen köar bakom klientens 8-slot-semafor; en
// sida som väntar förbi Next 60s-tak fäller HELA exporten (3 försök, sen abort).
// En AbortSignal.timeout gör att ett anrop ger upp i god tid → fetchern kastar →
// sidans generateMetadata/page faller tillbaka på tom metadata / undefined data
// (try/catch finns redan på alla anropställen) → bygget förblir grönt.
//
// Cache-lagret komponeras in i steg 3 (se buildCache.ts).

type IdFetcher<T> = (id: number, opts?: { signal?: AbortSignal }) => Promise<T>;

// < Next 60s static-generation-tak med god marginal. Långt nog att en frisk
// fetch hinner klart även under måttlig kö, kort nog att aldrig nå taket.
export const BUILD_FETCH_TIMEOUT_MS = 20_000;

/** AbortSignal med byggtids-deadline. Används även för list-fetchar i
 *  generateStaticParams (getPopular*/getTopRated*). */
export function buildSignal(): AbortSignal {
  return AbortSignal.timeout(BUILD_FETCH_TIMEOUT_MS);
}

export function fetchForBuild<T>(fetcher: IdFetcher<T>, id: number): Promise<T> {
  return fetcher(id, { signal: buildSignal() });
}
```

- [ ] **Step 1.4: Kör — PASS.** Run: `npx vitest run src/lib/tmdb/buildFetch.test.ts` → PASS

- [ ] **Step 1.5: Wire tv/[id]/page.tsx**

I `src/app/tv/[id]/page.tsx`:

Lägg importen (efter raden `import { preferOriginalTitle } ...`):
```ts
import { fetchForBuild, buildSignal } from '@/lib/tmdb/buildFetch';
```

Byt rad 36:
```ts
const cachedGetTVShow = cache((id: number) => getTVShow(id));
```
mot:
```ts
const cachedGetTVShow = cache((id: number) => fetchForBuild(getTVShow, id));
```

I `generateStaticParams`, byt de två `collectIds`-anropen:
```ts
      collectIds(getPopularTV, SEO_TITLE_PAGES),
      collectIds(getTopRatedTV, SEO_TOP_RATED_PAGES),
```
mot:
```ts
      collectIds(p => getPopularTV(p, { signal: buildSignal() }), SEO_TITLE_PAGES),
      collectIds(p => getTopRatedTV(p, { signal: buildSignal() }), SEO_TOP_RATED_PAGES),
```

- [ ] **Step 1.6: Wire movie/[id]/page.tsx**

I `src/app/movie/[id]/page.tsx`, lägg import:
```ts
import { fetchForBuild, buildSignal } from '@/lib/tmdb/buildFetch';
```
Byt `const cachedGetMovie = cache((id: number) => getMovie(id));` mot:
```ts
const cachedGetMovie = cache((id: number) => fetchForBuild(getMovie, id));
```
Byt collectIds-anropen:
```ts
      collectIds(getPopularMovies, SEO_TITLE_PAGES),
      collectIds(getTopRatedMovies, SEO_TOP_RATED_PAGES),
```
mot:
```ts
      collectIds(p => getPopularMovies(p, { signal: buildSignal() }), SEO_TITLE_PAGES),
      collectIds(p => getTopRatedMovies(p, { signal: buildSignal() }), SEO_TOP_RATED_PAGES),
```

- [ ] **Step 1.7: Wire person/[id]/page.tsx**

I `src/app/person/[id]/page.tsx`, lägg import:
```ts
import { fetchForBuild, buildSignal } from '@/lib/tmdb/buildFetch';
```
Byt `const cachedGetPerson = cache((id: number) => getPerson(id));` mot:
```ts
const cachedGetPerson = cache((id: number) => fetchForBuild(getPerson, id));
```
I `generateStaticParams`, byt:
```ts
    const popularResults = await Promise.allSettled(pages.map(p => getPopularMovies(p)));
```
mot:
```ts
    const popularResults = await Promise.allSettled(pages.map(p => getPopularMovies(p, { signal: buildSignal() })));
```
och byt:
```ts
    const movieDetails = await Promise.allSettled(
      Array.from(movieIds).map(id => getMovie(id)),
    );
```
mot:
```ts
    const movieDetails = await Promise.allSettled(
      Array.from(movieIds).map(id => getMovie(id, { signal: buildSignal() })),
    );
```

- [ ] **Step 1.8: Verifiera.** Run: `npm run typecheck && npm run lint && npx vitest run src/lib/tmdb/buildFetch.test.ts` → allt PASS

- [ ] **Step 1.9: Commit**

```bash
git add src/lib/tmdb/buildFetch.ts src/lib/tmdb/buildFetch.test.ts src/app/tv/[id]/page.tsx src/app/movie/[id]/page.tsx src/app/person/[id]/page.tsx
git commit -m "fix(build): AbortSignal-deadline på byggtids-TMDB-anrop — exporten kan aldrig nå 60s-taket"
```

Detta steg är självständigt shippbart: nästa deploy blir grön även under strypning (otursdrabbade sidor får tunn metadata, hela bygget faller inte).

---

### Task 2: Fil-baserad TMDB-byggcache

**Files:**
- Create: `src/lib/tmdb/buildCache.ts`
- Create: `src/lib/tmdb/buildCache.test.ts`

- [ ] **Step 2.1: Skriv failing test**

`src/lib/tmdb/buildCache.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBuildCache, writeBuildCache } from './buildCache';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tmdb-cache-test-'));
  process.env.TMDB_CACHE_DIR = dir;
  delete process.env.TMDB_CACHE_BUST;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TMDB_CACHE_DIR;
  delete process.env.TMDB_CACHE_BUST;
});

describe('buildCache', () => {
  it('skriver och läser tillbaka data', () => {
    writeBuildCache('tv', 1438, { name: 'The Wire' });
    expect(readBuildCache('tv', 1438)).toEqual({ name: 'The Wire' });
  });

  it('returnerar null vid miss', () => {
    expect(readBuildCache('tv', 999)).toBeNull();
  });

  it('separerar nycklar på kind + id', () => {
    writeBuildCache('tv', 1, { k: 'tv' });
    writeBuildCache('movie', 1, { k: 'movie' });
    expect(readBuildCache('tv', 1)).toEqual({ k: 'tv' });
    expect(readBuildCache('movie', 1)).toEqual({ k: 'movie' });
  });

  it('returnerar null när posten är äldre än TTL', () => {
    const past = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 dagar sedan
    writeBuildCache('tv', 1438, { name: 'gammal' }, past);
    expect(readBuildCache('tv', 1438)).toBeNull();
  });

  it('returnerar null när TMDB_CACHE_BUST=1 (även för färsk post)', () => {
    writeBuildCache('tv', 1438, { name: 'färsk' });
    process.env.TMDB_CACHE_BUST = '1';
    expect(readBuildCache('tv', 1438)).toBeNull();
  });

  it('returnerar null vid korrupt JSON (behandlas som miss, kastar inte)', () => {
    writeBuildCache('tv', 1438, { ok: true });
    // skriv över med skräp
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(join(dir, 'tv-1438.json'), '{ inte json');
    expect(readBuildCache('tv', 1438)).toBeNull();
  });
});
```

- [ ] **Step 2.2: Kör — FAIL.** Run: `npx vitest run src/lib/tmdb/buildCache.test.ts` → FAIL (modul saknas)

- [ ] **Step 2.3: Implementera `buildCache.ts`**

```ts
// Fil-baserad byggcache för TMDB-detaljsvar (server-only, node:fs).
//
// Syfte: en kod-deploy ska INTE hämta om ~25k titlar. Varje detaljsvar
// persistas i .tmdb-cache/{kind}-{id}.json med en tidsstämpel; nästa build
// återanvänder det inom TTL. Cache-katalogen persistas mellan CI-körningar
// via actions/cache (se .github/workflows/deploy.yml). Veckovis schemalagd
// deploy sätter TMDB_CACHE_BUST=1 → färsk hämtning som repopulerar cachen.
//
// Best-effort: alla fel (saknad/korrupt fil, skrivfel) behandlas som miss och
// får ALDRIG bryta bygget.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dagar

interface CacheEntry<T> {
  fetchedAt: number;
  data: T;
}

// TMDB_CACHE_DIR override:as i tester; default .tmdb-cache/ i repo-roten
// (gitignored, persistas via actions/cache).
function cacheDir(): string {
  return process.env.TMDB_CACHE_DIR || join(process.cwd(), '.tmdb-cache');
}

function cachePath(kind: string, id: number): string {
  return join(cacheDir(), `${kind}-${id}.json`);
}

export function readBuildCache<T>(kind: string, id: number, now: number = Date.now()): T | null {
  // Bust: tvinga miss så builden hämtar färskt och skriver om cachen.
  if (process.env.TMDB_CACHE_BUST === '1') return null;
  try {
    const raw = readFileSync(cachePath(kind, id), 'utf8');
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (typeof entry.fetchedAt !== 'number') return null;
    if (now - entry.fetchedAt > TTL_MS) return null;
    return entry.data;
  } catch {
    return null; // saknad / korrupt → miss
  }
}

export function writeBuildCache<T>(kind: string, id: number, data: T, now: number = Date.now()): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    const entry: CacheEntry<T> = { fetchedAt: now, data };
    // Atomisk skrivning (temp + rename) så parallella Next-workers aldrig
    // läser en halvskriven fil.
    const tmp = `${cachePath(kind, id)}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry));
    renameSync(tmp, cachePath(kind, id));
  } catch {
    // best-effort — skrivfel får aldrig fälla bygget
  }
}
```

- [ ] **Step 2.4: Kör — PASS.** Run: `npx vitest run src/lib/tmdb/buildCache.test.ts` → PASS (6 tester)

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/tmdb/buildCache.ts src/lib/tmdb/buildCache.test.ts
git commit -m "feat(build): fil-baserad TMDB-byggcache med TTL + bust-flagga"
```

---

### Task 3: Komponera cachen in i `fetchForBuild`

**Files:**
- Modify: `src/lib/tmdb/buildFetch.ts`
- Modify: `src/lib/tmdb/buildFetch.test.ts`
- Modify: `src/app/tv/[id]/page.tsx`, `src/app/movie/[id]/page.tsx`, `src/app/person/[id]/page.tsx` (lägg `kind`-argument)
- Modify: `.gitignore`

- [ ] **Step 3.1: Uppdatera buildFetch-testerna**

I `src/lib/tmdb/buildFetch.test.ts`, ersätt hela `describe('fetchForBuild', …)`-blocket med:

```ts
import { readBuildCache, writeBuildCache } from './buildCache';

vi.mock('./buildCache', () => ({
  readBuildCache: vi.fn(),
  writeBuildCache: vi.fn(),
}));

describe('fetchForBuild', () => {
  beforeEach(() => {
    vi.mocked(readBuildCache).mockReset();
    vi.mocked(writeBuildCache).mockReset();
  });

  it('cache-träff: returnerar cachad data utan att anropa fetchern', async () => {
    vi.mocked(readBuildCache).mockReturnValue({ name: 'cached' });
    const fetcher = vi.fn(async () => ({ name: 'fresh' }));
    const result = await fetchForBuild('tv', fetcher, 1438);
    expect(result).toEqual({ name: 'cached' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(writeBuildCache).not.toHaveBeenCalled();
  });

  it('cache-miss: anropar fetchern med signal, skriver resultatet, returnerar det', async () => {
    vi.mocked(readBuildCache).mockReturnValue(null);
    const fetcher = vi.fn(async (_id: number, _opts?: { signal?: AbortSignal }) => ({ name: 'fresh' }));
    const result = await fetchForBuild('tv', fetcher, 1438);
    expect(result).toEqual({ name: 'fresh' });
    const [id, opts] = fetcher.mock.calls[0];
    expect(id).toBe(1438);
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
    expect(writeBuildCache).toHaveBeenCalledWith('tv', 1438, { name: 'fresh' });
  });

  it('propagerar fetcher-fel och skriver inte till cachen', async () => {
    vi.mocked(readBuildCache).mockReturnValue(null);
    const fetcher = vi.fn(async () => { throw new Error('aborted'); });
    await expect(fetchForBuild('tv', fetcher, 1)).rejects.toThrow('aborted');
    expect(writeBuildCache).not.toHaveBeenCalled();
  });
});
```

Lägg `beforeEach` till importen från vitest högst upp:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
```

- [ ] **Step 3.2: Kör — FAIL.** Run: `npx vitest run src/lib/tmdb/buildFetch.test.ts` → FAIL (signaturen tar inte `kind` än)

- [ ] **Step 3.3: Uppdatera `fetchForBuild` i `buildFetch.ts`**

Lägg import högst upp:
```ts
import { readBuildCache, writeBuildCache } from './buildCache';
```
Ersätt `fetchForBuild`-funktionen:
```ts
export async function fetchForBuild<T>(
  kind: string,
  fetcher: IdFetcher<T>,
  id: number,
): Promise<T> {
  const cached = readBuildCache<T>(kind, id);
  if (cached !== null) return cached;
  const data = await fetcher(id, { signal: buildSignal() });
  writeBuildCache(kind, id, data);
  return data;
}
```
(`buildSignal` + `BUILD_FETCH_TIMEOUT_MS` är oförändrade.)

- [ ] **Step 3.4: Uppdatera de tre route-getterna med `kind`**

`src/app/tv/[id]/page.tsx`:
```ts
const cachedGetTVShow = cache((id: number) => fetchForBuild('tv', getTVShow, id));
```
`src/app/movie/[id]/page.tsx`:
```ts
const cachedGetMovie = cache((id: number) => fetchForBuild('movie', getMovie, id));
```
`src/app/person/[id]/page.tsx`:
```ts
const cachedGetPerson = cache((id: number) => fetchForBuild('person', getPerson, id));
```

- [ ] **Step 3.5: Gitignorera cache-katalogen**

I `.gitignore`, lägg till efter `.lighthouse/`-blocket:
```
# TMDB-byggcache (persistas mellan CI-körningar via actions/cache, aldrig committad)
.tmdb-cache/
```

- [ ] **Step 3.6: Verifiera.** Run: `npm run typecheck && npm run lint && npx vitest run src/lib/tmdb/` → allt PASS

- [ ] **Step 3.7: Commit**

```bash
git add src/lib/tmdb/buildFetch.ts src/lib/tmdb/buildFetch.test.ts src/app/tv/[id]/page.tsx src/app/movie/[id]/page.tsx src/app/person/[id]/page.tsx .gitignore
git commit -m "feat(build): route-getters läser TMDB-byggcachen → kod-deployer hämtar inte om titlar"
```

---

### Task 4: Persistera cachen i CI + veckovis refresh

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 4.1: Lägg schedule + dispatch-triggers**

Ersätt `on:`-blocket högst upp i `.github/workflows/deploy.yml`:
```yaml
on:
  push:
    branches: [main]
  schedule:
    # Veckovis metadata-refresh (måndag 04:00 UTC): bust:ar TMDB-byggcachen så
    # titel-metadata (overview, providers, status) hålls färsk. Kod-deployer
    # mellan refresharna återanvänder cachen och blir snabba.
    - cron: '0 4 * * 1'
  workflow_dispatch:
```

- [ ] **Step 4.2: Lägg cache-restore-steg före Build**

I `deploy.yml`, lägg in DESSA två steg DIREKT FÖRE `- name: Build`:
```yaml
      - name: Restore .next build cache
        uses: actions/cache@v4
        with:
          path: .next/cache
          key: next-cache-${{ hashFiles('package-lock.json') }}-${{ github.sha }}
          restore-keys: |
            next-cache-${{ hashFiles('package-lock.json') }}-
            next-cache-

      - name: Restore TMDB build cache
        uses: actions/cache@v4
        with:
          path: .tmdb-cache
          # Rullande nyckel: varje körning sparar en ny cache, restore-keys
          # plockar senaste. Ger "varm cache från förra deployen".
          key: tmdb-cache-${{ github.run_id }}
          restore-keys: |
            tmdb-cache-
```

- [ ] **Step 4.3: Sätt bust-env på schemalagda körningar**

I `deploy.yml`, i `- name: Build`-stegets `env:`-block, lägg till raden (t.ex. efter `NEXT_PUBLIC_GIT_SHA`):
```yaml
          # Tom sträng på push/dispatch (använd cachen). '1' på schedule →
          # bust:ar cachen för en färsk metadata-refresh.
          TMDB_CACHE_BUST: ${{ github.event_name == 'schedule' && '1' || '' }}
```

- [ ] **Step 4.4: Verifiera workflow-syntax**

Run: `npx --yes @action-validator/cli@latest .github/workflows/deploy.yml 2>/dev/null || python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml')); print('yaml OK')"`
Expected: `yaml OK` (eller validator-PASS). Om `python` saknas, öppna filen och kontrollera att indentering är 2-spaces konsekvent och att de tre nya stegen ligger under `steps:`.

- [ ] **Step 4.5: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci(deploy): persistera .next + TMDB-byggcache mellan körningar + veckovis cache-bust-refresh"
```

---

### Task 5: Dokumentation + slutverifiering

**Files:**
- Modify: `src/lib/tmdb/seoCoverage.ts` (kommentar)
- Modify: `CLAUDE.md` (Deployment-avsnittet)
- Modify: `docs/RUNBOOK.md`

- [ ] **Step 5.1: Uppdatera seoCoverage-kommentaren**

I `src/lib/tmdb/seoCoverage.ts`, i den stora doc-kommentaren högst upp, lägg till ett stycke efter "Byggtids-effekt"-blocket:
```
 *
 * Byggtids-resiliens (2026-06): varje byggtids-TMDB-anrop har en
 * AbortSignal.timeout (src/lib/tmdb/buildFetch.ts) så ingen sida kan nå Next
 * 60s static-generation-tak — exporten avbryts aldrig. Detaljsvaren cachas
 * dessutom på disk (src/lib/tmdb/buildCache.ts, .tmdb-cache/, persistas via
 * actions/cache) så kod-deployer återanvänder titeldata istället för att
 * hämta om ~25k titlar. En veckovis schemalagd deploy bust:ar cachen
 * (TMDB_CACHE_BUST=1) för färsk metadata. Höj därför INTE sidantalet för att
 * "spara byggtid" — byggtiden domineras numera av cache-träffar, inte fetch.
```

- [ ] **Step 5.2: Uppdatera CLAUDE.md Deployment-avsnittet**

I `CLAUDE.md`, i `## Deployment`-avsnittet, lägg till efter stycket om `next build` → static export:

```markdown
**Byggtids-TMDB (SEO-pre-rendering):** `/{tv,movie,person}/[id]` pre-renderas
för ~25k populära titlar (`generateStaticParams`). Varje sida gör ett
TMDB-anrop vid byggtid. Två skydd (se `src/lib/tmdb/buildFetch.ts` +
`buildCache.ts`):
- **AbortSignal.timeout (20s)** på alla byggtids-anrop → ingen sida når Next
  60s-tak; exporten kan aldrig avbrytas av en strypt fetch (otursdrabbade
  sidor får tunn metadata, bygget förblir grönt).
- **Fil-cache `.tmdb-cache/`** (TTL 7 dagar) persistas mellan CI-körningar via
  `actions/cache`. Kod-deployer hämtar därför nästan inga titlar (cache-träff)
  → ingen strypning, snabb deploy. Veckovis schemalagd deploy (cron i
  `deploy.yml`) sätter `TMDB_CACHE_BUST=1` och hämtar färsk metadata.

Skär **inte** ner pre-render-antalet för att fixa byggtid — catch-all-skalet är
`noindex` by default, så en icke-pre-renderad titel indexeras opålitligt
(endast efter JS-hydrering). Mekaniken är fixad; täckningen ska behållas.
```

- [ ] **Step 5.3: Lägg runbook-not**

I `docs/RUNBOOK.md`, lägg till en sektion (placera under befintliga incident-playbooks):
```markdown
## Deploy failar på "took more than 60 seconds" / static export

Symptom: `Failed to build /{tv,movie,person}/[id]/page: /…/<id> after 3 attempts. Export encountered an error … exiting the build.`

Orsak: byggtids-TMDB-strypning fick en sida att passera Next 60s-tak. Ska inte
längre kunna fälla bygget efter 2026-06 (AbortSignal.timeout), men om det
återkommer:
1. **Kör om** workflowen — oftast en övergående TMDB-strypning.
2. Kontrollera att `.tmdb-cache` faktiskt restoras (steget "Restore TMDB build
   cache" i deploy-loggen — "Cache restored" vs "Cache not found"). Kall cache
   = full refetch = långsam/skör build.
3. En kall körning (ny cache-nyckel, eller veckans `schedule`-refresh med
   `TMDB_CACHE_BUST=1`) hämtar alla titlar och är förväntat långsam (~25 min) —
   men ska förbli grön tack vare timeouten.
4. Höj inte sidantalet; sänk vid behov `BUILD_FETCH_TIMEOUT_MS` aldrig under
   ~10s (frisk fetch måste hinna klart).
```

- [ ] **Step 5.4: Slutverifiering**

Run: `npm run lint` → 0 fel
Run: `npm run typecheck` → 0 fel
Run: `npm test` → alla gröna (förvänta +9 nya: 2 buildFetch-grupper, buildCache 6, m.m.)
Run: `npx vitest run src/lib/tmdb/buildCache.test.ts src/lib/tmdb/buildFetch.test.ts` → PASS

Cache-rök-test lokalt (kräver giltig `NEXT_PUBLIC_TMDB_API_KEY` i `.env.local`; valfritt — hoppa om ingen nyckel):
```bash
node --input-type=module -e "
process.env.TMDB_CACHE_DIR='.tmdb-cache-smoke';
const { readBuildCache, writeBuildCache } = await import('./src/lib/tmdb/buildCache.ts').catch(()=>({}));
"
```
(Om tsx/loader saknas, förlita dig på vitest-testerna — de täcker cache-logiken.)

- [ ] **Step 5.5: Commit**

```bash
git add src/lib/tmdb/seoCoverage.ts CLAUDE.md docs/RUNBOOK.md
git commit -m "docs: byggtids-resiliens + TMDB-byggcache (deployment, runbook, seoCoverage)"
```

- [ ] **Step 5.6: Deploy-observation (efter merge till main)**

Efter att detta är på main:
1. **Första deployen** repopulerar `.tmdb-cache` från noll → förväntat långsam (~25 min) men grön (timeouten skyddar).
2. **Andra deployen** (valfri liten commit) ska restorea cachen → "Restore TMDB build cache: Cache restored" i loggen → byggfasen markant snabbare, inga 60s-timeouts.
3. Bekräfta i `gh run view <id> --log` att "Generating static pages" inte längre loggar `Failed to build … after 3 attempts`.

---

## Self-Review

**Spec coverage:**
- Steg 1 (AbortSignal-deadline) → Task 1 ✓
- Steg 2 (fil-cache + actions/cache) → Task 2 (cache) + Task 3 (komposition) + Task 4 (actions/cache) ✓
- Steg 3 (veckovis refresh/bust) → Task 4 (schedule + TMDB_CACHE_BUST) ✓
- "Behåll alla pre-renderade sidor" → ingen task ändrar `SEO_*`-konstanterna; uttryckligt i docs (Task 5) ✓

**Placeholder-scan:** Inga TBD/TODO; all kod är komplett och konkret. `node:fs`-skräp-test använder `require` inuti testet medvetet (jsdom/node-miljö stödjer det).

**Typkonsistens:** `fetchForBuild(fetcher, id)` i Task 1 → `fetchForBuild(kind, fetcher, id)` i Task 3 (medveten, dokumenterad signatur-utökning; alla tre call-sites uppdateras i 3.4). `readBuildCache`/`writeBuildCache`-signaturer matchar mellan buildCache.ts, dess test och buildFetch.ts. `buildSignal`/`BUILD_FETCH_TIMEOUT_MS` exporteras i Task 1 och används oförändrade i Task 3.

**Notering om kostnad:** person-routens `generateStaticParams` hämtar ~2000 fulla `getMovie` för cast- extraktion — dessa går inte via fil-cachen (de cachas inte per `kind`), men skyddas av `buildSignal()` (Task 1, step 1.7). En framtida optimering kan route:a dem genom `fetchForBuild('movie', …)` för cache-återanvändning; utanför scope här.
