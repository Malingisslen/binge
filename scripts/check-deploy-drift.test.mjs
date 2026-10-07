// Self-test for the deploy workflow's rules/functions check, its report mode and the
// backend gate (BIN-1426).
//
// Run: npm test
//
// Both directions are pinned against a REAL git repository built in a temp dir:
// a comment-only push must go green, and a real rules or functions change must
// stay red. The fail-closed cases are pinned just as hard — "could not compare"
// must never share an exit code with "nothing changed".

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  normalizeRules,
  transpileForComparison,
  globToRegExp,
  deployedPathsIn,
  deployCommand,
  deployArgs,
  githubOutput,
  gateTarget,
  gateOutput,
  gateSummary,
  mainTip,
  siteGateProblem,
  lastDeployed,
  deployRecords,
  newerDeployedRun,
  deployedRunsPath,
  deployedArtifactsPath,
  orderWarnings,
  EXCEPT_HOSTING,
  RECORD_FILE,
  RECORD_PREFIX,
  RUN_OPTIONS,
  TARGET_NOTE,
  main,
} from './check-deploy-drift.mjs';

const OPTIONS = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };

// BIN-1371: the tests against a real git repository spawn git repeatedly, and more than
// one of them has measured past the 5 000 ms default on Windows. Their own clock, not a
// global one.
const REAL_GIT_TIMEOUT_MS = 30_000;

describe('normalizeRules', () => {
  test('a line comment and a block comment do not count', () => {
    const a = "allow read: if isSignedIn()\n  && x == 'a';\n";
    const b = "// why\nallow read: if isSignedIn() /* note */\n  // more\n  && x == 'a';\n";
    expect(normalizeRules(b)).toBe(normalizeRules(a));
  });

  test('a changed condition counts', () => {
    expect(normalizeRules("allow read: if x == 'a';")).not.toBe(normalizeRules("allow read: if x == 'b';"));
  });

  test('a // inside a string is part of the string, not a comment', () => {
    const a = "allow read: if u == 'https://a';";
    const b = "allow read: if u == 'https://b';";
    expect(normalizeRules(a)).not.toBe(normalizeRules(b));
  });

  test('an escaped quote does not end the string, so what follows it still counts', () => {
    const a = "allow read: if x == 'a\\'//b' && y == 1;";
    const b = "allow read: if x == 'a\\'//b' && y == 2;";
    expect(normalizeRules(a)).not.toBe(normalizeRules(b));
    const c = 'allow read: if x == "a\\"//b" && y == 1;';
    const d = 'allow read: if x == "a\\"//b" && y == 2;';
    expect(normalizeRules(c)).not.toBe(normalizeRules(d));
  });

  test('a block comment still separates the tokens on either side of it', () => {
    expect(normalizeRules('if a/**/b')).not.toBe(normalizeRules('if ab'));
  });

  test('a raw or triple-quoted string is refused, not guessed at', () => {
    expect(() => normalizeRules("x.matches(r'a\\'//b')")).toThrow(/raw string/);
    expect(() => normalizeRules("x == '''a'''")).toThrow(/triple-quoted/);
    expect(() => normalizeRules('x == """a"""')).toThrow(/triple-quoted/);
  });

  test('an identifier ending in r before a string is not read as a raw prefix', () => {
    expect(() => normalizeRules("f(bar'x')")).not.toThrow();
  });

  test('whitespace inside a string is kept', () => {
    expect(normalizeRules("x == 'a  b'")).not.toBe(normalizeRules("x == 'a b'"));
  });

  test('an unterminated block comment throws', () => {
    expect(() => normalizeRules('allow read: /* never closed')).toThrow(/unterminated/);
  });

  test('an unterminated string throws', () => {
    expect(() => normalizeRules("allow read: if x == 'open;\n")).toThrow(/unterminated/);
  });
});

describe('transpileForComparison', () => {
  test('a comment-only edit gives identical output', () => {
    const a = 'export function f(x: number) {\n  return x + 1;\n}\n';
    const b = '/** doc */\nexport function f(x: number) {\n  // why\n  return x + 1; /* tail */\n}\n';
    expect(transpileForComparison(b, 'f.ts', OPTIONS)).toBe(transpileForComparison(a, 'f.ts', OPTIONS));
  });

  test('a changed expression gives different output', () => {
    const a = 'export const n = 1;\n';
    const b = 'export const n = 2;\n';
    expect(transpileForComparison(a, 'f.ts', OPTIONS)).not.toBe(transpileForComparison(b, 'f.ts', OPTIONS));
  });

  test('a changed template literal gives different output', () => {
    const a = 'export const s = `a\n\nb`;\n';
    const b = 'export const s = `a\nb`;\n';
    expect(transpileForComparison(a, 'f.ts', OPTIONS)).not.toBe(transpileForComparison(b, 'f.ts', OPTIONS));
  });

  test('a syntax error throws', () => {
    expect(() => transpileForComparison('export const = ;', 'f.ts', OPTIONS)).toThrow(/does not parse/);
  });

  test('a const enum is refused', () => {
    expect(() => transpileForComparison('export const enum E { A }', 'f.ts', OPTIONS)).toThrow(/const enum/);
  });
});

describe('globToRegExp', () => {
  test("the build's exclude patterns match test files at any depth and nothing else", () => {
    const re = globToRegExp('src/**/*.test.ts');
    expect(re.test('src/a.test.ts')).toBe(true);
    expect(re.test('src/x/y/a.test.ts')).toBe(true);
    expect(re.test('src/x/a.ts')).toBe(false);
    expect(re.test('src/x/a.test.tsx')).toBe(false);
  });
});

