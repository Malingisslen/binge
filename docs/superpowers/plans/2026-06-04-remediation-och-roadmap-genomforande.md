# Remediation & Roadmap Genomförande — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every partially- or un-implemented item from Binge's planning documents that is actionable in-repo, deliver an executable external-infra runbook, and a decomposition brief for the large features.

**Architecture:** Seven sequential phases. Fas 1–6 are code (TDD for pure logic, verification-gated for UI/integration). Fas 7 produces two doc deliverables. Each phase ends with `npm run typecheck && npm run lint && npm test && npm run build` green and commits. Firestore rules/functions/indexes changes require **manual** deploy (deploy.yml only ships hosting) — captured in the Fas 7 runbook, never auto-deployed by this plan.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind, TanStack Query v5, Firebase (Firestore + Cloud Functions v2 + FCM), Vitest + @testing-library/react + jsdom, MSW v2, @firebase/rules-unit-testing.

**Source:** Audit 2026-06-04 + spec `docs/superpowers/specs/2026-06-04-remediation-och-roadmap-genomforande-design.md`.

**Key findings from grounding (scope reductions vs the audit):**
- A1.1 skip-link + `#main` already exist in `AppShell.tsx` → only focus-visibility + `tabIndex` remain.
- A1.2 terms checkbox + `termsVersion` write already shipped → only the version-string bump remains.
- A4.1 advisor fan-out already routes through the 8-concurrent semaphore in `client.ts` → verify-and-guard, not rewrite.
- A4.2 `useLists` has no unbounded *collection* query (list items are an array field) → document, don't force an infinite query.
- A4.3 `isPublic` is already written by `addItem`/`updateVisibility` → close the gap on the other mutators + reader fallback.

---

## Fas 1 — Legal/a11y quick wins + docs

### Task 1.1: A1.1 — Skip-to-content focus target hardening
**Files:** Modify `src/components/layout/AppShell.tsx`

The skip-link (`<a href="#main">`) and `<main id="main">` already exist (AppShell.tsx ~lines 34/44/49). Gaps vs acceptance: the link is `sr-only` with no `focus:not-sr-only` (keyboard users never see it), and `<main>` lacks `tabIndex={-1}` (so `#main` is not a focus target). UI-only a11y change — verify via typecheck/build/manual.

- [ ] **Step 1: Make the skip-link visible on focus + give `<main>` a focus target** in both the guest branch and the main branch. Guest branch:
  ```tsx
  if (isLandingForGuest) {
    return (
      <>
        <DuotoneFilters />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-pop"
        >
          Hoppa till innehåll
        </a>
        <main id="main" tabIndex={-1} className="outline-none">{children}</main>
        <Footer />
      </>
    );
  }
  ```
  Main branch:
  ```tsx
  return (
    <>
      <DuotoneFilters />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-pop"
      >
        Hoppa till innehåll
      </a>
      <div className="app-shell">
        <AppTopbar />
        <Subnav />
        <EmailVerificationBanner />
        <main id="main" tabIndex={-1} className="canvas outline-none">{children}</main>
        <Footer />
      </div>
      <MobileTabBar />
    </>
  );
  ```
- [ ] **Step 2: Run `npm run typecheck`** Expected: passes.
- [ ] **Step 3: Run `npm run lint`** Expected: passes (valid Tailwind `focus:*` utilities, no jsx-a11y warning).
- [ ] **Step 4: Manual verification** `npm run dev`; Tab once from fresh load → the "Hoppa till innehåll" pill appears top-left; Enter moves focus into `<main id="main">` (`document.activeElement` is the `<main>`). Replaces a unit test — focus/visibility isn't meaningfully assertable in jsdom.
- [ ] **Step 5: Commit**
  ```
  git commit -am "fix(a11y): make skip-link visible on focus + give #main a focus target

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 1.2: A1.2 — Terms-acceptance bump to current version
**Files:** Modify `src/app/login/page.tsx`

The full terms-acceptance flow is already built (checkbox, `register(...TERMS_VERSION)`, `termsAcceptedAt`/`termsVersion` write in AuthContext, `termsVersion?` on `UserProfile`). Only the constant value lags (`'2026-04-20'`). Bump it so new sign-ups record the current legal version.

- [ ] **Step 1: Bump `TERMS_VERSION`** (`src/app/login/page.tsx` line 15):
  ```tsx
  const TERMS_VERSION = '2026-06-04';
  ```
- [ ] **Step 2: Run `npm run typecheck`** Expected: passes.
- [ ] **Step 3: Run `npm run lint`** Expected: passes.
- [ ] **Step 4: Commit**
  ```
  git commit -am "chore(legal): bump TERMS_VERSION to 2026-06-04 for current docs

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 1.3: A1.3 — Dashed `+`-tile in ProvidersSection
**Files:** Modify `src/components/settings/ProvidersSection.tsx`

When providers are selected, the "Dina tjänster"-grid should end with a dashed `+`-tile that smooth-scrolls to "Lägg till fler" (lines 91–98). DOM-interaction wiring — verify typecheck/lint/manual.

- [ ] **Step 1: Add a ref.** Update the React import (line 3) to `import { useEffect, useMemo, useRef, useState } from 'react';` and after `pendingSave` state add:
  ```tsx
  const addMoreRef = useRef<HTMLDivElement>(null);
  ```
- [ ] **Step 2: Render the `+`-tile** at the end of the selected grid (replace lines 81–83):
  ```tsx
          <div className="grid grid-cols-4 gap-[7px] mb-4">
            {selectedProviders.map(p => tile(p, true))}
            {available.length > 0 && (
              <button
                type="button"
                aria-label="Lägg till fler tjänster"
                onClick={() => addMoreRef.current?.scrollIntoView({ behavior: 'smooth' })}
                className="h-[46px] rounded-md flex items-center justify-center border-[1.5px] border-dashed border-rule text-ink-3 text-[20px] leading-none transition-colors hover:border-ink-3 hover:text-ink"
              >
                +
              </button>
            )}
          </div>
  ```
- [ ] **Step 3: Attach the ref** to the "Lägg till fler" grid (replace lines 91–98):
  ```tsx
      {available.length > 0 && (
        <div ref={addMoreRef}>
          <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3 mb-2">Lägg till fler</div>
          <div className="grid grid-cols-4 gap-[7px] mb-4">
            {available.map(p => tile(p, false))}
          </div>
        </div>
      )}
  ```
- [ ] **Step 4: Run `npm run typecheck`** Expected: passes.
- [ ] **Step 5: Run `npm run lint`** Expected: passes (aria-label on icon-only control).
- [ ] **Step 6: Manual verification** With ≥1 selected and ≥1 unselected provider, the dashed `+`-tile appears last in "Dina tjänster"; click smooth-scrolls to "Lägg till fler". No unit test — `scrollIntoView` is unimplemented in jsdom.
- [ ] **Step 7: Commit**
  ```
  git commit -am "feat(settings): dashed +-tile jumps to 'Lägg till fler' grid

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 1.4: A1.5 — Extract `AvatarInitials` (pure-logic test)
**Files:** Create `src/components/ui/AvatarInitials.tsx`, `src/components/ui/AvatarInitials.test.tsx`; Modify `src/components/pages/MoviePageClient.tsx`, `src/components/pages/TVShowPageClient.tsx`

Both page clients inline the same cast-initials fallback (`name.split(' ').map(n => n[0]).join('').slice(0,2)`) which mishandles empty/multi-space names. Extract a tested pure fn + small component. Test-first.

- [ ] **Step 1: Write the failing test** `src/components/ui/AvatarInitials.test.tsx`:
  ```tsx
  import { describe, it, expect } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { AvatarInitials, deriveInitials } from './AvatarInitials';

  describe('deriveInitials', () => {
    it('takes first letters of the first two words, uppercased', () => {
      expect(deriveInitials('Pedro Pascal')).toBe('PP');
    });
    it('handles a single-word name', () => {
      expect(deriveInitials('Zendaya')).toBe('Z');
    });
    it('uses only the first two words for longer names', () => {
      expect(deriveInitials('Mary Elizabeth Winstead')).toBe('ME');
    });
    it('collapses extra whitespace between words', () => {
      expect(deriveInitials('Bong   Joon  Ho')).toBe('BJ');
    });
    it('trims leading and trailing whitespace', () => {
      expect(deriveInitials('  Greta Gerwig  ')).toBe('GG');
    });
    it('falls back to "?" for empty or whitespace-only names', () => {
      expect(deriveInitials('')).toBe('?');
      expect(deriveInitials('   ')).toBe('?');
    });
  });

  describe('AvatarInitials', () => {
    it('renders the derived initials with the person name as accessible label', () => {
      render(<AvatarInitials name="Pedro Pascal" size={72} />);
      const el = screen.getByLabelText('Pedro Pascal');
      expect(el).toHaveTextContent('PP');
    });
  });
  ```
- [ ] **Step 2: Run `npm test -- AvatarInitials`** Expected: FAILS (module not found).
- [ ] **Step 3: Implement** `src/components/ui/AvatarInitials.tsx`:
  ```tsx
  'use client';

  /**
   * Initials fallback for a person with no portrait. Pure derivation kept
   * separate from the component so it can be unit-tested without rendering.
   */
  export function deriveInitials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    return words.slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  export function AvatarInitials({ name, size = 72 }: { name: string; size?: number }) {
    return (
      <div
        aria-label={name}
        style={{
          width: '100%', height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'var(--placeholder-fill)', color: 'var(--ink-3)',
          fontWeight: 600, fontSize: Math.round(size * 0.2),
        }}
      >
        {deriveInitials(name)}
      </div>
    );
  }
  ```
  (Keeps the exact `--placeholder-fill`/`--ink-3`/`fontWeight:600` styling the page clients used.)
- [ ] **Step 4: Run `npm test -- AvatarInitials`** Expected: PASSES (7 assertions).
- [ ] **Step 5: Swap MoviePageClient callsite** — add `import { AvatarInitials } from '@/components/ui/AvatarInitials';` and replace the inline fallback (MoviePageClient.tsx ~lines 309–319) with:
  ```tsx
                  ) : (
                    <AvatarInitials name={person.name} size={72} />
                  )}
  ```
- [ ] **Step 6: Swap TVShowPageClient callsite** — same import + replace the inline fallback (~lines 355–365) with the same `<AvatarInitials .../>` block.
- [ ] **Step 7: Run `npm run typecheck`** Expected: passes.
- [ ] **Step 8: Run `npm run lint`** Expected: passes.
- [ ] **Step 9: Run `npm test`** Expected: full suite green.
- [ ] **Step 10: Commit**
  ```
  git commit -am "feat(ui): extract testable AvatarInitials cast fallback

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 1.5: A1.4 — ListPageClient → designed states
**Files:** Modify `src/components/pages/ListPageClient.tsx`

Bare muted divs for loading/not-found (lines 33–34), no empty state. Swap to `LoadingView`/`NotFound`/`EmptyState` (props: `LoadingView` takes `variant`/`label`; `NotFound` takes `crumb`/`title`/`body`/`action`; `EmptyState` takes `title`/`body`/`action`). Verify via grep + typecheck/build.

- [ ] **Step 1: Add imports** after the `PageHeader` import (line 15):
  ```tsx
  import { LoadingView } from '@/components/ui/LoadingView';
  import { NotFound } from '@/components/ui/NotFound';
  import { EmptyState } from '@/components/ui/EmptyState';
  ```
- [ ] **Step 2: Replace loading + not-found early returns** (lines 33–34):
  ```tsx
    if (isLoading) return <LoadingView variant="detail" label="Laddar lista…" />;
    if (!list) {
      return (
        <NotFound
          crumb="Lista"
          title="Listan hittades inte"
          body="Listan kan vara borttagen eller satt till privat."
          action={<Link href="/bibliotek" className="btn btn-ghost">Till biblioteket</Link>}
        />
      );
    }
  ```
