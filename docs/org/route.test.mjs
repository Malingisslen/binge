// Tests for the blast-radius router (docs/org/route.mjs).
//
// Run: npm test (this file is in vitest.config.ts's `include`, deliberately — a test
// file outside the runner's globs is silently never run by `npm test` while passing
// when invoked by hand, so being in the globs is the whole point. BIN-802.)
//
// The clause that used to stand here — that route.mjs's `--selftest` flag "is wired to
// nothing" — was struck 2026-08-25 (BIN-833). It stopped being true in 851696d, which
// added `docs/org/gate-symmetry.test.mjs`'s "the router's own golden cases are wired to
// something that runs (BIN-880)" case; that case spawns `node docs/org/route.mjs
// --selftest` and requires exit 0, under this same `npm test`.
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
import { existsSync, globSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { route, isCodePath, TOOLING_CODE_FILES, mdBlock } from './route.mjs';
// The REAL config object, imported the way vitest itself loads it — never scraped as text.
// A routine reformat of vitest.config.ts would make a regex-scraped copy silently green,
// which is the "a shrink reads as a pass" failure this whole family exists to stop
// (BIN-838/823/850, and #25's binding condition 2 on BIN-874).
import vitestConfig from '../../vitest.config.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const posix = (p) => p.replace(/\\/g, '/');

// Would the repo's BLOCKING commit gate demand binge-integration-reviewer for this path?
// Mirrors the real hook's decision rather than just its pattern list; the precedence is in
// the function below. Reads the live config, not a fixture: the point is to catch the
// config drifting away from the router.
function gateMatches(agent, file) {
  const cfg = JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude', 'shared-plugin.json'),
      'utf8',
    ),
  );
  const gate = cfg.reviewGates.find((g) => g.agent === agent);
  // BIN-906 #4: deleting a whole gate OBJECT (not just one of its patterns) used to blow
  // up on the next property read and redden ~800 cases with a message about `undefined`,
  // pointing at this file instead of at the config that changed.
  if (!gate) throw new Error(`.claude/shared-plugin.json → reviewGates has no entry for ${agent}`);
  // A `keyed` rule OWNS its path and decides alone, same precedence as the real hook and
  // as blockingGates() in gate-symmetry.test.mjs.
  if ((gate.keyed || []).some((k) => k && k.path === file)) return true;
  const exact = new Set(gate.exact || []);
  return (
    (exact.has(file) || (gate.patterns || []).some((p) => new RegExp(p).test(file))) &&
    !(gate.exclude || []).some((p) => new RegExp(p).test(file))
  );
}

const integrationGateMatches = (file) => gateMatches('binge-integration-reviewer', file);

describe('the gates this file interrogates exist (BIN-906)', () => {
  it('names both gate objects before anything asserts against them', () => {
    // Deliberately FIRST in the file, and named: every block below reads the blocking
    // side through `gateMatches`, so a deleted gate object is the one failure that says
    // WHICH object is gone instead of repeating a type error a few hundred times.
    for (const agent of ['binge-integration-reviewer', 'binge-security-reviewer']) {
      expect(() => gateMatches(agent, 'docs/org/route.mjs')).not.toThrow();
      // …and it still has something to match with: an entry stripped to an empty
      // pattern list blocks nothing while remaining findable by name.
      expect(gateMatches(agent, 'src/lib/firebase/userData.ts') || gateMatches(agent, 'src/app/page.tsx')).toBe(
        true,
      );
    }
  });
});