describe('main against a real git repository', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  let dir;
  let base;
  const git = (args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const commit = (message) => {
    git(['add', '-A']);
    git(['commit', '-q', '-m', message]);
    return git(['rev-parse', 'HEAD']).trim();
  };
  const run = (before, after) => {
    const out = [];
    const code = main([before, after], { git, log: (l) => out.push(l), err: (l) => out.push(l) });
    return { code, out: out.join('\n') };
  };
  // Each case branches from `base`, so one case's edit never leaks into the next.
  const onBase = () => git(['checkout', '-q', '--detach', base]);

  const RULES = "rules_version = '2';\nservice cloud.firestore {\n  // who may read\n  match /a/{id} {\n    allow read: if request.auth != null;\n  }\n}\n";
  const SRC = "// sends the push\nexport function send(n: number): number {\n  return n * 2;\n}\n";
  const TEST = "import { send } from './send';\ntest('x', () => expect(send(1)).toBe(2));\n";

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deploy-drift-'));
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'test']);
    git(['config', 'core.autocrlf', 'false']);
    write('firestore.rules', RULES);
    write('functions/src/send.ts', SRC);
    write('functions/src/send.test.ts', TEST);
    write('functions/package.json', '{"name":"f"}\n');
    write(
      'functions/tsconfig.json',
      JSON.stringify({
        '//': 'a comment key, as the real functions/tsconfig.json carries',
        compilerOptions: { module: 'commonjs', target: 'es2022', outDir: 'lib' },
        include: ['src'],
        exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
      }),
    );
    write('README.md', 'x\n');
    base = commit('base');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('comment-only edits to the rules and a function, plus a test file, go green', () => {
    onBase();
    write('firestore.rules', RULES.replace('// who may read', '// who may read — signed-in users only\n  /* BIN-1 */'));
    write('functions/src/send.ts', SRC.replace('// sends the push', '/**\n * Sends the push.\n */'));
    write('functions/src/send.test.ts', TEST + "test('y', () => expect(send(2)).toBe(4));\n");
    const head = commit('comments');
    const { code, out } = run(base, head);
    expect(code).toBe(0);
    expect(out).toContain('no deployed change: firestore.rules');
    expect(out).toContain('no deployed change: functions/src/send.ts');
  });

  test('an excluded test file that a built file imports is compared like source', () => {
    onBase();
    write('functions/src/fixtures.test.ts', 'export const N = 1;\n');
    write('functions/src/uses.ts', "import { N } from './fixtures.test';\nexport const M = N;\n");
    const withImport = commit('import a test file');
    write('functions/src/fixtures.test.ts', 'export const N = 2;\n');
    const { code, out } = run(withImport, commit('change it'));
    expect(code).toBe(1);
    expect(out).toContain('functions/src/fixtures.test.ts  (compiled code changed)');
  });

  test('an excluded file reached through ANOTHER excluded file is still compared', () => {
    onBase();
    write('functions/src/b.test.ts', 'export const B = 1;\n');
    write('functions/src/a.test.ts', "export { B } from './b.test';\n");
    write('functions/src/root.ts', "import { B } from './a.test';\nexport const R = B;\n");
    const chained = commit('chain');
    write('functions/src/b.test.ts', 'export const B = 2;\n');
    const { code, out } = run(chained, commit('change the end of the chain'));
    expect(code).toBe(1);
    expect(out).toContain('functions/src/b.test.ts  (compiled code changed)');
  });

  test('a triple-slash reference to an excluded file sends it to the comparison', () => {
    onBase();
    write('functions/src/ref.spec.ts', 'export const S = 1;\n');
    write('functions/src/refs.ts', '/// <reference path="./ref.spec.ts" />\nexport const T = 1;\n');
    const referenced = commit('reference');
    write('functions/src/ref.spec.ts', 'export const S = 2;\n');
    expect(run(referenced, commit('change referenced')).code).toBe(1);
  });

  test.each([
    ['a backtick dynamic import', 'export const y = () => import(`./dyn.test`);\n'],
    ['an import with a .js suffix', "export { N } from './dyn.test.js';\n"],
    ['a require call', "export const y = require('./dyn.test');\n"],
    ['an import() wrapped over lines', 'export const y = () =>\n  import(\n    `./dyn.test`\n  );\n'],
    ['an import () with a space', 'export const y = () => import (`./dyn.test`);\n'],
    ['an import() with a comment inside', 'export const y = () => import(/* lazy */ `./dyn.test`);\n'],
    ['an import from a parent directory', "export { N } from '../src/dyn.test';\n"],
    [
      'an import after a regex holding a backtick',
      "export const esc = (s: string) => s.replace(/`/g, '');\nexport const y = () => import('./dyn.test');\n",
    ],
    ['an importer that is a .mts file', "export { N } from './dyn.test.js';\n", 'functions/src/dyn.mts'],
  ])('an excluded file reached by %s is compared like source', (_label, importer, importerPath = 'functions/src/dyn.ts') => {
    onBase();
    write('functions/src/dyn.test.ts', 'export const N = 1;\n');
    write(importerPath, importer);
    const withImport = commit('import it');
    write('functions/src/dyn.test.ts', 'export const N = 2;\n');
    const { code, out } = run(withImport, commit('change it'));
    expect(code).toBe(1);
    expect(out).toContain('functions/src/dyn.test.ts  (compiled code changed)');
  });

  test('a functions tsconfig that extends another fails closed', () => {
    onBase();
    write('functions/tsconfig.base.json', '{}\n');
    write(
      'functions/tsconfig.json',
      JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: {}, exclude: ['src/**/*.test.ts'] }),
    );
    const extended = commit('extends');
    write('functions/src/send.ts', SRC.replace('// sends the push', '// sends it'));
    const { code, out } = run(extended, commit('comment'));
    expect(code).toBe(1);
    expect(out).toContain('uses extends');
  });

  test.each([
    ['baseUrl', { compilerOptions: { baseUrl: '.' } }],
    ['paths', { compilerOptions: { paths: {} } }],
    ['rootDirs', { compilerOptions: { rootDirs: [] } }],
    ['allowJs', { compilerOptions: { allowJs: true } }],
    ['emitDecoratorMetadata', { compilerOptions: { emitDecoratorMetadata: true } }],
    ['files', { compilerOptions: {}, files: ['src/send.test.ts'] }],
    ['references', { compilerOptions: {}, references: [] }],
    // Not on any list of known-bad keys: the allowlist refuses whatever it has not judged.
    ['preserveConstEnums', { compilerOptions: { preserveConstEnums: true }, include: ['src'] }],
    // An allowed key with a different value is refused too.
    ['module', { compilerOptions: { module: 'node16' }, include: ['src'] }],
    ['compileOnSave', { compilerOptions: {}, include: ['src'], compileOnSave: true }],
    ['include', { compilerOptions: {}, include: ['src', 'extra'] }],
    ['include', { compilerOptions: {} }],
  ])('a functions tsconfig that sets %s fails closed', (key, config) => {
    onBase();
    write('functions/tsconfig.json', JSON.stringify({ ...config, exclude: ['src/**/*.test.ts'] }));
    const configured = commit(`set ${key}`);
    write('functions/src/send.ts', SRC.replace('// sends the push', '// sends it'));
    const { code, out } = run(configured, commit('comment'));
    expect(code).toBe(1);
    expect(out).toContain(`sets ${key}`);
    // A refusal tells the operator what to do, as a real change does. It cannot know
    // which files changed, so the command covers every manually deployed target.
    expect(out).toContain('Deploy manually:  firebase deploy --except hosting');
  });

  test('a failed import search fails closed rather than reading as "not imported"', () => {
    onBase();
    write('functions/src/send.test.ts', TEST + '// more\n');
    const head = commit('touch the test');
    const failingGrep = (args) => {
      if (args[0] === 'ls-tree') throw Object.assign(new Error('ls-tree broke'), { status: 128 });
      return git(args);
    };
    const out = [];
    const code = main([base, head], { git: failingGrep, log: (l) => out.push(l), err: (l) => out.push(l) });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('Could not compare');
  });

  test('a built file that only NAMES a test file in a comment does not make it built', () => {
    onBase();
    write('functions/src/send.ts', SRC.replace('// sends the push', '// sends the push; pinned in send.test.ts and `./send.test.ts`'));
    const named = commit('name the test in a comment');
    write('functions/src/send.test.ts', TEST + '// more\n');
    expect(run(named, commit('touch the test')).code).toBe(0);
  });

  test('a declaration file is not compared', () => {
    onBase();
    write('functions/src/types.d.ts', 'declare const X: number;\n');
    const withDecl = commit('add d.ts');
    write('functions/src/types.d.ts', '// note\ndeclare const X: number;\n');
    const { code, out } = run(withDecl, commit('comment d.ts'));
    expect(code).toBe(1);
    expect(out).toContain('functions/src/types.d.ts  (not a file this check can compare)');
  });

  test('a push that touches neither path goes green', () => {
    onBase();
    write('README.md', 'y\n');
    expect(run(base, commit('readme')).code).toBe(0);
  });

  test('a real rules change stays red', () => {
    onBase();
    write('firestore.rules', RULES.replace('request.auth != null', 'true'));
    const { code, out } = run(base, commit('open rules'));
    expect(code).toBe(1);
    expect(out).toContain('firestore.rules  (rules content changed)');
    expect(out).toContain('Deploy manually:  firebase deploy --only firestore:rules\n');
  });

  test('a real function change stays red, even when the same push also edits a comment', () => {
    onBase();
    write('functions/src/send.ts', SRC.replace('n * 2', 'n * 3').replace('sends', 'sends (tripled)'));
    const { code, out } = run(base, commit('triple'));
    expect(code).toBe(1);
    expect(out).toContain('functions/src/send.ts  (compiled code changed)');
    // No firebase.json in this repository, so the target comes from the floor path.
    expect(out).toContain('Deploy manually:  firebase deploy --only functions\n');
  });

  test('a type-only edit in a function file is not a deployed change', () => {
    onBase();
    write('functions/src/send.ts', SRC.replace('(n: number): number', '(n: number): number | never'));
    expect(run(base, commit('types')).code).toBe(0);
  });

  test('a declare that adds an exported value stays red, though this file emits the same', () => {
    onBase();
    write('functions/src/foo.ts', 'export interface Foo { x: number }\n');
    write('functions/src/reexport.ts', "export { Foo } from './foo';\n");
    const withType = commit('type only');
    write('functions/src/foo.ts', 'export interface Foo { x: number }\nexport declare const Foo: Foo;\n');
    const { code, out } = run(withType, commit('declare a value'));
    expect(code).toBe(1);
    expect(out).toContain('functions/src/foo.ts  (exported names changed)');
  });

  test.each([
    ['a type', 'export type Foo = number;\n', 'export declare const Foo: number;\n'],
    ['an interface', 'export interface Foo { x: number }\n', 'export declare class Foo { x: number }\n'],
  ])('%s becoming a declared value under the same name stays red', (_label, from, to) => {
    onBase();
    write('functions/src/foo.ts', from);
    write('functions/src/reexport.ts', "export { Foo } from './foo';\n");
    const withType = commit('type');
    write('functions/src/foo.ts', to);
    const { code, out } = run(withType, commit('value'));
    expect(code).toBe(1);
    expect(out).toContain('functions/src/foo.ts  (exported names changed)');
  });

  test('a declared namespace that goes from types to values stays red', () => {
    onBase();
    write('functions/src/ns.ts', 'export declare namespace Foo { type T = number; }\n');
    write('functions/src/reexport.ts', "export { Foo } from './ns';\n");
    const typesOnly = commit('types-only namespace');
    write('functions/src/ns.ts', 'export declare namespace Foo { const x: number; }\n');
    const { code, out } = run(typesOnly, commit('namespace with a value'));
    expect(code).toBe(1);
    expect(out).toContain('functions/src/ns.ts  (exported names changed)');
  });

  test('a comment inside a declared namespace is not a deployed change', () => {
    onBase();
    write('functions/src/ns.ts', 'export declare namespace Foo { type T = number; }\n');
    const plain = commit('namespace');
    write('functions/src/ns.ts', 'export declare namespace Foo {\n  // the unit\n  type T = number;\n}\n');
    const { code, out } = run(plain, commit('comment in namespace'));
    expect(code).toBe(0);
    expect(out).toContain('no deployed change: functions/src/ns.ts');
  });

  test('a built function file importing from outside functions/ fails closed on every push', () => {
    onBase();
    write('src/lib/shared.ts', 'export const K = 1;\n');
    write('functions/src/uses-root.ts', "import { K } from '../../src/lib/shared';\nexport const M = K;\n");
    const withImport = commit('import from the root tree');
    write('src/lib/shared.ts', 'export const K = 2;\n');
    const { code, out } = run(withImport, commit('change only the root file'));
    expect(code).toBe(1);
    expect(out).toContain('functions/src/uses-root.ts points at src/lib/shared, outside functions/');
  });

  test('an excluded test file that nothing imports may point outside functions/', () => {
    onBase();
    write('src/lib/shared.ts', 'export const K = 1;\n');
    write('functions/src/root.test.ts', "import { K } from '../../src/lib/shared';\ntest('k', () => expect(K).toBe(1));\n");
    const withImport = commit('test imports from the root tree');
    write('src/lib/shared.ts', 'export const K = 2;\n');
    expect(run(withImport, commit('change only the root file')).code).toBe(0);
  });

  test('an excluded file that a built file imports may not point outside functions/', () => {
    onBase();
    write('src/lib/shared.ts', 'export const K = 1;\n');
    write('functions/src/bridge.test.ts', "export { K } from '../../src/lib/shared';\n");
    write('functions/src/uses-bridge.ts', "import { K } from './bridge.test';\nexport const M = K;\n");
    const withImport = commit('built file reaches the root tree through a test file');
    write('README.md', 'z\n');
    const { code, out } = run(withImport, commit('unrelated'));
    expect(code).toBe(1);
    expect(out).toContain('functions/src/bridge.test.ts points at src/lib/shared, outside functions/');
  });

  describe('firebase.json', () => {
    const FIREBASE = {
      hosting: { public: 'out' },
      firestore: { rules: 'firestore.rules' },
      functions: [{ source: 'functions', runtime: 'nodejs22' }],
      emulators: { firestore: { port: 8080 } },
    };
    const DRIFT = 'firebase.json  (a firebase.json key other than hosting or emulators changed)';
    const withFirebaseJson = () => {
      onBase();
      write('firebase.json', JSON.stringify(FIREBASE, null, 2));
      return commit('firebase.json');
    };

    test('a hosting-only change is not a deployed change', () => {
      const before = withFirebaseJson();
      write('firebase.json', JSON.stringify({ ...FIREBASE, hosting: { public: 'dist' } }, null, 2));
      const { code, out } = run(before, commit('hosting'));
      expect(code).toBe(0);
      expect(out).toContain('no deployed change: firebase.json');
    });

    test.each([
      ['functions', { functions: [{ source: 'functions', runtime: 'nodejs20' }] }],
      ['firestore', { firestore: { rules: 'other.rules' } }],
    ])('a change to the %s block stays red', (_key, patch) => {
      const before = withFirebaseJson();
      write('firebase.json', JSON.stringify({ ...FIREBASE, ...patch }, null, 2));
      const { code, out } = run(before, commit('deployed block'));
      expect(code).toBe(1);
      expect(out).toContain(DRIFT);
    });

    test('an emulator-only change is not a deployed change', () => {
      const before = withFirebaseJson();
      write('firebase.json', JSON.stringify({ ...FIREBASE, emulators: { firestore: { port: 8081 } } }, null, 2));
      const { code, out } = run(before, commit('emulators'));
      expect(code).toBe(0);
      expect(out).toContain('no deployed change: firebase.json');
    });

    test('an added storage block stays red', () => {
      const before = withFirebaseJson();
      write('firebase.json', JSON.stringify({ ...FIREBASE, storage: { rules: 'storage.rules' } }, null, 2));
      const { code, out } = run(before, commit('storage'));
      expect(code).toBe(1);
      expect(out).toContain(DRIFT);
    });

    test('a change to a key this check has never seen stays red', () => {
      const before = withFirebaseJson();
      write('firebase.json', JSON.stringify({ ...FIREBASE, somethingNew: { a: 1 } }, null, 2));
      const unknownAdded = commit('unknown key');
      write('firebase.json', JSON.stringify({ ...FIREBASE, somethingNew: { a: 2 } }, null, 2));
      const { code, out } = run(unknownAdded, commit('unknown key changed'));
      expect(code).toBe(1);
      expect(out).toContain(DRIFT);
      expect(run(before, unknownAdded).code).toBe(1);
    });

    test('a firebase.json that is not an object fails closed', () => {
      const before = withFirebaseJson();
      write('firebase.json', 'null');
      const { code, out } = run(before, commit('null firebase.json'));
      expect(code).toBe(1);
      expect(out).toContain('Could not compare');
      expect(out).toContain('firebase.json is not a JSON object');
    });

    test('a new firebase.json stays red', () => {
      onBase();
      write('firebase.json', JSON.stringify(FIREBASE));
      const { code, out } = run(base, commit('add firebase.json'));
      expect(code).toBe(1);
      expect(out).toContain('firebase.json  (added)');
    });

    test('a firebase.json that no longer parses fails closed', () => {
      const before = withFirebaseJson();
      write('firebase.json', '{ "hosting": ');
      const { code, out } = run(before, commit('broken firebase.json'));
      expect(code).toBe(1);
      expect(out).toContain('Could not compare');
    });

    // BIN-1346: the watched paths come from what firebase.json names, so a file
    // outside the floor is diffed the moment a deployed block points at it.
    const withStorage = () => {
      onBase();
      write('firebase.json', JSON.stringify({ ...FIREBASE, storage: { rules: 'storage.rules' } }, null, 2));
      write('storage.rules', "rules_version = '2';\n");
      return commit('storage block and its rules');
    };

    test('a change to a rules file firebase.json names outside the floor stays red', () => {
      const before = withStorage();
      write('storage.rules', "rules_version = '2';\nservice firebase.storage {}\n");
      const { code, out } = run(before, commit('storage rules'));
      expect(code).toBe(1);
      expect(out).toContain('storage.rules  (not a file this check can compare)');
    });

    // BIN-1353: the deploy hint names the target that ships the changed file.
    test('a changed storage rules file is told to deploy storage', () => {
      const before = withStorage();
      write('storage.rules', "rules_version = '2';\nservice firebase.storage {}\n");
      const { code, out } = run(before, commit('storage rules'));
      expect(code).toBe(1);
      expect(out).toContain('Deploy manually:  firebase deploy --only storage\n');
    });

    test('a push touching rules and a function is told to deploy both targets', () => {
      const before = withFirebaseJson();
      write('firestore.rules', RULES.replace('request.auth != null', 'true'));
      write('functions/src/send.ts', SRC.replace('n * 2', 'n * 3'));
      const { code, out } = run(before, commit('rules and function'));
      expect(code).toBe(1);
      expect(out).toContain('Deploy manually:  firebase deploy --only firestore:rules,functions\n');
    });

    test('a changed firebase.json is told to deploy every target but hosting', () => {
      const before = withFirebaseJson();
      write('firebase.json', JSON.stringify({ ...FIREBASE, storage: { rules: 'storage.rules' } }, null, 2));
      const { code, out } = run(before, commit('storage block'));
      expect(code).toBe(1);
      expect(out).toContain('Deploy manually:  firebase deploy --except hosting');
    });

    test('the same file goes unwatched while no firebase.json names it', () => {
      onBase();
      write('storage.rules', "rules_version = '2';\n");
      const before = commit('an unnamed rules file');
      write('storage.rules', "rules_version = '2';\nservice firebase.storage {}\n");
      expect(run(before, commit('edit it')).code).toBe(0);
    });

    test('a push that repoints a rules path is diffed at the new place', () => {
      const before = withFirebaseJson();
      write('rules/main.rules', 'x\n');
      write('firebase.json', JSON.stringify({ ...FIREBASE, firestore: { rules: 'rules/main.rules' } }, null, 2));
      const { code, out } = run(before, commit('move rules'));
      expect(code).toBe(1);
      expect(out).toContain('rules/main.rules  (added)');
    });

    // The firebase.json change alone is red here, so only the storage.rules line
    // shows that the path the OLD firebase.json named was still diffed.
    test('a push that drops a rules path from firebase.json is still diffed at the old place', () => {
      const before = withStorage();
      write('firebase.json', JSON.stringify(FIREBASE, null, 2));
      write('storage.rules', "rules_version = '2';\nservice firebase.storage {}\n");
      const { code, out } = run(before, commit('drop storage block and edit its rules'));
      expect(code).toBe(1);
      expect(out).toContain('storage.rules  (not a file this check can compare)');
    });

    test('an unrelated push with a storage block goes green', () => {
      const before = withStorage();
      write('README.md', 'unrelated\n');
      expect(run(before, commit('readme')).code).toBe(0);
    });

    test('a deployed path pointing outside the repository fails closed', () => {
      onBase();
      write('firebase.json', JSON.stringify({ ...FIREBASE, database: { rules: '../elsewhere.json' } }, null, 2));
      const before = commit('outside path');
      write('README.md', 'y\n');
      const { code, out } = run(before, commit('readme'));
      expect(code).toBe(1);
      expect(out).toContain('points outside the repository');
    });
  });

  describe('deployedPathsIn', () => {
    test('reads rules, indexes, sources and templates from every deployed block, arrays included', () => {
      const config = {
        hosting: { source: 'not-read' },
        emulators: { ui: { enabled: true } },
        firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
        storage: [{ bucket: 'a', rules: './storage.rules' }],
        database: { rules: 'database.rules.json' },
        functions: [{ source: 'functions/' }, { source: 'other' }],
        remoteconfig: { template: 'remoteconfig.template.json' },
      };
      expect(deployedPathsIn(JSON.stringify(config)).map(({ path }) => path).sort()).toEqual(
        [
          'database.rules.json',
          'firestore.indexes.json',
          'firestore.rules',
          'functions',
          'other',
          'remoteconfig.template.json',
          'storage.rules',
        ].sort(),
      );
    });

    test('a path that is not a string fails closed', () => {
      expect(() => deployedPathsIn(JSON.stringify({ storage: { rules: 1 } }))).toThrow(/not a path/);
    });

    test('names the block and the key each path came from', () => {
      const config = { firestore: { rules: './firestore.rules' }, functions: [{ source: 'functions/' }] };
      expect(deployedPathsIn(JSON.stringify(config))).toEqual([
        { key: 'firestore', pathKey: 'rules', path: 'firestore.rules' },
        { key: 'functions', pathKey: 'source', path: 'functions' },
      ]);
    });
  });

  describe('deployCommand', () => {
    const gitWith = (config) => (args) => (args[0] === 'ls-tree' ? 'firebase.json\0' : JSON.stringify(config));

    test('a root that is a string prefix of another root does not claim its files', () => {
      const git = gitWith({ functions: { source: 'app' }, storage: { rules: 'app.rules' } });
      expect(deployCommand([{ path: 'app.rules' }], 'a', 'b', { git })).toBe('firebase deploy --only storage');
      expect(deployCommand([{ path: 'app/index.ts' }], 'a', 'b', { git })).toBe('firebase deploy --only functions');
    });

    test('a path firebase.json cannot name falls back to deploying every target but hosting', () => {
      const git = gitWith({ storage: { rules: 1 } });
      expect(deployCommand([{ path: 'firestore.rules' }], 'a', 'b', { git })).toBe('firebase deploy --except hosting');
    });
  });

  describe('firestore.indexes.json and .firebaserc', () => {
    const INDEXES = { indexes: [{ collectionGroup: 'a', queryScope: 'COLLECTION', fields: [{ fieldPath: 'x', order: 'ASCENDING' }] }], fieldOverrides: [] };
    const FIREBASERC = { projects: { default: 'binge-nu' } };
    const withBoth = () => {
      onBase();
      write('firestore.indexes.json', JSON.stringify(INDEXES, null, 2));
      write('.firebaserc', JSON.stringify(FIREBASERC, null, 2));
      return commit('indexes and firebaserc');
    };

    test('a changed index stays red', () => {
      const before = withBoth();
      const changed = { ...INDEXES, indexes: [{ ...INDEXES.indexes[0], fields: [{ fieldPath: 'y', order: 'ASCENDING' }] }] };
      write('firestore.indexes.json', JSON.stringify(changed, null, 2));
      const { code, out } = run(before, commit('change index'));
      expect(code).toBe(1);
      expect(out).toContain('firestore.indexes.json  (firestore.indexes.json content changed)');
      expect(out).toContain('--only firestore:indexes');
    });

    test('a whitespace-only reformat of the index file is not a deployed change', () => {
      const before = withBoth();
      write('firestore.indexes.json', JSON.stringify(INDEXES));
      const { code, out } = run(before, commit('reformat index'));
      expect(code).toBe(0);
      expect(out).toContain('no deployed change: firestore.indexes.json');
    });

    test('an added index file stays red', () => {
      onBase();
      write('firestore.indexes.json', JSON.stringify(INDEXES));
      const { code, out } = run(base, commit('add index file'));
      expect(code).toBe(1);
      expect(out).toContain('firestore.indexes.json  (added)');
    });

    test('an index file that no longer parses fails closed', () => {
      const before = withBoth();
      write('firestore.indexes.json', '{ "indexes": ');
      const { code, out } = run(before, commit('broken index file'));
      expect(code).toBe(1);
      expect(out).toContain('Could not compare');
      expect(out).toContain('firestore.indexes.json does not parse');
    });

    test('a changed project in .firebaserc stays red and says what it steers', () => {
      const before = withBoth();
      write('.firebaserc', JSON.stringify({ projects: { default: 'someone-else' } }, null, 2));
      const { code, out } = run(before, commit('switch project'));
      expect(code).toBe(1);
      expect(out).toContain('.firebaserc  (.firebaserc content changed)');
      expect(out).toContain('.firebaserc names the project a manual deploy targets');
    });

    test('a whitespace-only reformat of .firebaserc is not a deployed change', () => {
      const before = withBoth();
      write('.firebaserc', JSON.stringify(FIREBASERC));
      const { code, out } = run(before, commit('reformat firebaserc'));
      expect(code).toBe(0);
      expect(out).toContain('no deployed change: .firebaserc');
    });
  });

  test('a new function file stays red', () => {
    onBase();
    write('functions/src/other.ts', '// only a comment\n');
    const { code, out } = run(base, commit('add'));
    expect(code).toBe(1);
    expect(out).toContain('functions/src/other.ts  (added)');
  });

  test('a deleted function file stays red', () => {
    onBase();
    rmSync(join(dir, 'functions/src/send.ts'));
    const { code, out } = run(base, commit('delete'));
    expect(code).toBe(1);
    expect(out).toContain('functions/src/send.ts  (deleted)');
  });

  test('a manifest change stays red without being compared', () => {
    onBase();
    write('functions/package.json', '{"name":"f", "dependencies": {}}\n');
    const { code, out } = run(base, commit('manifest'));
    expect(code).toBe(1);
    expect(out).toContain('functions/package.json  (not a file this check can compare)');
  });

  test('a function file that no longer parses fails closed', () => {
    onBase();
    write('functions/src/send.ts', SRC.replace('return n * 2;', 'return n * ;'));
    const { code, out } = run(base, commit('broken'));
    expect(code).toBe(1);
    expect(out).toContain('Could not compare');
  });

  test('rules with an unterminated comment fail closed', () => {
    onBase();
    write('firestore.rules', RULES.replace('// who may read', '/* who may read'));
    const { code, out } = run(base, commit('broken rules'));
    expect(code).toBe(1);
    expect(out).toContain('Could not compare');
  });

  test('an unresolvable revision fails closed', () => {
    const { code, out } = run('0123456789abcdef0123456789abcdef01234567', base);
    expect(code).toBe(1);
    expect(out).toContain('Could not compare');
  });

  test('missing arguments fail closed', () => {
    expect(main([base], { git, log: () => {}, err: () => {} })).toBe(1);
  });

  // deploy.yml's `checks` job runs this mode and hands `deploy` to the `backend` job. Every
  // branch must write `checked=true`: the hosting job refuses to run without it.
  describe('report mode (--github-output)', () => {
    const report = (before, after, { summary = true, write } = {}) => {
      const files = {};
      const out = [];
      const args = ['--github-output', 'OUT', ...(summary ? ['--github-summary', 'SUM'] : []), before, after];
      const code = main(args, {
        git,
        log: (l) => out.push(l),
        err: (l) => out.push(l),
        write: write ?? ((file, text) => (files[file] = (files[file] ?? '') + text)),
      });
      return { code, out: out.join('\n'), files };
    };

    test('a push with nothing deployable deploys nothing', () => {
      onBase();
      write('README.md', 'changed\n');
      write('firestore.rules', RULES.replace('// who may read', '// who may read, in words'));
      const { code, files } = report(base, commit('docs and a rules comment'));
      expect(code).toBe(0);
      expect(files.OUT).toBe('deploy=\nchecked=true\n');
      expect(files.SUM).toContain(`inget som deployas har ändrats sedan ${base.slice(0, 12)}`);
      expect(files.SUM).not.toContain('Varning');
    });

    test('a rules change and a function change name their targets and list the files', () => {
      onBase();
      write('firestore.rules', RULES.replace('request.auth != null', 'false'));
      write('functions/src/send.ts', SRC.replace('n * 2', 'n * 3'));
      const { code, files } = report(base, commit('rules and a function'));
      expect(code).toBe(0);
      expect(files.OUT).toBe('deploy=--only firestore:rules,functions\nchecked=true\n');
      expect(files.SUM).toContain('- firestore.rules: ');
      expect(files.SUM).toContain('- functions/src/send.ts: compiled code changed');
      expect(files.SUM).toContain('Deployas: firebase deploy --only firestore:rules,functions');
    });

    test('a comparison that throws deploys everything but hosting', () => {
      const { code, files } = report('0123456789abcdef0123456789abcdef01234567', base);
      expect(code).toBe(0);
      expect(files.OUT).toBe(`deploy=${EXCEPT_HOSTING}\nchecked=true\n`);
      expect(files.SUM).toContain('Kunde inte jämföra med 0123456789ab');
      expect(files.SUM).toContain(
        'kunde inte läsa om .github/, firebase.json eller .firebaserc ändrats.',
      );
    });

    test('a change to the workflow or firebase.json is named in the summary', () => {
      onBase();
      write('.github/workflows/deploy.yml', 'name: x\n');
      write('firebase.json', JSON.stringify({ firestore: { rules: 'firestore.rules' } }));
      const { files } = report(base, commit('machinery'));
      expect(files.OUT).toBe(`deploy=${EXCEPT_HOSTING}\nchecked=true\n`);
      expect(files.SUM).toContain(
        'Varning:** ändringen rör också hur deployen går till: .github/workflows/deploy.yml, firebase.json.',
      );
    });

    test('a workflow change with nothing to deploy is named, and deploys nothing', () => {
      onBase();
      write('.github/workflows/deploy.yml', 'name: x\n');
      const { files } = report(base, commit('workflow only'));
      expect(files.OUT).toBe('deploy=\nchecked=true\n');
      expect(files.SUM).toContain('Varning:** ändringen rör också hur deployen går till: .github/workflows/deploy.yml.');
      expect(files.SUM).not.toContain('Deployas:');
    });

    test('a path is printed without the characters Markdown or HTML would read', () => {
      onBase();
      write('functions/src/[x](y)#!.ts', 'export const X = 1;\n');
      const { files } = report(base, commit('odd name'));
      expect(files.SUM).toContain('- functions/src/?x?(y)??.ts: added');
      expect(files.SUM).not.toContain('[x]');
    });

    test('the summary file is optional', () => {
      const { code, files } = report(base, base, { summary: false });
      expect(code).toBe(0);
      expect(Object.keys(files)).toEqual(['OUT']);
    });

    test('an output file that cannot be written fails the step', () => {
      const { code, out } = report(base, base, {
        write: () => {
          throw new Error('disk full');
        },
      });
      expect(code).toBe(1);
      expect(out).toContain('Kunde inte skriva deployrapporten: disk full');
    });

    test('missing arguments fail the step', () => {
      const quiet = { git, log: () => {}, err: () => {}, write: () => {} };
      expect(main(['--github-output', 'OUT', base], quiet)).toBe(1);
      expect(main(['--github-output', 'OUT', '--github-summary', base, base], quiet)).toBe(1);
      expect(main(['--github-output', 'OUT', '--all', base], quiet)).toBe(1);
      expect(main(['--github-output', 'OUT', '--since-last-deploy'], quiet)).toBe(1);
      expect(main(['--github-output', 'OUT', '--bogus', base], quiet)).toBe(1);
    });

    // Run workflow with deploy_all_backend: no comparison, no question to GitHub.
    test('--all deploys everything but hosting without comparing anything', () => {
      const files = {};
      const refuse = () => {
        throw new Error('--all must not read git or GitHub');
      };
      const code = main(['--github-output', 'OUT', '--github-summary', 'SUM', '--all'], {
        git: refuse,
        gh: refuse,
        env: {},
        log: () => {},
        err: () => {},
        write: (file, text) => (files[file] = (files[file] ?? '') + text),
      });
      expect(code).toBe(0);
      expect(files.OUT).toBe(`deploy=${EXCEPT_HOSTING}\nchecked=true\n`);
      expect(files.SUM).toContain('deploy_all_backend');
    });
  });

  // The comparison starts at the commit of the last successful run, not at the push's own
  // parent: a change whose run failed, was rejected or was cancelled must be found again.
  describe('report mode since the last successful run (--since-last-deploy)', () => {
    const ENV = { GITHUB_REPOSITORY: 'Malingisslen/binge' };
    const RUNS_PATH = 'repos/Malingisslen/binge/actions/workflows/deploy.yml/runs?per_page=100';
    const ARTIFACTS_PATH = 'repos/Malingisslen/binge/actions/artifacts?per_page=100';
    const runs = (...list) => JSON.stringify({ workflow_runs: list });
    const ok = (sha, number, created) => ({ head_sha: sha, head_branch: 'main', run_number: number, conclusion: 'success', created_at: created });
    // GitHub with these runs and no artifacts; an artifact of any kind is a test of its own below.
    const runsOnly = (answer) => (path) => (path === ARTIFACTS_PATH ? JSON.stringify({ total_count: 0, artifacts: [] }) : answer);
    const noDownload = () => {
      throw new Error('no record to download');
    };
    const since = (after, gh, env = ENV) => {
      const files = {};
      const out = [];
      const code = main(['--github-output', 'OUT', '--github-summary', 'SUM', '--since-last-deploy', after], {
        git,
        env,
        gh,
        download: noDownload,
        log: (l) => out.push(l),
        err: (l) => out.push(l),
        write: (file, text) => (files[file] = (files[file] ?? '') + text),
      });
      return { code, out: out.join('\n'), files };
    };

    test('a rules change whose run never succeeded is found again by the next push', () => {
      onBase();
      write('firestore.rules', RULES.replace('request.auth != null', 'false'));
      commit('rules, whose run failed');
      write('README.md', 'the next push\n');
      const head = commit('docs');
      const asked = [];
      const answer = runsOnly(runs(ok(base, 7, '2026-10-01T00:00:00Z')));
      const gh = (path) => {
        asked.push(path);
        return answer(path);
      };
      const { code, files } = since(head, gh);
      expect(code).toBe(0);
      expect(asked).toEqual([RUNS_PATH, ARTIFACTS_PATH]);
      expect(files.OUT).toBe('deploy=--only firestore:rules\nchecked=true\n');
      expect(files.SUM).toContain(`Ändrat sedan körning #7 (${base.slice(0, 12)}):`);
      expect(files.SUM).toContain(TARGET_NOTE);
    });

    test('the newest successful run in the history is the base, in whatever order GitHub lists them', () => {
      onBase();
      write('firestore.rules', RULES.replace('request.auth != null', 'false'));
      const deployed = commit('rules, deployed by run 8');
      write('README.md', 'the next push\n');
      const head = commit('docs');
      const gh = runsOnly(runs(ok(base, 7, '2026-10-01T00:00:00Z'), ok(deployed, 8, '2026-10-02T00:00:00Z')));
      const { files } = since(head, gh);
      expect(files.OUT).toBe('deploy=\nchecked=true\n');
      expect(files.SUM).toContain(`inget som deployas har ändrats sedan körning #8 (${deployed.slice(0, 12)})`);
    });

    test('a newer run outside the history, or of a commit this clone lacks, is passed over', () => {
      onBase();
      write('README.md', 'a side branch\n');
      const side = commit('side');
      onBase();
      write('firestore.rules', RULES.replace('request.auth != null', 'false'));
      const head = commit('rules');
      const gh = runsOnly(
        runs(ok(side, 9, '2026-10-03T00:00:00Z'), ok('f'.repeat(40), 10, '2026-10-04T00:00:00Z'), ok(base, 7, '2026-10-01T00:00:00Z')),
      );
      const { files } = since(head, gh);
      expect(files.OUT).toBe('deploy=--only firestore:rules\nchecked=true\n');
      expect(files.SUM).toContain('körning #7');
    });

    test('no successful run in the history deploys everything but hosting', () => {
      onBase();
      write('README.md', 'docs only\n');
      const head = commit('docs');
      const notUsable = [
        { head_sha: base, head_branch: 'main', run_number: 7, conclusion: 'failure', created_at: '2026-10-01T00:00:00Z' },
        { head_sha: 'main', head_branch: 'main', run_number: 8, conclusion: 'success', created_at: '2026-10-02T00:00:00Z' },
        { head_sha: base, head_branch: 'feature', run_number: 9, conclusion: 'success', created_at: '2026-10-03T00:00:00Z' },
      ];
      for (const answer of [runs(), runs(...notUsable)]) {
        const { code, files } = since(head, runsOnly(answer));
        expect(code).toBe(0);
        expect(files.OUT).toBe(`deploy=${EXCEPT_HOSTING}\nchecked=true\n`);
        expect(files.SUM).toContain(
          'Hittade ingen lyckad körning på main bland de 100 senaste vars commit finns i den här historiken, så allt utom webbplatsen deployas.',
        );
        expect(files.SUM).toContain(TARGET_NOTE);
      }
    });

    // An empty list is an answer; these are not, and none of them may read as "nothing to deploy".
    test('a GitHub that cannot be asked or answers garbage fails the step and writes nothing', () => {
      const head = git(['rev-parse', 'HEAD']).trim();
      const failing = () => {
        throw new Error('HTTP 403');
      };
      const fine = runs(ok(base, 7, '2026-10-01T00:00:00Z'));
      // The runs, then the artifacts, each unreadable while the other is fine.
      const cases = [failing, () => '<html>', () => '{"message":"Not Found"}'].flatMap((bad) => [
        (path) => (path === RUNS_PATH ? bad(path) : JSON.stringify({ total_count: 0, artifacts: [] })),
        (path) => (path === ARTIFACTS_PATH ? bad(path) : fine),
      ]);
      for (const gh of cases) {
        const { code, out, files } = since(head, gh);
        expect(code).toBe(1);
        expect(files).toEqual({});
        expect(out).toContain('::error::Kunde inte avgöra vad som ska deployas');
      }
    });

    test('a missing repository or an unresolvable commit fails the step and writes nothing', () => {
      const gh = runsOnly(runs(ok(base, 7, '2026-10-01T00:00:00Z')));
      expect(since(base, gh, {})).toMatchObject({ code: 1, files: {} });
      expect(since('no-such-ref', gh)).toMatchObject({ code: 1, files: {} });
    });
  });

  describe('order warnings', () => {
    const summaryOf = (message) => report(base, commit(message)).files.SUM;
    const report = (before, after) => {
      const files = {};
      main(['--github-output', 'OUT', '--github-summary', 'SUM', before, after], {
        git,
        log: () => {},
        err: () => {},
        write: (file, text) => (files[file] = (files[file] ?? '') + text),
      });
      return { files };
    };
    const INDEX_FILE = '{ "indexes": [], "fieldOverrides": [] }\n';

    test('indexes with rules or functions warn; indexes alone do not', () => {
      onBase();
      write('firestore.indexes.json', INDEX_FILE);
      write('firestore.rules', RULES.replace('request.auth != null', 'false'));
      expect(summaryOf('indexes and rules')).toContain('(BIN-1147)');
      onBase();
      write('firestore.indexes.json', INDEX_FILE);
      write('functions/src/send.ts', SRC.replace('n * 2', 'n * 3'));
      expect(summaryOf('indexes and a function')).toContain('(BIN-1147)');
      onBase();
      write('firestore.indexes.json', INDEX_FILE);
      expect(summaryOf('indexes alone')).not.toContain('BIN-1147');
    });

    test('rules with app code under src/ warn; with only tests there, or app code alone, they do not', () => {
      onBase();
      write('firestore.rules', RULES.replace('request.auth != null', 'false'));
      write('src/app/page.tsx', 'export default 1;\n');
      expect(summaryOf('rules and the app')).toContain('(BIN-540)');
      onBase();
      write('firestore.rules', RULES.replace('request.auth != null', 'false'));
      write('src/lib/x.test.ts', 'test("x", () => {});\n');
      write('src/test/helper.ts', 'export const h = 1;\n');
      expect(summaryOf('rules and tests')).not.toContain('BIN-540');
      onBase();
      write('src/app/page.tsx', 'export default 1;\n');
      expect(summaryOf('the app alone')).not.toContain('BIN-540');
    });

    test('a range it cannot read for app code still warns', () => {
      const broken = () => {
        throw new Error('boom');
      };
      expect(orderWarnings([{ path: 'firestore.rules' }], 'a', 'b', { git: broken }).join('\n')).toContain('(BIN-540)');
    });
  });

  // The backend job deploys main as GitHub has it when the job starts (BIN-1426, Malin's
  // choice 2026-10-07), and the next run compares with what that job deployed.
  describe('the backend gate (--backend-gate)', () => {
    const RUNS_PATH = 'repos/o/r/actions/workflows/deploy.yml/runs?per_page=100';
    const ARTIFACTS_PATH = 'repos/o/r/actions/artifacts?per_page=100';
    const envFor = (sha) => ({ GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, GITHUB_REPOSITORY: 'o/r' });
    const ok = (id, sha, number, created, conclusion = 'success') => ({
      id,
      head_sha: sha,
      head_branch: 'main',
      run_number: number,
      conclusion,
      created_at: created,
    });
    const record = (runId, sha, created = '2026-10-07T00:00:00Z') => ({
      name: `${RECORD_PREFIX}${sha}`,
      expired: false,
      created_at: created,
      workflow_run: { id: runId, head_branch: 'main' },
    });
    // Main where `tip` says each time GitHub is asked, and these runs and artifacts.
    // `asked` collects every path, so a test can count the questions about main.
    const github = ({ tip, runs = [], artifacts = [], asked = [] }) => (path) => {
      asked.push(path);
      if (path === 'repos/o/r/git/ref/heads/main') {
        return JSON.stringify({ ref: 'refs/heads/main', object: { sha: tip(), type: 'commit' } });
      }
      if (path === RUNS_PATH) return JSON.stringify({ workflow_runs: runs });
      if (path === ARTIFACTS_PATH) return JSON.stringify({ total_count: artifacts.length, artifacts });
      throw new Error(`unexpected gh ${path}`);
    };
    const noDownload = () => {
      throw new Error('no record to download');
    };
    const collect = () => {
      const files = {};
      const out = [];
      const errors = [];
      return {
        files,
        out,
        errors,
        io: { log: (l) => out.push(l), err: (l) => errors.push(l), write: (file, text) => (files[file] = (files[file] ?? '') + text) },
      };
    };
    // The backend job's checkout is the run's commit.
    const gate = (sha, gh, { all = false, download = noDownload } = {}) => {
      git(['checkout', '-q', '--detach', sha]);
      const { files, out, errors, io } = collect();
      const args = ['--backend-gate', '--github-output', 'OUT', '--github-summary', 'SUM', ...(all ? ['--all'] : [])];
      const code = main(args, { env: envFor(sha), gh, git, download, ...io });
      return { code, files, out, errors };
    };
    // The next run's `checks` job.
    const nextRun = (head, gh, download = noDownload) => {
      const { files, io } = collect();
      const code = main(['--github-output', 'OUT', '--github-summary', 'SUM', '--since-last-deploy', head], {
        env: { GITHUB_REPOSITORY: 'o/r' },
        gh,
        git,
        download,
        ...io,
      });
      return { code, files };
    };
    const rules = (allow) => write('firestore.rules', RULES.replace('request.auth != null', allow));

    test("main at the run's own commit: the job deploys what changed since the last deploy", () => {
      onBase();
      rules('false');
      const run = commit('rules');
      const { code, files } = gate(run, github({ tip: () => run, runs: [ok(7, base, 7, '2026-10-01T00:00:00Z')] }));
      expect(code).toBe(0);
      expect(files.OUT).toBe(`target=${run}\ndeploy=--only firestore:rules\n`);
      expect(files.SUM).toContain(`Main pekade på körningens egen commit, ${run.slice(0, 12)}, när jobbet startade.`);
      expect(files.SUM).toContain(`Jämfört med ${base.slice(0, 12)}, som körning #7 deployade.`);
      expect(files.SUM).toContain('Deployas: firebase deploy --only firestore:rules');
    });

    // Deploying the run's commit would roll main's newer rules back. The checkout's origin/main is set to the run's commit, as the
    // checkout may leave it, to show the gate asks GitHub instead.
    test("main moved on: the job deploys main's commit, compared with the last deploy, whatever origin/main says", () => {
      onBase();
      rules('false');
      const run = commit('rules, the run queued behind another');
      rules('true');
      write('functions/src/send.ts', SRC.replace('n * 2', 'n * 3'));
      const tip = commit('newer rules and a function, pushed while it was queued');
      git(['update-ref', 'refs/remotes/origin/main', run]);
      const { code, files, errors } = gate(run, github({ tip: () => tip, runs: [ok(7, base, 7, '2026-10-01T00:00:00Z')] }));
      expect(errors).toEqual([]);
      expect(code).toBe(0);
      expect(files.OUT).toBe(`target=${tip}\ndeploy=--only firestore:rules,functions\n`);
      expect(files.SUM).toContain(
        `Main hade gått vidare från körningens commit ${run.slice(0, 12)} till ${tip.slice(0, 12)} när jobbet startade, så det är ${tip.slice(0, 12)} som deployas.`,
      );
      expect(files.SUM).toContain('Skiljer dem åt i regler och funktioner: firestore.rules, functions/src/send.ts.');
      expect(files.SUM).toContain(`Faller ett av dem deployas ingenting, inte heller ${run.slice(0, 12)}.`);
      expect(files.SUM).toContain(`Jämfört med ${base.slice(0, 12)}, som körning #7 deployade.`);
    });

    test('main moved on to a commit that undid the change: nothing deploys, and the summary says so', () => {
      onBase();
      rules('false');
      const run = commit('rules');
      rules('request.auth != null');
      const tip = commit('revert');
      const { code, files } = gate(run, github({ tip: () => tip, runs: [ok(7, base, 7, '2026-10-01T00:00:00Z')] }));
      expect(code).toBe(0);
      expect(files.OUT).toBe(`target=${tip}\ndeploy=\n`);
      expect(files.SUM).toContain('Skiljer dem åt i regler och funktioner: firestore.rules.');
      expect(files.SUM).toContain('Inget i regler och funktioner skiljer sig från det som redan är deployat, så inget deployas.');
    });

    test('a commit main has left behind is refused, and nothing is written', () => {
      onBase();
      rules('false');
      const side = commit('side');
      onBase();
      write('README.md', 'main\n');
      const tip = commit('main');
      const { code, files, errors } = gate(side, github({ tip: () => tip }));
      expect(code).toBe(1);
      expect(files).toEqual({});
      expect(errors).toEqual([`::error::Regler och funktioner deployas inte: ${side.slice(0, 12)} finns inte på main.`]);
    });

    test('deploy_all_backend deploys everything but hosting, for main as it stands', () => {
      onBase();
      rules('false');
      const run = commit('rules');
      write('README.md', 'later\n');
      const tip = commit('docs');
      const asked = [];
      const { code, files } = gate(run, github({ tip: () => tip, asked }), { all: true });
      expect(code).toBe(0);
      expect(files.OUT).toBe(`target=${tip}\ndeploy=${EXCEPT_HOSTING}\n`);
      expect(files.SUM).toContain('Run workflow med deploy_all_backend');
      expect(asked).not.toContain(RUNS_PATH);
    });

    // #8's conditions 4 and 7: main moves again after the gate. The gate asked GitHub once,
    // and its output is what the job deploys; the next run compares with that commit.
    test('main moving again after the gate changes nothing it wrote, and the next run compares with what the job deployed', () => {
      onBase();
      rules('false');
      const run = commit('rules, run #8 is queued');
      rules('true');
      const target = commit('newer rules, main when the job starts');
      write('functions/src/send.ts', SRC.replace('n * 2', 'n * 3'));
      const later = commit('a function, pushed after the gate');
      let main_ = target;
      const asked = [];
      const runs = [ok(7, base, 7, '2026-10-01T00:00:00Z')];
      const started = gate(run, github({ tip: () => main_, runs, asked }));
      main_ = later;
      expect(started.files.OUT).toBe(`target=${target}\ndeploy=--only firestore:rules\n`);
      expect(asked.filter((p) => p === 'repos/o/r/git/ref/heads/main')).toHaveLength(1);

      // Run #8 then succeeded with its record of `target`.
      const after = [...runs, ok(8, run, 8, '2026-10-02T00:00:00Z')];
      const recorded = [record(8, target)];
      const downloads = [];
      const download = (repo, runId, name) => {
        downloads.push([repo, runId, name]);
        return `${target}\n`;
      };
      const next = nextRun(later, github({ tip: () => later, runs: after, artifacts: recorded }), download);
      expect(next.code).toBe(0);
      expect(next.files.OUT).toBe('deploy=--only functions\nchecked=true\n');
      expect(next.files.SUM).toContain(`Ändrat sedan körning #8 (${target.slice(0, 12)}):`);
      expect(downloads).toEqual([['o/r', 8, `${RECORD_PREFIX}${target}`]]);
      // Without the record, run #8's own commit is the base, and the rules come again.
      const without = nextRun(later, github({ tip: () => later, runs: after }));
      expect(without.files.OUT).toBe('deploy=--only firestore:rules,functions\nchecked=true\n');
      // The run queued for `target` itself finds nothing left to deploy.
      const queued = nextRun(target, github({ tip: () => later, runs: after, artifacts: recorded }), download);
      expect(queued.files.OUT).toBe('deploy=\nchecked=true\n');
    });

    test('a record whose file names another commit, or that cannot be read, stops the comparison', () => {
      onBase();
      rules('false');
      const run = commit('rules');
      rules('true');
      const target = commit('newer rules');
      const gh = github({ tip: () => target, runs: [ok(7, base, 7, '2026-10-01T00:00:00Z'), ok(8, run, 8, '2026-10-02T00:00:00Z')], artifacts: [record(8, target)] });
      const failing = () => {
        throw new Error('HTTP 410');
      };
      for (const download of [() => `${run}\n`, () => '', failing]) {
        expect(nextRun(target, gh, download)).toEqual({ code: 1, files: {} });
      }
    });
  });

  describe('the site gate', () => {
    const twoCommits = (second) => {
      onBase();
      write('firestore.rules', RULES.replace('request.auth != null', 'false'));
      const first = commit('rules');
      second();
      return [first, commit('later')];
    };

    test('the site gate refuses a commit older than one a successful run deployed', () => {
      const [first, later] = twoCommits(() => write('README.md', 'later\n'));
      const ok = (sha, number, created, conclusion = 'success') => ({
        head_sha: sha,
        head_branch: 'main',
        run_number: number,
        conclusion,
        created_at: created,
      });
      const site = (sha, ...runs) =>
        siteGateProblem({
          env: { GITHUB_SHA: sha, GITHUB_REPOSITORY: 'o/r' },
          gh: () => JSON.stringify({ workflow_runs: runs }),
          git,
        });
      const deployedBoth = [ok(first, 1, '2026-10-01T00:00:00Z'), ok(later, 2, '2026-10-02T00:00:00Z')];
      expect(site(first, ...deployedBoth)).toBe(
        `körning #2 har redan deployat den nyare commiten ${later.slice(0, 12)}, och den här körningen skulle ersätta webbplatsen med en äldre. Vill du deploya igen: Run workflow på main`,
      );
      // The newest deployed commit itself, a commit after every deployed one, and an older
      // commit whose newer run failed: the site may go out.
      expect(site(later, ...deployedBoth)).toBeNull();
      expect(site(later, ok(first, 1, '2026-10-01T00:00:00Z'))).toBeNull();
      expect(site(first, ok(later, 2, '2026-10-02T00:00:00Z', 'failure'))).toBeNull();
      const exitFor = (sha) =>
        main(['--site-gate'], {
          env: { GITHUB_SHA: sha, GITHUB_REPOSITORY: 'o/r' },
          gh: () => JSON.stringify({ workflow_runs: deployedBoth }),
          git,
          log: () => {},
          err: () => {},
        });
      expect(exitFor(first)).toBe(1);
      expect(exitFor(later)).toBe(0);
    });
  });
});

