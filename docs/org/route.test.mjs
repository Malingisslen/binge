// Tests for the blast-radius router (docs/org/route.mjs).
//
// Run: npm test (this file is in vitest.config.ts's `include`, deliberately —
// route.mjs's own `--selftest` flag is wired to nothing, so a silent regression
// there was invisible to every gate. BIN-802.)
//
// Why this file exists: the router decides BOTH whether a stakeholder panel is
// convened before a change is built AND — since BIN-776 — whether a sprint may
// pick a ticket up at all. If it starts answering `skip` too generously, nothing
// fails; reviews simply stop happening. Every assertion below is written so that
// the cheapest wrong implementation fails it.
//
// The ownership map (docs/org/ownership-map.json) is committed data, so these run
// against the real map rather than a fixture — a map edit that breaks the routing
// contract should fail here, which is the point.

import { describe, it, expect } from 'vitest';
import { route, isCodePath } from './route.mjs';

describe('folder-ownership inheritance (BIN-788)', () => {
  it('seats the directory owner for an unlisted sibling file', () => {
    // prefetch.ts is NOT in the ownership map; its siblings in src/lib/tmdb/ are.
    // Before BIN-788 this matched nothing and routed `skip` — an unreviewed change
    // in a heavily-owned directory.
    const r = route(['src/lib/tmdb/prefetch.ts']);

    expect(r.tier).toBe('medium');
    expect(r.reasonCode).toBe('owned');
    expect(r.panel).toHaveLength(1);

    // The seat must be a role that inherited it from the directory — not the
    // #14 unmapped fallback, which would mean inheritance never fired.
    const seated = r.roles.find((role) => role.num === r.panel[0]);
    expect(seated.inherited).toContain('src/lib/tmdb/prefetch.ts');
    expect(r.panel).not.toContain(14);
    expect(r.unownedCode).toEqual([]);
  });

  it('does not inherit for a non-code path in an owned directory', () => {
    // Inheritance is gated on isCodePath so a prose file never drags in a code
    // reviewer. docs/ is owned by #21 alone → still doc-only.
    const r = route(['docs/data-export-format.md']);

    expect(r.tier).toBe('skip');
    expect(r.reasonCode).toBe('doc-only');
    expect(r.panel).toEqual([]);
  });
});

describe('unmapped code is not cleared code (BIN-788)', () => {
  it('routes an unowned code path medium and seats #14 Software Architect', () => {
    const r = route(['src/lib/no-such-dir/brandNew.ts']);

    expect(r.tier).toBe('medium');
    expect(r.reasonCode).toBe('unmapped-code');
    expect(r.panel).toEqual([14]);
    expect(r.unmappedCode).toEqual(['src/lib/no-such-dir/brandNew.ts']);
    // The path is named so the map gets fixed rather than the gap re-appearing.
    expect(r.reason).toContain('src/lib/no-such-dir/brandNew.ts');
  });

  it('still names an unowned code path when another file carries the tier', () => {
    // The gap must survive being mixed with owned code — otherwise it is only
    // reported in the one case where it is already obvious.
    const r = route(['src/lib/mediaTypeDocId.ts', 'src/lib/no-such-dir/brandNew.ts']);

    expect(r.tier).toBe('medium');
    expect(r.reasonCode).toBe('owned');
    expect(r.unownedCode).toContain('src/lib/no-such-dir/brandNew.ts');
    expect(r.reason).toContain('src/lib/no-such-dir/brandNew.ts');
  });
});

describe('non-code paths still route skip', () => {
  it.each([
    ['public/llms.txt', 'doc-only'], // owned by #21 only
    ['tasks/todo.md', 'no-code-paths'], // sprint scratch, owned by nobody
    ['scripts/gen-app-icons.mjs', 'no-code-paths'], // ordinary repo tooling (BIN-805 kept this)
    ['docs/workflow-map.html', 'doc-only'], // .html under docs/ is prose, not code
  ])('%s → skip (%s)', (path, reasonCode) => {
    const r = route([path]);

    expect(r.tier).toBe('skip');
    expect(r.reasonCode).toBe(reasonCode);
    expect(r.panel).toEqual([]);
  });
});

