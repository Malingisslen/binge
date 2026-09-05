// Tests for the ownership-map generator (docs/org/gen-ownership-map.mjs).
//
// Run: npm test (this file is in vitest.config.ts's `include` via
// 'docs/org/**/*.{test,spec}.mjs' — the same glob route.test.mjs relies on).
//
// Why this file exists: the generator produces docs/org/ownership-map.json, which
// route.mjs reads to decide who reviews a change and whether a sprint may pick a
// ticket up at all. BIN-803 was filed because the map had been hand-edited despite
// its own "auto-generated — do not hand-edit" banner, and the reason it drifted is
// the interesting part: existence used to be a bare `existsSync` against the
// WORKING DIRECTORY, so the output depended on where the generator ran. A sprint
// worktree has no `.tmdb-cache/`, so regenerating from one silently dropped role
// #3's build-cache pattern — a map that looks edited though nobody edited it.
//
// Every assertion below is written so the cheapest wrong implementation fails it.
// In particular: a revert to filesystem-based existence, and a `findGaps()` that
// returns nothing, each fail a named test rather than passing quietly.

import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMap, findGaps, main, trackedPaths } from './gen-ownership-map.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), 'utf8'));

const tracked = trackedPaths();
const allPatterns = (map) => Object.values(map.roles).flatMap((r) => r.patterns);

describe('the committed map is exactly what the generator produces (BIN-803)', () => {
  it('regenerates the committed ownership-map.json identically', () => {
    // The whole point of the "do not hand-edit" banner. A hand-edit, a stale
    // regeneration, or a generator change that alters the output all fail here —
    // which is the only place they would ever fail, since nothing else compares
    // the file to its own source of truth.
    expect(buildMap(tracked).map).toEqual(readJson('docs/org/ownership-map.json'));
  });

  it('declares a pattern count that matches the patterns it actually holds', () => {
    // HEAD before BIN-803 declared 151 while holding 153: a count nobody recomputed.
    const { map } = buildMap(tracked);
    expect(map.patternCount).toBe(allPatterns(map).length);
    expect(map.roleCount).toBe(Object.keys(map.roles).length);
  });
});

describe('existence is resolved from git, not from the working directory (BIN-803)', () => {
  it('drops every pattern whose path this checkout does not track', () => {
    // THE DECISIVE CASE. With an empty tracked set, a git-based implementation can
    // keep nothing except the deliberately-declared untracked paths. The previous
    // implementation asked the filesystem instead, so it would still return all
    // ~156 patterns here and this test would fail — which is exactly the bug.
    const { map } = buildMap({ files: new Set(), dirs: new Set() });

    expect(allPatterns(map)).toEqual(['.tmdb-cache/']);
    expect(map.patternCount).toBe(1);
  });

  it('keeps an owned path that git deliberately does not track', () => {
    // `.tmdb-cache/` is a build artifact role #3 genuinely owns and git never sees.
    // It survives via the UNTRACKED_OWNED allowlist; if that allowlist is emptied,
    // the surface that costs money loses its owner again.
    const { map } = buildMap(tracked);

    expect(map.roles['3'].patterns).toContain('.tmdb-cache/');
  });

  it('gives the same answer from any checkout of the same commit', () => {
    // The property the git switch buys: the output is a function of the commit, not
    // of which worktree happens to have run a build.
    expect(buildMap(tracked).map).toEqual(buildMap(trackedPaths()).map);
  });
});

describe('the gate roster has a named owner (BIN-851)', () => {
  it('assigns the commit-gate config and the deviations ledger to role #25', () => {
    // Parsed out of docs/role-responsibilities.md §25. Delete that bullet and the
    // router answers `skip` for the file that decides who reviews everything else.
    const { map } = buildMap(tracked);

    expect(map.roles['25'].patterns).toContain('.claude/shared-plugin.json');
    expect(map.roles['25'].patterns).toContain('.claude/rules/accepted-deviations.md');
  });
});