describe('deployArgs and githubOutput', () => {
  const gitWith = (config) => (args) => (args[0] === 'ls-tree' ? 'firebase.json\0' : JSON.stringify(config));
  const REAL = {
    hosting: { public: 'out' },
    firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
    functions: { source: 'functions' },
  };

  test('names the targets the changed paths deploy', () => {
    const git = gitWith(REAL);
    expect(deployArgs([{ path: 'firestore.rules' }, { path: 'functions/src/a.ts' }], 'a', 'b', { git })).toBe(
      '--only firestore:rules,functions',
    );
    expect(deployArgs([{ path: 'firestore.indexes.json' }], 'a', 'b', { git })).toBe('--only firestore:indexes');
  });

  // A target name is a firebase.json key from the pushed commit. Each of these would read as
  // a flag, a command or a second output line if it reached the workflow.
  test.each(['x --force', '$(id)', 'x\ninjected=1'])('a firebase.json key %j never reaches the arguments', (key) => {
    const git = gitWith({ ...REAL, [key]: { source: 'app' } });
    expect(deployArgs([{ path: 'app/index.ts' }], 'a', 'b', { git })).toBe(EXCEPT_HOSTING);
    expect(deployArgs([{ path: 'app/index.ts' }, { path: 'firestore.rules' }], 'a', 'b', { git })).toBe(EXCEPT_HOSTING);
  });

  test('a target firebase.json allows but this check has not judged deploys everything but hosting', () => {
    const git = gitWith({ ...REAL, storage: { rules: 'storage.rules' } });
    expect(deployArgs([{ path: 'storage.rules' }], 'a', 'b', { git })).toBe(EXCEPT_HOSTING);
  });

  test('a path no target names, or an unreadable firebase.json, deploys everything but hosting', () => {
    expect(deployArgs([{ path: '.firebaserc' }], 'a', 'b', { git: gitWith(REAL) })).toBe(EXCEPT_HOSTING);
    const broken = () => {
      throw new Error('boom');
    };
    expect(deployArgs([{ path: 'firestore.rules' }], 'a', 'b', { git: broken })).toBe(EXCEPT_HOSTING);
  });

  test('githubOutput writes the arguments and the checked flag, and refuses a line break', () => {
    expect(githubOutput('--only functions')).toBe('deploy=--only functions\nchecked=true\n');
    expect(githubOutput('')).toBe('deploy=\nchecked=true\n');
    expect(() => githubOutput('--only functions\nchecked=false')).toThrow(/line break/);
    expect(() => githubOutput('--only functions\rx')).toThrow(/line break/);
  });
});