describe('the longest matching pattern wins', () => {
  it('seats the file owner over a directory owner of the same directory', () => {
    // #1 Product Designer owns BOTH `src/components/ui/` and the file itself;
    // #2 Accessibility owns a sibling in that directory and therefore inherits it.
    // Taking the FIRST matching pattern instead of the longest gives #1 the
    // directory's specificity (18 chars) — a tie with #2's inherited 18 — which the
    // weight tie-break then hands to #2. So this assertion fails on that mutant.
    const r = route(['src/components/ui/DuotonePoster.tsx']);

    expect(r.tier).toBe('medium');
    expect(r.panel).toEqual([1]);
    expect(r.roles.map((role) => role.num)).toContain(2); // #2 still resolved…
    expect(r.dropped.join(' ')).toContain('2 Accessibility'); // …but not seated
  });
});

describe('high-stakes paths outrank everything', () => {
  it('routes the full panel and seats a high-stakes role first', () => {
    const r = route(['firestore.rules', 'src/lib/no-such-dir/brandNew.ts']);

    expect(r.tier).toBe('top');
    expect(r.reasonCode).toBe('high-stakes');
    expect(r.highStakes).toContain('firestore.rules');
    expect(r.panel).toContain(4); // Security Architect
    expect(r.panel.length).toBeLessThanOrEqual(5); // PANEL_CAP
  });
});

describe('the router and the gate scripts cannot clear themselves (BIN-805)', () => {
  it.each([
    'docs/org/route.mjs',
    'docs/org/route.test.mjs',
    'scripts/check-workflow-map.mjs',
    'scripts/check-workflow-map.test.mjs',
  ])('%s routes medium, not skip', (path) => {
    expect(isCodePath(path)).toBe(true);

    const r = route([path]);

    expect(r.tier).toBe('medium');
    expect(r.reasonCode).toBe('unmapped-code');
    expect(r.panel).toEqual([14]);
    expect(r.unownedCode).toEqual([path]);
  });

  it('keeps the Technical Writer from being the sole reviewer of that code', () => {
    // docs/ is #21's, so route.mjs IS matched by a role — the pre-BIN-805 tier
    // logic answered `doc-only` on that alone. #21 may still be listed, never seated.
    const r = route(['docs/org/route.mjs']);

    expect(r.roles.map((role) => role.num)).toEqual([21]);
    expect(r.panel).not.toContain(21);
    expect(r.dropped.join(' ')).toContain('21 Technical Writer');
  });

  it('leaves the rest of scripts/ and docs/ routing as before', () => {
    // The narrow list is the decision (Malin, 2026-08-08, alternative (a)):
    // pulling all of docs/ + scripts/ in would put a reviewer on every helper tweak.
    expect(isCodePath('scripts/serve-spa.mjs')).toBe(false);
    expect(isCodePath('docs/org/ownership-map.json')).toBe(false);
    expect(route(['scripts/serve-spa.mjs']).tier).toBe('skip');
    expect(route(['docs/org/adr/0018-seo-selection-ratchet.md']).tier).not.toBe('top');
  });
});

describe('input handling', () => {
  it('ignores blank entries (a piped `git diff --name-only` ends in a newline)', () => {
    expect(route(['firestore.rules', '', '  '])).toMatchObject({ tier: 'top' });
    expect(route([''])).toMatchObject({ tier: 'skip', reasonCode: 'no-code-paths', panel: [] });
  });

  it('normalizes Windows separators and ./ prefixes', () => {
    expect(route(['.\\src\\lib\\firebase\\userData.ts']).tier).toBe('top');
  });
});
