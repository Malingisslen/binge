# Swedish Person Bios (Wikipedia/Wikidata fallback) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When TMDB has no Swedish biography for a person, fall back to a Swedish-Wikipedia summary (preferred over TMDB's English text) so person pages read in Swedish for a Swedish audience.

**Architecture:** Client-side only — Wikimedia's APIs are keyless and CORS-enabled, so no Cloud Function is needed. A new hook resolves the person's Wikidata id (via TMDB `/person/{id}/external_ids`), looks up the `svwiki` article title, and fetches the Swedish Wikipedia REST summary. The person page's existing bio precedence (`sv TMDB → en TMDB`) becomes `sv TMDB → sv Wikipedia → en TMDB`, with CC BY-SA attribution when the Wikipedia text is used.

**Tech Stack:** Next.js/React 19 client, React Query, TMDB client, Wikimedia REST + Wikidata action API (no keys). Vitest for pure logic.

## Global Constraints

- Client-only; no new Cloud Function, no secret, no Firestore collection.
- Wikimedia calls use `origin=*` (Wikidata action API) and the public REST summary endpoint — both CORS-safe from the browser.
- New query keys `'person-external-ids'` and `'wiki-bio'` must NOT be added to `PERSISTED_QUERY_PREFIXES`.
- Respect AbortSignal: pass React Query's `ctx.signal` into fetches (matches the TMDB client convention).
- UI copy in Swedish. Wikipedia content requires **CC BY-SA attribution** with a link to the source article.
- Only fetch the fallback when TMDB's Swedish bio is empty (avoid needless Wikimedia calls).
- Cache tier: reuse `TMDB_STALE.PERSON_DETAIL`-style long staleness — bios change rarely.

---

## File Structure

**New — pure logic (unit-tested):**
- `src/lib/wikipedia/bio.ts` — `svwikiTitleFromEntities`, `cleanWikiExtract`.
- `src/lib/wikipedia/bio.test.ts`

**New — hook:**
- `src/hooks/useSwedishWikiBio.ts` — resolves wikidata id → svwiki title → summary.

**Modified:**
- `src/lib/tmdb/client.ts` — add `getPersonExternalIds(id)`.
- `src/lib/tmdb/tmdb.ts` (or wherever TMDB types live) — add `TMDBPersonExternalIds`.
- `src/components/pages/PersonPageClient.tsx` — new precedence + attribution.

---

## Task 1: TMDB person external_ids fetch

**Files:**
- Modify: `src/lib/tmdb/client.ts`
- Modify: `src/lib/tmdb/tmdb.ts` (type location used by the client)

**Interfaces:**
- Produces:
  - `interface TMDBPersonExternalIds { wikidata_id?: string | null; imdb_id?: string | null }`
  - `getPersonExternalIds(id: number, opts?: TmdbFetchOpts): Promise<TMDBPersonExternalIds>`

- [ ] **Step 1: Add the type**

In the TMDB types file, add:

```ts
export interface TMDBPersonExternalIds {
  wikidata_id?: string | null;
  imdb_id?: string | null;
  facebook_id?: string | null;
  instagram_id?: string | null;
  twitter_id?: string | null;
}
```

- [ ] **Step 2: Add the client function**

In `src/lib/tmdb/client.ts`, near `getPerson`:

```ts
export function getPersonExternalIds(id: number, opts?: TmdbFetchOpts): Promise<TMDBPersonExternalIds> {
  return tmdbFetch(`/person/${id}/external_ids`, {}, opts);
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`

```bash
git add src/lib/tmdb/client.ts src/lib/tmdb/tmdb.ts
git commit -m "feat(person): TMDB getPersonExternalIds (for wikidata_id)"
```

---

## Task 2: Wikipedia pure helpers

**Files:**
- Create: `src/lib/wikipedia/bio.ts`
- Test: `src/lib/wikipedia/bio.test.ts`

**Interfaces:**
- Produces:
  - `svwikiTitleFromEntities(json: unknown, wikidataId: string): string | null`
  - `cleanWikiExtract(summary: unknown): { text: string; pageUrl: string } | null`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/wikipedia/bio.test.ts
import { describe, it, expect } from 'vitest';
import { svwikiTitleFromEntities, cleanWikiExtract } from './bio';

