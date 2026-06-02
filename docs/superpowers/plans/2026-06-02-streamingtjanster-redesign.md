# Mina streamingtjänster — Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the "Mina streamingtjänster" section of `/settings` as a brand-colored wordmark-tile grid (grouped "Dina tjänster" / "Lägg till fler") with a separate tier/cost strip and instant, debounce-batched saving.

**Architecture:** Keep `ProvidersSection.tsx` inside the existing `SettingsSection collapsible` wrapper. Extract pure logic to `ProvidersSection.helpers.ts` (grouping, total, contrast) and the save coordination to a `useDebouncedCommit` hook so the expensive group-cascade write (`updateProviders`) fires once per burst instead of per click. No data-model or Firestore-schema changes — reuse `SWEDISH_PROVIDERS` and existing `AuthContext` methods.

**Tech Stack:** Next.js 14 (App Router, static export), TypeScript, Tailwind (Direction-H tokens), Vitest + @testing-library/react, Firebase Firestore (via `AuthContext`).

---

## Before you start

This repo's policy is "commit only when asked" and CI runs on non-main branches. Create a feature branch first:

```bash
git checkout -b streamingtjanster-redesign
```

Spec reference: `docs/superpowers/specs/2026-06-02-streamingtjanster-redesign-design.md`.

Reference facts (verified against the codebase):
- `AuthContext` exposes: `updateProviders(providers: number[]): Promise<void>` (fans out to group memberships — the expensive one), `updateProviderTier(providerId: number, tierId: string | null): Promise<void>`, `updateProviderCosts(costs: Record<number, number>): Promise<void>`. Access via `useAuth()`.
- `user.myProviders: number[]`, `user.providerTiers: Record<number,string>`, `user.providerCosts: Record<number,number>`.
- `src/lib/tmdb/providers.ts` exports `SWEDISH_PROVIDERS: SwedishProvider[]`, `canonicalProviderId(id)`, `getProvider(id)`. `SwedishProvider` has `{ id, name, shortName, color, type, defaultMonthlyCost?, tiers?: {id,name,cost}[] }`.
- Tile/section styling uses Direction-H tokens (`bg-surface`, `border-rule`, `text-ink`/`ink-2`/`ink-3`, `rounded-md`). Brand color is applied via **inline `style`** from `provider.color` (data-driven, allowed — same as the existing colored dots), never as a Tailwind class.

---

## File Structure

- Create: `src/components/settings/ProvidersSection.helpers.ts` — pure functions: `readableTextColor`, `splitProviders`, `totalMonthlyCost`.
- Create: `src/components/settings/ProvidersSection.helpers.test.ts` — unit tests for the above.
- Create: `src/hooks/useDebouncedCommit.ts` — generic debounced-commit hook with flush-on-unmount + flush-on-pagehide.
- Create: `src/hooks/useDebouncedCommit.test.ts` — fake-timer tests.
- Modify: `src/components/settings/ProvidersSection.tsx` — full rewrite of the render + wiring (keep the file and the `SettingsSection` wrapper).

---

## Task 1: Contrast helper — `readableTextColor`

Brand colors as tile backgrounds need legible text. This returns the foreground for a given hex background using WCAG relative luminance.

**Files:**
- Create: `src/components/settings/ProvidersSection.helpers.ts`
- Test: `src/components/settings/ProvidersSection.helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { readableTextColor } from './ProvidersSection.helpers';

describe('readableTextColor', () => {
  it('returns white on dark brand colors', () => {
    expect(readableTextColor('#E50914')).toBe('white'); // Netflix red
    expect(readableTextColor('#0063E5')).toBe('white'); // Disney+ blue
    expect(readableTextColor('#000000')).toBe('white');
  });

  it('returns ink on light brand colors', () => {
    expect(readableTextColor('#FFFFFF')).toBe('ink');
    expect(readableTextColor('#FFD400')).toBe('ink'); // bright yellow
  });

  it('handles 3-digit hex and missing #', () => {
    expect(readableTextColor('fff')).toBe('ink');
    expect(readableTextColor('000')).toBe('white');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/ProvidersSection.helpers.test.ts`