- [ ] **Step 3: Add an empty-list state** — wrap the poster-grid so an empty list shows `EmptyState`. Before the grid wrapper:
  ```tsx
      {list.items.length === 0 ? (
        <EmptyState
          title="Listan är tom"
          body={isOwner
            ? 'Lägg till din första titel med knappen ovan.'
            : 'Den här listan har inga titlar ännu.'}
        />
      ) : (
        <div className="bg-surface border border-border-main rounded-sm mt-3">
          <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-[10px] md:gap-[7px] px-3 py-2">
            {list.items.map(item => {
  ```
  and close the conditional after the existing grid's closing `</div></div>` with:
  ```tsx
          </div>
        </div>
      )}
  ```
  (`Link` is already imported at line 4.)
- [ ] **Step 4: Verify the antipattern is gone**:
  ```powershell
  npm run -s lint; Select-String -Path src/components/pages/ListPageClient.tsx -Pattern 'text-text-muted py-4|hittades inte</div>|Laddar…</div>'
  ```
  Expected: no matches (acceptance for A1.4).
- [ ] **Step 5: Run `npm run typecheck`** Expected: passes.
- [ ] **Step 6: Run `npm run build`** Expected: static export succeeds.
- [ ] **Step 7: Commit**
  ```
  git commit -am "refactor(lists): designed loading/not-found/empty states in ListPageClient

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 1.6: A6.1 — CLAUDE.md stack line → Next 16 / React 19
**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: Update line 11**:
  ```markdown
  - **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, React Query (TanStack Query v5)
  ```
- [ ] **Step 2: Check for other stale refs**:
  ```powershell
  Select-String -Path CLAUDE.md -Pattern 'Next\.js 14|Next 14|React 18'
  ```
  Expected: no matches after the edit (update any stragglers in the same edit).
- [ ] **Step 3: Commit**
  ```
  git commit -am "docs: update CLAUDE.md stack line to Next.js 16 + React 19

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 1.7: A6.2 — SLO.md Lighthouse baseline
**Files:** Modify `docs/SLO.md`

- [ ] **Step 1: Run Lighthouse** against prod (or latest preview):
  ```powershell
  npx -y lighthouse https://binge.nu/ --only-categories=performance --preset=desktop --quiet --chrome-flags="--headless" --output=json --output-path=./lighthouse-baseline.json
  node -e "const r=require('./lighthouse-baseline.json');const a=r.audits;console.log('perf-score', Math.round(r.categories.performance.score*100));console.log('LCP', a['largest-contentful-paint'].displayValue);console.log('CLS', a['cumulative-layout-shift'].displayValue);console.log('TBT', a['total-blocking-time'].displayValue);"
  ```
  Record the four values. (If binge.nu is unreachable, run against a local `npm run build && npm run start` server and note the source.)
- [ ] **Step 2: Add a baseline section to `docs/SLO.md`** after the "Latens (performance)" table (after line 28), filling the measured values:
  ```markdown
  ### Lighthouse-baseline (engångsmätning)

  _Mätt 2026-06-04 mot `https://binge.nu/` (Lighthouse desktop-preset, performance-kategorin)._

  | Mått | Värde |
  |------|-------|
  | Performance-score | <fyll i från Step 1> |
  | LCP (lab) | <fyll i> |
  | CLS (lab) | <fyll i> |
  | TBT (lab) | <fyll i> |

  Lab-värdena ovan är en engångs-snapshot för regressionsjämförelse. De
  fältbaserade p75-targetsen i tabellen ovan (Plausible Web Vitals) gäller fortsatt som SLO.
  ```
- [ ] **Step 3: Update the checklist item** (line ~73): append `(Lighthouse lab-baseline införd 2026-06-04; fält-p75 väntar fortfarande på Plausible-data)`.
- [ ] **Step 4: Remove the throwaway report**: `Remove-Item ./lighthouse-baseline.json` (git status should show only `docs/SLO.md`).
- [ ] **Step 5: Commit**
  ```
  git commit -am "docs: record Lighthouse desktop baseline in SLO.md

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 1.8: Fas 1 verification gate
- [ ] **Step 1:** `npm run typecheck && npm run lint && npm test && npm run build` — all green.

---

## Fas 2 — Säkerhet & rules

### Task 2.1: Create the Firestore rules-test harness (vitest + emulator)
**Files:** Create `src/test/rules/firestore-rules.test.ts`, `vitest.rules.config.ts`; Modify `vitest.config.ts`, `package.json`

The repo declares a `test:rules` script pointing at `scripts/test-rules.mjs` which **does not exist**; `@firebase/rules-unit-testing@^5.0.1` is installed. Isolate rules tests in their own node-env config + emulator-wrapped script. **Emulator requires Java on PATH** (Android Studio JBR — see memory).

- [ ] **Step 1: Write the failing rules test** `src/test/rules/firestore-rules.test.ts` (asserts A2.1: unknown-field writes rejected, valid writes allowed, across all four paths). FAILS initially because rules have no `hasOnly`:
  ```ts
  import { readFileSync } from 'node:fs';
  import { resolve } from 'node:path';
  import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
  import {
    assertFails, assertSucceeds, initializeTestEnvironment,
    type RulesTestEnvironment,
  } from '@firebase/rules-unit-testing';
  import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

  const PROJECT_ID = 'binge-rules-test';
  const OWNER = 'owner_uid';
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8'),
        host: '127.0.0.1', port: 8080,
      },
    });
  });
  afterAll(async () => { await testEnv.cleanup(); });
  beforeEach(async () => { await testEnv.clearFirestore(); });
  function ownerDb() { return testEnv.authenticatedContext(OWNER).firestore(); }

  describe('users/{uid}/watchlist/{id} field whitelist', () => {
    it('allows a valid watchlist write', async () => {
      const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
      await assertSucceeds(setDoc(ref, {
        tmdbId: 603, mediaType: 'movie', status: 'vill_se', rating: null, notes: null,
        title: 'The Matrix', posterPath: null, releaseYear: 1999, totalSeasons: null,
        lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false, rewatchCount: 0,
        providers: [8], providersCheckedAt: null, visibility: null, genreIds: [28, 878],
        tmdbStatus: null, effectiveVisibility: 'private', isPublic: false,
        addedAt: serverTimestamp(), updatedAt: serverTimestamp(), watchedAt: null,
      }));
    });
    it('rejects a watchlist write with an unknown field', async () => {
      const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
      await assertFails(setDoc(ref, {
        tmdbId: 603, mediaType: 'movie', status: 'vill_se', title: 'The Matrix',
        evilField: 'pwned', addedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }));
    });
  });

  describe('reviews/{id} field whitelist', () => {
    it('allows a valid review write', async () => {
      const ref = doc(ownerDb(), 'reviews', 'r1');
      await assertSucceeds(setDoc(ref, {
        uid: OWNER, tmdbId: 603, mediaType: 'movie', text: 'Bra film.', spoiler: false,
        rating: 8, displayName: null, username: null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }));
    });
    it('rejects a review write with an unknown field', async () => {
      const ref = doc(ownerDb(), 'reviews', 'r1');
      await assertFails(setDoc(ref, {
        uid: OWNER, tmdbId: 603, mediaType: 'movie', text: 'Bra film.', injected: true,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }));
    });
  });

  describe('users/{uid}/episodeProgress/{id} field whitelist', () => {
    it('allows a valid episodeProgress write', async () => {
      const ref = doc(ownerDb(), 'users', OWNER, 'episodeProgress', '1399');
      await assertSucceeds(setDoc(ref, {
        tmdbId: 1399, seasons: { '1': { '1': { watched: true, watchedAt: serverTimestamp() } } },
      }));
    });
    it('rejects an episodeProgress write with an unknown field', async () => {
      const ref = doc(ownerDb(), 'users', OWNER, 'episodeProgress', '1399');
      await assertFails(setDoc(ref, { tmdbId: 1399, seasons: {}, junk: 'x' }));
    });
  });

  describe('users/{uid}/notInterested/{id} field whitelist', () => {
    it('allows a valid notInterested write', async () => {
      const ref = doc(ownerDb(), 'users', OWNER, 'notInterested', '603');
      await assertSucceeds(setDoc(ref, { tmdbId: 603, mediaType: 'movie', addedAt: serverTimestamp() }));
    });
    it('rejects a notInterested write with an unknown field', async () => {
      const ref = doc(ownerDb(), 'users', OWNER, 'notInterested', '603');
      await assertFails(setDoc(ref, { tmdbId: 603, mediaType: 'movie', addedAt: serverTimestamp(), spam: 1 }));
    });
  });
  ```
- [ ] **Step 2: Add `vitest.rules.config.ts`**:
  ```ts
  import { defineConfig } from 'vitest/config';
  export default defineConfig({
    test: {
      environment: 'node', globals: true,
      include: ['src/test/rules/**/*.test.ts'],
      testTimeout: 20000,
    },
  });
  ```
- [ ] **Step 3: Exclude rules tests from the default run** — edit `vitest.config.ts` `exclude`: add `'src/test/rules/**'`.
- [ ] **Step 4: Rewire `test:rules`** in `package.json`:
  ```json
  "test:rules": "firebase emulators:exec --only firestore \"vitest run --config vitest.rules.config.ts\"",
  ```
- [ ] **Step 5: Run (expect RED)**:
  ```powershell
  $env:Path = "C:\Program Files\Android\Android Studio\jbr\bin;" + $env:Path
  npm run test:rules
  ```
  Expected: emulator boots; the four `rejects ... unknown field` tests FAIL (no `hasOnly` yet); valid-write tests pass. If `Could not spawn java`, re-run the PATH export.
- [ ] **Step 6: Commit**
  ```
  git commit -am "test(rules): add @firebase/rules-unit-testing harness (tests RED)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 2.2: Add `hasOnly` field whitelists to the four write-paths (A2.1)
**Files:** Modify `firestore.rules` (Task 2.1 test goes GREEN)

Field lists are the exact union per writer (cross-referenced with WatchlistContext/useReviews/useEpisodeProgress/NotInterestedContext + domain.ts). **Critical:** merge-writes mean `request.resource.data` is the full post-merge doc — list *every* field the doc can ever hold.

- [ ] **Step 1: Add `isValidWatchlistItem` helper** (after `isValidList`, before `// ---- users ----`):
  ```
    function isValidWatchlistItem(d) {
      return d.keys().hasOnly([
        'tmdbId', 'mediaType', 'status', 'rating', 'notes', 'title',
        'posterPath', 'releaseYear', 'totalSeasons', 'lastWatchedSeason',
        'lastWatchedEpisode', 'dropped', 'rewatchCount', 'providers',
        'providersCheckedAt', 'visibility', 'genreIds', 'tmdbStatus',
        'effectiveVisibility', 'isPublic', 'addedAt', 'updatedAt', 'watchedAt'
      ]);
    }
  ```
- [ ] **Step 2: Apply to the watchlist write rule** — split write so the whitelist gates create/update only (delete has no `request.resource.data`):
  ```
      match /users/{uid}/watchlist/{itemId} {
        allow read, delete: if isOwner(uid);
        allow create, update: if isOwner(uid) && isValidWatchlistItem(request.resource.data);
  ```
  (Leave the existing visibility-based `allow read` clauses untouched.)