describe('svwikiTitleFromEntities', () => {
  it('extracts the svwiki sitelink title', () => {
    const json = { entities: { Q42: { sitelinks: { svwiki: { title: 'Greta Garbo' }, enwiki: { title: 'Greta Garbo (en)' } } } } };
    expect(svwikiTitleFromEntities(json, 'Q42')).toBe('Greta Garbo');
  });
  it('returns null when there is no svwiki sitelink', () => {
    const json = { entities: { Q42: { sitelinks: { enwiki: { title: 'X' } } } } };
    expect(svwikiTitleFromEntities(json, 'Q42')).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(svwikiTitleFromEntities(null, 'Q42')).toBeNull();
    expect(svwikiTitleFromEntities({ entities: {} }, 'Q42')).toBeNull();
  });
});

describe('cleanWikiExtract', () => {
  it('returns text + page url for a standard summary', () => {
    const summary = { type: 'standard', extract: 'Greta Garbo var en svensk skådespelare.', content_urls: { desktop: { page: 'https://sv.wikipedia.org/wiki/Greta_Garbo' } } };
    expect(cleanWikiExtract(summary)).toEqual({ text: 'Greta Garbo var en svensk skådespelare.', pageUrl: 'https://sv.wikipedia.org/wiki/Greta_Garbo' });
  });
  it('rejects disambiguation pages', () => {
    expect(cleanWikiExtract({ type: 'disambiguation', extract: 'kan syfta på...' })).toBeNull();
  });
  it('rejects empty/too-short extracts', () => {
    expect(cleanWikiExtract({ type: 'standard', extract: '   ', content_urls: { desktop: { page: 'x' } } })).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(cleanWikiExtract(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/wikipedia/bio.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

```ts
// src/lib/wikipedia/bio.ts
export function svwikiTitleFromEntities(json: unknown, wikidataId: string): string | null {
  if (!json || typeof json !== 'object') return null;
  const entities = (json as { entities?: Record<string, unknown> }).entities;
  const entity = entities?.[wikidataId] as { sitelinks?: { svwiki?: { title?: unknown } } } | undefined;
  const title = entity?.sitelinks?.svwiki?.title;
  return typeof title === 'string' && title.length > 0 ? title : null;
}

export function cleanWikiExtract(summary: unknown): { text: string; pageUrl: string } | null {
  if (!summary || typeof summary !== 'object') return null;
  const s = summary as { type?: unknown; extract?: unknown; content_urls?: { desktop?: { page?: unknown } } };
  if (s.type === 'disambiguation') return null;
  const text = typeof s.extract === 'string' ? s.extract.trim() : '';
  const pageUrl = s.content_urls?.desktop?.page;
  if (text.length < 10 || typeof pageUrl !== 'string') return null;
  return { text, pageUrl };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/wikipedia/bio.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wikipedia/bio.ts src/lib/wikipedia/bio.test.ts
git commit -m "feat(wiki): pure helpers for svwiki title + extract cleaning"
```

---

## Task 3: `useSwedishWikiBio` hook

**Files:**
- Create: `src/hooks/useSwedishWikiBio.ts`

**Interfaces:**
- Consumes: `getPersonExternalIds` (Task 1), `svwikiTitleFromEntities`, `cleanWikiExtract` (Task 2).
- Produces: `useSwedishWikiBio(personId: number | undefined, enabled: boolean): { text: string; pageUrl: string } | null`

- [ ] **Step 1: Implement the hook**

```ts
// src/hooks/useSwedishWikiBio.ts
import { useQuery } from '@tanstack/react-query';
import { getPersonExternalIds } from '@/lib/tmdb/client';
import { svwikiTitleFromEntities, cleanWikiExtract } from '@/lib/wikipedia/bio';

/**
 * Swedish-Wikipedia bio fallback: TMDB external_ids -> Wikidata svwiki title ->
 * Wikipedia REST summary. Client-side, keyless, CORS-safe. Only runs when
 * `enabled` (i.e. TMDB has no Swedish bio). Not persisted (per-title data).
 */
export function useSwedishWikiBio(
  personId: number | undefined,
  enabled: boolean,
): { text: string; pageUrl: string } | null {
  const { data } = useQuery({
    queryKey: ['wiki-bio', personId],
    enabled: enabled && personId != null,
    staleTime: 1000 * 60 * 60 * 24 * 30, // bios rarely change
    queryFn: async (ctx) => {
      const ext = await getPersonExternalIds(personId!, { signal: ctx.signal });
      const wd = ext.wikidata_id;
      if (!wd) return null;

      const entRes = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wd}&props=sitelinks&format=json&origin=*`,
        { signal: ctx.signal },
      );
      if (!entRes.ok) return null;
      const title = svwikiTitleFromEntities(await entRes.json(), wd);
      if (!title) return null;

      const sumRes = await fetch(
        `https://sv.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { signal: ctx.signal },
      );
      if (!sumRes.ok) return null;
      return cleanWikiExtract(await sumRes.json());
    },
  });
  return data ?? null;
}
```

> Confirm `TmdbFetchOpts` accepts `{ signal }` (it does per the AbortSignal note in CLAUDE.md). If the option name differs, match `getPerson`'s existing opts shape.

- [ ] **Step 2: Typecheck + confirm not persisted**

Run: `npm run typecheck`
Confirm `'wiki-bio'` and `'person-external-ids'` are absent from `PERSISTED_QUERY_PREFIXES`.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSwedishWikiBio.ts
git commit -m "feat(wiki): useSwedishWikiBio fallback hook"
```

---

## Task 4: Wire into PersonPageClient with new precedence + attribution

**Files:**
- Modify: `src/components/pages/PersonPageClient.tsx`

**Interfaces:**
- Consumes: `useSwedishWikiBio` (Task 3).

- [ ] **Step 1: Update the bio resolution**

Replace the existing bio computation (around lines 23–95) so precedence is `sv TMDB → sv Wikipedia → en TMDB`:

```tsx
import { useSwedishWikiBio } from '@/hooks/useSwedishWikiBio';

const svBio = person?.biography || '';
// Only fetch the wiki fallback when TMDB has no Swedish bio.
const wikiBio = useSwedishWikiBio(person?.id, !!person && !svBio);
const enBio = personEn?.biography || '';

const biography = svBio || wikiBio?.text || enBio || '';
const bioSource: 'tmdb-sv' | 'wiki-sv' | 'tmdb-en' | null =
  svBio ? 'tmdb-sv' : wikiBio?.text ? 'wiki-sv' : enBio ? 'tmdb-en' : null;
```

- [ ] **Step 2: Update the render + attribution**

Replace the bio render block:

```tsx
{biography && (
  <>
    <p className="text-base text-ink-2 leading-relaxed mb-3 line-clamp-6">{biography}</p>
    {bioSource === 'wiki-sv' && wikiBio && (
      <p className="text-xxs text-ink-3 mb-3">
        Biografi från{' '}
        <a href={wikiBio.pageUrl} target="_blank" rel="noopener noreferrer" className="underline">
          svenska Wikipedia
        </a>{' '}
        (CC BY-SA).
      </p>
    )}
    {bioSource === 'tmdb-en' && (
      <p className="text-xxs text-ink-3 mb-3">Biografi på engelska — svensk översättning saknas.</p>
    )}
  </>
)}
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Open a person who has a Swedish TMDB bio → unchanged (no wiki call — verify in network tab that no wikidata/wikipedia request fires). Open a person with no Swedish TMDB bio but who has a Swedish Wikipedia article (e.g. a well-known Swedish actor) → Swedish Wikipedia text + CC BY-SA credit appears. Open an obscure foreign person with neither → falls back to the English note as before.

- [ ] **Step 4: Typecheck + design guard + commit**

Run: `npm run typecheck && npx vitest run src/lib/design/consistency.test.ts`
Expected: PASS.

```bash
git add src/components/pages/PersonPageClient.tsx
git commit -m "feat(wiki): Swedish Wikipedia bio fallback on person pages"
```

---

## Task 5: Gate + push

- [ ] **Step 1:** Run `npm run lint && npm run typecheck && npm test` (watch `no-explicit-any`).
- [ ] **Step 2:** Dispatch `binge-code-reviewer` on the staged diff (no backend/rules change here, so security review optional). Address findings.
- [ ] **Step 3:** This is client-only — no function/rules deploy needed. Push to main when green.

---

## Self-Review

**Spec coverage:** Swedish bio fallback (Tasks 3,4) ✓; preferred over English (precedence in Task 4) ✓; attribution (Task 4 Step 2) ✓; only fetch when TMDB sv missing (`enabled` gate, Task 4 Step 1) ✓; no key/cron/collection (client-only architecture) ✓.

**Placeholder scan:** the one external unknown (exact `TmdbFetchOpts` signal field name) is a confirm step in Task 3, not a hidden TODO.

**Type consistency:** `useSwedishWikiBio` returns `{ text; pageUrl } | null`, consumed in Task 4 as `wikiBio?.text` / `wikiBio.pageUrl`. `getPersonExternalIds` returns `TMDBPersonExternalIds` with `wikidata_id`, used as `ext.wikidata_id`. `svwikiTitleFromEntities`/`cleanWikiExtract` signatures match their call sites.