describe('lastDeployed', () => {
  const [A, B, C, D] = ['a', 'b', 'c', 'd'].map((c) => c.repeat(40));
  const inHistory = new Set([A, B, D, 'main']);
  // `merge-base --is-ancestor <sha> HEAD`: in the history or not.
  const git = ([, , sha]) => {
    if (!inHistory.has(sha)) throw new Error('exit 1');
    return '';
  };
  const run = (sha, number, created, conclusion = 'success', branch = 'main') => ({
    id: number,
    head_sha: sha,
    head_branch: branch,
    run_number: number,
    created_at: created,
    conclusion,
  });
  const runs = (...list) => JSON.stringify({ workflow_runs: list });
  const artifacts = (...list) => JSON.stringify({ total_count: list.length, artifacts: list });
  const NONE = artifacts();
  const record = (runId, sha, { created = '2026-10-07T00:00:00Z', expired = false, branch = 'main', name } = {}) => ({
    name: name ?? `${RECORD_PREFIX}${sha}`,
    expired,
    created_at: created,
    workflow_run: { id: runId, head_branch: branch },
  });
  // The record's own commit, whatever is asked for.
  const holds = (sha) => () => `${sha}\n`;
  const never = () => {
    throw new Error('nothing should be downloaded');
  };

  // Each run that must lose is removed by one filter or by the sort: a failure, a commit named
  // by a branch name, a commit outside the history, a run on another branch, and the older A.
  test('without records, takes the newest successful run on main with a full commit id in the history', () => {
    const raw = runs(
      run(A, 1, '2026-10-01T00:00:00Z'),
      run(B, 2, '2026-10-02T00:00:00Z'),
      run('main', 3, '2026-10-03T00:00:00Z'),
      run(C, 4, '2026-10-04T00:00:00Z'),
      run(B, 5, '2026-10-05T00:00:00Z', 'failure'),
      run(A, 6, '2026-10-06T00:00:00Z', 'success', 'feature'),
    );
    expect(lastDeployed(raw, NONE, 'HEAD', { git, download: never })).toEqual({ sha: B, number: 2, recorded: false });
  });

  // Unfiltered on purpose: GitHub's list filtered by branch and status was stale for this
  // repository (deployedRunsPath says how to see it). mainRuns filters instead.
  test('asks GitHub for the newest runs and artifacts without a filter', () => {
    expect(deployedRunsPath('o/r')).toBe('repos/o/r/actions/workflows/deploy.yml/runs?per_page=100');
    expect(deployedArtifactsPath('o/r')).toBe('repos/o/r/actions/artifacts?per_page=100');
  });

  test('answers null when no run qualifies, and throws on an answer that is not a run list', () => {
    expect(lastDeployed(runs(run(C, 4, '2026-10-04T00:00:00Z')), NONE, 'HEAD', { git, download: never })).toBeNull();
    expect(() => lastDeployed('<html>', NONE, 'HEAD', { git, download: never })).toThrow('JSON');
    expect(() => lastDeployed('{"message":"Not Found"}', NONE, 'HEAD', { git, download: never })).toThrow('lista');
  });

  // Run 2 deployed D, a newer commit than its own A, because main had moved on when its job started.
  const movedOn = runs(run(B, 1, '2026-10-01T00:00:00Z'), run(A, 2, '2026-10-02T00:00:00Z'));

  test("a run's record names the commit it deployed, read from the file inside it", () => {
    const asked = [];
    const download = (runId, name) => {
      asked.push([runId, name]);
      return `${D}\n`;
    };
    expect(lastDeployed(movedOn, artifacts(record(2, D)), 'HEAD', { git, download })).toEqual({ sha: D, number: 2, recorded: true });
    expect(asked).toEqual([[2, `${RECORD_PREFIX}${D}`]]);
  });

  // The backend went out, the site did not.
  test('a record counts on a run that failed after it', () => {
    const failed = runs(run(B, 1, '2026-10-01T00:00:00Z'), run(A, 2, '2026-10-02T00:00:00Z', 'failure'));
    expect(lastDeployed(failed, artifacts(record(2, D)), 'HEAD', { git, download: holds(D) })).toEqual({ sha: D, number: 2, recorded: true });
  });

  test('of two records on one run, the newer one counts', () => {
    const two = artifacts(record(2, B, { created: '2026-10-02T00:00:00Z' }), record(2, D, { created: '2026-10-03T00:00:00Z' }));
    expect(lastDeployed(movedOn, two, 'HEAD', { git, download: holds(D) })).toMatchObject({ sha: D });
    const reversed = artifacts(record(2, D, { created: '2026-10-03T00:00:00Z' }), record(2, B, { created: '2026-10-02T00:00:00Z' }));
    expect(lastDeployed(movedOn, reversed, 'HEAD', { git, download: holds(D) })).toMatchObject({ sha: D });
  });

  // #8's condition 6: these never make a newer commit the base. Each falls back to run 2's
  // own commit A, which a record of D would have replaced.
  test('a record from another run, another branch, or with another name is passed over', () => {
    const passedOver = [
      record(99, D),
      record(2, D, { branch: 'feature' }),
      record(2, D, { name: `${RECORD_PREFIX}${D.slice(0, 39)}` }),
      record(2, D, { name: `${RECORD_PREFIX}${D.toUpperCase()}` }),
      record(2, D, { name: `x${RECORD_PREFIX}${D}` }),
      record(2, D, { name: `${RECORD_PREFIX}${D}.zip` }),
      { ...record(2, D), workflow_run: null },
      null,
    ];
    for (const artifact of passedOver) {
      expect(lastDeployed(movedOn, artifacts(artifact), 'HEAD', { git, download: never }), JSON.stringify(artifact)).toEqual({
        sha: A,
        number: 2,
        recorded: false,
      });
    }
  });

  test('artifacts of other kinds beside a record change nothing; an empty list falls back to the runs', () => {
    const other = (n) => ({ ...record(2, D), name: `build-${n}` });
    const crowded = artifacts(other(1), record(2, D), other(2), other(3));
    expect(lastDeployed(movedOn, crowded, 'HEAD', { git, download: holds(D) })).toMatchObject({ sha: D, recorded: true });
    expect(lastDeployed(movedOn, NONE, 'HEAD', { git, download: never })).toMatchObject({ sha: A, recorded: false });
  });

  test('a record of a commit outside the history passes to the next older run', () => {
    expect(lastDeployed(movedOn, artifacts(record(2, C)), 'HEAD', { git, download: never })).toEqual({ sha: B, number: 1, recorded: false });
  });

  // Run 2's own commit A is older than what is live, so falling back to it could leave a
  // change undeployed. Each of these throws, which deploys everything but hosting.
  test('a record that cannot be trusted throws instead of falling back', () => {
    const cases = [
      [artifacts(record(2, D, { expired: true })), never, 'har gått ut'],
      [artifacts({ ...record(2, D), expired: undefined }), never, 'har gått ut'],
      [artifacts(record(2, D)), holds(A), 'innehåller inte sin egen commit'],
      [artifacts(record(2, D)), () => '', 'innehåller inte sin egen commit'],
      [
        artifacts(record(2, D)),
        () => {
          throw new Error('HTTP 410');
        },
        'kunde inte läsa',
      ],
    ];
    for (const [raw, download, message] of cases) {
      expect(() => lastDeployed(movedOn, raw, 'HEAD', { git, download })).toThrow(message);
    }
  });

  // A record that falls off the page would leave its run reading as its own, older commit.
  test('an artifact list longer than one page, or one it cannot read, throws', () => {
    const full = JSON.stringify({ total_count: 101, artifacts: [record(2, D)] });
    expect(() => lastDeployed(movedOn, full, 'HEAD', { git, download: holds(D) })).toThrow('fler än de 1 på en sida');
    for (const raw of ['<html>', '{"message":"Not Found"}', JSON.stringify({ artifacts: [] }), JSON.stringify({ total_count: 0 })]) {
      expect(() => lastDeployed(movedOn, raw, 'HEAD', { git, download: never }), raw).toThrow(/GitHub svarade inte/);
    }
  });

  test('deployRecords keys each record by its run', () => {
    expect([...deployRecords(movedOn, artifacts(record(2, D), record(1, B))).entries()]).toEqual([
      [2, { sha: D, name: `${RECORD_PREFIX}${D}`, expired: false }],
      [1, { sha: B, name: `${RECORD_PREFIX}${B}`, expired: false }],
    ]);
  });
});