- [ ] **Step 3: Add `hasOnly` to `isValidReview`** — append as one more `&&` term (don't replace existing bounds):
  ```
        && matchesOwnIdentity(d)
        && d.keys().hasOnly([
          'uid', 'tmdbId', 'mediaType', 'text', 'rating', 'spoiler',
          'displayName', 'username', 'title', 'posterPath',
          'createdAt', 'updatedAt'
        ]);
  ```
- [ ] **Step 4: Whitelist episodeProgress** (replace the bare rule):
  ```
      match /users/{uid}/episodeProgress/{itemId} {
        allow read, delete: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && request.resource.data.keys().hasOnly(['tmdbId', 'seasons']);
      }
  ```
- [ ] **Step 5: Whitelist notInterested**:
  ```
      match /users/{uid}/notInterested/{itemId} {
        allow read, delete: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && request.resource.data.keys().hasOnly(['tmdbId', 'mediaType', 'addedAt']);
      }
  ```
- [ ] **Step 6: Run the rules test (expect GREEN)**:
  ```powershell
  $env:Path = "C:\Program Files\Android\Android Studio\jbr\bin;" + $env:Path
  npm run test:rules
  ```
  Expected: all 8 pass. If a "valid" case now fails, a legit field is missing from a whitelist — add it (do NOT remove `hasOnly`).
- [ ] **Step 7: Sanity-check + full suite**:
  ```powershell
  npx firebase deploy --only firestore:rules --dry-run
  npm run typecheck; npm run lint; npm test
  ```
  Expected: rules compile; typecheck/lint/test green (rules test excluded from `npm test`).
- [ ] **Step 8: Commit**
  ```
  git commit -am "feat(rules): hasOnly whitelists on watchlist/reviews/episodeProgress/notInterested

  NOTE: rules change — requires manual firebase deploy --only firestore:rules.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 2.3: Resolve dependency vulnerabilities (A2.2)
**Files:** Modify `package-lock.json`

- [ ] **Step 1: Baseline** — `npm audit --audit-level=high`. Record HIGH advisories. If already 0 HIGH, skip to commit-nothing.
- [ ] **Step 2: Apply non-breaking fixes** — `npm audit fix`.
- [ ] **Step 3: Re-check** — `npm audit --audit-level=high`. Expected: 0 HIGH. **If HIGH remain:** inspect `npm audit fix --force --dry-run`. Only `--force` if the major bumps are dev/transitive (not `next`/`react`/`firebase`). If `--force` would bump a core runtime dep, STOP and document the advisory as a known exception per A2.2.
- [ ] **Step 4: Verify nothing broke** — `npm run typecheck; npm run lint; npm test; npm run build`. If `--force` broke something: `git checkout -- package-lock.json package.json && npm ci`, then use the documented-exception path.
- [ ] **Step 5: Commit**
  ```
  git commit -am "chore(deps): npm audit fix — resolve HIGH advisories

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 2.4: Add `npm audit` gate to CI (A2.3)
**Files:** Modify `.github/workflows/ci.yml`

- [ ] **Step 1: Insert an Audit step** between `Install deps` and `Lint`:
  ```yaml
        - name: Install deps
          run: npm ci

        - name: Audit (high+)
          run: npm audit --audit-level=high

        - name: Lint
          run: npm run lint
  ```
- [ ] **Step 2: Verify locally** — `npm audit --audit-level=high`; confirm `$LASTEXITCODE` is `0`.
- [ ] **Step 3: Commit**
  ```
  git commit -am "ci: gate on npm audit --audit-level=high

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Fas 3 — Observability + Performance

### Task 3.1: Add the six missing analytics events (TDD)
**Files:** Modify `src/lib/analytics.ts`; Create `src/lib/analytics.test.ts`

- [ ] **Step 1: Write the failing test** `src/lib/analytics.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
  import { trackEvent, type AnalyticsEvent } from './analytics';

  describe('trackEvent', () => {
    beforeEach(() => { (window as unknown as { plausible?: unknown }).plausible = vi.fn(); });
    afterEach(() => { delete (window as unknown as { plausible?: unknown }).plausible; vi.restoreAllMocks(); });

    it('forwards name + props to window.plausible', () => {
      const spy = window.plausible as ReturnType<typeof vi.fn>;
      trackEvent('providers_selected', { count: 3 });
      expect(spy).toHaveBeenCalledWith('providers_selected', { props: { count: 3 } });
    });
    it('is a no-op when window.plausible is absent', () => {
      delete (window as unknown as { plausible?: unknown }).plausible;
      expect(() => trackEvent('advisor_viewed', { providerCount: 2 })).not.toThrow();
    });
    it('accepts each of the six new event shapes', () => {
      const spy = window.plausible as ReturnType<typeof vi.fn>;
      const events: AnalyticsEvent[] = [
        { name: 'providers_selected', props: { count: 4 } },
        { name: 'advisor_viewed', props: { providerCount: 2 } },
        { name: 'advisor_action_taken', props: { action: 'pause', providerId: 8 } },
        { name: 'search_submitted', props: { resultCount: 12, mediaFilter: 'all' } },
        { name: 'status_changed', props: { mediaType: 'tv', status: 'mina' } },
        { name: 'error_boundary_triggered', props: { scope: 'app:movie' } },
      ];
      for (const e of events) trackEvent(e.name, e.props as never);
      expect(spy).toHaveBeenCalledTimes(events.length);
    });
  });
  ```
  > Adjust the `trackEvent` call signature in the test to match the real one in `analytics.ts` (the grounding agent confirmed a `trackEvent(name, props)` shape; verify the exact `props`-wrapping the existing impl uses and align the first assertion to it).
- [ ] **Step 2: Run** `npx vitest run src/lib/analytics.test.ts` — Expected: FAILS (new names not in union).
- [ ] **Step 3: Extend the `AnalyticsEvent` union** in `src/lib/analytics.ts` (append after the existing last member; fix the trailing `;`):
  ```ts
    | { name: 'providers_selected'; props: { count: number } }
    | { name: 'advisor_viewed'; props: { providerCount: number } }
    | { name: 'advisor_action_taken'; props: { action: 'pause' | 'resume' | 'subscribe' | 'catchup'; providerId: number } }
    | { name: 'search_submitted'; props: { resultCount: number; mediaFilter: 'all' | 'movie' | 'tv' } }
    | { name: 'status_changed'; props: { mediaType: 'movie' | 'tv'; status: 'vill_se' | 'mina' | 'sedd' | 'avbruten' } }
    | { name: 'error_boundary_triggered'; props: { scope: string } };
  ```
- [ ] **Step 4: Run** `npx vitest run src/lib/analytics.test.ts` — Expected: PASSES.
- [ ] **Step 5: Commit**
  ```
  git commit -am "feat(analytics): add six observability event types to AnalyticsEvent union

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 3.2: Wire providers_selected + status_changed + error_boundary_triggered
**Files:** Modify `src/components/settings/ProvidersSection.tsx`, `src/contexts/WatchlistContext.tsx`, `src/components/layout/SegmentError.tsx`

- [ ] **Step 1: `providers_selected`** — in `ProvidersSection.tsx`, import `trackEvent` and fire it inside the debounced commit after `await updateProviders(ids)` succeeds: `trackEvent('providers_selected', { count: ids.length });`.
- [ ] **Step 2: `status_changed`** — in `WatchlistContext.tsx` (`trackEvent` already imported), in `updateStatus` after the `setDoc(...)`: `trackEvent('status_changed', { mediaType: currentItem?.mediaType ?? 'movie', status });`. (Do NOT add to `addItem` — it already fires `title_added_watchlist`.)
- [ ] **Step 3: `error_boundary_triggered`** — in `SegmentError.tsx`, import `trackEvent` and inside the existing `useEffect` after `captureError(...)`: `trackEvent('error_boundary_triggered', { scope });`. (Fires for every segment `error.tsx` via the shared component.)
- [ ] **Step 4: Run** `npm run typecheck && npm run lint` — Expected: clean.
- [ ] **Step 5: Commit**
  ```
  git commit -am "feat(analytics): fire providers_selected, status_changed, error_boundary_triggered

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 3.3: Wire advisor_viewed + advisor_action_taken
**Files:** Modify `src/app/savings/page.tsx`

- [ ] **Step 1: Imports** — add `useEffect` (merge into existing react import) and `import { trackEvent } from '@/lib/analytics';`.
- [ ] **Step 2: `advisor_viewed`** — after `const advisor = useSubscriptionAdvisor(...)`:
  ```ts
    const hasAdvisorProviders = advisor.providers.length > 0;
    useEffect(() => {
      if (!advisor.isLoading && hasAdvisorProviders) {
        trackEvent('advisor_viewed', { providerCount: advisor.providers.length });
      }
    }, [advisor.isLoading, hasAdvisorProviders, advisor.providers.length]);
  ```
- [ ] **Step 3: `advisor_action_taken` on resume** — wrap `onResume`:
  ```tsx
            onResume={(id) => { resumeProvider(id); trackEvent('advisor_action_taken', { action: 'resume', providerId: id }); }}
  ```
- [ ] **Step 4: `advisor_action_taken` on pause** — wrap `onPauseProvider`:
  ```tsx
              onPauseProvider={(id, resumeAt) => { pauseProvider(id, resumeAt); trackEvent('advisor_action_taken', { action: 'pause', providerId: id }); }}
  ```
- [ ] **Step 5: Run** `npm run typecheck && npm run lint` — Expected: clean.
- [ ] **Step 6: Commit**
  ```
  git commit -am "feat(analytics): fire advisor_viewed + advisor_action_taken on Streamingrådgivaren

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 3.4: Wire search_submitted
**Files:** Modify `src/app/search/page.tsx`

- [ ] **Step 1: Imports** — add `useEffect` (merge into existing react import) + `import { trackEvent } from '@/lib/analytics';`.
- [ ] **Step 2: Fire after results resolve** — inside `SearchResults`, keyed on query+filter:
  ```ts
    useEffect(() => {
      if (!query.trim() || isLoading) return;
      trackEvent('search_submitted', { resultCount: results.length, mediaFilter });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query, mediaFilter, isLoading]);
  ```
  (No search string in props → no PII. eslint-disable matches the repo's existing pattern in `useSubscriptionAdvisor.ts`.)
- [ ] **Step 3: Run** `npm run typecheck && npm run lint` — Expected: clean.
- [ ] **Step 4: Commit**
  ```
  git commit -am "feat(analytics): fire search_submitted when results resolve for a query

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 3.5: Add `Review` JSON-LD (TDD)
**Files:** Modify `src/components/title/JsonLd.tsx`; Create `src/components/title/JsonLd.test.ts`; Modify `src/components/title/ReviewList.tsx`

- [ ] **Step 1: Write the failing test** `src/components/title/JsonLd.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { reviewSchema, type ReviewSchemaInput } from './JsonLd';

  const base: ReviewSchemaInput = {
    id: 'r1', authorName: 'Anna', reviewBody: 'Riktigt bra.', rating: 8,
    itemName: 'Dune', itemType: 'Movie', itemUrl: 'https://binge.nu/movie/438631/',
  };

  describe('reviewSchema', () => {
    it('builds a Review embedded in itemReviewed', () => {
      const s = reviewSchema(base);
      expect(s['@type']).toBe('Review');
      expect(s.reviewBody).toBe('Riktigt bra.');
      expect(s.author).toEqual({ '@type': 'Person', name: 'Anna' });
      expect(s.itemReviewed).toEqual({ '@type': 'Movie', name: 'Dune', url: 'https://binge.nu/movie/438631/' });
    });
    it('maps a 0–10 rating to reviewRating with bestRating 10', () => {
      expect(reviewSchema(base).reviewRating).toEqual({ '@type': 'Rating', ratingValue: 8, bestRating: 10, worstRating: 1 });
    });
    it('omits reviewRating when rating is null', () => {
      expect(reviewSchema({ ...base, rating: null }).reviewRating).toBeUndefined();
    });
    it('supports TVSeries itemType', () => {
      const s = reviewSchema({ ...base, itemType: 'TVSeries', itemName: 'Severance' });
      expect((s.itemReviewed as Record<string, unknown>)['@type']).toBe('TVSeries');
    });
    it('falls back to "Anonym" when authorName is empty', () => {
      expect(reviewSchema({ ...base, authorName: '' }).author).toEqual({ '@type': 'Person', name: 'Anonym' });
    });
  });
  ```
- [ ] **Step 2: Run** `npx vitest run src/components/title/JsonLd.test.ts` — Expected: FAILS (no `reviewSchema`).
- [ ] **Step 3: Add the builder** in `JsonLd.tsx` after `breadcrumbSchema`:
  ```ts
  export interface ReviewSchemaInput {
    id: string; authorName: string; reviewBody: string; rating: number | null;
    itemName: string; itemType: 'Movie' | 'TVSeries'; itemUrl: string;
  }

  export function reviewSchema(input: ReviewSchemaInput): Record<string, unknown> {
    const schema: Record<string, unknown> = {
      '@context': 'https://schema.org', '@type': 'Review',
      reviewBody: input.reviewBody,
      author: { '@type': 'Person', name: input.authorName.trim() || 'Anonym' },
      itemReviewed: { '@type': input.itemType, name: input.itemName, url: input.itemUrl },
    };
    if (input.rating != null) {
      schema.reviewRating = { '@type': 'Rating', ratingValue: input.rating, bestRating: 10, worstRating: 1 };
    }
    return schema;
  }
  ```
- [ ] **Step 4: Run** `npx vitest run src/components/title/JsonLd.test.ts` — Expected: PASSES.
- [ ] **Step 5: Render from `ReviewList.tsx`** (where the review data already lives). Add `import { JsonLd, reviewSchema } from './JsonLd';`. After `otherReviews` is computed:
  ```tsx
    const itemType = mediaType === 'tv' ? 'TVSeries' : 'Movie';
    const itemUrl = `https://binge.nu/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}/`;
    const ldReviews = [myReview, ...otherReviews].filter(
      (r): r is Review => !!r && !r.spoiler && r.text.trim().length > 0,
    );
  ```
  Near the top of the returned fragment:
  ```tsx
        {title && ldReviews.map(r => (
          <JsonLd key={`ld-${r.id}`} data={reviewSchema({
            id: r.id, authorName: r.displayName, reviewBody: r.text, rating: r.rating,
            itemName: title, itemType, itemUrl,
          })} />
        ))}
  ```
  (`title` is already passed to `ReviewList` from both page clients — verify by grep; no page-client edit needed.)
- [ ] **Step 6: Run** `npm run typecheck && npm run lint` — Expected: clean (`Review` already imported in `ReviewList.tsx`).
- [ ] **Step 7: Commit**
  ```
  git commit -am "feat(seo): add Review JSON-LD for public reviews on movie/tv pages

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 3.6: Segment `error.tsx` for the dynamic routes
**Files:** Create `src/app/movie/[id]/error.tsx`, `src/app/tv/[id]/error.tsx`, `src/app/[...path]/error.tsx`

**Route-structure finding:** `movie/[id]` and `tv/[id]` are real folders → own `error.tsx`. `grupper/[id]` and `tillsammans/[id]` are served by the root catch-all `src/app/[...path]/` (DynamicRouter) — the existing `grupper/error.tsx` does NOT cover `/grupper/:id`. So the catch-all's new `error.tsx` covers the detail routes (spec's "eller motsvarande catch-all-segment").

- [ ] **Step 1: `movie/[id]/error.tsx`**:
  ```tsx
  'use client';
  import { SegmentError } from '@/components/layout/SegmentError';
  export default function MovieError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return <SegmentError error={error} reset={reset} scope="app:movie"
      heading="Kunde inte ladda filmen"
      body="Något gick fel när filmen skulle laddas. Försök igen om en stund." />;
  }
  ```
- [ ] **Step 2: `tv/[id]/error.tsx`** — same shape, `scope="app:tv"`, heading "Kunde inte ladda serien", body "Något gick fel när serien skulle laddas. Försök igen om en stund.".
- [ ] **Step 3: `[...path]/error.tsx`** (covers grupper/:id, tillsammans/:id, user/:u, list/:id):
  ```tsx
  'use client';
  import { SegmentError } from '@/components/layout/SegmentError';
  export default function CatchAllError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return <SegmentError error={error} reset={reset} scope="app:dynamic"
      heading="Kunde inte ladda sidan"
      body="Något gick fel. Försök igen, eller gå tillbaka till startsidan." />;
  }
  ```
  > Verify `SegmentError`'s actual prop names (`heading`/`body`/`scope`) by reading the existing `src/app/feed/error.tsx`; align if they differ.
- [ ] **Step 4: Design-token note (do not gold-plate here).** `SegmentError` uses `bg-accent`/`text-text-primary` rather than the `danger` token. Tightening it is shared across all boundaries — flag as a small follow-up, out of scope for this route-wiring task. `error_boundary_triggered` already fires from its effect (Task 3.2).
- [ ] **Step 5: Run** `npm run build` — Expected: build succeeds; App Router emits the new boundaries.
- [ ] **Step 6: Commit**
  ```
  git commit -am "feat(error): segment error boundaries for movie/[id], tv/[id], catch-all routes

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 3.7: Verify advisor fan-out staggering (A4.1)
**Files:** Read-verify `src/lib/tmdb/client.ts`, `src/hooks/useSubscriptionAdvisor.ts`; optional Create `src/lib/tmdb/client.test.ts`

**Finding:** advisor already routes every per-title fetch through `getTVShow(id,{signal})` → `client.ts` `acquireSlot()` 8-concurrent semaphore + 429 Retry-After + AbortSignal. No uncapped burst. This is verify-and-guard.

- [ ] **Step 1: Confirm the semaphore path** — read `client.ts`: `acquireSlot()` awaited in the shared fetch wrapper; `getTVShow` goes through it; `ctx.signal` reaches `getTVShow` (advisor's `queryFn` is `({signal}) => getTVShow(id,{signal})`). Document in the commit body; no code change if both hold.
- [ ] **Step 2: AbortSignal-on-navigation guard test** — add `src/lib/tmdb/client.test.ts` (or extend it) asserting the pre-acquire bailout:
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { getTVShow } from './client';
  describe('getTVShow abort', () => {
    it('rejects immediately when the signal is already aborted', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const ac = new AbortController(); ac.abort();
      await expect(getTVShow(1, { signal: ac.signal })).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });
  ```
  > If `client.ts` reads `NEXT_PUBLIC_TMDB_API_KEY` at module load and throws in test env, stub it via `vi.stubEnv` in `vitest.setup.ts`, or skip this test and rely on Step 1's manual verification — note which path you took.
- [ ] **Step 3: Stagger only if Step 1 reveals a gap** — if (and only if) `useQueries` bypasses the semaphore, add chunked `enabled` gating. Otherwise no change.
- [ ] **Step 4: Run** `npm run typecheck && npm test` — Expected: green.
- [ ] **Step 5: Commit**
  ```
  git commit -am "test(advisor): verify TMDB fan-out is semaphore-gated + aborts on navigation

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 3.8: Pure infinite-query page-param helper (TDD)
**Files:** Create `src/hooks/pagination.ts`, `src/hooks/pagination.test.ts`

- [ ] **Step 1: Write the failing test** `src/hooks/pagination.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { nextCursor, hasFullPage } from './pagination';

  describe('hasFullPage', () => {
    it('true when page is exactly pageSize', () => { expect(hasFullPage(new Array(50).fill(0), 50)).toBe(true); });
    it('false when page is short', () => { expect(hasFullPage(new Array(12).fill(0), 50)).toBe(false); });
    it('false for an empty page', () => { expect(hasFullPage([], 50)).toBe(false); });
  });
  describe('nextCursor', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    it('returns the last item as cursor when page is full', () => { expect(nextCursor(items, 3)).toEqual({ id: 'c' }); });
    it('returns undefined when the page is short', () => { expect(nextCursor(items, 50)).toBeUndefined(); });
    it('returns undefined for an empty page', () => { expect(nextCursor([], 50)).toBeUndefined(); });
  });
  ```
- [ ] **Step 2: Run** `npx vitest run src/hooks/pagination.test.ts` — Expected: FAILS.
- [ ] **Step 3: Implement** `src/hooks/pagination.ts`:
  ```ts
  /** Pure page-param logic for useInfiniteQuery + Firestore cursor pagination. */
  export function hasFullPage<T>(page: readonly T[], pageSize: number): boolean {
    return page.length === pageSize;
  }
  export function nextCursor<T>(page: readonly T[], pageSize: number): T | undefined {
    if (!hasFullPage(page, pageSize)) return undefined;
    return page[page.length - 1];
  }
  ```
- [ ] **Step 4: Run** `npx vitest run src/hooks/pagination.test.ts` — Expected: PASSES.
- [ ] **Step 5: Commit**
  ```
  git commit -am "feat(pagination): pure page-param helpers for infinite Firestore queries

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 3.9: Convert `useReviewsForTitle` to `useInfiniteQuery`
**Files:** Modify `src/hooks/useReviews.ts`, `src/components/title/ReviewList.tsx`

