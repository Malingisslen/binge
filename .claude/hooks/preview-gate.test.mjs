import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decide, norm, routeMatch, slugFor, markerPath } from './preview-gate.mjs';

// BIN-1036 — the gate that decides whether a NEW screen may be created before Malin has
// seen design directions for it. It had no tests at all.
//
// Both of its failure modes are silent. A false NEGATIVE builds a screen she never got to
// react to; a false POSITIVE blocks an edit to a screen that already exists, or a file
// that is not a route. The path handling is where either would come from: it normalises
// Windows drive letters across three spellings, strips route groups and dynamic segments
// out of the marker name, and tests two different files for existence.
//
// The marker lives under the REAL `~/.claude/state/`, which the founder's own `/preview`
// runs write into. So nothing here creates, touches or deletes a marker: the pure
// `decide()` answers both existence questions through an injected probe, and the
// subprocess row below drives only the branch where no marker exists.

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const HOME = 'C:/Users/tester';
const CWD = 'C:/binge';

/** `decide` with a world where nothing exists unless named. */
const run = (filePath, { existing = [], skip = false, home = HOME, cwd = CWD } = {}) =>
  decide(
    { tool_input: { file_path: filePath } },
    { cwd, home, skip, exists: (p) => existing.includes(p) },
  );

describe('preview-gate: path normalisation', () => {
  it('makes the three spellings of a Windows path equal', () => {
    // A gate that fires from one shell and not another is worse than no gate: it reads as
    // "checked" on the run where it silently did nothing.
    expect(norm('/c/binge/src/app/x/page.tsx')).toBe('C:/binge/src/app/x/page.tsx');
    expect(norm('c:\\binge\\src\\app\\x\\page.tsx')).toBe('C:/binge/src/app/x/page.tsx');
    expect(norm('C:/binge/src/app/x/page.tsx')).toBe('C:/binge/src/app/x/page.tsx');
  });

  it('leaves a posix path alone and survives an empty input', () => {
    expect(norm('/home/me/app/src/app/x/page.tsx')).toBe('/home/me/app/src/app/x/page.tsx');
    expect(norm(undefined)).toBe('');
  });
});

describe('preview-gate: what counts as a route screen', () => {
  it('matches the three screen files under src/app', () => {
    for (const file of ['page', 'layout', 'template']) {
      expect(routeMatch(`src/app/grupper/${file}.tsx`), file).not.toBeNull();
    }
  });

  it('does not match a component, a non-tsx file, or src/app itself', () => {
    expect(routeMatch('src/components/layout/AppShell.tsx')).toBeNull();
    expect(routeMatch('src/app/grupper/page.ts')).toBeNull();
    expect(routeMatch('src/app/page.tsx')).toBeNull(); // the root screen has no segment
    expect(routeMatch('docs/page.tsx')).toBeNull();
  });
});

describe('preview-gate: the marker slug', () => {
  it('joins segments with dashes', () => {
    expect(slugFor('grupper/ny')).toBe('grupper-ny');
  });

  it('drops route groups and unwraps dynamic segments', () => {
    // `(marketing)` and `[slug]` describe ROUTING. Malin looked at a screen, and the
    // marker names what she looked at.
    expect(slugFor('(marketing)/kampanj')).toBe('kampanj');
    expect(slugFor('titel/[id]')).toBe('titel-id');
    expect(slugFor('blogg/[...slug]')).toBe('blogg-slug');
  });

  it('falls back to "root" when nothing is left', () => {
    expect(slugFor('(marketing)')).toBe('root');
  });

  it('puts the marker under .claude/state with the slug in its name', () => {
    expect(norm(markerPath('grupper-ny', HOME)))
      .toBe('C:/Users/tester/.claude/state/preview-done-grupper-ny.marker');
  });
});

