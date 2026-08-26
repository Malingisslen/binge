// Tests for the freshness PostToolUse hook (BIN-1009).
//
// Run: npm test — this file is matched by vitest.config.ts's `.claude/hooks/**` include,
// added in the same commit. A test file outside the runner's globs is silently never run
// while passing when invoked by hand (BIN-802), so if you move this file, move that glob.
//
// WHY THIS FILE EXISTS. `freshness.mjs` is the mechanism that creates work orders: when it
// stamps `.claude/state/workflow-map-stale.json`, CLAUDE.md instructs the next session to
// re-trace the flows for the paths it names. Both directions cost:
//   • a false positive sends a session to re-trace a file nobody edited — BIN-790 is the
//     ticket filed about exactly that;
//   • a lost anti-self-trigger skip makes editing the role doc stamp a marker asking
//     someone to re-audit the role doc.
// Neither is visible in a diff: the flag lives under gitignored `.claude/state/`.
//
// (A tally of how many times the first has happened, and a list of ids for it, stood here
// and was struck 2026-08-26. Two of the ids were the OTHER failure — BIN-706's commit is
// "re-trace the four flows nine commits made wrong" and BIN-968's re-traced three real
// edits, i.e. the flag was right and unread, not wrong. `freshness.mjs` itself calls
// BIN-968 "that same flag surviving sprints unread". Do not write a corrected count: a
// tally of past incidents is not what this test protects, and the last one shipped into a
// permanent comment was wrong about two of its three cases.)
//
// The hook could not be tested at all until this commit — it ran its CLI at import and
// called `process.exit(0)`, so importing it ate the runner's stdin and killed the process.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  toRepoRelative,
  globToRegExp,
  patternMatch,
  matchesToken,
  isDossierStampSkipped,
  isMapStampSkipped,
} from './freshness.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Runs the hook exactly the way `.claude/settings.json` runs it:
 *   bash -c 'cd "$CLAUDE_PROJECT_DIR"; exec node .claude/hooks/freshness.mjs'
 * rather than a convenient absolute-path call — #25's binding condition on this ticket,
 * 2026-08-26: test the invocation that actually happens.
 *
 * (A claim that this specifically proves the guard survives a RELATIVE argv[1] was struck
 * 2026-08-26. Node resolves the entry script's argv[1] to an absolute path before user
 * code runs, measured under this exact invocation.)
 *
 * `projectDir` redirects where the hook READS the map and WRITES the flag, via the
 * `CLAUDE_PROJECT_DIR` branch of resolveRepoRoot(). cwd stays the real repo so the
 * relative path — the thing under test — still resolves. That keeps the test off the
 * repo's own `.claude/state/`, which a sibling session may be using.
 */
function runHook(input, projectDir) {
  return execFileSync('bash', ['-c', `cd "${REPO_ROOT}"; exec node .claude/hooks/freshness.mjs`], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir ?? REPO_ROOT },
  });
}

/**
 * A throwaway project dir holding just enough for the hook to have something to do.
 *
 * It writes BOTH inputs, and that is load-bearing rather than tidy. An earlier version
 * wrote only the workflow map, so `stampDossier` always returned at its own
 * `existsSync(ownership-map.json)` guard — and deleting the entire `stampDossier(...)`
 * call out of `main()` left the whole file green. Half this hook was covered by nothing,
 * which is round one's exit-code tautology repeated on the sibling stamper. Found by the
 * test reviewer, 2026-08-26.
 */
function makeFixture({ nodePath, ownedPattern, malformedRole, roleNum = '9' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'freshness-hook-'));
  mkdirSync(join(dir, 'docs', 'org'), { recursive: true });
  if (nodePath) {
    writeFileSync(
      join(dir, 'docs', 'workflow-map.html'),
      `<script id="data" type="application/json">${JSON.stringify({ nodes: [{ path: nodePath }] })}</script>`,
    );
  }
  if (ownedPattern) {
    writeFileSync(
      join(dir, 'docs', 'org', 'ownership-map.json'),
      JSON.stringify({ roles: { [roleNum]: { patterns: [ownedPattern] } } }),
    );
  }
  if (malformedRole) {
    // `patterns` as a NUMBER. stampDossier's loop is `for (const pat of (def.patterns || []))`,
    // which throws "number 5 is not iterable" — and none of that function's three internal
    // try/catches wrap it (they cover the JSON read, the mkdir, and the marker append).
    // So this is a real, reachable throw out of stampDossier, which is what makes the
    // isolation contract in main() testable at all.
    writeFileSync(
      join(dir, 'docs', 'org', 'ownership-map.json'),
      JSON.stringify({ roles: { [roleNum]: { patterns: 5 } } }),
    );
  }
  return dir;
}