- [ ] **Step 1: Rewrite the query hook** — add `startAfter` + snapshot types to the firestore import and `useInfiniteQuery` to the react-query import. Replace `useReviewsForTitle`:
  ```ts
  const REVIEWS_PAGE_SIZE = 20;
  interface ReviewsPage { reviews: Review[]; cursor: QueryDocumentSnapshot<DocumentData> | null; full: boolean; }

  function mapReviewDoc(d: QueryDocumentSnapshot<DocumentData>): Review {
    const data = d.data();
    return {
      id: d.id, uid: data.uid, tmdbId: data.tmdbId, mediaType: data.mediaType,
      text: data.text, spoiler: data.spoiler ?? false, rating: data.rating ?? null,
      displayName: data.displayName ?? '', username: data.username ?? null,
      createdAt: toDate(data.createdAt), updatedAt: toDate(data.updatedAt),
    } as Review;
  }

  export function useReviewsForTitle(tmdbId: number) {
    return useInfiniteQuery({
      queryKey: ['reviews', tmdbId],
      initialPageParam: null as QueryDocumentSnapshot<DocumentData> | null,
      queryFn: async ({ pageParam }): Promise<ReviewsPage> => {
        const q = query(
          collection(db, 'reviews'),
          where('tmdbId', '==', tmdbId),
          orderBy('createdAt', 'desc'),
          ...(pageParam ? [startAfter(pageParam)] : []),
          limit(REVIEWS_PAGE_SIZE),
        );
        const snap = await getDocs(q);
        return {
          reviews: snap.docs.map(mapReviewDoc),
          cursor: snap.docs.length === REVIEWS_PAGE_SIZE ? snap.docs[snap.docs.length - 1] : null,
          full: snap.docs.length === REVIEWS_PAGE_SIZE,
        };
      },
      getNextPageParam: (last) => (last.full ? last.cursor : undefined),
      staleTime: 60_000,
    });
  }
  ```
  > Use the real existing `toDate` helper + `Review` mapping fields from the current `useReviews.ts` — align field names to the existing mapper rather than the illustrative set above.
- [ ] **Step 2: Invalidation unchanged** — `useReviewActions`' `invalidateQueries({ queryKey: ['reviews', tmdbId] })` works as-is.
- [ ] **Step 3: Update `ReviewList` consumer**:
  ```tsx
    const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useReviewsForTitle(tmdbId);
    const reviews = data?.pages.flatMap(p => p.reviews);
  ```
  (Rest of the component is unchanged — `reviews` is still `Review[] | undefined`.)
- [ ] **Step 4: Add "Visa fler"-button** after the mapped reviews:
  ```tsx
        {hasNextPage && (
          <button type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="btn btn-ghost">
            {isFetchingNextPage ? 'Laddar…' : 'Visa fler recensioner'}
          </button>
        )}
  ```
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test` — Expected: green.
- [ ] **Step 6: Commit**
  ```
  git commit -am "feat(reviews): paginate useReviewsForTitle with useInfiniteQuery + startAfter

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 3.10: Document why lists use single-doc reads (A4.2)
**Files:** Modify `src/hooks/useLists.ts`

**Finding:** `useMyLists` is an `onSnapshot` real-time subscription with `limit(100)`; `usePublicList` is a single `getDoc`; list items are an array field (`arrayUnion`). There is no unbounded *collection* query to paginate — converting would lose real-time or be incorrect.