Expected: FAIL — `readableTextColor` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/settings/ProvidersSection.helpers.ts

/** WCAG relative luminance → pick legible foreground for a hex background. */
export function readableTextColor(hex: string): 'white' | 'ink' {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // Contrast vs white = 1.05/(L+0.05); vs black = (L+0.05)/0.05.
  // Use white text when it is at least as readable as dark text.
  return L <= 0.45 ? 'white' : 'ink';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/settings/ProvidersSection.helpers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ProvidersSection.helpers.ts src/components/settings/ProvidersSection.helpers.test.ts
git commit -m "feat(settings): add readableTextColor contrast helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Grouping + total helpers — `splitProviders`, `totalMonthlyCost`

**Files:**
- Modify: `src/components/settings/ProvidersSection.helpers.ts`
- Test: `src/components/settings/ProvidersSection.helpers.test.ts`

- [ ] **Step 1: Write the failing test (append to the existing test file)**

```ts
import { splitProviders, totalMonthlyCost } from './ProvidersSection.helpers';
import type { SwedishProvider } from '@/lib/tmdb/providers';

const P = (id: number, name: string): SwedishProvider =>
  ({ id, name, shortName: name, color: '#000', type: 'flatrate' });

describe('splitProviders', () => {
  const all = [P(8, 'Netflix'), P(337, 'Disney+'), P(489, 'TV4 Play')];

  it('splits selected (in selection order) from available (in source order)', () => {
    const { selected, available } = splitProviders(all, [489, 8]);
    expect(selected.map(p => p.id)).toEqual([489, 8]);
    expect(available.map(p => p.id)).toEqual([337]);
  });

  it('matches via canonical id so aliases do not duplicate', () => {
    // 1944 is an alias of 489 (TV4 Play)
    const { selected, available } = splitProviders(all, [1944]);
    expect(selected.map(p => p.id)).toEqual([489]);
    expect(available.map(p => p.id)).toEqual([8, 337]);
  });

  it('ignores selected ids with no matching provider', () => {
    const { selected } = splitProviders(all, [99999]);
    expect(selected).toEqual([]);
  });
});

describe('totalMonthlyCost', () => {
  it('sums costs for selected ids only', () => {
    expect(totalMonthlyCost([8, 489], { 8: 109, 489: 69, 337: 159 })).toBe(178);
  });
  it('treats missing costs as 0', () => {
    expect(totalMonthlyCost([8, 489], { 8: 109 })).toBe(109);
  });
  it('is 0 for empty selection', () => {
    expect(totalMonthlyCost([], { 8: 109 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/ProvidersSection.helpers.test.ts`
Expected: FAIL — `splitProviders` / `totalMonthlyCost` not exported.

- [ ] **Step 3: Write minimal implementation (append to helpers file)**

```ts
import { canonicalProviderId, type SwedishProvider } from '@/lib/tmdb/providers';

/**
 * Split a provider list into selected (in the order the user selected them)
 * and available (remaining, in source order). Matching is canonical so
 * aliases (e.g. TV4 Play 489/1944) never appear twice.
 */
export function splitProviders(
  all: SwedishProvider[],
  selectedIds: number[],
): { selected: SwedishProvider[]; available: SwedishProvider[] } {
  const canonSelected = selectedIds.map(canonicalProviderId);
  const byId = new Map(all.map(p => [canonicalProviderId(p.id), p]));
  const selected = canonSelected
    .map(id => byId.get(id))
    .filter((p): p is SwedishProvider => Boolean(p));
  const selectedSet = new Set(selected.map(p => canonicalProviderId(p.id)));
  const available = all.filter(p => !selectedSet.has(canonicalProviderId(p.id)));
  return { selected, available };
}

/** Sum monthly cost across the selected provider ids. */
export function totalMonthlyCost(
  selectedIds: number[],
  providerCosts: Record<number, number>,
): number {
  return selectedIds.reduce((sum, id) => sum + (providerCosts[id] ?? 0), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/settings/ProvidersSection.helpers.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ProvidersSection.helpers.ts src/components/settings/ProvidersSection.helpers.test.ts
git commit -m "feat(settings): add splitProviders + totalMonthlyCost helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Debounced-commit hook — `useDebouncedCommit`

Coalesces rapid changes into one commit; flushes on unmount and on `pagehide`/`visibilitychange` so a pending write is never lost when the user collapses the section or leaves the page.

**Files:**
- Create: `src/hooks/useDebouncedCommit.ts`
- Test: `src/hooks/useDebouncedCommit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedCommit } from './useDebouncedCommit';