describe('folder-ownership inheritance (BIN-788)', () => {
  it('seats the directory owner for an unlisted sibling file', () => {
    // The fixture is deliberately a path that does not exist: the branch under test is
    // "a file the map does not list, in a directory it does", and any REAL such file can
    // be given an owner later — BIN-871 did exactly that to this case's previous fixture,
    // src/lib/tmdb/prefetch.ts.
    // Before BIN-788 this matched nothing and routed `skip` — an unreviewed change
    // in a heavily-owned directory.
    const unlisted = 'src/lib/tmdb/__unlisted-sibling.ts';
    const r = route([unlisted]);

    expect(r.tier).toBe('medium');
    expect(r.reasonCode).toBe('owned');
    expect(r.panel).toHaveLength(1);

    // The seat must be a role that inherited it from the directory — not the
    // #14 unmapped fallback, which would mean inheritance never fired.
    const seated = r.roles.find((role) => role.num === r.panel[0]);
    expect(seated.inherited).toContain(unlisted);
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

// The CODE_ROOT_FILES half of `isCodePath` — root-level files that are code despite
// sitting outside CODE_ROOTS.
describe('root-level files outside src/ that are still code', () => {
  // BIN-923. `vitest.rules.config.ts` and `vitest.setup.ts` were promoted into
  // CODE_ROOT_FILES by BIN-880 (851696d) and no test named either: a grep for both names
  // across this file and gate-symmetry.test.mjs returned nothing outside route.mjs itself.
  // Their only protection was gate-symmetry's rule B firing INDIRECTLY (a path the
  // blocking gate stops must not route `skip`) — a whole-tree aggregation, so one future
  // ACCEPTED_ASYMMETRIES entry or one gate narrowing removes the only thing pinning the
  // decision, silently, and no case explains why these two are code.
  //
  // `not skip` rather than an exact tier/reasonCode ON PURPOSE: neither file has an owning
  // role today, so both answer `medium`/`unmapped-code`, and NAMING an owner for either is
  // an intended improvement that flips the reasonCode to `owned`. A case pinning it would
  // report that improvement as a failure — the same reasoning route.mjs's golden case for
  // `scripts/check-public-env.mjs` carries, in the same words: what must never change is
  // that it stops being `skip`.
  it.each(['vitest.rules.config.ts', 'vitest.setup.ts'])(
    '%s is code and does not route skip (BIN-923)',
    (path) => {
      expect(isCodePath(path)).toBe(true);

      const r = route([path]);
      expect(r.tier).not.toBe('skip');
      expect(r.panel).not.toEqual([]);
    },
  );

  it('…and the blocking gate stops both, which is the pair BIN-880 was closing', () => {
    // The other half of that promotion: the gate ALREADY stopped both files while the
    // router cleared them, so widening the router added no blocking obligation. Pinned
    // here so the two halves cannot drift apart again without a red test — rule B goes
    // quiet the moment either path picks up an exception.
    expect(integrationGateMatches('vitest.rules.config.ts')).toBe(true);
    expect(integrationGateMatches('vitest.setup.ts')).toBe(true);
  });

  // BIN-934. Lockfiles are code, decided 2026-08-22, and the decision applies to BOTH.
  // Before it, the two had landed in different classes by accident and not by judgment:
  // `functions/package-lock.json` is code because `functions/` is a CODE_ROOT and `.json`
  // is a code extension, while the ROOT lockfile matched nothing in the router at all and
  // routed `skip` with zero blocking reviewers. gate-symmetry.test.mjs could not see that
  // under either keying of its rule A1 — which is why this case lives HERE, on the
  // router side where the hole was.
  it.each(['package-lock.json', 'functions/package-lock.json'])(
    '%s is code, does not route skip, and reaches the blocking gate (BIN-934)',
    (path) => {
      expect(isCodePath(path)).toBe(true);

      const r = route([path]);
      expect(r.tier).not.toBe('skip');

      // The BIN-830 rule, asserted rather than promised: widening the ADVISING list has
      // never widened the BLOCKING one on its own. Both lockfiles reach the reviewer
      // class BIN-919 chose for `package.json`.
      expect(integrationGateMatches(path)).toBe(true);
    },
  );

  it('the manifest and its lockfile are not in different classes by accident (BIN-934)', () => {
    // The ticket's actual subject. Not "each file reaches some reviewer" — that is the
    // case above — but that the four dependency files give ONE answer between them, which
    // is what nobody had ever chosen. A revert of either half of the decision (the router
    // entry or the gate pattern) fails this.
    for (const path of [
      'package.json',
      'package-lock.json',
      'functions/package.json',
      'functions/package-lock.json',
    ]) {
      expect(isCodePath(path), `${path} is not code to the router`).toBe(true);
      expect(route([path]).tier, `${path} routes skip`).not.toBe('skip');
    }
    expect(integrationGateMatches('package.json')).toBe(true);
    expect(integrationGateMatches('package-lock.json')).toBe(true);

    // The reasoning for which of these reach the security gate lives in reviewGates' own
    // _note9/_note10/_note19 rather than in a copy here.
    expect(gateMatches('binge-security-reviewer', 'functions/package-lock.json')).toBe(true);
    expect(gateMatches('binge-security-reviewer', 'package-lock.json')).toBe(false);
    // BIN-939: the manifest reaches the security gate through its OWN pattern, so deleting
    // that pattern must redden something. Rule A1 would not — package.json still reaches the
    // integration gate, so its reviewer count stays above zero.
    expect(gateMatches('binge-security-reviewer', 'package.json')).toBe(true);
  });

  // BIN-967. A lint rule and the file that switches it on are one guard, not two.
  // BIN-931 gated the rule FILE and its test and left this one out, priced against a red
  // test; BIN-967 reversed that on 2026-08-23. Named here rather than left to
  // gate-symmetry, for the reason the BIN-923 block above gives at length: rule B is a
  // whole-tree aggregation, so one future ACCEPTED_ASYMMETRIES entry retires the only
  // thing pinning the decision and nothing says why this file is code.
  it('the lint rule and the config that switches it on answer the same way (BIN-967)', () => {
    for (const path of [
      'eslint-rules/no-bare-streaming-offers-id.mjs',
      'eslint-rules/no-bare-streaming-offers-id.test.mjs',
      'eslint.config.mjs',
    ]) {
      expect(isCodePath(path), `${path} is not code to the router`).toBe(true);
      expect(route([path]).tier, `${path} routes skip`).not.toBe('skip');
      // The BIN-830 pairing, asserted on the half that actually blocks. Emptying the
      // config’s `rules` block disarms the rule while every other gated file stays
      // byte-identical, so the switch has to reach a reviewer too.
      expect(integrationGateMatches(path), `${path} reaches no blocking reviewer`).toBe(true);
    }
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
// BIN-874 (2026-08-14): this used to be a hand-written copy of those eight paths — a
// THIRD list to keep in step by memory, which is what the ticket was filed about
// (2026-08-12 comment: "tre listor som ska hållas i takt för hand"). It is now DERIVED
// from the router's real `TOOLING_CODE_FILES`, so the cases below read the advising list
// itself and check it against the blocking one. Nothing here can be quietly shrunk any
// more: a path dropped from the real set drops out of every case AND breaks the floor at
// the end of this block.
const GATE_SCRIPTS = [...TOOLING_CODE_FILES];

describe('the router and the gate scripts cannot clear themselves (BIN-805)', () => {
  it.each(GATE_SCRIPTS)('%s routes medium, not skip', (path) => {
    // Assert the property this block is named for and nothing more — the entries do not
    // answer alike.
    //
    // WHICH entry answers WHAT is not written here, and neither is how many. Deliberately
    // (BIN-979). Enumerations here have gone stale repeatedly, and the rewrites meant to
    // fix them kept carrying a fresh claim nobody had run a command against: the
    // 2026-08-23 attempt was failed by the outcome verifier for exactly that, and so was
    // the first attempt at THIS strike, which asserted a single inheriting file where the
    // router names more, and partitioned the set into buckets that did not hold all of
    // it. So the sentence is not written at all any more. Derive it instead, which is the
    // only form that cannot go stale:
    //   node -e "import('./docs/org/route.mjs').then(m=>{for(const p of [...m.TOOLING_CODE_FILES].sort()){const r=m.route([p]);console.log(p, r.reasonCode, JSON.stringify(r.panel))}})"
    //
    // (A "Corrected 2026-08-17" note stood here, recording that an earlier version of the
    // paragraph above had miscounted which entries were owned. Struck 2026-08-25 with the
    // paragraph it corrected — a correction whose subject no longer exists points at
    // nothing, and the enumeration is not coming back.)
    //
    // Pinning either specific answer HERE would defeat the point: the router's own
    // failure text tells you to fix an unowned path by naming it in
    // docs/role-responsibilities.md, and a `[14]` pin would make following that advice
    // fail `npm test`, which gates deploy.yml. Improving ownership must never break the
    // deploy; the same trap is refused for the gap baseline in gen-ownership-map.test.mjs.
    // Both specific answers ARE pinned, each in its own named test below, so flipping one
    // reddens exactly one assertion, by name.
    //
    // BIN-874 dropped an `expect(isCodePath(path)).toBe(true)` that stood here: once the
    // list is DERIVED from TOOLING_CODE_FILES, isCodePath is true by construction for
    // every entry, and a tautology in a drift-detecting suite reads as coverage while
    // proving nothing. The non-vacuous halves are the blocking-side case further down
    // (every entry of the advising list must reach a blocking reviewer) and the BIN-874
    // symmetry block, which walks the two lists against each other over the real tree.
    const r = route([path]);

    expect(r.tier).toBe('medium');
    expect(r.panel).not.toEqual([]); // somebody is seated
    expect(r.panel).not.toContain(21); // and it is never the Technical Writer alone
  });

  it('seats the unmapped-code fallback while a gate script has no named owner', () => {
    // The specifics, isolated to ONE case so that naming an owner later flips exactly
    // this test — a signal to update it — instead of scattered ones. That is what
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
    // These are the load-bearing negatives. Both lists have been widened repeatedly since
    // BIN-805 created this one. Either way, a widening must still leave ordinary helper
    // scripts alone — that is what makes it a narrow list rather than a glob.
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
    // Since BIN-874 the list is derived, so this floor now guards the REAL set in
    // route.mjs: deleting `scripts/check-public-env.mjs` from TOOLING_CODE_FILES makes
    // every case above vanish silently, and this line is what refuses that.
    // Same shape as BIN-838's script-self-test floor (405a2fc) — "the floor is not
    // decoration".
    //
    // A FLOOR, not an equality: adding a further gate script is the desired direction and
    // must never fail. Pinning the exact count would punish the improvement — the same
    // trap taken out of the `it.each` above in this diff, whose three over-tight pins
    // moved into one isolated case, and out of gen-ownership-map.test.mjs's baseline
    // assertion in bfb82f4.
    //
    // BIN-906 #2 removed the `new Set(GATE_SCRIPTS).size === GATE_SCRIPTS.length` line
    // that used to sit here. It guarded against padding the floor with duplicates, which
    // was a real risk while the list was hand-written — but since BIN-874 derived it from
    // a Set (`[...TOOLING_CODE_FILES]`) duplicates are impossible by construction, and a
    // line that cannot fail reads as coverage while proving nothing. Same reasoning that
    // retired `expect(isCodePath(path)).toBe(true)` from the `it.each` above; the
    // dedup line on GATE_FILES further down is kept, because that list is two
    // independent `readdirSync` calls concatenated, not a Set being spread.
    // Raised to the list's measured length on 2026-08-25 (BIN-979), because a floor that
    // does not follow its list is a guard that never fires. No claim is made here about
    // how many widenings it fell behind by — measure the list instead, with the command
    // that set this number:
    //   node -e "import('./docs/org/route.mjs').then(m=>console.log(m.TOOLING_CODE_FILES.size))"
    // A FLOOR, not an equality — the
    // objection to equality pins above is about pinning a specific answer, not about
    // advancing a shrink guard with the list it guards. It matters most for
    // docs/org/metrics/log_event.mjs, the one new entry with NO `.test.mjs` sibling:
    // remove it from both TOOLING_CODE_FILES and the gate regex and the symmetry
    // biconditional reads false === false, gate-symmetry is blind (no owner, no gate —
    // its own blind spot 1) and the DISCOVERY half never nominates it. This floor is the
    // only thing left that would notice, and BIN-918 left it at 9 until the twelfth
    // integration pass measured it.
    //
    // BIN-1009 nearly repeated it. Left at 20 against a list of 22, the guard's own
    // motivating case goes green: removing docs/org/metrics/log_event.mjs from both lists
    // gives 21, still ≥ 20, and nothing else sees it — that file has no `.test.mjs`
    // sibling so the BIN-874 discovery half never nominates it, the TOOLING_MJS
    // biconditional reads false === false, and gate-symmetry's A1 is keyed on isCodePath,
    // which the removal switches off. Re-measure with the command above; never copy this
    // number forward without running it.
    expect(GATE_SCRIPTS.length).toBeGreaterThanOrEqual(29);
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
    // Reached by a `keyed` rule, not a pattern (BIN-990). Without this the keyed arm in
    // gateMatches() is pinned by nothing in this file.
    expect(integrationGateMatches('.claude/settings.json')).toBe(true);
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
    // Floors lowered 7→6 and 3→2 on 2026-08-23 when dossier-freshness.mjs and
    // map-freshness.mjs merged into the single freshness.mjs. They are deliberately NOT
    // re-raised as the directories grow — these are anti-vacuity floors, and their only
    // job is catching the derived list going EMPTY, which would make every `it.each`
    // above vanish with no error.
    //
    // A tally of what the two directories hold stood here and was struck 2026-08-26
    // (BIN-1009 added `.claude/hooks/freshness.test.mjs` and made it false the same day
    // it was read). Derive it instead of trusting a sentence:
    //   ls .claude/agents/*-reviewer.md .claude/hooks/*.mjs
    expect(GATE_FILES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(GATE_FILES).size).toBe(GATE_FILES.length);
    expect(REVIEWER_INSTRUCTIONS.length).toBeGreaterThanOrEqual(4);
    expect(HOOKS.length).toBeGreaterThanOrEqual(2);
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

// ── BIN-874, 2026-08-14 ────────────────────────────────────────────────────────────────
// Four widenings of the review lists (BIN-830, BIN-851, BIN-864/873, BIN-869) and every
// one of them REACTIVE: a human or a reviewer happened to ask "does this .mjs decide
// something about review?". That is discovery debt, not maintenance debt — the fix is not
// a fifth patch to the regex (Malin decided narrow-over-broad twice, 2026-08-08
// alternative (a), and that is explicitly out of scope) but a check that finds the fifth
// gap before an incident does.
//
// Two halves, and neither compares a real list against a hand-written copy of itself:
//
//   1. SYMMETRY — over every .mjs the tree actually contains under docs/ and scripts/,
//      the advising side (`isCodePath`, i.e. route.mjs's TOOLING_CODE_FILES) and the
//      blocking side (`reviewGates` in .claude/shared-plugin.json) must give the SAME
//      answer. Widening one without the other is exactly BIN-830's lesson, and it is now
//      a red test rather than a note in a comment.
//   2. DISCOVERY — a third, independent signal: any file with a `.test.mjs` sibling
//      inside vitest's own `include` globs is a file somebody thought worth testing
//      outside src/, i.e. a candidate decider. Those must be in BOTH lists, or carry a
//      named exception with a reason.
//
// #25's condition 4, answered explicitly: this check needs NO new entry in either list,
// because it is not a new file. It lives in docs/org/route.test.mjs, which is already in
// TOOLING_CODE_FILES and already matched by the blocking gate — so weakening the check
// itself cannot slip past a reviewer, the hole BIN-869 closed one file over.
// `fs.globSync` needs Node >= 22 (still flagged experimental there, hence the one-line
// warning in the run output); every workflow that runs `npm test` pins node-version 22 —
// derive them rather than trusting this: grep -l "npm test" .github/workflows/*.yml
const TOOLING_MJS = globSync(['docs/**/*.mjs', 'scripts/**/*.mjs'], { cwd: REPO_ROOT }).map(posix);

// Files that a `.test.mjs` sibling nominates as candidates but that are deliberately NOT
// review machinery. A LIST WITH A REASON EACH, never a silence — and the rot test below
// fails the moment an entry stops being needed.
const NOT_REVIEW_MACHINERY = {
  'functions/scripts/recap-upload.helpers.mjs':
    'Recap content pipeline (BIN-185), not review machinery: it decides nothing about who reviews what. The router already calls it code — functions/ is a CODE_ROOT — and seats the #14 fallback, so it is not unreviewed on the advising side. Closing the gap to the blocking gate for every unowned functions/ path is the ownership-vs-gate sweep in BIN-880, not this narrow tooling list.',
  'functions/scripts/recap-upload.helpers.test.mjs':
    'Same subject as the line above, and additionally reached by binge-test-reviewer through the repo-wide `\\.test\\.mjs$` pattern, so it is not a zero-reviewer path.',
  'scripts/scripts-self-tests-present.test.mjs':
    'The floor asserting every script under scripts/ carries a self-test (BIN-850). It has no non-test sibling to gate, and binge-test-reviewer already reaches it via the repo-wide `\\.test\\.mjs$` pattern — so it is NOT a zero-reviewer hole (BIN-874 comment, 2026-08-12). Putting it into the two narrow lists is a widening only Malin decides (2026-08-08, alternative (a)); this check names it instead of staying quiet about it.',
};

// The candidate set, derived — test file plus the sibling it tests, when that exists.
const MJS_TEST_FILES = globSync(vitestConfig.test.include, {
  cwd: REPO_ROOT,
  exclude: vitestConfig.test.exclude,
})
  .map(posix)
  .filter((p) => /\.(test|spec)\.mjs$/.test(p))
  .sort();
const REVIEW_CANDIDATES = [
  ...new Set(
    MJS_TEST_FILES.flatMap((testFile) => {
      const subject = testFile.replace(/\.(test|spec)\.mjs$/, '.mjs');
      return existsSync(join(REPO_ROOT, subject)) ? [testFile, subject] : [testFile];
    }),
  ),
].sort();

// BIN-906 #1 — the block used to be called "the advising list and the blocking gate
// cannot drift apart", which promises the whole repo while the cases below only walk
// tooling `.mjs` under docs/ and scripts/. Two whole pattern classes sit outside that
// glob and this block is blind to both: the repo-wide `\.(ts|tsx)$` entry and
// `^\.github/(workflows|actions)/` — deleting either from reviewGates left the suite at
// 837/837 green. Those belong to BIN-880, whose docs/org/gate-symmetry.test.mjs walks
// every git-TRACKED path and compares the ownership map against the gate; both deletions
// redden it. The name here now says what this block actually covers.
// BIN-906 #3 — and the DISCOVERY half below is keyed on a `.test.mjs` sibling, so a
// tooling `.mjs` that nobody wrote a test for is nominated by nothing and stays invisible
// to it. That is a stated limit of the word "mechanical", NOT a request to widen:
// narrow-before-broad is Malin's 2026-08-08 call, alternative (a).
// BIN-1014 — the named example is struck rather than replaced. The sentence above states
// the limit completely on its own.
describe('the advising list and the blocking gate cannot drift apart for tooling `.mjs` (BIN-874)', () => {
  it.each(TOOLING_MJS)('%s gets the same answer from both lists', (path) => {
    // The biconditional is the point: `isCodePath` false + gate true means a commit is
    // blocked for a review the router never asks for, and true + false is the BIN-830
    // hole (route.mjs was code to the router and matched no gate for three days).
    expect(
      isCodePath(path),
      `${path}: the router calls it ${isCodePath(path) ? 'code' : 'not code'} but the blocking gate ${integrationGateMatches(path) ? 'demands' : 'demands no'} a review — widen or narrow BOTH (docs/org/route.mjs TOOLING_CODE_FILES and .claude/shared-plugin.json reviewGates), in one commit`,
    ).toBe(integrationGateMatches(path));
  });

  it.each(REVIEW_CANDIDATES.filter((p) => !(p in NOT_REVIEW_MACHINERY)))(
    '%s is named in BOTH review lists',
    (path) => {
      // A new gate script arriving with its test — the actual future this ticket exists
      // for — fails here by name until both lists carry it.
      expect(
        TOOLING_CODE_FILES.has(path),
        `${path} has a test in vitest's include globs but is missing from TOOLING_CODE_FILES in docs/org/route.mjs`,
      ).toBe(true);
      expect(
        integrationGateMatches(path),
        `${path} has a test in vitest's include globs but reaches no blocking reviewer`,
      ).toBe(true);
    },
  );

  it('every exception carries a reason, and rots loudly instead of quietly', () => {
    for (const [path, reason] of Object.entries(NOT_REVIEW_MACHINERY)) {
      expect(reason.length, `${path}: an exception needs a reason, not a placeholder`).toBeGreaterThan(80);
      expect(
        REVIEW_CANDIDATES,
        `${path} is exempted but is no longer a candidate (deleted, or renamed out of the vitest globs) — delete the entry`,
      ).toContain(path);
      expect(
        TOOLING_CODE_FILES.has(path) && integrationGateMatches(path),
        `${path} is now in both lists — its exception is spent, delete the entry`,
      ).toBe(false);
    }
  });

  it('the derived inputs have not silently emptied', () => {
    // `it.each([])` registers ZERO tests and reports no error, so an include array that
    // stopped matching — a moved directory, a renamed glob, a config import that started
    // resolving to something else — would delete both blocks above in total silence.
    // Anti-vacuity floors: they exist to make a list that stopped matching fail loudly,
    // not to pin today's length.
    expect(vitestConfig.test.include.length).toBeGreaterThanOrEqual(5);
    expect(MJS_TEST_FILES.length).toBeGreaterThanOrEqual(6);
    expect(REVIEW_CANDIDATES.length).toBeGreaterThanOrEqual(11);
    // TOOLING_MJS is the exception: its floor is NOT the measured value. The glob is
    // dominated by one-off scripts/recaps/*.mjs, so a count pinned near the measurement
    // would break on every new recap without ever guarding the thing that matters. The
    // floor stays low and the SHAPE is pinned instead — one file per glob entry, below.
    expect(TOOLING_MJS.length).toBeGreaterThanOrEqual(19);
    // One pin per glob entry, because a count cannot see a HALF disappear. Dropping
    // 'docs/**/*.mjs' leaves every scripts/ file — over any plausible floor — while
    // silently removing route.mjs, route.test.mjs, gen-ownership-map.mjs and its test
    // from the symmetry check: precisely the four paths BIN-830 was filed about. That
    // shrink-reads-as-a-pass class (BIN-838/823/850) is what this whole block exists to
    // stop, so it must not be reproducible inside the guard itself.
    expect(TOOLING_MJS).toContain('docs/org/route.mjs');
    // …and the narrow list stays narrow: ordinary helper scripts must never be dragged in
    // by this check (Malin, 2026-08-08, alternative (a) — criterion 4 on the ticket).
    expect(TOOLING_MJS).toContain('scripts/serve-spa.mjs');
    expect(TOOLING_MJS).toContain('scripts/gen-app-icons.mjs');
    expect(route(['scripts/serve-spa.mjs']).tier).toBe('skip');
    expect(route(['scripts/gen-app-icons.mjs']).tier).toBe('skip');
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

describe('mdBlock — the `--md` form every tool actually consumes (BIN-832)', () => {
  // `.claude/shared-plugin.json` sets `delivery.router.command` to
  // `node docs/org/route.mjs --md`, so the markdown block — not the JSON — is what the
  // sprint skill and /linear paste into a ticket. It had no coverage at all: 24f6612
  // moved its warning line from `unmappedCode` to `unownedCode`, which fires on a
  // different set of cases, and nothing in this file would have failed.
  //
  // The first cases feed mdBlock LITERAL result objects instead of live routes. That is
  // deliberate. Anchoring the warning on a real repo path pins today's ownership map, so
  // the day that path gains an owner the test fails for a reason that has nothing to do
  // with mdBlock — which is how BIN-834 would have broken a naive version of this test.
  // The live-route cases below cover the wiring; the literal ones cover the formatting.

  it('names the tier, every seated role, and the reason', () => {
    const md = mdBlock({
      tier: 'medium',
      reason: 'single medium-impact area → one owning role',
      panel: [25],
      roles: [{ num: 25, title: 'Engineering Manager / Release Manager' }],
      unownedCode: [],
    });
    expect(md).toContain('Tier **medium**');
    expect(md).toContain('#25 Engineering Manager / Release Manager');
    expect(md).toContain('single medium-impact area → one owning role');
  });

  it('titles the unmapped-code fallback seat even though it has no matched paths', () => {
    // The #14 seat is synthesised by route() for code nobody owns, so it never appears in
    // `roles`. Without the ROLE_TITLES lookup the block would print a bare "#14" and the
    // reader would have to go find out who that is.
    const md = mdBlock({
      tier: 'medium',
      reason: 'code path(s) with no owning role',
      panel: [14],
      roles: [],
      unownedCode: ['src/lib/no-such-dir/brandNew.ts'],
    });
    expect(md).toContain('#14 Software Architect');
  });

  it('prints the unowned-code warning only when there is unowned code', () => {
    const base = {
      tier: 'medium',
      reason: 'single medium-impact area → one owning role',
      panel: [25],
      roles: [{ num: 25, title: 'Engineering Manager / Release Manager' }],
    };
    expect(mdBlock({ ...base, unownedCode: ['scripts/nobody-owns-me.mjs'] })).toContain(
      '⚠ Unowned code path(s): scripts/nobody-owns-me.mjs',
    );
    expect(mdBlock({ ...base, unownedCode: [] })).not.toContain('⚠');
    // The field is optional on older callers; a missing one must read as "none", not throw.
    expect(mdBlock(base)).not.toContain('⚠');
  });

  it('says there is no review tier for a skip result, and names no roles', () => {
    const md = mdBlock({ tier: 'skip', reason: 'no code paths', panel: [], roles: [] });
    expect(md).toContain('no review tier');
    expect(md).not.toContain('Tier **');
    // …and seats nobody. Not `toContain('#')` — the block's own "## Stakeholders" heading
    // makes that vacuously true, so match a role NUMBER instead.
    expect(md).not.toMatch(/#\d/);
  });

  it('is wired to route(): a high-stakes path prints the full panel', () => {
    // firestore.rules is pinned as `top` by the high-stakes block above, so the tier
    // assertion cannot move with the ownership map. The role name and the absent warning
    // CAN — both are read off the map — which is why the literal cases above carry the
    // formatting contract and this one only proves the two ends are wired together.
    const md = mdBlock(route(['firestore.rules']));
    expect(md).toContain('Tier **top**');
    expect(md).toContain('#4 Security Architect');
    expect(md).not.toContain('⚠');
  });

  it('is wired to route(): code nobody owns carries its warning all the way out', () => {
    // A path under a directory that does not exist can never acquire an owner, so this
    // anchor cannot rot the way a real repo path can.
    const md = mdBlock(route(['src/lib/no-such-dir/brandNew.ts']));
    expect(md).toContain('Tier **medium**');
    expect(md).toContain('⚠ Unowned code path(s): src/lib/no-such-dir/brandNew.ts');
  });
});