- [ ] **Step 1: Confirm the data shape** (re-read `useLists.ts`) and add a short code comment near `useMyLists`/`usePublicList` documenting: items are an array field, `useMyLists` keeps `limit(100)`, and `pagination.ts` (Task 3.8) is the pattern for any *future* public-lists collection query. No functional change.
- [ ] **Step 2: Run** `npm run typecheck && npm run lint` — Expected: clean.
- [ ] **Step 3: Commit**
  ```
  git commit -am "docs(lists): document why lists use single-doc reads, not infinite queries

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 3.11: `isPublic` lazy-on-write denormalization (A4.3)
**Files:** Modify `src/contexts/WatchlistContext.tsx`, `src/hooks/usePublicProfile.ts`

**Finding:** `addItem`/`updateVisibility` already write `isPublic`+`effectiveVisibility`. The gap: the other mutators (`updateStatus`, `updateRating`, `updateNotes`, `updateProgress`, `updateTmdbStatus`) `merge` without re-asserting them. Lazy-on-write = re-assert on every touch; readers fall back to owner flag for old docs.

- [ ] **Step 1: Reader fallback** — in `usePublicProfile.ts`, ensure visibility resolution falls back to the owner profile's `defaultVisibility` when a watchlist doc has neither `effectiveVisibility` nor `isPublic`. Read the file to find the exact resolution point; if it filters server-side on `isPublic == true`, "absent = not public" is the inherent safe default (document which mechanism is in play).
- [ ] **Step 2: Re-assert on touch** — add a helper in the provider body:
  ```ts
    const effectiveVisibilityNow = useCallback((): { effectiveVisibility: ItemVisibility; isPublic: boolean } => {
      const eff = user?.defaultVisibility ?? 'private';
      return { effectiveVisibility: eff, isPublic: eff === 'public' };
    }, [user?.defaultVisibility]);
  ```
  Then in each of the five mutators, only when the item has no per-item `visibility` override:
  ```ts
      const current = items.find(i => i.tmdbId === tmdbId);
      const visFields = current?.visibility == null ? effectiveVisibilityNow() : {};
      await setDoc(ref, { /* existing fields */, ...visFields, updatedAt: serverTimestamp() }, { merge: true });
  ```
- [ ] **Step 3: No migration sweep** — old untouched docs rely on the Step 1 reader fallback (matches CLAUDE.md lazy-migration philosophy).
- [ ] **Step 4: Confirm rules compatibility** — `isPublic`+`effectiveVisibility` are in the watchlist `hasOnly` whitelist (Task 2.2) — verified there. Run `npm run typecheck && npm run lint && npm test` — Expected: green.
- [ ] **Step 5: Commit**
  ```
  git commit -am "feat(watchlist): re-assert isPublic on every mutating write (lazy-on-write)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 3.12: Fas 3 verification gate
- [ ] **Step 1:** `npm run typecheck && npm run lint && npm test && npm run build` — all green.
- [ ] **Step 2:** Grep each new event name; confirm a callsite per event.
- [ ] **Step 3:** Confirm `error.tsx` exists at `movie/[id]`, `tv/[id]`, `[...path]`.

---

## Fas 4 — Testinfra (MSW)