describe('newerDeployedRun', () => {
  const [A, B, C, D] = ['a', 'b', 'c', 'd'].map((c) => c.repeat(40));
  // A is this run's commit. B and D come after it; C is older or elsewhere. Real git calls a
  // commit its own ancestor, and so does this fake, so only the skip keeps A's own runs out.
  const containsA = new Set([A, B, D]);
  const git = ([, , from, to]) => {
    if (from !== A || !containsA.has(to)) throw new Error('exit 1');
    return '';
  };
  const run = (sha, number, created, conclusion = 'success', branch = 'main') => ({
    head_sha: sha,
    head_branch: branch,
    run_number: number,
    created_at: created,
    conclusion,
  });
  const runs = (...list) => JSON.stringify({ workflow_runs: list });

  // Each run that must lose is removed by the skip, a filter, the sort or the ancestry test:
  // this commit's own runs, an older commit, a failure, a commit named by a branch name, a
  // run on another branch (the newest run in the list), and the older of the two later commits.
  test('finds the newest successful run on main of a later commit', () => {
    const raw = runs(
      run(A, 1, '2026-10-01T00:00:00Z'),
      run(C, 2, '2026-10-02T00:00:00Z'),
      run(B, 3, '2026-10-03T00:00:00Z'),
      run(D, 4, '2026-10-04T00:00:00Z', 'failure'),
      run('main', 5, '2026-10-05T00:00:00Z'),
      run(D, 6, '2026-10-06T00:00:00Z'),
      run(A, 7, '2026-10-07T00:00:00Z'),
      run(D, 8, '2026-10-08T00:00:00Z', 'success', 'feature'),
    );
    expect(newerDeployedRun(raw, A, { git })).toEqual({ sha: D, number: 6 });
  });

  test('answers null when no run is of a later commit, and throws on an answer that is not a run list', () => {
    expect(newerDeployedRun(runs(run(A, 1, '2026-10-01T00:00:00Z'), run(C, 2, '2026-10-02T00:00:00Z')), A, { git })).toBeNull();
    expect(newerDeployedRun(runs(run(B, 3, '2026-10-03T00:00:00Z', 'failure')), A, { git })).toBeNull();
    expect(() => newerDeployedRun('<html>', A, { git })).toThrow('JSON');
    expect(() => newerDeployedRun('{"message":"Not Found"}', A, { git })).toThrow('lista');
  });
});