const flagIn = (dir) => join(dir, '.claude', 'state', 'workflow-map-stale.json');
const markerIn = (dir, roleNum) =>
  join(dir, '.claude', 'state', 'dossier-stale', `${roleNum}.marker`);

describe('the entry-point guard (BIN-802 / BIN-1009)', () => {
  // This suite importing the module at all is the first half of the proof: before the
  // guard, that import would have blocked on fd 0 and then exited the process.

  it('FIRES on the real invocation — the hook still does its job', () => {
    // The load-bearing case. "Exits 0" alone proves nothing: a guard broken to `if
    // (false)` also exits 0, having done nothing — measured, that mutant left an
    // exit-code-only suite fully green. What distinguishes a working guard from a dead
    // one is the SIDE EFFECT, so this asserts the stamp.
    //
    // A dead guard is the worst outcome in this ticket: the hook stops stamping, fails
    // open by design, and nothing anywhere reports it.
    const dir = makeFixture({ nodePath: 'src/contexts/WatchlistContext.tsx' });
    try {
      runHook(
        JSON.stringify({
          tool_name: 'Edit',
          tool_input: { file_path: 'src/contexts/WatchlistContext.tsx' },
        }),
        dir,
      );
      expect(existsSync(flagIn(dir))).toBe(true);
      const flag = JSON.parse(readFileSync(flagIn(dir), 'utf8'));
      expect(flag.triggers).toContain('src/contexts/WatchlistContext.tsx');
      expect(flag.map).toBe('docs/workflow-map.html');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT stamp a path the map never names', () => {
    // The other half: a stamper that fires on everything is a session sent to re-trace a
    // file the map has no node for. Same fixture, unmapped payload, no flag.
    const dir = makeFixture({ nodePath: 'src/contexts/WatchlistContext.tsx' });
    try {
      runHook(
        JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'README.md' } }),
        dir,
      );
      expect(existsSync(flagIn(dir))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 and writes nothing on empty or malformed stdin', () => {
    // Fail-open is the contract: a hook that crashes must never cost the tool call its
    // run. Empty exercises the early return, `not-json` the JSON.parse catch.
    const dir = makeFixture({ nodePath: 'src/contexts/WatchlistContext.tsx' });
    try {
      expect(() => runHook('', dir)).not.toThrow();
      expect(() => runHook('not-json', dir)).not.toThrow();
      expect(existsSync(flagIn(dir))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('stampDossier end-to-end — the half that was covered by nothing', () => {
  // Round 3's finding. Deleting the whole `stampDossier(payload, repoRoot, rel)` call out
  // of main() left 26 of 26 green, because the fixture never wrote an ownership map and
  // the stamper returned at its own existsSync guard. The pure predicates were pinned; the
  // WIRING was not — one level up from round one's exit-code tautology, on the sibling
  // stamper. These cases fail if that call goes away.
  //
  // What is at stake: this is the stamper that tells a role its dossier needs re-auditing.

  it('appends a marker for the owning role when mapped code is edited', () => {
    const dir = makeFixture({ ownedPattern: 'src/lib/firebase/', roleNum: '27' });
    try {
      runHook(
        JSON.stringify({
          tool_name: 'Edit',
          tool_input: { file_path: 'src/lib/firebase/groups.ts' },
        }),
        dir,
      );
      expect(existsSync(markerIn(dir, '27'))).toBe(true);
      // The marker's line is `<path>\t<ISO stamp>` — the path is what a role acts on.
      expect(readFileSync(markerIn(dir, '27'), 'utf8')).toContain('src/lib/firebase/groups.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stamps no marker for a path no role owns', () => {
    const dir = makeFixture({ ownedPattern: 'src/lib/firebase/', roleNum: '27' });
    try {
      runHook(
        JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'src/lib/diary.ts' } }),
        dir,
      );
      expect(existsSync(markerIn(dir, '27'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stamps no marker for a tool that does not write files', () => {
    // The tool allow-list is the first line of stampDossier. A Read or a Bash call must
    // not age a dossier.
    const dir = makeFixture({ ownedPattern: 'src/lib/firebase/', roleNum: '27' });
    try {
      runHook(
        JSON.stringify({
          tool_name: 'Read',
          tool_input: { file_path: 'src/lib/firebase/groups.ts' },
        }),
        dir,
      );
      expect(existsSync(markerIn(dir, '27'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honours the anti-self-trigger skip end-to-end, not just in the predicate', () => {
    // isDossierStampSkipped is unit-tested above; this proves it is WIRED. A pattern that
    // would otherwise match `.claude/` is deliberately chosen so only the skip can stop it.
    const dir = makeFixture({ ownedPattern: '.claude/', roleNum: '25' });
    try {
      runHook(
        JSON.stringify({
          tool_name: 'Edit',
          tool_input: { file_path: '.claude/rules/accepted-deviations.md' },
        }),
        dir,
      );
      expect(existsSync(markerIn(dir, '25'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accumulates triggers across invocations instead of overwriting', () => {
    // Round 4's finding. Every other case uses a fresh mkdtemp dir, so nothing drove the
    // hook TWICE — and mutating the flag merge to a no-op left the whole file green.
    //
    // What that would cost: a session edits file A, then file B. Without the merge, B's
    // stamp replaces A's, and CLAUDE.md's instruction — "re-trace ONLY the flows whose
    // nodes match the flag's triggers" — silently skips A's flows. That is BIN-790's
    // false-positive twin, running the other way, on the hook's own state.
    const dir = makeFixture({ nodePath: 'src/contexts/WatchlistContext.tsx,src/lib/diary.ts' });
    try {
      runHook(
        JSON.stringify({
          tool_name: 'Edit',
          tool_input: { file_path: 'src/contexts/WatchlistContext.tsx' },
        }),
        dir,
      );
      const first = JSON.parse(readFileSync(flagIn(dir), 'utf8'));

      runHook(
        JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'src/lib/diary.ts' } }),
        dir,
      );
      const second = JSON.parse(readFileSync(flagIn(dir), 'utf8'));

      // Both survive — the first is not replaced by the second.
      expect(second.triggers).toContain('src/contexts/WatchlistContext.tsx');
      expect(second.triggers).toContain('src/lib/diary.ts');
      // And the flag remembers when the work order opened, not just when it last grew.
      expect(second.firstStampedAt).toBe(first.firstStampedAt);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not duplicate a trigger stamped twice', () => {
    // `triggers` is a Set before it is written. Without that, a file edited ten times
    // appears ten times and the next session reads a work order that looks bigger than
    // it is.
    const dir = makeFixture({ nodePath: 'src/lib/diary.ts' });
    try {
      const payload = JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: 'src/lib/diary.ts' },
      });
      runHook(payload, dir);
      runHook(payload, dir);
      const flag = JSON.parse(readFileSync(flagIn(dir), 'utf8'));
      expect(flag.triggers).toEqual(['src/lib/diary.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a throw inside stampDossier does not cost stampMap its run', () => {
    // Round 5's finding, and the contract main() states in a comment:
    //   try { stampDossier(...) } catch {}
    //   try { stampMap(...) }     catch {}
    // Nothing tested it. Merging the two try blocks into one leaves the rest of this file
    // green, because no other case drives a throw.
    //
    // Not hypothetical: `ownership-map.json` is COMMITTED, GENERATED data, and a `patterns`
    // field typed as a number instead of an array throws straight out of stampDossier's
    // loop — past all three of its internal catches. If the isolation regressed at the
    // same time, one malformed ownership entry would silently take down the unrelated
    // workflow-map staleness detector too, and both failures are invisible in a diff.
    const dir = makeFixture({
      nodePath: 'src/lib/diary.ts',
      malformedRole: true,
      roleNum: '9',
    });
    try {
      runHook(
        JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'src/lib/diary.ts' } }),
        dir,
      );
      // stampDossier threw and was contained: no marker.
      expect(existsSync(markerIn(dir, '9'))).toBe(false);
      // …and stampMap still ran. THIS is the assertion the isolation contract rests on.
      expect(existsSync(flagIn(dir))).toBe(true);
      expect(JSON.parse(readFileSync(flagIn(dir), 'utf8')).triggers).toContain('src/lib/diary.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs BOTH stampers on one edit — neither shadows the other', () => {
    // main() calls them in separate try/catch blocks so one throwing cannot cost the other
    // its run. The isolation itself is pinned by the case above; this one proves both are
    // reached from a single invocation, which the fixture could not show before.
    const dir = makeFixture({
      nodePath: 'src/lib/firebase/groups.ts',
      ownedPattern: 'src/lib/firebase/',
      roleNum: '27',
    });
    try {
      runHook(
        JSON.stringify({
          tool_name: 'Edit',
          tool_input: { file_path: 'src/lib/firebase/groups.ts' },
        }),
        dir,
      );
      expect(existsSync(markerIn(dir, '27'))).toBe(true);
      expect(existsSync(flagIn(dir))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('anti-self-trigger skips', () => {
  // If any of these is lost, the loop feeds itself: editing the docs that define the
  // system stamps a marker asking someone to re-audit the docs that define the system.

  it.each([
    ['.claude/hooks/freshness.mjs', 'the hook machinery'],
    ['.claude/rules/accepted-deviations.md', 'anything under .claude/'],
    ['docs/org/route.mjs', 'the org tooling'],
    ['docs/role-responsibilities.md', 'the role doc itself'],
  ])('dossier stamping skips %s (%s)', (rel) => {
    expect(isDossierStampSkipped(rel)).toBe(true);
  });

  it('dossier stamping skips paths outside the repo, both POSIX and Windows shapes', () => {
    expect(isDossierStampSkipped('/etc/passwd')).toBe(true);
    expect(isDossierStampSkipped('C:/somewhere/else.ts')).toBe(true);
  });

  it('dossier stamping does NOT skip ordinary app code', () => {
    // The case that proves the skips are a filter and not an off switch.
    expect(isDossierStampSkipped('src/lib/seenDate.ts')).toBe(false);
    expect(isDossierStampSkipped('functions/src/index.ts')).toBe(false);
    // docs/ that is NOT docs/org/ is still ordinary content.
    expect(isDossierStampSkipped('docs/RUNBOOK.md')).toBe(false);
  });

  it('map stamping skips the map itself, the hook machinery, and an empty path', () => {
    expect(isMapStampSkipped('docs/workflow-map.html')).toBe(true);
    expect(isMapStampSkipped('.claude/state/workflow-map-stale.json')).toBe(true);
    expect(isMapStampSkipped('')).toBe(true);
    expect(isMapStampSkipped(undefined)).toBe(true);
  });

  it('map stamping does NOT skip a mapped source file', () => {
    expect(isMapStampSkipped('src/contexts/WatchlistContext.tsx')).toBe(false);
  });
});

describe('patternMatch — a false positive here is the cost this hook keeps paying', () => {
  it('matches an exact root file, and only that file', () => {
    expect(patternMatch('firestore.rules', 'firestore.rules')).toBe(true);
    expect(patternMatch('firestore.indexes.json', 'firestore.rules')).toBe(false);
  });

  it('treats a trailing slash as a directory prefix', () => {
    expect(patternMatch('src/lib/firebase/groups.ts', 'src/lib/firebase/')).toBe(true);
    expect(patternMatch('src/lib/tmdb/client.ts', 'src/lib/firebase/')).toBe(false);
  });

  it('matches a bare path exactly or as a directory of that name', () => {
    expect(patternMatch('src/lib/diary.ts', 'src/lib/diary.ts')).toBe(true);
    expect(patternMatch('src/lib/taste/stats.ts', 'src/lib/taste')).toBe(true);
    // …but not a sibling whose name merely starts with the same characters. This is the
    // boundary a naive `startsWith` gets wrong, and it is how an unrelated file would get
    // stamped as a trigger.
    expect(patternMatch('src/lib/tasteful.ts', 'src/lib/taste')).toBe(false);
  });

  it('confines a glob star to one path segment', () => {
    expect(patternMatch('src/components/watchlistpage.tsx', 'src/components/*.tsx')).toBe(true);
    // A star must not cross a slash — otherwise one pattern claims a whole subtree and
    // every edit under it stamps.
    expect(patternMatch('src/components/watchlist/card.tsx', 'src/components/*.tsx')).toBe(false);
  });

  it('is case-insensitive on the pattern side, as its Test-PatternMatch port was', () => {
    expect(patternMatch('src/lib/diary.ts', 'SRC/LIB/DIARY.TS')).toBe(true);
  });
});

describe('matchesToken — the two branches the child-process fixture cannot reach', () => {
  // The fixture always names the edited file exactly, so it only ever exercises the
  // `rel === tok` branch. Measured by the test reviewer and re-derived here: deleting
  // either branch below left the whole targeted suite green.
  //
  // Both branches are LIVE. Parsed from docs/workflow-map.html's node data: of 103 path
  // tokens, exactly one is a glob (`functions/src/streamingOffers/*`) and exactly one is
  // a directory (`src/app`). Lose either branch and edits under those two stop being
  // flagged as workflow-map-stale — the false-negative class this hook exists to catch,
  // and invisible, because the flag lives under gitignored `.claude/state/`.
  //
  // Derive the token classes rather than trusting those counts; the map grows:
  //   node -e "const h=require('fs').readFileSync('docs/workflow-map.html','utf8');…"

  it('matches a token naming a directory the edited file lives in', () => {
    expect(matchesToken('src/app/stats/page.tsx', 'src/app')).toBe(true);
  });

  it('does not let a directory token claim a sibling with the same prefix', () => {
    // `src/apple.ts` starts with `src/app` as a string. Without the `/` this branch
    // appends, one token would claim files it does not name.
    expect(matchesToken('src/apple.ts', 'src/app')).toBe(false);
  });

  it('matches a glob token within its own directory', () => {
    expect(
      matchesToken('functions/src/streamingOffers/index.ts', 'functions/src/streamingOffers/*'),
    ).toBe(true);
  });

  it('does not let a glob token cross a directory boundary', () => {
    expect(
      matchesToken('functions/src/leavingRollup/index.ts', 'functions/src/streamingOffers/*'),
    ).toBe(false);
    // …nor reach into a subdirectory of its own: the star is one segment.
    expect(
      matchesToken('functions/src/streamingOffers/motn/changes.ts', 'functions/src/streamingOffers/*'),
    ).toBe(false);
  });

  it('a token with a file extension is exact, not a prefix', () => {
    // The `!/\.[a-z]+$/i` test is what stops `src/lib/diary.ts` behaving as a directory.
    expect(matchesToken('src/lib/diary.ts', 'src/lib/diary.ts')).toBe(true);
    expect(matchesToken('src/lib/diary.ts/nested.ts', 'src/lib/diary.ts')).toBe(false);
  });
});

describe('globToRegExp', () => {
  it('anchors at both ends', () => {
    const re = globToRegExp('src/*.ts');
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('x/src/a.ts')).toBe(false);
    expect(re.test('src/a.ts.bak')).toBe(false);
  });

  it('escapes regex metacharacters so a dot is a dot', () => {
    const re = globToRegExp('next.config.mjs');
    expect(re.test('next.config.mjs')).toBe(true);
    expect(re.test('nextxconfigxmjs')).toBe(false);
  });
});

describe('toRepoRelative', () => {
  it('strips the repo root and normalises separators', () => {
    expect(toRepoRelative('C:\\binge\\src\\lib\\diary.ts', 'C:\\binge')).toBe('src/lib/diary.ts');
    expect(toRepoRelative('/home/x/binge/src/lib/diary.ts', '/home/x/binge')).toBe('src/lib/diary.ts');
  });

  it('is case-insensitive about the root, which Windows requires', () => {
    expect(toRepoRelative('c:/BINGE/src/a.ts', 'C:/binge')).toBe('src/a.ts');
  });

  it('leaves a path that is already relative alone, minus a ./ prefix', () => {
    expect(toRepoRelative('./src/a.ts', 'C:/binge')).toBe('src/a.ts');
    expect(toRepoRelative('src/a.ts', 'C:/binge')).toBe('src/a.ts');
  });
});