### Task 4.1: Install MSW v2
**Files:** Modify `package.json`, `package-lock.json`
- [ ] **Step 1:** `npm install --save-dev msw@2.10.2` (MSW v2 ships its own types; pin to a current v2 compatible with the repo's Vitest/jsdom — verify the exact latest v2 at run time).
- [ ] **Step 2:** Confirm `"msw"` appears in `devDependencies`.
- [ ] **Step 3:** `npm test` — Expected: all existing tests pass (zero impact).
- [ ] **Step 4: Commit** `chore(test): install msw v2 for network-level mocking`

### Task 4.2: MSW node server + TMDB handlers
**Files:** Create `src/test/server.ts`, `src/test/handlers.ts`
- [ ] **Step 1: Create `src/test/handlers.ts`** using the real TMDB base URL from `src/lib/tmdb/client.ts` (`https://api.themoviedb.org/3`) and MSW v2 `http`/`HttpResponse`:
  ```ts
  import { http, HttpResponse } from 'msw';
  const TMDB_BASE = 'https://api.themoviedb.org/3';
  export const defaultHandlers = [
    http.get(`${TMDB_BASE}/movie/:id`, () => HttpResponse.json({
      id: 1, title: 'Test Movie', original_title: 'Test Movie', overview: 'A test film.',
      release_date: '2024-01-01', poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg',
      genres: [], vote_average: 7.5, vote_count: 100, runtime: 120, status: 'Released',
      'watch/providers': { results: { SE: { flatrate: [] } } }, recommendations: { results: [] },
      credits: { cast: [], crew: [] }, videos: { results: [] },
    })),
    http.get(`${TMDB_BASE}/tv/:id`, () => HttpResponse.json({
      id: 1, name: 'Test Show', original_name: 'Test Show', overview: 'A test series.',
      first_air_date: '2024-01-01', poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg',
      genres: [], vote_average: 7.8, vote_count: 200, number_of_seasons: 2, status: 'Returning Series',
      last_episode_to_air: null, next_episode_to_air: null, seasons: [],
      'watch/providers': { results: { SE: { flatrate: [] } } }, recommendations: { results: [] },
      credits: { cast: [], crew: [] }, videos: { results: [] }, external_ids: {},
    })),
    http.get(`${TMDB_BASE}/search/multi`, ({ request }) => {
      const query = new URL(request.url).searchParams.get('query') ?? '';
      return HttpResponse.json({ page: 1, total_pages: 1, total_results: 1, results: [
        { id: 42, media_type: 'movie', title: `Result for ${query}`, original_title: `Result for ${query}`,
          poster_path: null, backdrop_path: null, overview: '', vote_average: 6.0, genre_ids: [], release_date: '2023-05-01' },
      ] });
    }),
  ];
  ```
  > Align the stub field shapes to the real `TMDBMovie`/`TMDBShow` types so the client's parsers don't choke; extend per test via `server.use()`.
- [ ] **Step 2: Create `src/test/server.ts`**:
  ```ts
  import { setupServer } from 'msw/node';
  import { defaultHandlers } from './handlers';
  export const server = setupServer(...defaultHandlers);
  ```
- [ ] **Step 3:** `npm run typecheck` — Expected: clean.
- [ ] **Step 4:** `npm test` — Expected: green (server created, not yet started).
- [ ] **Step 5: Commit** `test(msw): add MSW node server + default TMDB handlers`

### Task 4.3: Wire MSW lifecycle into vitest setup
**Files:** Modify `vitest.setup.ts`
- [ ] **Step 1: Add lifecycle hooks** (the file currently only imports jest-dom; `setupFiles` already points here):
  ```ts
  import '@testing-library/jest-dom/vitest';
  import { beforeAll, afterEach, afterAll } from 'vitest';
  import { server } from './src/test/server';
  beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  ```
- [ ] **Step 2:** `npm test` — Expected: all existing tests pass (no real network calls today). **Note:** the Task 3.7 `client.test.ts` abort test asserts `fetch` is NOT called; that still holds with MSW (MSW intercepts but the pre-abort bailout returns before fetch). Verify it stays green.
- [ ] **Step 3:** `npm run typecheck` — Expected: clean.
- [ ] **Step 4: Commit** `test(msw): wire MSW server lifecycle into vitest global setup`

### Task 4.4: Migrate a TMDB-fetch test to MSW
**Files:** Create `src/lib/tmdb/client.network.test.ts`
- [ ] **Step 1: Create the network test** (no prior network test exists; this demonstrates the MSW pattern replacing `vi.spyOn(globalThis,'fetch')`):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { http, HttpResponse } from 'msw';
  import { server } from '../test/server';
  import { getMovie, getTVShow, searchMulti } from './client';

  process.env.NEXT_PUBLIC_TMDB_API_KEY = 'test-key';

  describe('getMovie', () => {
    it('returns parsed movie data from the default handler', async () => {
      const movie = await getMovie(550);
      expect(movie.id).toBe(1);
      expect(movie.title).toBe('Test Movie');
    });
    it('can be overridden per-test', async () => {
      server.use(http.get('https://api.themoviedb.org/3/movie/:id', () => HttpResponse.json({
        id: 550, title: 'Fight Club', original_title: 'Fight Club', overview: 'First rule.',
        release_date: '1999-10-15', poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg',
        genres: [{ id: 18, name: 'Drama' }], vote_average: 8.8, vote_count: 25000, runtime: 139,
        status: 'Released', 'watch/providers': { results: { SE: { flatrate: [] } } },
        recommendations: { results: [] }, credits: { cast: [], crew: [] }, videos: { results: [] },
      })));
      const movie = await getMovie(550);
      expect(movie.id).toBe(550);
      expect(movie.runtime).toBe(139);
    });
    it('throws when TMDB returns a 404', async () => {
      server.use(http.get('https://api.themoviedb.org/3/movie/:id', () => new HttpResponse(null, { status: 404 })));
      await expect(getMovie(99999)).rejects.toThrow();
    });
  });

  describe('getTVShow', () => {
    it('returns parsed TV show data from the default handler', async () => {
      const show = await getTVShow(1396);
      expect(show.id).toBe(1);
      expect(show.status).toBe('Returning Series');
    });
  });

  describe('searchMulti', () => {
    it('passes query param and returns results', async () => {
      const results = await searchMulti('inception');
      expect(results.results[0].title).toBe('Result for inception');
    });
  });
  ```
  > Align imported fn names (`getMovie`/`getTVShow`/`searchMulti`) + return shapes to the real exports in `client.ts`; adjust assertions to the actual parsed field names.
- [ ] **Step 2:** `npm test` — Expected: all green; new tests included.
- [ ] **Step 3:** `npm run typecheck && npm run lint` — Expected: clean.
- [ ] **Step 4: Commit** `test(msw): add network tests for getMovie/getTVShow/searchMulti via MSW`

---

## Fas 5 — Roadmap-finputs (provider-data, assertNever, invite-token)

### Task 5.1: Provider catalog — Max rebrand + C More alias (TDD)
**Files:** Modify `src/lib/tmdb/providers.test.ts`, `src/lib/tmdb/providers.ts`

> **CONFIRM BEFORE MERGE:** the C More legacy TMDB-SE provider id (expected **1759**) could not be verified offline. Confirm via `curl "https://api.themoviedb.org/3/watch/providers/tv?language=sv-SE&watch_region=SE&api_key=$KEY"` and grep for `"C More"`. If it differs, substitute in both test and catalog.

- [ ] **Step 1: Write failing tests** — append to `src/lib/tmdb/providers.test.ts`:
  ```ts
  describe('B1 — Max rebrand (id 384)', () => {
    it('renders the HBO Max provider under the name "Max"', () => { expect(getProvider(384)?.name).toBe('Max'); });
    it('keeps the legacy HBO Max alias 1899 mapped to id 384', () => {
      expect(getProvider(1899)?.id).toBe(384); expect(canonicalProviderId(1899)).toBe(384);
    });
    it('lists Max exactly once', () => {
      const named = SWEDISH_PROVIDERS.filter(p => p.name === 'Max' || p.name === 'HBO Max');
      expect(named).toHaveLength(1); expect(named[0].name).toBe('Max');
    });
  });
  describe('B1 — C More legacy id maps to TV4 Play (id 489)', () => {
    const C_MORE_LEGACY_ID = 1759; // CONFIRM against live TMDB before merge
    it('canonicalises the C More legacy id to TV4 Play (489)', () => { expect(canonicalProviderId(C_MORE_LEGACY_ID)).toBe(489); });
    it('resolves to the TV4 Play struct', () => {
      expect(getProvider(C_MORE_LEGACY_ID)?.id).toBe(489); expect(getProvider(C_MORE_LEGACY_ID)?.name).toBe('TV4 Play');
    });
    it('keeps the existing TV4 Play alias 1944 intact', () => {
      expect(canonicalProviderId(1944)).toBe(489); expect(canonicalProviderId(C_MORE_LEGACY_ID)).toBe(489);
    });
    it('dedupes a title listed under both 489 and C More legacy', () => {
      const result = extractSEProviders({ 'watch/providers': { results: { SE: { flatrate: [{ provider_id: 489 }, { provider_id: C_MORE_LEGACY_ID }] } } } });
      expect(result).toEqual([489]);
    });
  });
  ```
  > Align `getProvider`/`canonicalProviderId`/`extractSEProviders`/`SWEDISH_PROVIDERS` to the real exports — verify names by reading the file's existing tests.
- [ ] **Step 2: Run** `npm test -- src/lib/tmdb/providers.test.ts` — Expected: new blocks FAIL.
- [ ] **Step 3: Rename id 384** in `providers.ts` — change only `name: 'Max'` (keep `shortName: 'HBO'`, `aliases: [1899]`, color, tiers).
- [ ] **Step 4: Add C More alias on id 489** — extend `aliases: [1944, 1759]` with a comment.
- [ ] **Step 5: Run** `npm test -- src/lib/tmdb/providers.test.ts` — Expected: PASS.
- [ ] **Step 6: Full verify** `npm run typecheck && npm run lint && npm test` — Expected: green.
- [ ] **Step 7: Commit**
  ```
  git commit -am "feat(providers): rebrand HBO Max → Max, add C More alias on TV4 Play

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 5.2: assertNever on in-memory exhaustive switches (TDD)
**Files:** Modify `src/types/recommendations.ts`, `src/app/insikter/components/format.ts`; Create `src/types/recommendations.assertNever.test.ts`

> **Scope (per `assertNever.ts` doc):** do NOT use `assertNever` on persisted unions — excludes `WatchStatus` (`WatchlistPage.labelForStatus`), `AggregationStrategy` (`together/matching.ts`), `watchStatus.migration.ts`. Safe in-memory targets: `RowId.kind` (`rowKey`) and `MetricFormat.kind` (`formatScalar`).

- [ ] **Step 1: Write the guard test** `src/types/recommendations.assertNever.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { rowKey, type RowId } from './recommendations';
  describe('rowKey exhaustiveness', () => {
    it('produces stable keys for every known kind', () => {
      expect(rowKey({ kind: 'similar', mediaType: 'movie', tmdbId: 603 })).toBe('similar:movie:603');
      expect(rowKey({ kind: 'person', personId: 140607 })).toBe('person:140607');
      expect(rowKey({ kind: 'genre-canon', genreId: 18 })).toBe('genre:18');
      expect(rowKey({ kind: 'thematic', keywordId: 9663 })).toBe('keyword:9663');
      expect(rowKey({ kind: 'trending' })).toBe('trending');
      expect(rowKey({ kind: 'latest-fav' })).toBe('latest-fav');
      expect(rowKey({ kind: 'upcoming' })).toBe('upcoming');
    });
    it('throws via assertNever for an unknown kind', () => {
      const bogus = { kind: 'does-not-exist' } as unknown as RowId;
      expect(() => rowKey(bogus)).toThrow(/assertNever/);
    });
  });
  ```
  > Align the `RowId` member shapes + expected key strings to the real `rowKey` in `recommendations.ts` (read it first; the cases above are illustrative).
- [ ] **Step 2: Run** `npm test -- src/types/recommendations.assertNever.test.ts` — Expected: the "throws" case FAILS (currently returns `undefined`).
- [ ] **Step 3: Migrate `rowKey`** — add `import { assertNever } from '@/lib/assertNever';` and `default: return assertNever(id);`.
- [ ] **Step 4: Migrate `formatScalar`** in `format.ts` — add the import + `default: return assertNever(format);`. If `tsc` says `format` isn't `never`, a `MetricFormat` member is unhandled — handle it explicitly (read `metrics/types.ts`).
- [ ] **Step 5: Run** `npm test -- src/types/recommendations.assertNever.test.ts && npm run typecheck` — Expected: green (tsc proves exhaustiveness).
- [ ] **Step 6: Full verify** `npm run lint && npm test && npm run build` — Expected: green.
- [ ] **Step 7: Commit**
  ```
  git commit -am "refactor: assertNever on in-memory exhaustive switches (rowKey, formatScalar)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 5.3: Invite-token age/should-rotate helper (TDD)
**Files:** Create `src/lib/groupInviteToken.ts`, `src/lib/groupInviteToken.test.ts`

> **Grounding:** `GroupSidePanels.tsx` already has an inline 180-day `isStale` nudge ("N dagar"). B3 adds a month-worded label + a separate 30-day auto-rotation threshold, extracted as pure logic.

- [ ] **Step 1: Write the helper test** `src/lib/groupInviteToken.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import {
    inviteTokenAgeDays, inviteTokenAgeLabel, shouldAutoRotateInviteToken,
    AUTO_ROTATE_AFTER_DAYS, STALE_NUDGE_AFTER_DAYS,
  } from './groupInviteToken';
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date('2026-06-04T12:00:00Z').getTime();

  describe('inviteTokenAgeDays', () => {
    it('null when rotatedAt is null', () => { expect(inviteTokenAgeDays(null, now)).toBeNull(); });
    it('whole days since rotation', () => { expect(inviteTokenAgeDays(new Date(now - 10 * DAY), now)).toBe(10); });
    it('floors partial days', () => { expect(inviteTokenAgeDays(new Date(now - (5 * DAY + DAY / 2)), now)).toBe(5); });
    it('clamps future rotatedAt to 0', () => { expect(inviteTokenAgeDays(new Date(now + 3 * DAY), now)).toBe(0); });
  });
  describe('inviteTokenAgeLabel', () => {
    it('null when unknown', () => { expect(inviteTokenAgeLabel(null, now)).toBeNull(); });
    it('words days under a month', () => { expect(inviteTokenAgeLabel(new Date(now - 5 * DAY), now)).toBe('Länken är 5 dagar gammal'); });
    it('singular dag for one day', () => { expect(inviteTokenAgeLabel(new Date(now - 1 * DAY), now)).toBe('Länken är 1 dag gammal'); });
    it('words whole months ≥ 30 days', () => { expect(inviteTokenAgeLabel(new Date(now - 60 * DAY), now)).toBe('Länken är 2 månader gammal'); });
    it('singular månad for one month', () => { expect(inviteTokenAgeLabel(new Date(now - 30 * DAY), now)).toBe('Länken är 1 månad gammal'); });
  });
  describe('shouldAutoRotateInviteToken', () => {
    it('false when token inactive', () => { expect(shouldAutoRotateInviteToken({ isOwner: true, tokenIsActive: false, rotatedAt: new Date(now - 200 * DAY), now })).toBe(false); });
    it('false when not owner', () => { expect(shouldAutoRotateInviteToken({ isOwner: false, tokenIsActive: true, rotatedAt: new Date(now - 200 * DAY), now })).toBe(false); });
    it('false when rotatedAt unknown', () => { expect(shouldAutoRotateInviteToken({ isOwner: true, tokenIsActive: true, rotatedAt: null, now })).toBe(false); });
    it('false when younger than threshold', () => { expect(shouldAutoRotateInviteToken({ isOwner: true, tokenIsActive: true, rotatedAt: new Date(now - 29 * DAY), now })).toBe(false); });
    it('true when owner + older than 30 days', () => { expect(shouldAutoRotateInviteToken({ isOwner: true, tokenIsActive: true, rotatedAt: new Date(now - 31 * DAY), now })).toBe(true); });
    it('true at the threshold boundary', () => { expect(shouldAutoRotateInviteToken({ isOwner: true, tokenIsActive: true, rotatedAt: new Date(now - AUTO_ROTATE_AFTER_DAYS * DAY), now })).toBe(true); });
  });
  describe('constants', () => {
    it('thresholds are 30 and 180 days', () => { expect(AUTO_ROTATE_AFTER_DAYS).toBe(30); expect(STALE_NUDGE_AFTER_DAYS).toBe(180); });
  });
  ```
- [ ] **Step 2: Run** `npm test -- src/lib/groupInviteToken.test.ts` — Expected: FAILS (no module).
- [ ] **Step 3: Implement** `src/lib/groupInviteToken.ts`:
  ```ts
  const DAY_MS = 24 * 60 * 60 * 1000;
  export const AUTO_ROTATE_AFTER_DAYS = 30;
  export const STALE_NUDGE_AFTER_DAYS = 180;

  export function inviteTokenAgeDays(rotatedAt: Date | null, now: number): number | null {
    if (!rotatedAt) return null;
    const diff = now - rotatedAt.getTime();
    if (diff <= 0) return 0;
    return Math.floor(diff / DAY_MS);
  }
  export function inviteTokenAgeLabel(rotatedAt: Date | null, now: number): string | null {
    const days = inviteTokenAgeDays(rotatedAt, now);
    if (days === null) return null;
    if (days < 30) { const unit = days === 1 ? 'dag' : 'dagar'; return `Länken är ${days} ${unit} gammal`; }
    const months = Math.floor(days / 30); const unit = months === 1 ? 'månad' : 'månader';
    return `Länken är ${months} ${unit} gammal`;
  }
  export function shouldAutoRotateInviteToken(params: {
    isOwner: boolean; tokenIsActive: boolean; rotatedAt: Date | null; now: number;
  }): boolean {
    if (!params.isOwner || !params.tokenIsActive) return false;
    const days = inviteTokenAgeDays(params.rotatedAt, params.now);
    if (days === null) return false;
    return days >= AUTO_ROTATE_AFTER_DAYS;
  }
  ```
- [ ] **Step 4: Run** `npm test -- src/lib/groupInviteToken.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```
  git commit -am "feat(groups): pure invite-token age/auto-rotate helper

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 5.4: Wire InvitePanel — badge + lazy auto-rotation
**Files:** Modify `src/components/groups/GroupSidePanels.tsx` (+ the `<InvitePanel>` callsite in `GroupPageClient`)

> **Grounding:** `InvitePanel` currently computes `tokenAgeDays`/`isStale` inline vs `TOKEN_STALE_DAYS=180`, uses `useMountTime()`, and only rotates on the manual button. It does NOT know the viewer — B3 adds an `isOwner` prop from the callsite.

- [ ] **Step 1: Add `isOwner` prop + use the helper** — import the helper symbols, remove the inline `TOKEN_STALE_DAYS` + `tokenAgeDays`/`isStale`, and change the signature to accept `isOwner: boolean`. Derive:
  ```ts
    const tokenIsActive = group.inviteTokenHash !== null;
    const rotatedAt = group.inviteTokenRotatedAt ?? null;
    const now = useMountTime(); // number | null
    const ageLabel = now !== null ? inviteTokenAgeLabel(rotatedAt, now) : null;
    const ageDays = now !== null ? inviteTokenAgeDays(rotatedAt, now) : null;
    const isStale = ageDays !== null && ageDays >= STALE_NUDGE_AFTER_DAYS;
  ```
- [ ] **Step 2: Lazy auto-rotation effect** (owner only, once) — add `useRef` to the react import and reuse the existing `handleRotate`:
  ```ts
    const autoRotatedRef = useRef(false);
    useEffect(() => {
      if (now === null || autoRotatedRef.current || working) return;
      if (shouldAutoRotateInviteToken({ isOwner, tokenIsActive, rotatedAt, now })) {
        autoRotatedRef.current = true;
        void handleRotate();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [now, isOwner, tokenIsActive, rotatedAt, working]);
  ```
  > If lint complains after the disable comment, prefer satisfying it (memoize `handleRotate` with `useCallback`, add to deps) over leaving a lint error — CI lints.
- [ ] **Step 3: Month-worded badge** — replace the existing `isStale` badge JSX:
  ```tsx
              {isStale && ageLabel && (
                <div className="text-xxs text-amber-700 bg-amber-50 border border-amber-200 rounded-sm px-2 py-1">
                  {ageLabel}. Generera en ny om du misstänker att den läckt.
                </div>
              )}
  ```
  (Keep the pre-existing `amber` classes — moving them to a token is out of scope.)
- [ ] **Step 4: Pass `isOwner` from the callsite** — grep for `<InvitePanel` (likely `GroupPageClient.tsx`); add `isOwner={group.ownerUid === myUid}` (the page already has `myUid` for `LeavePanel`).
- [ ] **Step 5: Verify** `npm run typecheck && npm run lint && npm test && npm run build` — Expected: green (typecheck confirms the new required prop is supplied; helper logic is covered by Task 5.3).
- [ ] **Step 6: Commit**
  ```
  git commit -am "feat(groups): invite-link age badge + lazy auto-rotation on owner open

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 5.5: Fas 5 verification gate
- [ ] **Step 1:** `npm run typecheck && npm run lint && npm test && npm run build` — green.
- [ ] **Step 2:** Confirm `getProvider(384)?.name === 'Max'` and `canonicalProviderId(<C More id>) === 489`.
- [ ] **Step 3 (pre-merge gate):** confirm the real C More legacy id against live TMDB; fix alias + test constant if it differs; amend the Task 5.1 commit.

---

## Fas 6 — Episod-release-push (Cloud Function)

### Task 6.1: Pure logic — qualification + dedupe (TDD)
**Files:** Create `functions/src/episodeNotify/logic.ts`, `functions/src/episodeNotify/logic.test.ts`

Mirrors the client's `tvSubState()` chain (`airingState`/`isEndedStatus`/`isUserBehindOnAired`) so the function only notifies `'ikapp'` shows, plus the dedupe decision. No firebase-admin import — runs under the root Vitest suite (`vitest.config.ts` already globs `functions/src/**/*.test.ts`). The client logic uses `@/` aliases that don't resolve under `functions/tsconfig.json`, so **copy** the pure functions faithfully.

- [ ] **Step 1: Write the failing test** `functions/src/episodeNotify/logic.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import {
    airingState, isEndedStatus, isUserBehindOnAired, deriveSubState, shouldNotify,
    type WatchlistLite, type LastEpisode,
  } from './logic';

  const baseItem: WatchlistLite = {
    uid: 'u1', tmdbId: 100, mediaType: 'tv', status: 'mina', title: 'Show',
    lastWatchedSeason: 2, lastWatchedEpisode: 8, tmdbStatus: 'Returning Series',
  };
  const lastEp = (id: number, s: number, e: number): LastEpisode => ({ id, season_number: s, episode_number: e });

  describe('airingState / isEndedStatus', () => {
    it('ongoing for Returning Series / In Production / Planned', () => {
      expect(airingState('Returning Series')).toBe('ongoing');
      expect(isEndedStatus('Returning Series')).toBe(false);
    });
    it('ended for Ended / Canceled / Cancelled', () => {
      expect(isEndedStatus('Ended')).toBe(true);
      expect(isEndedStatus('Canceled')).toBe(true);
      expect(isEndedStatus('Cancelled')).toBe(true);
    });
    it('not-ended for null', () => { expect(isEndedStatus(null)).toBe(false); });
  });
  describe('isUserBehindOnAired', () => {
    it('not behind when not started', () => { expect(isUserBehindOnAired({ ...baseItem, lastWatchedSeason: null }, lastEp(1, 2, 8))).toBe(false); });
    it('not behind when no aired episode', () => { expect(isUserBehindOnAired(baseItem, null)).toBe(false); });
    it('behind when season < aired season', () => { expect(isUserBehindOnAired({ ...baseItem, lastWatchedSeason: 1, lastWatchedEpisode: 99 }, lastEp(5, 2, 1))).toBe(true); });
    it('behind when same season, episode < aired', () => { expect(isUserBehindOnAired({ ...baseItem, lastWatchedSeason: 2, lastWatchedEpisode: 7 }, lastEp(5, 2, 8))).toBe(true); });
    it('caught up at the aired episode', () => { expect(isUserBehindOnAired({ ...baseItem, lastWatchedSeason: 2, lastWatchedEpisode: 8 }, lastEp(5, 2, 8))).toBe(false); });
  });
  describe('deriveSubState', () => {
    it("'ikapp' = caught up + airing", () => { expect(deriveSubState({ ...baseItem, lastWatchedSeason: 2, lastWatchedEpisode: 8 }, 'Returning Series', lastEp(5, 2, 8))).toBe('ikapp'); });
    it("'aktiv' = behind", () => { expect(deriveSubState({ ...baseItem, lastWatchedSeason: 1, lastWatchedEpisode: 1 }, 'Returning Series', lastEp(5, 2, 8))).toBe('aktiv'); });
    it("'avslutad' = caught up + ended", () => { expect(deriveSubState({ ...baseItem, lastWatchedSeason: 2, lastWatchedEpisode: 8 }, 'Ended', lastEp(5, 2, 8))).toBe('avslutad'); });
    it("'none' = not 'mina' or not started", () => {
      expect(deriveSubState({ ...baseItem, status: 'vill_se' }, 'Returning Series', lastEp(5, 2, 8))).toBe('none');
      expect(deriveSubState({ ...baseItem, lastWatchedSeason: null }, 'Returning Series', lastEp(5, 2, 8))).toBe('none');
    });
  });
  describe('shouldNotify', () => {
    it('true for a new aired episode id', () => { expect(shouldNotify(lastEp(900, 3, 1), 850)).toBe(true); });
    it('false when id equals stored (idempotent)', () => { expect(shouldNotify(lastEp(900, 3, 1), 900)).toBe(false); });
    it('true on first run (no stored id)', () => { expect(shouldNotify(lastEp(900, 3, 1), null)).toBe(true); });
    it('false when no aired episode', () => { expect(shouldNotify(null, 850)).toBe(false); });
  });
  ```
- [ ] **Step 2: Implement** `functions/src/episodeNotify/logic.ts` — faithful copies of `src/lib/airingState.ts` + `isUserBehindOnAired` + the `'ikapp'` branch of `tvSubState`:
  ```ts
  export type AiringState = 'ongoing' | 'ended' | 'unknown';
  export type TvSubState = 'aktiv' | 'ikapp' | 'avslutad' | 'none';
  export interface LastEpisode { id: number; season_number: number; episode_number: number; }
  export interface WatchlistLite {
    uid: string; tmdbId: number; mediaType: string; status: string; title: string;
    lastWatchedSeason: number | null; lastWatchedEpisode: number | null; tmdbStatus: string | null;
  }

  export function airingState(tmdbStatus: string | null | undefined): AiringState {
    if (!tmdbStatus) return 'unknown';
    const s = tmdbStatus.toLowerCase();
    if (s === 'returning series' || s === 'in production' || s === 'planned') return 'ongoing';
    if (s === 'ended' || s === 'canceled' || s === 'cancelled' || s === 'pilot') return 'ended';
    return 'unknown';
  }
  export function isEndedStatus(tmdbStatus: string | null | undefined): boolean {
    return airingState(tmdbStatus) === 'ended';
  }
  export function isUserBehindOnAired(item: WatchlistLite, last: LastEpisode | null): boolean {
    if (item.lastWatchedSeason == null) return false;
    if (!last) return false;
    const userS = item.lastWatchedSeason ?? 0;
    const userE = item.lastWatchedEpisode ?? 0;
    if (userS < last.season_number) return true;
    if (userS === last.season_number && userE < last.episode_number) return true;
    return false;
  }
  export function deriveSubState(item: WatchlistLite, tmdbStatus: string | null, last: LastEpisode | null): TvSubState {
    if (item.mediaType !== 'tv') return 'none';
    if (item.status !== 'mina') return 'none';
    if (item.lastWatchedSeason == null) return 'none';
    if (isUserBehindOnAired(item, last)) return 'aktiv';
    return isEndedStatus(tmdbStatus) ? 'avslutad' : 'ikapp';
  }
  export function shouldNotify(last: LastEpisode | null, lastNotifiedEpisodeId: number | null): boolean {
    if (!last) return false;
    return last.id !== lastNotifiedEpisodeId;
  }
  ```
  > Cross-check `airingState` against the real `src/lib/airingState.ts` — if the client maps any status differently (e.g. 'pilot'), match it exactly so server and client agree.
- [ ] **Step 3: Run** `npm test -- functions/src/episodeNotify/logic.test.ts` — Expected: PASS.
- [ ] **Step 4: Commit** `feat(functions): pure episode-release qualification + dedupe logic (B4)`

### Task 6.2: TMDB fetch helper (secret-bound)
**Files:** Create `functions/src/episodeNotify/tmdb.ts`

Mirror the `defineSecret` pattern from `functions/src/insights/api.ts`. Returns only `status` + `last_episode_to_air`.

- [ ] **Step 1: Implement** `functions/src/episodeNotify/tmdb.ts`:
  ```ts
  import { logger } from 'firebase-functions/v2';
  import type { LastEpisode } from './logic';
  const BASE_URL = 'https://api.themoviedb.org/3';
  export interface TvAiringInfo { status: string | null; lastEpisode: LastEpisode | null; }

  export async function fetchTvAiringInfo(tmdbId: number): Promise<TvAiringInfo | null> {
    const key = process.env.TMDB_API_KEY;
    if (!key) { logger.error('episodeNotify: TMDB_API_KEY not set'); return null; }
    try {
      const res = await fetch(`${BASE_URL}/tv/${tmdbId}?api_key=${key}&language=sv-SE`);
      if (!res.ok) { logger.warn(`episodeNotify: TMDB /tv/${tmdbId} → ${res.status}`); return null; }
      const json = (await res.json()) as { status?: string; last_episode_to_air?: { id: number; season_number: number; episode_number: number } | null };
      const last = json.last_episode_to_air ?? null;
      return { status: json.status ?? null, lastEpisode: last ? { id: last.id, season_number: last.season_number, episode_number: last.episode_number } : null };
    } catch (err) { logger.warn(`episodeNotify: TMDB fetch failed for ${tmdbId}`, err); return null; }
  }
  ```
- [ ] **Step 2: Verify it compiles** — `npm --prefix functions run build` (fetch is global on Node 20). Expected: tsc exits 0.
- [ ] **Step 3: Commit** `feat(functions): secret-bound TMDB airing-info fetch for episode push (B4)`

### Task 6.3: Extract shared FCM sender
**Files:** Create `functions/src/push.ts`; Modify `functions/src/index.ts`

Lift `sendPushToUser` + `NotifPayload` + `FcmTokenDoc` (currently inline in `index.ts` ~lines 37–133) into a shared module so both the existing triggers and the new function use one sender.

- [ ] **Step 1: Create `functions/src/push.ts`** — move the existing block verbatim (token fetch, `pushEnabled` gate, `sendEach`, invalid-token cleanup, `lastUsedAt` bump), exporting `sendPushToUser` + `NotifPayload`. Do not re-author the body — the existing `index.ts:58-133` logic is the source of truth.
- [ ] **Step 2: Trim `functions/src/index.ts`** — remove the moved interfaces + function, remove now-unused imports (`getMessaging`, `type Message`), add `import { sendPushToUser } from './push';`. Leave both triggers' bodies unchanged.
- [ ] **Step 3: Build** — `npm --prefix functions run build`. Expected: tsc exits 0 (`noUnusedLocals` guards dangling imports).
- [ ] **Step 4: Commit** `refactor(functions): extract shared sendPushToUser into push.ts (B4 prep)`

### Task 6.4: Scheduled function `episodeReleaseNotify`
**Files:** Create `functions/src/episodeNotify/index.ts`; Modify `firestore.indexes.json`

`onSchedule('every 6 hours', europe-west1)`. `collectionGroup('watchlist')` (narrowed via `.select()`) finds TV in `'mina'`; `uid` from `d.ref.parent.parent.id`. Per unique show: fetch TMDB, derive `'ikapp'`, dedupe vs per-show `episodeNotifyState/{tmdbId}.lastNotifiedEpisode` (idempotent), notify users with `episodeReleases` on.

- [ ] **Step 1: Implement** `functions/src/episodeNotify/index.ts`:
  ```ts
  import { getFirestore, FieldValue } from 'firebase-admin/firestore';
  import { onSchedule } from 'firebase-functions/v2/scheduler';
  import { logger } from 'firebase-functions/v2';
  import { defineSecret } from 'firebase-functions/params';
  import { sendPushToUser } from '../push';
  import { fetchTvAiringInfo } from './tmdb';
  import { deriveSubState, shouldNotify, type WatchlistLite, type LastEpisode } from './logic';

  const TMDB_API_KEY = defineSecret('TMDB_API_KEY');

  async function readFollowedSeries(): Promise<WatchlistLite[]> {
    const db = getFirestore();
    const snap = await db.collectionGroup('watchlist')
      .where('mediaType', '==', 'tv').where('status', '==', 'mina')
      .select('mediaType', 'status', 'title', 'tmdbId', 'lastWatchedSeason', 'lastWatchedEpisode', 'tmdbStatus')
      .get();
    return snap.docs.map((d) => {
      const x = d.data();
      const uid = d.ref.parent.parent?.id ?? '';
      return {
        uid, tmdbId: Number(x.tmdbId ?? Number(d.id)), mediaType: String(x.mediaType ?? ''),
        status: String(x.status ?? ''), title: String(x.title ?? ''),
        lastWatchedSeason: typeof x.lastWatchedSeason === 'number' ? x.lastWatchedSeason : null,
        lastWatchedEpisode: typeof x.lastWatchedEpisode === 'number' ? x.lastWatchedEpisode : null,
        tmdbStatus: typeof x.tmdbStatus === 'string' ? x.tmdbStatus : null,
      };
    });
  }
  async function readLastNotified(tmdbId: number): Promise<number | null> {
    const snap = await getFirestore().collection('episodeNotifyState').doc(String(tmdbId)).get();
    const v = snap.data()?.lastNotifiedEpisode;
    return typeof v === 'number' ? v : null;
  }
  async function episodeReleasesEnabled(uid: string): Promise<boolean> {
    const snap = await getFirestore().collection('users').doc(uid).get();
    if (!snap.exists) return false;
    const settings = snap.data()?.notificationSettings as { episodeReleases?: boolean } | undefined;
    return settings?.episodeReleases !== false; // default on
  }
  function episodeCode(last: LastEpisode): string {
    return `S${String(last.season_number).padStart(2, '0')}E${String(last.episode_number).padStart(2, '0')}`;
  }

  async function processShow(tmdbId: number, items: WatchlistLite[]): Promise<number> {
    const info = await fetchTvAiringInfo(tmdbId);
    if (!info) return 0;
    const lastNotified = await readLastNotified(tmdbId);
    if (!shouldNotify(info.lastEpisode, lastNotified)) return 0;
    const last = info.lastEpisode!;
    const db = getFirestore();
    const recipients = items.filter((it) => deriveSubState(it, info.status, last) === 'ikapp');
    if (recipients.length === 0) {
      await db.collection('episodeNotifyState').doc(String(tmdbId))
        .set({ lastNotifiedEpisode: last.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return 0;
    }
    const title = recipients[0]?.title || 'En serie du följer';
    const code = episodeCode(last);
    const actionUrl = `/tv/${tmdbId}/`;
    let notified = 0;
    await Promise.allSettled(recipients.map(async (it) => {
      if (!(await episodeReleasesEnabled(it.uid))) return;
      const notifId = `episode-${tmdbId}-${last.id}`;
      await db.collection('users').doc(it.uid).collection('notifications').doc(notifId).set({
        tmdbId, mediaType: 'tv', title: it.title || title, kind: 'episode_release',
        episodeCode: code, read: false, createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await sendPushToUser(it.uid, { title: 'Nytt avsnitt', body: `${it.title || title} — ${code} har släppts`, actionUrl, tag: `episode-${tmdbId}` });
      notified += 1;
    }));
    await db.collection('episodeNotifyState').doc(String(tmdbId))
      .set({ lastNotifiedEpisode: last.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return notified;
  }

  export const episodeReleaseNotify = onSchedule(
    { schedule: 'every 6 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB', secrets: [TMDB_API_KEY] },
    async () => {
      let series: WatchlistLite[] = [];
      try { series = await readFollowedSeries(); }
      catch (err) { logger.error('episodeNotify: watchlist scan failed', err); return; }
      const byShow = new Map<number, WatchlistLite[]>();
      for (const it of series) { const arr = byShow.get(it.tmdbId); if (arr) arr.push(it); else byShow.set(it.tmdbId, [it]); }
      let totalNotified = 0;
      for (const [tmdbId, items] of byShow) {
        try { totalNotified += await processShow(tmdbId, items); }
        catch (err) { logger.error(`episodeNotify: show ${tmdbId} failed`, err); }
      }
      logger.info('episodeNotify done', { followedTvDocs: series.length, uniqueShows: byShow.size, notified: totalNotified });
    },
  );
  ```
  > Verify the FCM token storage shape + `notificationSettings` path against the real `index.ts`/`AuthContext` before relying on `episodeReleasesEnabled`. Admin SDK bypasses `firestore.rules`, so no rule change is needed for `episodeNotifyState`.
- [ ] **Step 2: Add the collection-group index** to `firestore.indexes.json`:
  ```json
  { "collectionGroup": "watchlist", "queryScope": "COLLECTION_GROUP",
    "fields": [ { "fieldPath": "mediaType", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" } ] }
  ```
  (Ships via `firebase deploy --only firestore:indexes` — runbook.)
- [ ] **Step 3: Build** — `npm --prefix functions run build` (import from `../push` resolves after Task 6.3). Expected: tsc exits 0.
- [ ] **Step 4: Commit** `feat(functions): scheduled episodeReleaseNotify — ikapp-filtered episode push (B4)`

### Task 6.5: Export `episodeReleaseNotify`
**Files:** Modify `functions/src/index.ts`
- [ ] **Step 1: Add the export** at the bottom alongside the insights exports:
  ```ts
  export { episodeReleaseNotify } from './episodeNotify';
  ```
- [ ] **Step 2: Build** — `npm --prefix functions run build`. Expected: tsc exits 0.
- [ ] **Step 3: Commit** `feat(functions): export episodeReleaseNotify entrypoint (B4)`

### Task 6.6: `episodeReleases` preference field + toggle
**Files:** Modify `src/types/domain.ts`, `src/contexts/AuthContext.tsx` (3 sites), `src/components/settings/NotificationsSection.tsx`

- [ ] **Step 1: Type** — add `episodeReleases: boolean;` to the `notificationSettings` block in `domain.ts`.
- [ ] **Step 2: Read-mapper** — in `AuthContext.tsx` (~line 144) add `episodeReleases: data.notificationSettings?.episodeReleases ?? true,`.
- [ ] **Step 3: Profile-creation defaults** — add `episodeReleases: true` to BOTH default blocks (~line 180 object + ~line 279 inline).
- [ ] **Step 4: Toggle** — in `NotificationsSection.tsx`, add a checkbox driven by the existing `updateNotificationSettings`:
  ```tsx
        <label className="flex items-center gap-2 cursor-pointer text-base mt-3">
          <input type="checkbox" checked={user.notificationSettings.episodeReleases} disabled={busy}
            onChange={(e) => { void updateNotificationSettings({ episodeReleases: e.target.checked }); }}
            className="accent-acc-deep w-[14px] h-[14px]" />
          Notiser när en serie jag följer släpper ett nytt avsnitt
        </label>
  ```
- [ ] **Step 5: Run** `npm run typecheck && npm run lint` — Expected: 0 errors (the now-required field forces all three AuthContext sites to be updated).
- [ ] **Step 6: Commit** `feat(settings): episodeReleases notif preference, default on (B4)`

### Task 6.7: Fas 6 full verification (no auto-deploy)
- [ ] **Step 1:** `npm run typecheck && npm run lint && npm test && npm run build` — all green.
- [ ] **Step 2:** `npm --prefix functions run build` — tsc exits 0; `lib/episodeNotify/*` + `lib/push.js` emitted.
- [ ] **Step 3:** Record the manual-deploy requirement (do NOT deploy here): `firebase functions:secrets:set TMDB_API_KEY` + `firebase deploy --only functions:episodeReleaseNotify,firestore:indexes`. Confirm these land in the Fas 7 runbook.

---

## Fas 7 — Extern infra-runbook + decomposition-brief (doc deliverables)

### Task 7.1: Write the external-actions runbook
**Files:** Create `docs/EXTERNAL_ACTIONS_RUNBOOK.md`

- [ ] **Step 1: Write the runbook** — exact, copy-pasteable steps the user runs. Each step: command + expected output + verification. Source the items from `docs/analysis/EXTERNAL_ACTIONS.md` plus the new deploys from this plan. Cover, in order:
  1. **Deploy functions + rules + indexes (incl. episode-push):**
     ```
     firebase deploy --only functions:rollupInsights,functions:apiInsights,functions:episodeReleaseNotify,firestore:rules,firestore:indexes
     ```
  2. **Secrets:** `firebase functions:secrets:set INSIGHTS_TOKEN` · `PLAUSIBLE_API_KEY` · `PLAUSIBLE_SITE_ID` · **`TMDB_API_KEY`** (new for episode-push).
  3. **Plausible:** register goals for the six events added in Fas 3 (`providers_selected`, `advisor_viewed`, `advisor_action_taken`, `search_submitted`, `status_changed`, `error_boundary_triggered`).
  4. **Admin flag:** set `users/{uid}.isAdmin = true` in Firestore Console.
  5. **Sentry DSN:** provision + set `NEXT_PUBLIC_SENTRY_DSN` in hosting env.
  6. **App Check:** register reCAPTCHA v3, set `NEXT_PUBLIC_APP_CHECK_SITE_KEY`, enforce.
  7. **Firestore PITR + scheduled backups** (Blaze).
  8. **Branch protection** on `main` (require CI green).
  9. **Billing alert** + **UptimeRobot** monitor.
  10. **Official TMDB logo** (replace placeholder).
  11. **Verify:** `curl -I https://binge.nu` security headers; `binge.nu/insikter` loads post-deploy; trigger `episodeReleaseNotify` once via Console and check logs.
- [ ] **Step 2: Cross-link** — add a one-line pointer from `docs/analysis/EXTERNAL_ACTIONS.md` to the runbook.
- [ ] **Step 3: Commit** `docs: external-actions runbook (deploy, secrets, infra)`

### Task 7.2: Write the big-features decomposition brief
**Files:** Create `docs/analysis/BIG_FEATURES_BRIEF.md`

- [ ] **Step 1: Write the brief** — for each feature: problem, scope, dependencies, rough effort, and "needs its own spec→plan cycle". Cover:
  - **B12 Dark mode** — oklch token variants, `prefers-color-scheme` + toggle, flash-prevention. ~1 vecka.
  - **B13 PWA** — `manifest.json`, full Workbox service worker (separate from the FCM SW), install-banner. ~1 vecka.
  - **B11 CSV-import** — Trakt/Letterboxd/IMDb parsers, TMDB title-matching, dedupe, dry-run UI. ~1–2 veckor.
  - **B25–B27 Paddle + paywall** — Paddle integration, webhook function, `plan`/`renewsAt` fields, paywall gates, billing portal; legal + Cloud Functions. Flera veckor.
  - **B14 Native** — React Native/Capacitor evaluation. Månader; eget projekt.
- [ ] **Step 2: Commit** `docs: big-features decomposition brief (dark mode, PWA, import, paywall, native)`

### Task 7.3: Final plan-wide verification
- [ ] **Step 1:** `npm run typecheck && npm run lint && npm test && npm run build` + `npm --prefix functions run build` — all green.
- [ ] **Step 2:** Confirm REMEDIATION_PLAN + design-consistency-plan have no remaining "claimed-done-but-unbuilt" items (the audit's A/B list is all addressed or documented-as-deferred).
- [ ] **Step 3:** Remind the user: rules/functions/indexes/secrets require the Fas 7.1 runbook to be executed manually — code merge alone does not activate episode-push or insikter.

---

## Self-Review

- **Spec coverage:** Every A-item (A1.1–A6.2) and B-item (B1–B4) maps to a task; C → Task 7.1; D → Task 7.2. ✅
- **Scope reductions documented:** A1.1/A1.2/A4.1/A4.2/A4.3 were found partly-done; tasks scoped to the real gaps. ✅
- **Type consistency:** `deriveInitials`/`AvatarInitials`, `reviewSchema`/`ReviewSchemaInput`, `hasFullPage`/`nextCursor`, `inviteTokenAgeDays`/`inviteTokenAgeLabel`/`shouldAutoRotateInviteToken`, `airingState`/`deriveSubState`/`shouldNotify`/`WatchlistLite`/`LastEpisode`, `sendPushToUser`/`NotifPayload` — names used consistently across the tasks that define and consume them. ✅
- **Known "verify against real file" markers:** several tasks carry a `>`-note to align illustrative code (analytics `track` signature, `useReviews` mapper fields, `SegmentError` props, provider helper names, `airingState` mapping, FCM token shape) with the actual source before implementing — these are deliberate, since the drafting agents read the files but the exact signatures must be confirmed at edit time. Not placeholders — the code is complete and the note says what to check.
- **Pre-merge gate:** C More legacy id (Task 5.1) must be confirmed against live TMDB.
