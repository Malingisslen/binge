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
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { route, isCodePath } from './route.mjs';

// Would the repo's BLOCKING commit gate demand binge-integration-reviewer for this path?
// Mirrors the real hook's decision rather than just its pattern list:
// require-review-before-commit.mjs takes `exact` OR a pattern match, then SUBTRACTS
// `exclude`. This gate carries no excludes today, so the two are equivalent — but a later
// `exclude` would disarm the gate while a patterns-only helper stayed green, which is the
// exact silent disarming these tests exist to prevent. Reads the live config, not a
// fixture: the point is to catch the config drifting away from the router.
function gateMatches(agent, file) {
  const cfg = JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude', 'shared-plugin.json'),
      'utf8',
    ),
  );
  const gate = cfg.reviewGates.find((g) => g.agent === agent);
  const exact = new Set(gate.exact || []);
  return (
    (exact.has(file) || (gate.patterns || []).some((p) => new RegExp(p).test(file))) &&
    !(gate.exclude || []).some((p) => new RegExp(p).test(file))
  );
}

const integrationGateMatches = (file) => gateMatches('binge-integration-reviewer', file);

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

// The files that decide who reviews everything else. ONE list, used for both halves
// below — the advising router and the blocking commit gate. Asserting the two halves
// against two hand-copied lists is how the drift they exist to prevent gets in. At
// bfb82f4 NO gate script was checked on the blocking side at all — the only blocking-side
// test named the two `.claude` files — and an earlier draft of this change checked just
// the four new BIN-864/873 paths, so narrowing the gate's alternation down to those two
// new alternation entries passed every test.
//
// BIN-805 seeded it with route.mjs + check-workflow-map; BIN-864 / BIN-873 (2026-08-12)
// added the other two. gen-ownership-map.mjs computes the map this router reads;
// check-public-env.mjs is the guard that exists because a public env var went missing
// from the production build for three months with CI and deploy green (BIN-849).
//
// DO NOT shrink this array to make a test pass. It is the ONLY place the blocking side
// is checked: no sibling test names any of these files against the commit gate, so a
// dropped path silently loses its blocking-side coverage — the same self-clearing move
// the array was hoisted to prevent. That shrink WAS measured green, before the floor at
// the end of this block existed; the floor is what makes it loud now. A file leaves this
// list only when it also leaves BOTH real lists.
const GATE_SCRIPTS = [
  'docs/org/route.mjs',
  'docs/org/route.test.mjs',
  'scripts/check-workflow-map.mjs',
  'scripts/check-workflow-map.test.mjs',
  'docs/org/gen-ownership-map.mjs',
  'docs/org/gen-ownership-map.test.mjs',
  'scripts/check-public-env.mjs',
  'scripts/check-public-env.test.mjs',
];