describe('preview-gate: the decision', () => {
  const NEW_SCREEN = 'C:/binge/src/app/grupper/ny/page.tsx';

  it('BLOCKS a new route screen with no marker', () => {
    // The row every other row in this file depends on. Without it the pass-through cases
    // below are all green on a gate that never stops anyone.
    const reason = run(NEW_SCREEN);
    expect(reason).toContain('PREVIEW GATE');
    expect(reason).toContain('src/app/grupper/ny/page.tsx');
    // It names the exact marker to stamp — the remedy is the reason the block is useful.
    expect(reason).toContain('preview-done-grupper-ny.marker');
  });

  it('lets a screen through once its marker exists', () => {
    expect(run(NEW_SCREEN, { existing: [markerPath('grupper-ny', HOME)] })).toBeNull();
  });

  it('lets an EXISTING screen through — editing is not creating', () => {
    expect(run(NEW_SCREEN, { existing: [NEW_SCREEN] })).toBeNull();
  });

  it('lets a non-route file through', () => {
    expect(run('C:/binge/src/components/layout/AppShell.tsx')).toBeNull();
  });

  it('lets everything through under SKIP_PREVIEW_GATE', () => {
    expect(run(NEW_SCREEN, { skip: true })).toBeNull();
  });

  it('lets a payload with no file path through', () => {
    expect(decide({}, { cwd: CWD, home: HOME, skip: false, exists: () => false })).toBeNull();
  });

  it('still blocks when the write is spelled with a posix drive path', () => {
    // Same file, other shell. This is the case the normalisation exists for, driven
    // through the whole decision rather than through `norm` alone.
    expect(run('/c/binge/src/app/grupper/ny/page.tsx')).toContain('PREVIEW GATE');
  });
});

describe('preview-gate: the real invocation path', () => {
  // `.claude/settings.json` runs the hook as a subprocess with stdin. Testing only the
  // exported function would leave the entry-point guard, the stdin read and the JSON on
  // stdout unproven — and a refactor that broke any of the three would disarm the gate
  // while every row above stayed green.
  const invoke = (input, env = {}) =>
    execFileSync('bash', ['-c', `cd "${REPO_ROOT}"; exec node .claude/hooks/preview-gate.mjs`], {
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });

  // A slug no real screen can claim, so this can never collide with a marker a genuine
  // /preview run left behind. Asserted absent rather than assumed: if it somehow existed,
  // the block assertion below would fail for the wrong reason.
  const SLUG = 'bin1036-fixture-not-a-real-screen';
  const TARGET = `${REPO_ROOT.replace(/\\/g, '/')}/src/app/${SLUG}/page.tsx`;

  it('blocks a new screen, over stdin, and prints the block JSON', () => {
    expect(existsSync(TARGET), 'the fixture route must not exist').toBe(false);
    expect(
      existsSync(join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'state', `preview-done-${SLUG}.marker`)),
      'the fixture marker must not exist',
    ).toBe(false);

    const out = invoke(JSON.stringify({ tool_name: 'Write', tool_input: { file_path: TARGET } }));

    const parsed = JSON.parse(out);
    expect(parsed.decision).toBe('block');
    expect(parsed.reason).toContain('PREVIEW GATE');
  });

  it('says nothing at all for a file that is not a route screen', () => {
    // Silence is how this hook approves. Anything on stdout that is not the block JSON
    // would be read by the harness as a decision.
    const out = invoke(
      JSON.stringify({ tool_name: 'Write', tool_input: { file_path: `${REPO_ROOT.replace(/\\/g, '/')}/src/lib/nytt.ts` } }),
    );
    expect(out).toBe('');
  });

  it('says nothing under SKIP_PREVIEW_GATE, for the very payload it blocks without it', () => {
    const out = invoke(
      JSON.stringify({ tool_name: 'Write', tool_input: { file_path: TARGET } }),
      { SKIP_PREVIEW_GATE: '1' },
    );
    expect(out).toBe('');
  });

  it('fails OPEN on unparseable stdin rather than bricking file creation', () => {
    expect(invoke('not json at all')).toBe('');
    expect(invoke('')).toBe('');
  });
});