describe('mainTip', () => {
  const SHA = 'a'.repeat(40);
  test("reads the commit GitHub says refs/heads/main points at", () => {
    expect(mainTip(JSON.stringify({ ref: 'refs/heads/main', object: { sha: SHA, type: 'commit' } }))).toBe(SHA);
  });

  test('throws on any other answer', () => {
    const answers = [
      '<html>',
      '{"message":"Not Found"}',
      JSON.stringify({ ref: 'refs/heads/other', object: { sha: SHA, type: 'commit' } }),
      JSON.stringify({ ref: 'refs/heads/main', object: { sha: SHA, type: 'tag' } }),
      JSON.stringify({ ref: 'refs/heads/main', object: { sha: 'main', type: 'commit' } }),
    ];
    for (const raw of answers) expect(() => mainTip(raw), raw).toThrow(/GitHub svarade inte/);
  });
});

describe('gateTarget', () => {
  const SHA = 'a'.repeat(40);
  const ENV = { GITHUB_REF: 'refs/heads/main', GITHUB_SHA: SHA, GITHUB_REPOSITORY: 'Malingisslen/binge' };
  const TIP = 'repos/Malingisslen/binge/git/ref/heads/main';
  const tipAt = (sha) => JSON.stringify({ ref: 'refs/heads/main', object: { sha, type: 'commit' } });
  // GitHub's answers by path; an Error is thrown, and any other path is a call the gate
  // should not make.
  const github = (answers) => (path) => {
    if (!(path in answers)) throw new Error(`unexpected gh ${path}`);
    if (answers[path] instanceof Error) throw answers[path];
    return answers[path];
  };
  const mainAt = (tip) => github({ [TIP]: tipAt(tip) });
  // HEAD at `head`; anything else is a call the gate should not make.
  const gitAt = (head) => (args) => {
    if (args.join(' ') === 'rev-parse HEAD') return `${head}\n`;
    throw new Error(`unexpected git ${args.join(' ')}`);
  };

  test('a run of the commit main points at deploys that commit, asking GitHub only where main points', () => {
    const asked = [];
    const answer = mainAt(SHA);
    const gh = (path) => {
      asked.push(path);
      return answer(path);
    };
    expect(gateTarget({ env: ENV, gh, git: gitAt(SHA) })).toEqual({ target: SHA });
    expect(asked).toEqual([TIP]);
  });

  test.each(['refs/heads/feature', 'refs/pull/1/merge', 'refs/tags/v1', undefined])('a run for %s is refused', (ref) => {
    expect(gateTarget({ env: { ...ENV, GITHUB_REF: ref }, gh: mainAt(SHA), git: gitAt(SHA) }).problem).toMatch(
      /inte refs\/heads\/main/,
    );
  });

  test('a commit id that is not one is refused', () => {
    expect(gateTarget({ env: { ...ENV, GITHUB_SHA: 'main' }, gh: mainAt(SHA), git: gitAt(SHA) }).problem).toBe(
      'GITHUB_SHA är inget commit-id',
    );
  });

  test('a missing or malformed repository is refused', () => {
    const gate = (env) => gateTarget({ env: { ...ENV, ...env }, gh: mainAt(SHA), git: gitAt(SHA) }).problem;
    expect(gate({ GITHUB_REPOSITORY: undefined })).toBe('GITHUB_REPOSITORY saknas');
    expect(gate({ GITHUB_REPOSITORY: 'o/r/../../x' })).toBe('GITHUB_REPOSITORY saknas');
  });

  test('a checkout of another commit is refused', () => {
    expect(gateTarget({ env: ENV, gh: mainAt(SHA), git: gitAt('b'.repeat(40)) }).problem).toMatch(/utcheckade commiten bbbb/);
  });

  test('a main GitHub cannot name is refused', () => {
    for (const answer of [new Error('HTTP 404'), '<html>', tipAt('main')]) {
      const gh = github({ [TIP]: answer });
      expect(gateTarget({ env: ENV, gh, git: gitAt(SHA) }).problem).toMatch(/^frågan till GitHub om main misslyckades: /);
    }
  });

  test('a commit that is not on main is refused', () => {
    const MAIN = 'c'.repeat(40);
    const git = (args) => {
      if (args[0] === 'merge-base') throw new Error('not an ancestor');
      if (args.join(' ') === `rev-parse --verify --quiet ${MAIN}^{commit}`) return `${MAIN}\n`;
      return gitAt(SHA)(args);
    };
    expect(gateTarget({ env: ENV, gh: mainAt(MAIN), git }).problem).toBe(`${SHA.slice(0, 12)} finns inte på main`);
  });

  // GitHub's main is newer than anything this clone fetched: the gate fetches it.
  test('a newer main the clone lacks is fetched, and one it cannot fetch is refused', () => {
    const MAIN = 'c'.repeat(40);
    const calls = [];
    const clone = ({ fetches }) => {
      let fetched = false;
      return (args) => {
        calls.push(args.join(' '));
        if (args.join(' ') === `rev-parse --verify --quiet ${MAIN}^{commit}`) {
          if (!fetched) throw new Error('exit 1');
          return `${MAIN}\n`;
        }
        if (args.join(' ') === `fetch --no-tags --quiet origin ${MAIN}`) {
          if (!fetches) throw new Error('could not fetch');
          fetched = true;
          return '';
        }
        if (args.join(' ') === `merge-base --is-ancestor ${SHA} ${MAIN}`) return '';
        return gitAt(SHA)(args);
      };
    };
    expect(gateTarget({ env: ENV, gh: mainAt(MAIN), git: clone({ fetches: true }) })).toEqual({ target: MAIN });
    expect(calls).toContain(`fetch --no-tags --quiet origin ${MAIN}`);
    expect(gateTarget({ env: ENV, gh: mainAt(MAIN), git: clone({ fetches: false }) })).toEqual({
      problem: 'main pekar på cccccccccccc, som den här körningen inte kunde hämta',
    });
  });

  // The exit code is what stops the job; a refusal that is only printed lets the key step run.
  // A run for another ref: GitHub is not asked, so the stub throws on any path.
  test('through main, a refusal exits 1 with its reason and writes nothing', () => {
    const files = {};
    const errors = [];
    const code = main(['--backend-gate', '--github-output', 'OUT', '--github-summary', 'SUM'], {
      env: { ...ENV, GITHUB_REF: 'refs/heads/feature' },
      gh: github({}),
      git: gitAt(SHA),
      log: () => {},
      err: (l) => errors.push(l),
      write: (file, text) => (files[file] = text),
    });
    expect({ code, errors, files }).toEqual({
      code: 1,
      errors: ['::error::Regler och funktioner deployas inte: körningen gäller refs/heads/feature, inte refs/heads/main.'],
      files: {},
    });
  });

  // A comparison that cannot be made is a refusal too: with no outputs the job checks out
  // an empty target and stops, but the exit code is what says so.
  test('through main, a comparison that throws exits 1 and writes nothing', () => {
    const files = {};
    const errors = [];
    const code = main(['--backend-gate', '--github-output', 'OUT', '--github-summary', 'SUM'], {
      env: ENV,
      gh: github({ [TIP]: tipAt(SHA) }),
      git: gitAt(SHA),
      log: () => {},
      err: (l) => errors.push(l),
      write: (file, text) => (files[file] = text),
    });
    expect(code).toBe(1);
    expect(files).toEqual({});
    expect(errors.join('\n')).toContain(`::error::Regler och funktioner deployas inte: kunde inte avgöra vad ${SHA.slice(0, 12)} ska deploya: `);
  });

  test('the gate mode needs both files, and takes --all and nothing else after them', () => {
    const refuse = () => {
      throw new Error('a usage error must not ask anyone');
    };
    const errors = [];
    const quiet = { env: ENV, gh: refuse, git: refuse, log: () => {}, err: (l) => errors.push(l), write: refuse };
    for (const args of [
      [],
      ['--github-output', 'OUT'],
      ['--github-output', 'OUT', '--github-summary'],
      ['--github-summary', 'SUM', '--github-output', 'OUT'],
      ['--github-output', 'OUT', '--github-summary', 'SUM', '--bogus'],
      ['--github-output', 'OUT', '--github-summary', 'SUM', '--all', '--all'],
    ]) {
      expect(main(['--backend-gate', ...args], quiet), args.join(' ')).toBe(1);
    }
    expect(new Set(errors)).toEqual(
      new Set(['usage: check-deploy-drift.mjs --backend-gate --github-output <file> --github-summary <file> [--all]']),
    );
  });

  test('gateOutput writes the target and the arguments, and refuses anything else', () => {
    expect(gateOutput(SHA, '--only functions')).toBe(`target=${SHA}\ndeploy=--only functions\n`);
    expect(gateOutput(SHA, '')).toBe(`target=${SHA}\ndeploy=\n`);
    expect(() => gateOutput('main', '')).toThrow(/commit id/);
    expect(() => gateOutput(`${SHA}\ndeploy=x`, '')).toThrow(/commit id/);
    expect(() => gateOutput(SHA, '--only functions\ntarget=x')).toThrow(/line break/);
  });

  test("gateSummary names the target, and says when no base was found", () => {
    const lines = gateSummary(SHA, SHA, { deploy: EXCEPT_HOSTING, base: null }, { git: gitAt(SHA) });
    expect(lines).toContain(`Main pekade på körningens egen commit, ${SHA.slice(0, 12)}, när jobbet startade.`);
    expect(lines).toContain(`Hittade ingen tidigare deploy i historiken för ${SHA.slice(0, 12)}.`);
    expect(lines).toContain(`Deployas: firebase deploy ${EXCEPT_HOSTING}`);
    const broken = () => {
      throw new Error('boom');
    };
    expect(gateSummary(SHA, 'c'.repeat(40), { deploy: '', base: null }, { git: broken })).toContain(
      'Kunde inte läsa vad som skiljer dem åt i regler och funktioner.',
    );
  });
});

describe('siteGateProblem', () => {
  const SHA = 'a'.repeat(40);
  const ENV = { GITHUB_SHA: SHA, GITHUB_REPOSITORY: 'Malingisslen/binge' };
  const RUNS = 'repos/Malingisslen/binge/actions/workflows/deploy.yml/runs?per_page=100';
  const NONE = JSON.stringify({ workflow_runs: [] });
  // A full clone in which no commit comes after SHA.
  const full = (args) => {
    if (args.join(' ') === 'rev-parse --is-shallow-repository') return 'false\n';
    if (args[0] === 'merge-base') throw new Error('exit 1');
    throw new Error(`unexpected git ${args.join(' ')}`);
  };

  test('asks GitHub for the runs, and lets the site out when none is of a later commit', () => {
    const asked = [];
    const gh = (path) => {
      asked.push(path);
      return JSON.stringify({ workflow_runs: [{ head_sha: 'b'.repeat(40), head_branch: 'main', run_number: 7, conclusion: 'success' }] });
    };
    expect(siteGateProblem({ env: ENV, gh, git: full })).toBeNull();
    expect(asked).toEqual([RUNS]);
  });

  // "Nothing newer" must never be the answer of a clone that cannot see history.
  test('a shallow clone, one git gives no clear answer about, or one git cannot read, is refused', () => {
    for (const answer of ['true\n', '', 'unknown\n']) {
      const shallow = (args) => (args[1] === '--is-shallow-repository' ? answer : full(args));
      expect(siteGateProblem({ env: ENV, gh: () => NONE, git: shallow }), JSON.stringify(answer)).toBe(
        'klonen saknar historiken som visar om en nyare körning redan deployat',
      );
    }
    const broken = () => {
      throw new Error('not a git repository');
    };
    expect(siteGateProblem({ env: ENV, gh: () => NONE, git: broken })).toBe('kan inte läsa om klonen har hela historiken');
  });

  test('a GitHub that cannot be asked or answers garbage is refused', () => {
    const failing = () => {
      throw new Error('HTTP 403');
    };
    for (const gh of [failing, () => '<html>', () => '{"message":"Not Found"}']) {
      expect(siteGateProblem({ env: ENV, gh, git: full })).toMatch(/^frågan till GitHub om tidigare körningar misslyckades: /);
    }
  });

  test('a commit id or repository that is not one is refused', () => {
    expect(siteGateProblem({ env: { ...ENV, GITHUB_SHA: 'main' }, gh: () => NONE, git: full })).toBe('GITHUB_SHA är inget commit-id');
    expect(siteGateProblem({ env: { ...ENV, GITHUB_REPOSITORY: 'x' }, gh: () => NONE, git: full })).toBe('GITHUB_REPOSITORY saknas');
  });

  // The same successful run of B, and only the ancestry answer differs: the exit code is
  // what keeps an older site from replacing a newer one.
  test('through main, a newer deployed commit exits 1 with its reason and an older one exits 0', () => {
    const NEWER = 'b'.repeat(40);
    const deployed = () =>
      JSON.stringify({
        workflow_runs: [{ head_sha: NEWER, head_branch: 'main', run_number: 7, conclusion: 'success', created_at: '2026-10-05T00:00:00Z' }],
      });
    const before = (args) => (args.join(' ') === `merge-base --is-ancestor ${SHA} ${NEWER}` ? '' : full(args));
    const site = (git) => {
      const out = [];
      const errors = [];
      const code = main(['--site-gate'], { env: ENV, gh: deployed, git, log: (l) => out.push(l), err: (l) => errors.push(l) });
      return { code, out, errors };
    };
    expect(site(before)).toEqual({
      code: 1,
      out: [],
      errors: [
        `::error::Webbplatsen deployas inte: körning #7 har redan deployat den nyare commiten ${NEWER.slice(0, 12)}, och den här körningen skulle ersätta webbplatsen med en äldre. Vill du deploya igen: Run workflow på main.`,
      ],
    });
    expect(site(full)).toEqual({
      code: 0,
      out: ['Ingen lyckad körning har deployat en nyare commit, så webbplatsen från den här körningen kan gå ut.'],
      errors: [],
    });
  });
});