describe('an owned folder that gains an unowned sibling is detected (BIN-788/803)', () => {
  it('reports a tracked code file that only inherits its reviewer', () => {
    // Kills the `findGaps() => []` mutant: a brand-new file in a directory the map
    // enumerates file-by-file must surface, because the reviewer it would otherwise
    // get is "whoever owns a sibling" — a guess, not an owner.
    const sibling = 'src/lib/tmdb/zzzSyntheticSibling.ts';
    const files = new Set(tracked.files);
    files.add(sibling);

    expect(findGaps({ files, dirs: tracked.dirs })).toContain(sibling);
  });

  it('does not report a file a role names outright', () => {
    // firestore.rules is named by three roles. If pattern-owned files leaked into
    // the gap list, the baseline would be noise and the ratchet meaningless.
    const gaps = findGaps(tracked);

    expect(gaps).not.toContain('firestore.rules');
    expect(gaps).not.toContain('docs/org/route.mjs');
  });

  it('holds the baseline in the shrinking direction only', () => {
    // The ratchet compares SETS, never counts — a count-based floor stays green
    // while one path leaves and another arrives (the BIN-823 lesson).
    //
    // Asserting EQUALITY here would be a trap, and a costly one: `main()` treats a
    // baseline entry that stopped being a gap as informational (logs, returns 0), so
    // someone following the generator's own remedy — name the file under its role in
    // docs/role-responsibilities.md — would get a green generator, commit, and then
    // fail `npm test`, which deploy.yml runs as the gate on the ONLY production path.
    // Fixing a gap must never break the deploy. Only NEW gaps are a regression.
    const accepted = new Set(readJson('docs/org/ownership-gaps.json').accepted);
    const newGaps = findGaps(tracked).filter((g) => !accepted.has(g));

    expect(
      newGaps,
      `New unowned sibling(s) in a directory the ownership map lists file-by-file.\n` +
        `Name them under the owning role in docs/role-responsibilities.md, or — only if no\n` +
        `role should own them — re-baseline with: node docs/org/gen-ownership-map.mjs --update-gaps`,
    ).toEqual([]);
  });

  it('returns a sorted list of repo-relative paths', () => {
    // Driven by a tracked set with deliberate gaps rather than by the repo, for the
    // reason BIN-871 demonstrated: the live list was emptied, and
    // a case that needs the repo to have a gap fails on the day someone fixes them all.
    // Two siblings, out of alphabetical order, so the sort is measured rather than
    // accidentally satisfied by one element.
    const zeta = 'src/lib/tmdb/__zeta-sibling.ts';
    const alpha = 'src/lib/tmdb/__alpha-sibling.ts';
    const withGaps = {
      files: new Set([...tracked.files, zeta, alpha]),
      dirs: new Set(tracked.dirs),
    };

    const gaps = findGaps(withGaps);

    expect(gaps).toContain(zeta);
    expect(gaps).toContain(alpha);
    expect([...gaps].sort()).toEqual(gaps);
    for (const g of gaps) expect(withGaps.files.has(g)).toBe(true);
  });
});

describe('--check grades without writing (BIN-802 entry-point discipline)', () => {
  it('does not write the generated files, and passes on an in-sync tree', () => {
    // Compare mtimes, NOT contents. On an in-sync tree a regeneration reproduces the
    // committed bytes exactly (that is the point of the idempotence test above), so a
    // content comparison here is vacuous: an implementation that ignored `--check` and
    // wrote anyway would still leave the file byte-identical and pass. Verified — that
    // mutant survived the content-based version of this test and dies on this one.
    const files = ['docs/org/ownership-map.json', 'docs/org/ownership-gaps.json'];
    const mtimes = () => files.map((f) => statSync(join(repoRoot, f)).mtimeMs);
    const before = mtimes();

    expect(main(['--check'])).toBe(0);

    expect(mtimes()).toEqual(before);
  });
});