describe('the router and the gate scripts cannot clear themselves (BIN-805)', () => {
  it.each(GATE_SCRIPTS)('%s routes medium, not skip', (path) => {
    // Assert the property this block is named for and nothing more — the eight no longer
    // answer alike. Measured at these bytes: the four under docs/org/ are `owned`/[25] —
    // BIN-834 + BIN-869 NAMED three of them in §25 and the fourth
    // (gen-ownership-map.test.mjs) inherits, which is exactly why the two named tests
    // below can assert `inherited === []` and that fourth file could not. The four under
    // scripts/ are `unmapped-code`/[14].
    // Pinning either specific answer HERE would defeat the point: the router's own
    // failure text tells you to fix an unowned path by naming it in
    // docs/role-responsibilities.md, and a `[14]` pin would make following that advice
    // fail `npm test`, which gates deploy.yml. Improving ownership must never break the
    // deploy; the same trap is refused for the gap baseline in gen-ownership-map.test.mjs.
    // Both specific answers ARE pinned, each in its own named test below, so flipping one
    // reddens exactly one assertion instead of eight.
    expect(isCodePath(path)).toBe(true);

    const r = route([path]);

    expect(r.tier).toBe('medium');
    expect(r.panel).not.toEqual([]); // somebody is seated
    expect(r.panel).not.toContain(21); // and it is never the Technical Writer alone
  });

  it('seats the unmapped-code fallback while a gate script has no named owner', () => {
    // The specifics, isolated to ONE case so that naming an owner later flips exactly
    // this test — a signal to update it — instead of eight scattered ones. That is what
    // happened: BIN-834 gave docs/org/route.mjs a real owner, so the example moved to a
    // script that is still unowned. The fallback itself is still the thing being pinned.
    const r = route(['scripts/check-workflow-map.mjs']);

    expect(r.reasonCode).toBe('unmapped-code');
    expect(r.panel).toEqual([14]);
    expect(r.unownedCode).toEqual(['scripts/check-workflow-map.mjs']);
  });

  it('route.mjs has a real owner now, not the fallback seat (BIN-834)', () => {
    // The router used to answer `unmapped-code` about ITSELF and print "add the path to
    // docs/role-responsibilities.md and regenerate the map" — permanently, for every
    // future change to it, because nobody was assigned to follow that instruction.
    // #25 owns it now (it decides who reviews everything else), so the advice is spent.
    const r = route(['docs/org/route.mjs']);

    expect(r.reasonCode).toBe('owned');
    expect(r.panel).toEqual([25]);
    expect(r.unownedCode).toEqual([]);
    // And it is the EXPLICIT §25 entry, not a neighbour's. Dropping just this path from
    // the dossier while keeping `gen-ownership-map.mjs` re-seats #25 by directory
    // inheritance from `docs/org/`, which every assertion above survives.
    expect(r.roles.find((role) => role.num === 25).inherited).toEqual([]);
  });

  it('gen-ownership-map.mjs got the same owner in the same change (BIN-869)', () => {
    // BIN-834's other half. The it.each above passes identically at #14 and #25, so
    // without this the second file's ownership is pinned nowhere.
    const r = route(['docs/org/gen-ownership-map.mjs']);

    expect(r.reasonCode).toBe('owned');
    expect(r.panel).toEqual([25]);
    expect(r.roles.find((role) => role.num === 25).inherited).toEqual([]);
  });

  it('keeps the Technical Writer from being the sole reviewer of that code', () => {
    // docs/ is #21's, so route.mjs IS matched by that role — the pre-BIN-805 tier logic
    // answered `doc-only` on that alone. #21 may still be LISTED, never seated. The
    // property survives ownership: what changed is that a second role is now listed
    // beside it, not that #21 became seatable.
    const r = route(['docs/org/route.mjs']);

    // `toEqual`, not `toContain`: the loose form lets a co-owner that never wins the seat
    // join silently. Verified — adding this path to a HIGHER-numbered role leaves panel
    // [25] and every other assertion green, while a lower-numbered one is caught by the
    // panel pin above. The exact pair is the only thing that sees both.
    expect(r.roles.map((role) => role.num)).toEqual([21, 25]);
    expect(r.panel).not.toContain(21);
    expect(r.dropped.join(' ')).toContain('21 Technical Writer');
  });

  it('leaves the rest of scripts/ and docs/ routing as before', () => {
    // The narrow list is the decision (Malin, 2026-08-08, alternative (a)):
    // pulling all of docs/ + scripts/ in would put a reviewer on every helper tweak.
    // These are the load-bearing negatives. This ROUTER-side list has been widened once
    // since BIN-805 created it (here, by BIN-864/873); the blocking gate's own pattern
    // array has moved four times. Either way, a widening must still leave ordinary
    // helper scripts alone — that is what makes it a narrow list rather than a glob.
    expect(isCodePath('scripts/serve-spa.mjs')).toBe(false);
    expect(isCodePath('scripts/gen-app-icons.mjs')).toBe(false);
    expect(isCodePath('docs/org/ownership-map.json')).toBe(false);
    expect(route(['scripts/serve-spa.mjs']).tier).toBe('skip');
    expect(route(['scripts/gen-app-icons.mjs']).tier).toBe('skip');
    expect(route(['docs/org/adr/0018-seo-selection-ratchet.md']).tier).not.toBe('top');
  });

  it('keeps a floor under the list itself, so a shrink cannot go quiet', () => {
    // The comment above GATE_SCRIPTS warns a human; this stops CI going green on the
    // regression it warns about. Before this test existed, dropping an entry left the
    // suite fully green at 37/37 — with it, the shrink reddens this line by name.
    // Same shape as BIN-838's script-self-test floor (405a2fc) — "the floor is not
    // decoration".
    //
    // A FLOOR, not an equality: adding a ninth gate script is the desired direction and
    // must never fail. Pinning the exact count would punish the improvement — the same
    // trap taken out of the `it.each` above in this diff, whose three over-tight pins
    // moved into one isolated case, and out of gen-ownership-map.test.mjs's baseline
    // assertion in bfb82f4.
    expect(GATE_SCRIPTS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(GATE_SCRIPTS).size).toBe(GATE_SCRIPTS.length); // no duplicate padding
  });

  it('names every one of those scripts in the BLOCKING list too (BIN-864/873)', () => {
    // The advising half is above; this is the half that refuses a commit. BIN-830's
    // lesson is that widening one never widens the other — so this iterates the SAME
    // list, not a copy of the paths that happened to be added most recently.
    for (const path of GATE_SCRIPTS) {
      expect(integrationGateMatches(path), `${path} reaches no blocking reviewer`).toBe(true);
    }

    // …and the negatives hold on this side too: a helper script must not start
    // demanding a review just because the alternation grew.
    expect(integrationGateMatches('scripts/serve-spa.mjs')).toBe(false);
    expect(integrationGateMatches('scripts/gen-app-icons.mjs')).toBe(false);
  });
});