// The tests above inject git, gh, the environment and the output file. These pin what the
// command line uses instead, which no injected test can see (BIN-852).
describe('the command line wiring', () => {
  const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'check-deploy-drift.mjs'), 'utf8');
  const file = ts.createSourceFile('check-deploy-drift.mjs', SOURCE, ts.ScriptTarget.ES2022, true);
  const declared = (name) => {
    const node = file.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name);
    if (!node) throw new Error(`no function ${name} in check-deploy-drift.mjs`);
    return node.getText(file).replace(/\s+/g, ' ');
  };

  test('main reads the real git, gh, environment, output file and record download, and dispatches every mode', () => {
    const body = declared('main');
    for (const fallback of ['git = runGit', 'env = process.env', 'gh = runGh', 'write = appendFileSync', 'download = downloadRecord']) {
      expect(body).toContain(fallback);
    }
    expect(body).toContain(
      "if (argv[0] === '--backend-gate') return gateMain(argv.slice(1), { env, gh, git, log, err, write, download });",
    );
    expect(body).toContain("if (argv[0] === '--site-gate') return siteGateMain({ env, gh, git, log, err });");
    expect(body).toContain(
      "if (argv[0] === '--github-output') return reportMain(argv.slice(1), { git, log, err, write, env, gh, download });",
    );
    expect(SOURCE).toMatch(/^ {2}process\.exit\(main\(process\.argv\.slice\(2\)\)\);$/m);
  });

  test('--since-last-deploy asks GitHub for the runs and the records, and compares with what the last deploy left live', () => {
    const body = declared('sinceLastDeploy');
    expect(body).toContain('gh = runGh');
    expect(body).toContain('download = downloadRecord');
    expect(body).toContain('lastDeployed(gh(deployedRunsPath(repo)), gh(deployedArtifactsPath(repo)), head, {');
    expect(body).toContain('download: (runId, name) => download(repo, runId, name),');
    expect(body).toContain('if (base) return { ...report(base.sha, head, { git, baseRun: base }), base };');
    expect(body).toContain('deploy: EXCEPT_HOSTING');
  });

  test('a record is downloaded by gh into a directory of its own, and its file is read from there', () => {
    const body = declared('downloadRecord');
    expect(body).toContain('const dir = mkdtempSync(join(tmpdir(), RECORD_PREFIX));');
    expect(body).toContain(
      "execFileSync('gh', ['run', 'download', String(runId), '--repo', repo, '--name', name, '--dir', dir], RUN_OPTIONS);",
    );
    expect(body).toContain('return readFileSync(join(dir, RECORD_FILE), \'utf8\');');
    expect(body).toContain('rmSync(dir, { recursive: true, force: true });');
    expect(RECORD_FILE).toBe('deployed-sha');
    expect(RECORD_PREFIX).toBe('backend-deployed-');
  });

  test('the gate asks gh where main points, not the clone, and deploys what that commit needs', () => {
    const gateMainBody = declared('gateMain');
    expect(gateMainBody).toContain('const { problem, target } = gateTarget({ env, gh, git });');
    expect(gateMainBody).toContain('decided = all ? reportAll() : sinceLastDeploy(target, { git, gh, env, download });');
    expect(gateMainBody).toContain('write(outFile, gateOutput(target, decided.deploy));');
    const gate = declared('gateTarget');
    expect(gate).toContain('gh = runGh');
    expect(gate).toContain('tip = mainTip(gh(mainTipPath(repo)));');
    expect(gate).toContain('if (!isAncestor(sha, tip, git)) return { problem: `${short(sha)} finns inte på main` };');
    expect(gate).not.toContain('origin/main');
    expect(declared('mainTipPath')).toContain('`repos/${repo}/git/ref/heads/main`');
    expect(declared('runGh')).toContain("execFileSync('gh', ['api', path]");
  });

  test('both runners read an answer past the default buffer', () => {
    const size = 2 * 1024 * 1024;
    const answer = execFileSync(process.execPath, ['-e', `process.stdout.write('x'.repeat(${size}))`], RUN_OPTIONS);
    expect(typeof answer).toBe('string');
    expect(answer).toHaveLength(size);
    expect(declared('runGit')).toContain("execFileSync('git', args, RUN_OPTIONS)");
    expect(declared('runGh')).toContain("execFileSync('gh', ['api', path], RUN_OPTIONS)");
  });

  test('the site gate asks gh for the runs and refuses a shallow clone', () => {
    expect(declared('siteGateMain')).toContain('siteGateProblem({ env, gh, git })');
    const site = declared('siteGateProblem');
    expect(site).toContain('gh = runGh');
    expect(site).toContain('git = runGit');
    expect(site).toContain("git(['rev-parse', '--is-shallow-repository'])");
    expect(site).toContain('newer = newerDeployedRun(gh(deployedRunsPath(repo)), sha, { git });');
  });

  test('report mode writes what the chosen mode decided', () => {
    const body = declared('reportMain');
    expect(body).toContain('decided = reportAll();');
    expect(body).toContain('decided = sinceLastDeploy(what[1], { git, gh, env, download });');
    expect(body).toContain('decided = report(what[0], what[1], { git });');
    expect(body).toContain('const { deploy, summary } = decided;');
    expect(body).toContain('write(outFile, githubOutput(deploy));');
  });
});