describe('useDebouncedCommit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces rapid schedules into one commit with the latest value', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<number[]>(commit, 700));

    act(() => { result.current.schedule([1]); });
    act(() => { result.current.schedule([1, 2]); });
    act(() => { result.current.schedule([1, 2, 3]); });
    expect(commit).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(700); });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('flush() commits the pending value immediately', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<number[]>(commit, 700));
    act(() => { result.current.schedule([9]); });
    act(() => { result.current.flush(); });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([9]);
  });

  it('does nothing on flush when nothing is pending', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<number[]>(commit, 700));
    act(() => { result.current.flush(); });
    expect(commit).not.toHaveBeenCalled();
  });

  it('flushes a pending commit on unmount', () => {
    const commit = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedCommit<number[]>(commit, 700));
    act(() => { result.current.schedule([5]); });
    unmount();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([5]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useDebouncedCommit.test.ts`
Expected: FAIL — `useDebouncedCommit` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/hooks/useDebouncedCommit.ts
'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Debounce a commit so rapid changes write once. The pending value is held in
 * a ref and flushed on: timer fire, explicit flush(), unmount, and pagehide/
 * visibilitychange (so collapsing the section or leaving the page never drops a
 * pending write).
 */
export function useDebouncedCommit<T>(
  commit: (value: T) => void | Promise<void>,
  delayMs: number,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ value: T } | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current) {
      const { value } = pending.current;
      pending.current = null;
      void commitRef.current(value);
    }
  }, []);

  const schedule = useCallback((value: T) => {
    pending.current = { value };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delayMs);
  }, [delayMs, flush]);

  useEffect(() => {
    const onLeave = () => flush();
    window.addEventListener('pagehide', onLeave);
    document.addEventListener('visibilitychange', onLeave);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      document.removeEventListener('visibilitychange', onLeave);
      flush(); // flush on unmount
    };
  }, [flush]);

  return { schedule, flush };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useDebouncedCommit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useDebouncedCommit.ts src/hooks/useDebouncedCommit.test.ts
git commit -m "feat(hooks): add useDebouncedCommit with flush-on-unmount/pagehide

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Rewrite `ProvidersSection.tsx`

Replace the flat checkbox list with: a grid of selected tiles ("Dina tjänster"), a grid of available tiles ("Lägg till fler"), and a "Nivå & kostnad" strip for the selected services. Tap toggles selection optimistically; the `updateProviders` write is debounced via the hook. Tier/cost still commit immediately (they don't trigger the group cascade). The explicit Spara/Ångra buttons are removed.

**Files:**
- Modify: `src/components/settings/ProvidersSection.tsx` (full rewrite of the component body)

- [ ] **Step 1: Replace the entire file contents**

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SWEDISH_PROVIDERS, canonicalProviderId, type SwedishProvider } from '@/lib/tmdb/providers';
import { useDebouncedCommit } from '@/hooks/useDebouncedCommit';
import { SettingsSection } from './SettingsSection';
import {
  readableTextColor,
  splitProviders,
  totalMonthlyCost,
} from './ProvidersSection.helpers';

const FLATRATE = SWEDISH_PROVIDERS.filter(p => p.type === 'flatrate');

export function ProvidersSection() {
  const { user, updateProviders, updateProviderCosts, updateProviderTier } = useAuth();
  const { show: toast } = useToast();

  const savedProviders = useMemo(() => user?.myProviders ?? [], [user?.myProviders]);
  const [selected, setSelected] = useState<number[]>(savedProviders);
  const [pendingSave, setPendingSave] = useState(false);

  // Debounced commit of the (expensive, group-cascading) provider set.
  const { schedule } = useDebouncedCommit<number[]>(async (ids) => {
    try {
      await updateProviders(ids);
    } finally {
      setPendingSave(false);
    }
  }, 700);

  // Keep local state in sync if myProviders changes elsewhere (other tab, onboarding).
  useEffect(() => { setSelected(savedProviders); }, [savedProviders]);

  if (!user) return null;

  const toggle = (providerId: number) => {
    const canon = canonicalProviderId(providerId);
    setSelected(prev => {
      const has = prev.some(id => canonicalProviderId(id) === canon);
      const next = has
        ? prev.filter(id => canonicalProviderId(id) !== canon)
        : [...prev, providerId];
      setPendingSave(true);
      schedule(next);
      return next;
    });
  };

  const { selected: selectedProviders, available } = splitProviders(FLATRATE, selected);
  const total = totalMonthlyCost(selected, user.providerCosts ?? {});

  const tile = (p: SwedishProvider, isSelected: boolean) => {
    const fg = readableTextColor(p.color);
    return (
      <button
        key={p.id}
        type="button"
        aria-pressed={isSelected}
        onClick={() => toggle(p.id)}
        className="relative h-[46px] rounded-md flex items-center justify-center text-center text-[12px] font-bold px-2 transition-colors"
        style={
          isSelected
            ? { background: p.color, color: fg === 'white' ? '#fff' : 'var(--ink)' }
            : { border: '1.5px solid var(--rule)', color: p.color }
        }
      >
        {p.shortName}
        {isSelected && <span className="absolute top-1 right-1.5 text-[10px]" style={{ color: fg === 'white' ? '#fff' : 'var(--ink)' }}>✓</span>}
      </button>
    );
  };

  return (
    <SettingsSection title="Mina streamingtjänster" collapsible defaultOpen={savedProviders.length === 0}>
      {selectedProviders.length > 0 ? (
        <>
          <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3 mb-2">
            Dina tjänster · {selectedProviders.length}
          </div>
          <div className="grid grid-cols-4 gap-[7px] mb-4">
            {selectedProviders.map(p => tile(p, true))}
          </div>
        </>
      ) : (
        <p className="text-xs text-ink-3 mb-3">
          Välj tjänsterna du prenumererar på — de markeras i hela appen.
        </p>
      )}

      {available.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3 mb-2">Lägg till fler</div>
          <div className="grid grid-cols-4 gap-[7px] mb-4">
            {available.map(p => tile(p, false))}
          </div>
        </>
      )}

      {selectedProviders.length > 0 && (
        <div className="border-t border-rule-2 pt-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3 mb-2">Nivå &amp; kostnad</div>
          <div className="space-y-[2px]">
            {selectedProviders.map(provider => {
              const selectedTierId = user.providerTiers?.[provider.id];
              const hasTiers = (provider.tiers?.length ?? 0) > 0;
              const isCustom = hasTiers && !selectedTierId;
              const fg = readableTextColor(provider.color);
              return (
                <div key={provider.id} className="flex items-center gap-[10px] py-[3px]">
                  <span
                    className="rounded-sm px-2 py-[1px] text-[11px] font-semibold min-w-[54px] text-center"
                    style={{ background: provider.color, color: fg === 'white' ? '#fff' : 'var(--ink)' }}
                  >
                    {provider.shortName}
                  </span>
                  <span className="flex-1" />
                  {hasTiers ? (
                    <select
                      value={selectedTierId ?? ''}
                      onChange={e => {
                        const val = e.target.value;
                        updateProviderTier(provider.id, val === '' ? null : val);
                        toast('Prenumeration uppdaterad');
                      }}
                      className="px-1 py-[1px] text-xs border border-rule rounded-sm bg-surface text-ink font-[inherit] outline-none max-w-[180px]"
                    >
                      <option value="">Egen kostnad…</option>
                      {provider.tiers!.map(t => (
                        <option key={t.id} value={t.id}>{t.name} — {t.cost} kr</option>
                      ))}
                    </select>
                  ) : null}
                  {(!hasTiers || isCustom) && (
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="kr/mån"
                      defaultValue={user.providerCosts?.[provider.id] ?? ''}
                      onBlur={e => {
                        const val = parseInt(e.target.value, 10);
                        const costs = { ...user.providerCosts };
                        if (isNaN(val) || val <= 0) delete costs[provider.id];
                        else costs[provider.id] = val;
                        updateProviderCosts(costs);
                      }}
                      className="w-[70px] px-1 py-[1px] text-xs border border-rule rounded-sm bg-surface text-ink font-[inherit] outline-none text-right"
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3 border-t border-rule-2 pt-[10px]">
            <span className="text-[11px] text-ink-3">
              {pendingSave ? 'Sparar…' : '✓ Sparat automatiskt'}
            </span>
            <span className="text-[13px] font-bold tabular-nums">{total} kr/mån</span>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (no errors).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 errors (pre-existing warnings elsewhere are fine; none new in this file).

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new helper + hook tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ProvidersSection.tsx
git commit -m "feat(settings): rebuild streamingtjänster as brand-tile grid + cost strip

Grid of wordmark tiles (Dina tjänster / Lägg till fler), tap to toggle with
optimistic state + debounced batched updateProviders commit, separate Nivå &
kostnad strip, auto-save indicator. Removes explicit Spara/Ångra.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Visual verification in the running app

**Files:** none (manual verification).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background) and open `http://localhost:3000/settings` (log in if needed).

- [ ] **Step 2: Verify behavior**

Confirm:
- "Mina streamingtjänster" shows filled brand tiles under "Dina tjänster" and outline tiles under "Lägg till fler".
- Tapping a tile moves it between groups instantly; "Sparar…" appears, then "✓ Sparat automatiskt" within ~1s.
- Selected services appear in the "Nivå & kostnad" strip; changing a tier updates the total.
- Tile text is legible on every brand color (no white-on-light or dark-on-dark).
- Reloading the page preserves selections (commit landed).

- [ ] **Step 3: Re-run gates and finish**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

---

## Self-Review

**1. Spec coverage**
- A (recognition): wordmark tiles in brand color — Task 4. ✓
- B (save friction): optimistic toggle + `useDebouncedCommit` (Task 3) wired in Task 4; Spara/Ångra removed. ✓
- D (mixed controls): tier/cost moved to one consistent "Nivå & kostnad" strip — Task 4. ✓
- E (grouping): `splitProviders` (Task 2) → "Dina tjänster" / "Lägg till fler" — Task 4. ✓
- F (finished feel): grid + strip + auto-save indicator — Task 4. ✓
- Non-goals respected: no value/insight features, no real logos, no JustWatch work. ✓
- Edge cases: empty state (Task 4 conditional), contrast fallback (Task 1 + tile styling), alias dedupe (`canonicalProviderId` in Tasks 2 & 4), flush-on-collapse/navigate (collapse unmounts children → hook unmount flush; plus pagehide/visibilitychange — Task 3). ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output. ✓

**3. Type consistency:** `readableTextColor → 'white'|'ink'`, `splitProviders → {selected, available}`, `totalMonthlyCost(ids, costs) → number`, `useDebouncedCommit<T>(commit, delayMs) → {schedule, flush}` — used consistently in Task 4. `SwedishProvider` import from `@/lib/tmdb/providers`. Auth method signatures match `AuthContext`. ✓

No gaps found.