describe('the file that decides who reviews everything else (BIN-851)', () => {
  // Two lists decide who reviews a change, and widening one never widens the other:
  // this router ADVISES, `.claude/shared-plugin.json` → reviewGates BLOCKS. Until
  // BIN-851 neither of them covered shared-plugin.json itself, so a commit that
  // DELETED a reviewer pattern reached zero reviewers — a gate that could disarm
  // itself unwitnessed. Both halves are pinned here, in one place, on purpose.

  it('seats the release manager for the commit-gate config', () => {
    const r = route(['.claude/shared-plugin.json']);

    expect(r.tier).toBe('medium');
    expect(r.reasonCode).toBe('owned');
    expect(r.panel).toEqual([25]);
  });

  it('seats the same owner for the decided-deviations ledger', () => {
    // The mirror image: this file decides what a reviewer is FORBIDDEN to flag, so
    // appending to it silently retires a finding class.
    const r = route(['.claude/rules/accepted-deviations.md']);

    expect(r.tier).toBe('medium');
    expect(r.panel).toEqual([25]);
  });

  it('names both files in the BLOCKING gate list too, not just here', () => {
    // The half that actually refuses a commit. A future edit that drops these
    // patterns while leaving the dossier bullet in place would keep the two
    // assertions above green and still reopen the hole.
    expect(integrationGateMatches('.claude/shared-plugin.json')).toBe(true);
    expect(integrationGateMatches('.claude/rules/accepted-deviations.md')).toBe(true);
    // Deliberately NOT all of .claude/rules/: lessons-digest.md is appended by every
    // sprint close-out, and gating routine bookkeeping on a review was the rejected
    // alternative (Malin's narrow-over-broad call, same as BIN-830).
    expect(integrationGateMatches('.claude/rules/lessons-digest.md')).toBe(false);
  });
});

// BIN-869, 2026-08-13. Editing what a reviewer is TOLD to look for disarms a gate exactly
// as effectively as deleting its pattern, and until this batch the four instruction files
// and the three hooks routed `skip` and matched no gate at all. Both halves shipped with
// zero assertions the first time round; the test review mutated them and got 40/40 green
// in both directions, which is why this block exists.
// DERIVED from the directories, not hand-written. A hand-written list is green the day
// someone adds a fifth reviewer or a fourth hook, which is the exact silent-widening-gap
// this whole block exists to close (test review, 2026-08-13: nothing read `.claude/hooks/`,
// so a renamed hook stayed green while reaching no gate).
const CLAUDE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude');
const REVIEWER_INSTRUCTIONS = readdirSync(join(CLAUDE_DIR, 'agents'))
  .filter((f) => /^binge-.*-reviewer\.md$/.test(f))
  .map((f) => `.claude/agents/${f}`);
const HOOKS = readdirSync(join(CLAUDE_DIR, 'hooks'))
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => `.claude/hooks/${f}`);
const GATE_FILES = [...REVIEWER_INSTRUCTIONS, ...HOOKS];

describe("the reviewers' own instructions and the hooks reach a gate (BIN-869)", () => {
  it.each(GATE_FILES)('%s is named in the BLOCKING gate list', (file) => {
    expect(integrationGateMatches(file), `${file} reaches no blocking reviewer`).toBe(true);
  });

  it.each(GATE_FILES)('%s has an owning role, not the fallback seat', (file) => {
    const r = route([file]);

    expect(r.tier).toBe('medium');
    expect(r.panel).toEqual([25]);
  });

  it('EXCLUDES the knowledge files the reviewers write to themselves', () => {
    // The deliberate carve-out, exact mirror of the lessons-digest.md negative above:
    // these are appended on every ledger run, so gating them would put routine
    // bookkeeping behind a review (Malin's narrow-over-broad call). The mechanism is the
    // `\.md` SUFFIX in the pattern, not the `$` anchor — verified by mutation: dropping
    // the `$` still excludes them (their names continue past `-reviewer`), while
    // dropping `\.md` lets them straight in.
    expect(integrationGateMatches('.claude/agents/binge-test-reviewer.knowledge.md')).toBe(false);
    expect(integrationGateMatches('.claude/agents/binge-code-reviewer.knowledge.archive.md')).toBe(false);
  });

  it('the derived list has not silently shrunk to nothing', () => {
    // The floor is the whole defence for the `it.each` cases above: `it.each([])`
    // registers ZERO tests and reports no error, so an empty list would make every
    // assertion in this block vanish silently (verified — 46 tests become 32).
    expect(GATE_FILES.length).toBeGreaterThanOrEqual(7);
    expect(new Set(GATE_FILES).size).toBe(GATE_FILES.length);
    expect(REVIEWER_INSTRUCTIONS.length).toBeGreaterThanOrEqual(4);
    expect(HOOKS.length).toBeGreaterThanOrEqual(3);
  });

  it("the integration reviewer's OWN instructions get a second, independent reader", () => {
    // The one gated file whose only reviewer would otherwise be an agent spawned from
    // the very instructions being weakened — `_note4`'s "the gate could disarm itself
    // unwitnessed", one file further in. It is listed in the SECURITY gate too, and
    // without this assertion that line is deletable with the whole suite green.
    expect(gateMatches('binge-security-reviewer', '.claude/agents/binge-integration-reviewer.md')).toBe(true);
    // And the other three are deliberately NOT duplicated there — they already have an
    // independent reader, so doubling their review cost buys nothing.
    expect(gateMatches('binge-security-reviewer', '.claude/agents/binge-code-reviewer.md')).toBe(false);
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