// Read off the workflow itself: what the backend job may touch, and what lets the site
// through (BIN-1426). Text-level, so no YAML parser joins the dependencies. Comment lines
// are dropped first, since several of them name what the steps must never do.
describe('deploy.yml wires the backend deploy safely (BIN-1426)', () => {
  const WORKFLOW = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'deploy.yml'),
    'utf8',
  );
  const lines = WORKFLOW.split(/\r?\n/).filter((line) => !/^\s*#/.test(line));
  const indent = (line) => line.length - line.trimStart().length;
  // The lines after `start` that sit deeper than `level`, blank lines included.
  const deeper = (from, start, level) => {
    const out = [];
    for (const line of from.slice(start + 1)) {
      if (line.trim() !== '' && indent(line) <= level) break;
      out.push(line);
    }
    return out;
  };

  const jobs = {};
  const jobsLine = lines.indexOf('jobs:');
  lines.forEach((line, i) => {
    const header = /^ {2}([\w-]+):\s*$/.exec(line);
    if (header && i > jobsLine) jobs[header[1]] = deeper(lines, i, 2);
  });
  const steps = (job) => {
    const starts = job.flatMap((line, i) => (/^ {6}- /.test(line) ? [i] : []));
    return starts.map((start, n) => job.slice(start, starts[n + 1] ?? job.length).join('\n'));
  };
  // Every `run:` script in the lines given: a `|` or `>` block, or the rest of the line.
  const scripts = (from) =>
    from.flatMap((line, i) => {
      const run = /^(\s*)(- )?run:\s*(.*)$/.exec(line);
      if (!run) return [];
      if (!/^[|>]/.test(run[3])) return [run[3]];
      return [deeper(from, i, run[1].length + (run[2] ? 2 : 0)).join('\n')];
    });

  test('finds the four jobs it checks', () => {
    expect(Object.keys(jobs).sort()).toEqual(['backend', 'checks', 'deploy', 'rules-tests']);
    expect(Object.values(jobs).every((job) => steps(job).length > 0)).toBe(true);
  });

  test('every job reads the repository, and no job may write anything', () => {
    const top = lines.indexOf('permissions:');
    expect(top).toBeGreaterThan(-1);
    expect(deeper(lines, top, 0).filter((l) => l.trim() !== '')).toEqual(['  contents: read']);
    for (const [id, job] of Object.entries(jobs)) {
      const at = job.indexOf('    permissions:');
      if (at === -1) continue;
      const granted = deeper(job, at, 4).map((l) => l.trim()).filter(Boolean);
      expect(granted, id).toContain('contents: read');
      for (const entry of granted) expect(['contents: read', 'actions: read'], `${id}: ${entry}`).toContain(entry);
    }
    // An inline `permissions: write-all` or `permissions: {}` would skip the block reading above.
    for (const line of lines.filter((l) => /^\s*permissions:/.test(l))) expect(line.trim()).toBe('permissions:');
  });

  test('every action comes from actions/', () => {
    const used = lines.flatMap((line) => /^\s*(?:- )?uses:\s*(\S+)/.exec(line)?.[1] ?? []);
    expect(used.length).toBeGreaterThan(0);
    for (const action of used) expect(action).toMatch(/^actions\/[\w.-]+(\/[\w.-]+)*@[\w.-]+$/);
  });

  test('the backend job runs in the backend environment, after the checks and the rules tests', () => {
    const job = jobs.backend;
    expect(job).toContain('    environment: backend');
    expect(job).toContain('    needs: [checks, rules-tests]');
    expect(job).toContain("    if: needs.checks.outputs.deploy != ''");
  });

  // #8's condition 1: nothing restored from a cache runs where the key does.
  test('the backend job restores no cache, and its installs run no install script', () => {
    const text = jobs.backend.join('\n');
    expect(text).not.toMatch(/^\s*cache:/m);
    expect(text).not.toContain('actions/cache');
    // Every npm or npx command before the key step is one of these, so none runs an
    // install script (`npm rebuild` would, for one).
    const backend = steps(jobs.backend);
    const key = backend.findIndex((s) => s.includes('secrets.'));
    const npm = scripts(backend.slice(0, key).join('\n').split('\n')).filter((s) => /\bnp[mx]\b/.test(s));
    expect(npm.length).toBeGreaterThan(0);
    for (const script of npm) {
      expect([
        'npm ci --ignore-scripts',
        'npm run typecheck',
        'npm test',
        'npm i -g firebase-tools@14.27.0 --ignore-scripts',
        'npm run test:rules',
      ]).toContain(script);
    }
  });

  // #8's condition 2. The steps between the gate and the key run main's newer commit when
  // main has moved on: each is named here, so a new one is a decision, not an accident.
  test('the backend gate runs before anything reads the key, and only the deploy step reads it', () => {
    const backend = steps(jobs.backend);
    const gate = backend.findIndex((s) => /^\s+id: gate$/m.test(s));
    const keyed = backend.flatMap((s, i) => (s.includes('secrets.') ? [i] : []));
    const firstInstall = backend.findIndex((s) => s.includes('npm ci --ignore-scripts'));
    expect(firstInstall).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(firstInstall);
    expect(keyed).toHaveLength(1);
    expect(keyed[0]).toBeGreaterThan(gate);
    expect(backend[keyed[0]]).toContain('FIREBASE_BACKEND_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_BACKEND_SERVICE_ACCOUNT }}');
    // The gate runs exactly its command, and neither it nor the key step can be skipped,
    // run after a failure, or have its failure ignored.
    expect(scripts(backend[gate].split('\n'))).toEqual([
      [
        '          if [ "$DEPLOY_ALL" = "true" ]; then',
        '            node scripts/check-deploy-drift.mjs --backend-gate --github-output "$GITHUB_OUTPUT" --github-summary "$GITHUB_STEP_SUMMARY" --all',
        '          else',
        '            node scripts/check-deploy-drift.mjs --backend-gate --github-output "$GITHUB_OUTPUT" --github-summary "$GITHUB_STEP_SUMMARY"',
        '          fi',
        '',
      ].join('\n'),
    ]);
    expect(backend[gate]).toContain('GH_TOKEN: ${{ github.token }}');
    expect(backend[gate]).toContain("DEPLOY_ALL: ${{ github.event_name == 'workflow_dispatch' && inputs.deploy_all_backend }}");
    for (const step of [backend[gate], backend[keyed[0]]]) {
      expect(step).not.toMatch(/^\s*(- )?if:/m);
      expect(step).not.toContain('continue-on-error');
    }
    // Each step's name, the directory it runs in and its whole command.
    const shape = (step) => ({
      name: /^ {6}- (?:name|uses): (.+)$/m.exec(step)?.[1],
      directory: /^ {8}working-directory: (.+)$/m.exec(step)?.[1] ?? null,
      run: scripts(step.split('\n')).map((script) => script.split('\n').map((l) => l.trim()).filter(Boolean).join('\n')),
    });
    const on = (name, run, directory = null) => ({ name, directory, run: run === null ? [] : [run] });
    expect(backend.slice(gate + 1, keyed[0]).map(shape)).toEqual([
      on("Check out main's newer commit", 'git checkout -q --detach "$TARGET"\ntest "$(git rev-parse HEAD)" = "$TARGET"'),
      on("Install the newer commit's deps (no install scripts)", 'npm ci --ignore-scripts'),
      on('Install functions deps (no install scripts)', 'npm ci --ignore-scripts', 'functions'),
      on('Typecheck functions', 'npm run typecheck', 'functions'),
      on('Test the newer commit', 'npm test'),
      on('actions/setup-java@v6', null),
      on('Install Firebase CLI for the rules tests (no install scripts)', 'npm i -g firebase-tools@14.27.0 --ignore-scripts'),
      on('Rules tests on the newer commit', 'npm run test:rules'),
      on(
        'Refuse while an emulator is still running',
        "if pgrep -a java || pgrep -af 'firebase|emulator'; then\necho \"::error::En emulator från testerna kör fortfarande, så nyckeln läses inte.\"\nexit 1\nfi",
      ),
    ]);
    for (const step of backend.slice(0, keyed[0])) {
      expect(step).not.toMatch(/GITHUB_(ENV|PATH)/);
      expect(step).not.toContain('continue-on-error');
      // Skipped only when main has not moved on, never after a failure.
      const condition = /^\s*(?:- )?if:\s*(.+)$/m.exec(step)?.[1];
      if (condition !== undefined) expect(condition).toBe('steps.gate.outputs.target != github.sha');
    }
    // The last step before the key fails while a test's emulator still runs.
    expect(scripts(backend[keyed[0] - 1].split('\n'))).toEqual([
      [
        "          if pgrep -a java || pgrep -af 'firebase|emulator'; then",
        '            echo "::error::En emulator från testerna kör fortfarande, så nyckeln läses inte."',
        '            exit 1',
        '          fi',
        '',
      ].join('\n'),
    ]);
    expect(backend[keyed[0] - 1]).not.toMatch(/^\s*(- )?if:/m);
  });

  // #8's condition 4: the commit the gate picked is the one checked out, tested and deployed;
  // nothing after the gate asks where main points.
  test('the job deploys the commit the gate picked, with the arguments the gate wrote', () => {
    const backend = steps(jobs.backend);
    const checkout = backend.find((s) => s.includes("- name: Check out main's newer commit"));
    expect(checkout).toContain('TARGET: ${{ steps.gate.outputs.target }}');
    expect(scripts(checkout.split('\n'))).toEqual([
      ['          git checkout -q --detach "$TARGET"', '          test "$(git rev-parse HEAD)" = "$TARGET"', ''].join('\n'),
    ]);
    const text = jobs.backend.join('\n');
    expect(text.split('--backend-gate').length - 1).toBe(2);
    expect(text).not.toContain('heads/main');
    expect(jobs.backend.filter((l) => l.includes('needs.checks.outputs.deploy'))).toEqual([
      "    if: needs.checks.outputs.deploy != ''",
    ]);
    expect(jobs.backend.filter((l) => l.includes('DEPLOY_ARGS:'))).toEqual([
      '          DEPLOY_ARGS: ${{ steps.gate.outputs.deploy }}',
      '          DEPLOY_ARGS: ${{ steps.gate.outputs.deploy }}',
    ]);
  });

  test('the backend deploy names the project, takes its arguments from the environment, and forces nothing', () => {
    const text = jobs.backend.join('\n');
    for (const banned of ['--force', '--token', '--debug', 'set -x']) expect(text, banned).not.toContain(banned);
    const deploy = scripts(jobs.backend).filter((s) => s.includes('firebase-tools@15'));
    expect(deploy).toHaveLength(1);
    expect(deploy[0]).toContain('deploy "${ARGS[@]}" --project binge-nu --non-interactive');
    expect(deploy[0]).toContain('read -ra ARGS <<< "$DEPLOY_ARGS"');
    // With nothing to deploy, the step ends before the key is written: a bare
    // `firebase deploy` would deploy the site too.
    const empty = deploy[0].indexOf('if [ -z "$DEPLOY_ARGS" ]; then');
    expect(empty).toBeGreaterThan(-1);
    expect(deploy[0].indexOf('exit 0')).toBeGreaterThan(empty);
    expect(deploy[0].indexOf('exit 0')).toBeLessThan(deploy[0].indexOf('printf \'%s\' "$FIREBASE_BACKEND_SERVICE_ACCOUNT"'));
  });

  // #8's condition 6, the whole script by equality: a `|| true`, a `set +e` or a log
  // path that tee and grep do not share would each let a failed or partial deploy write
  // clean=true, and the record would then name a commit that never went live.
  test('the deploy step runs exactly its script', () => {
    // The script relies on the default shell, bash -e: `shell: bash {0}` or `sh {0}` on the
    // step, the job or the workflow drops -e, and a failed deploy would end green.
    expect(lines.filter((l) => /^\s*(shell|defaults):/.test(l))).toEqual([]);
    const backend = steps(jobs.backend);
    const deploy = backend.find((s) => s.includes('- name: Deploy rules and functions'));
    expect(scripts(deploy.split('\n'))).toEqual([
      [
        "          set -o pipefail",
        "          if [ -z \"$DEPLOY_ARGS\" ]; then",
        "            echo \"Inget i regler och funktioner skiljer sig från det som redan är deployat.\"",
        "            echo \"clean=true\" >> \"$GITHUB_OUTPUT\"",
        "            exit 0",
        "          fi",
        "          if [ -z \"$FIREBASE_BACKEND_SERVICE_ACCOUNT\" ]; then",
        "            echo \"::error::Nyckeln FIREBASE_BACKEND_SERVICE_ACCOUNT saknas i miljön backend. Deploya för hand med firebase deploy $DEPLOY_ARGS --project binge-nu och kör sedan Run workflow med backend_deployed_by_hand.\"",
        "            exit 1",
        "          fi",
        "          read -ra ARGS <<< \"$DEPLOY_ARGS\"",
        "          SA=\"$RUNNER_TEMP/firebase-backend-sa.json\"",
        "          trap 'rm -f \"$SA\"' EXIT",
        "          printf '%s' \"$FIREBASE_BACKEND_SERVICE_ACCOUNT\" > \"$SA\"",
        "          export GOOGLE_APPLICATION_CREDENTIALS=\"$SA\"",
        "          npx --yes firebase-tools@15.22.3 deploy \"${ARGS[@]}\" --project binge-nu --non-interactive 2>&1 | tee \"$RUNNER_TEMP/backend-deploy.log\"",
        "          if grep -qF \"Skipping updates for functions that may be unsafe to update\" \"$RUNNER_TEMP/backend-deploy.log\"; then",
        "            echo \"::warning::firebase hoppade över funktioner vars utlösare byter händelsetyp. Deploya dem för hand med firebase deploy --only functions --project binge-nu.\"",
        "            echo \"> **Varning:** firebase hoppade över funktioner vars utlösare byter händelsetyp. Deploya dem för hand med \\`firebase deploy --only functions --project binge-nu\\`, som frågar innan den flyttar dem.\" >> \"$GITHUB_STEP_SUMMARY\"",
        "          else",
        "            echo \"clean=true\" >> \"$GITHUB_OUTPUT\"",
        "          fi",
        '',
      ].join('\n'),
    ]);
  });

  // #8's condition 5: the record moves where the next comparison starts, so it is written
  // only when main's newer commit is live as it stands: deployed with nothing skipped, or
  // nothing to deploy.
  test('the record is uploaded only after a clean deploy of a newer main, and holds that commit', () => {
    const deploy = scripts(jobs.backend).find((s) => s.includes('firebase-tools@15'));
    const clean = 'echo "clean=true" >> "$GITHUB_OUTPUT"';
    expect(deploy.split(clean).length - 1).toBe(2);
    // Once in the nothing-to-deploy branch, once in the else of the skipped-functions check.
    expect(deploy.indexOf(clean)).toBeLessThan(deploy.indexOf('exit 0'));
    const skipped = deploy.indexOf('if grep -qF "Skipping updates for functions that may be unsafe to update"');
    // The branches are cut at whole lines: the warning text itself contains "else".
    const otherwise = deploy.indexOf('\n          else\n', skipped);
    const done = deploy.indexOf('\n          fi\n', otherwise);
    expect(skipped).toBeGreaterThan(-1);
    expect(otherwise).toBeGreaterThan(skipped);
    expect(done).toBeGreaterThan(otherwise);
    expect(deploy.slice(skipped, otherwise)).not.toContain('clean=true');
    expect(deploy.slice(otherwise, done)).toContain(clean);
    expect(deploy.lastIndexOf(clean)).toBeLessThan(done);
    // Without pipefail a failed firebase deploy piped into tee exits 0, reaches the else and
    // writes the record: the step's shell is bash -e, which reads only tee's exit code.
    expect(deploy).toMatch(/^ {10}set -o pipefail$/m);
    expect(deploy.search(/^ {10}set -o pipefail$/m)).toBeLessThan(deploy.indexOf('| tee'));

    const backend = steps(jobs.backend);
    const when = "        if: steps.gate.outputs.target != github.sha && steps.backend-deploy.outputs.clean == 'true'";
    const writes = backend.find((s) => s.includes('- name: Write down the commit the job deployed'));
    const upload = backend.find((s) => s.includes('uses: actions/upload-artifact@'));
    for (const step of [writes, upload]) expect(step.split('\n')).toContain(when);
    expect(writes).toContain('TARGET: ${{ steps.gate.outputs.target }}');
    expect(scripts(writes.split('\n'))).toEqual([
      [
        '          mkdir -p "$RUNNER_TEMP/backend-deployed"',
        `          printf '%s\\n' "$TARGET" > "$RUNNER_TEMP/backend-deployed/${RECORD_FILE}"`,
        '',
      ].join('\n'),
    ]);
    expect(upload).toContain(`          name: ${RECORD_PREFIX}\${{ steps.gate.outputs.target }}`);
    expect(upload).toContain(`          path: \${{ runner.temp }}/backend-deployed/${RECORD_FILE}`);
    expect(upload).toContain('          if-no-files-found: error');
    expect(upload).toContain('          retention-days: 90');
    expect(backend.indexOf(writes)).toBeGreaterThan(backend.findIndex((s) => s.includes('id: backend-deploy')));
    expect(backend.indexOf(upload)).toBe(backend.indexOf(writes) + 1);
    // Nothing else in the workflows uploads an artifact a reader could mistake for one.
    expect(lines.filter((l) => l.includes('upload-artifact'))).toHaveLength(1);
  });

  // #8's condition 8.
  test('a failure before the deploy says that nothing was deployed, the run\'s own commit included', () => {
    const backend = steps(jobs.backend);
    const said = backend.find((s) => s.includes('- name: Say that nothing was deployed'));
    expect(said).toContain("        if: failure() && steps.gate.outcome == 'success' && steps.backend-deploy.outcome == 'skipped'");
    expect(scripts(said.split('\n'))[0]).toContain(
      'varken main på ${TARGET:0:12} eller körningens egen commit ${RUN_SHA:0:12}',
    );
  });

  test('the backend key is read in that one step, and the hosting key never in the backend job', () => {
    const everywhere = lines.join('\n').split('secrets.FIREBASE_BACKEND_SERVICE_ACCOUNT').length - 1;
    expect(everywhere).toBe(1);
    expect(jobs.backend.join('\n')).not.toContain('secrets.FIREBASE_SERVICE_ACCOUNT');
  });

  test('no expression is expanded inside a script', () => {
    const all = scripts(lines);
    expect(all.length).toBeGreaterThan(0);
    for (const script of all) expect(script).not.toContain('${{');
  });

  test('the report step fails the checks job when it fails, and the site requires its answer', () => {
    const report = steps(jobs.checks).find((s) => s.includes('id: backend-changes'));
    expect(report).toBeDefined();
    expect(report).not.toContain('continue-on-error');
    expect(report).toContain('GH_TOKEN: ${{ github.token }}');
    expect(report).toContain('--github-output "$GITHUB_OUTPUT"');
    expect(jobs.checks).toContain('      deploy: ${{ steps.backend-changes.outputs.deploy }}');
    expect(jobs.checks).toContain('      checked: ${{ steps.backend-changes.outputs.checked }}');
    expect(jobs.deploy).toContain('    needs: [checks, rules-tests, backend]');
    expect(jobs.deploy.find((l) => l.startsWith('    if: '))).toBe(
      "    if: ${{ !cancelled() && needs.checks.result == 'success' && needs.rules-tests.result == 'success' && (needs.backend.result == 'success' || needs.backend.result == 'skipped') && (needs.checks.outputs.checked == 'true' || (github.event_name == 'workflow_dispatch' && inputs.backend_deployed_by_hand)) }}",
    );
  });

  test('continue-on-error sits only on the steps allowed to fail', () => {
    const marked = [];
    for (const [id, job] of Object.entries(jobs)) {
      for (const line of job.filter((l) => l.includes('continue-on-error'))) {
        expect(line, id).toMatch(/^ {8}continue-on-error: true$/);
      }
      for (const step of steps(job).filter((s) => s.includes('continue-on-error'))) {
        marked.push(`${id}: ${/^ {6}- name: (.+)$/m.exec(step)?.[1]}`);
      }
    }
    expect(marked).toEqual([
      'checks: Reviewer knowledge-file caps (warning only)',
      'checks: Process tests (warning only)',
      'deploy: First Load JS-rapport (rapporterar, fäller aldrig)',
      'deploy: Save TMDB build cache',
    ]);
  });

  test('the hosting job checks for a newer deployed run before it builds, on full history', () => {
    const hosting = steps(jobs.deploy);
    const gate = hosting.findIndex((s) => s.includes('node scripts/check-deploy-drift.mjs --site-gate'));
    const build = hosting.findIndex((s) => /^ {6}- name: Build$/m.test(s));
    expect(gate).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(gate);
    expect(hosting[gate]).toContain('GH_TOKEN: ${{ github.token }}');
    expect(scripts(hosting[gate].split('\n'))).toEqual(['node scripts/check-deploy-drift.mjs --site-gate']);
    // Neither the gate nor the step that deploys the site can be skipped, run after a
    // failure, or have its failure ignored.
    const keyed = hosting.flatMap((s, i) => (s.includes('secrets.FIREBASE_SERVICE_ACCOUNT') ? [i] : []));
    expect(keyed).toHaveLength(1);
    expect(keyed[0]).toBeGreaterThan(build);
    for (const step of [hosting[gate], hosting[keyed[0]]]) {
      expect(step).not.toMatch(/^\s*(- )?if:/m);
      expect(step).not.toContain('continue-on-error');
    }
    const checkouts = hosting.filter((s) => s.includes('uses: actions/checkout@'));
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0]).toContain('fetch-depth: 0');
    expect(jobs.deploy).toContain('      actions: read');
  });

  // The gate and `checks` ask GitHub for runs and records; without the permission the call
  // is refused and the step exits 1.
  test('the backend and checks jobs keep actions: read and the backend checkout keeps its history', () => {
    expect(jobs.backend).toContain('      actions: read');
    expect(jobs.checks).toContain('      actions: read');
    const checkouts = steps(jobs.backend).filter((s) => s.includes('uses: actions/checkout@'));
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0]).toContain('fetch-depth: 0');
  });
});
