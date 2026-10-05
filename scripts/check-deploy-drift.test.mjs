// Self-test for the deploy workflow's rules/functions check, its report mode and the
// approval gate (BIN-1426).
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
  approvalProblem,
  staleProblem,
  gateProblem,
  mainTip,
  siteGateProblem,
  lastDeployedRun,
  newerDeployedRun,
  deployedRunsPath,
  orderWarnings,
  EXCEPT_HOSTING,
  RUN_OPTIONS,
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

    test('a push with nothing deployable asks for no approval', () => {
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
      expect(files.SUM).toContain('Deployas efter godkännande: firebase deploy --only firestore:rules,functions');
    });

    test('a comparison that throws deploys everything but hosting, behind the approval', () => {
      const { code, files } = report('0123456789abcdef0123456789abcdef01234567', base);
      expect(code).toBe(0);
      expect(files.OUT).toBe(`deploy=${EXCEPT_HOSTING}\nchecked=true\n`);
      expect(files.SUM).toContain('Kunde inte jämföra med 0123456789ab');
      expect(files.SUM).toContain(
        'kunde inte läsa om .github/, firebase.json eller .firebaserc ändrats. Läs ändringen innan du godkänner.',
      );
    });

    test('a change to the workflow or firebase.json is named before the approval', () => {
      onBase();
      write('.github/workflows/deploy.yml', 'name: x\n');
      write('firebase.json', JSON.stringify({ firestore: { rules: 'firestore.rules' } }));
      const { files } = report(base, commit('machinery'));
      expect(files.OUT).toBe(`deploy=${EXCEPT_HOSTING}\nchecked=true\n`);
      expect(files.SUM).toContain(
        'Varning:** ändringen rör också hur deployen går till: .github/workflows/deploy.yml, firebase.json. Läs ändringen innan du godkänner.',
      );
    });

    test('a workflow change with nothing to deploy is named, and asks for no approval', () => {
      onBase();
      write('.github/workflows/deploy.yml', 'name: x\n');
      const { files } = report(base, commit('workflow only'));
      expect(files.OUT).toBe('deploy=\nchecked=true\n');
      expect(files.SUM).toContain('Varning:** ändringen rör också hur deployen går till: .github/workflows/deploy.yml.');
      expect(files.SUM).not.toContain('godkänn');
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
    const runs = (...list) => JSON.stringify({ workflow_runs: list });
    const ok = (sha, number, created) => ({ head_sha: sha, head_branch: 'main', run_number: number, conclusion: 'success', created_at: created });
    const since = (after, gh, env = ENV) => {
      const files = {};
      const out = [];
      const code = main(['--github-output', 'OUT', '--github-summary', 'SUM', '--since-last-deploy', after], {
        git,
        env,
        gh,
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
      const gh = (path) => {
        asked.push(path);
        return runs(ok(base, 7, '2026-10-01T00:00:00Z'));
      };
      const { code, files } = since(head, gh);
      expect(code).toBe(0);
      expect(asked).toEqual(['repos/Malingisslen/binge/actions/workflows/deploy.yml/runs?per_page=100']);
      expect(files.OUT).toBe('deploy=--only firestore:rules\nchecked=true\n');
      expect(files.SUM).toContain(`Ändrat sedan körning #7 (${base.slice(0, 12)}):`);
    });

    test('the newest successful run in the history is the base, in whatever order GitHub lists them', () => {
      onBase();
      write('firestore.rules', RULES.replace('request.auth != null', 'false'));
      const deployed = commit('rules, deployed by run 8');
      write('README.md', 'the next push\n');
      const head = commit('docs');
      const gh = () => runs(ok(base, 7, '2026-10-01T00:00:00Z'), ok(deployed, 8, '2026-10-02T00:00:00Z'));
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
      const gh = () =>
        runs(ok(side, 9, '2026-10-03T00:00:00Z'), ok('f'.repeat(40), 10, '2026-10-04T00:00:00Z'), ok(base, 7, '2026-10-01T00:00:00Z'));
      const { files } = since(head, gh);
      expect(files.OUT).toBe('deploy=--only firestore:rules\nchecked=true\n');
      expect(files.SUM).toContain('körning #7');
    });

    test('no successful run in the history deploys everything but hosting, behind the approval', () => {
      onBase();
      write('README.md', 'docs only\n');
      const head = commit('docs');
      const notUsable = [
        { head_sha: base, head_branch: 'main', run_number: 7, conclusion: 'failure', created_at: '2026-10-01T00:00:00Z' },
        { head_sha: 'main', head_branch: 'main', run_number: 8, conclusion: 'success', created_at: '2026-10-02T00:00:00Z' },
        { head_sha: base, head_branch: 'feature', run_number: 9, conclusion: 'success', created_at: '2026-10-03T00:00:00Z' },
      ];
      for (const answer of [runs(), runs(...notUsable)]) {
        const { code, files } = since(head, () => answer);
        expect(code).toBe(0);
        expect(files.OUT).toBe(`deploy=${EXCEPT_HOSTING}\nchecked=true\n`);
        expect(files.SUM).toContain(
          'Hittade ingen lyckad körning på main bland de 100 senaste vars commit finns i den här historiken, så allt utom webbplatsen deployas.',
        );
      }
    });

    // An empty list is an answer; these are not, and none of them may read as "nothing to deploy".
    test('a GitHub that cannot be asked or answers garbage fails the step and writes nothing', () => {
      const head = git(['rev-parse', 'HEAD']).trim();
      const failing = () => {
        throw new Error('HTTP 403');
      };
      for (const gh of [failing, () => '<html>', () => '{"message":"Not Found"}']) {
        const { code, out, files } = since(head, gh);
        expect(code).toBe(1);
        expect(files).toEqual({});
        expect(out).toContain('::error::Kunde inte avgöra vad som ska deployas');
      }
    });

    test('a missing repository or an unresolvable commit fails the step and writes nothing', () => {
      const gh = () => runs(ok(base, 7, '2026-10-01T00:00:00Z'));
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

  // A re-run of an older run must not deploy older rules over the ones a newer run shipped.
  describe('staleProblem', () => {
    const twoCommits = (second) => {
      onBase();
      write('firestore.rules', RULES.replace('request.auth != null', 'false'));
      const first = commit('rules');
      second();
      return [first, commit('later')];
    };

    test('the commit main points at is current', () => {
      expect(staleProblem(base, base, { git })).toBeNull();
    });

    test('a newer main that changes nothing the backend deploy ships is current', () => {
      const [first, later] = twoCommits(() => write('README.md', 'later\n'));
      expect(staleProblem(first, later, { git })).toBeNull();
    });

    test('a newer main whose rules differ only in a comment is current', () => {
      const [first, later] = twoCommits(() =>
        write('firestore.rules', RULES.replace('request.auth != null', 'false').replace('// who may read', '// nobody')),
      );
      expect(staleProblem(first, later, { git })).toBeNull();
    });

    test('a newer main with other rules would be rolled back', () => {
      const [first, later] = twoCommits(() => write('firestore.rules', RULES.replace('request.auth != null', 'true')));
      expect(staleProblem(first, later, { git })).toMatch(
        new RegExp(
          `har gått vidare till ${later.slice(0, 12)}, som ändrar firestore\\.rules\\. .*godkänn körningen för den nyare commiten`,
        ),
      );
    });

    test('a commit that is not on main is refused', () => {
      onBase();
      write('README.md', 'side\n');
      const side = commit('side');
      onBase();
      write('README.md', 'main\n');
      expect(staleProblem(side, commit('main'), { git })).toMatch(/finns inte på/);
    });

    test('a main commit this run has not fetched is refused, with the re-run that fetches it', () => {
      expect(staleProblem(base, 'f'.repeat(40), { git })).toBe(
        'main pekar på ffffffffffff, som den här körningen inte har hämtat. Kör om jobbet med Re-run failed jobs',
      );
    });

    // The checkout may point origin/main at the commit it checked out, and then a re-run of
    // an older run finds origin/main at its own commit. The gate asks GitHub where main
    // points instead (#25's condition, BIN-1426); this pins it against exactly that clone.
    test('the gate refuses a re-run whose rules main has since replaced, whatever origin/main says', () => {
      const [first, later] = twoCommits(() => write('firestore.rules', RULES.replace('request.auth != null', 'true')));
      git(['checkout', '-q', '--detach', first]);
      git(['update-ref', 'refs/remotes/origin/main', first]);
      const env = { GITHUB_REF: 'refs/heads/main', GITHUB_SHA: first, GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '1' };
      const github = (tip) => (path) => {
        if (path === 'repos/o/r/actions/runs/1/approvals') {
          return JSON.stringify([{ state: 'approved', environments: [{ name: 'backend' }] }]);
        }
        if (path === 'repos/o/r/git/ref/heads/main') {
          return JSON.stringify({ ref: 'refs/heads/main', object: { sha: tip, type: 'commit' } });
        }
        throw new Error(`unexpected gh ${path}`);
      };
      expect(gateProblem({ env, gh: github(later), git })).toMatch(
        new RegExp(`har gått vidare till ${later.slice(0, 12)}, som ändrar firestore\\.rules\\. Den här körningen skulle backa det`),
      );
      expect(gateProblem({ env, gh: github(first), git })).toBeNull();
      const quiet = { log: () => {}, err: () => {} };
      expect(main(['--approval-gate'], { env, gh: github(later), git, ...quiet })).toBe(1);
      expect(main(['--approval-gate'], { env, gh: github(first), git, ...quiet })).toBe(0);
    });

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

describe('lastDeployedRun', () => {
  const [A, B, C] = ['a', 'b', 'c'].map((c) => c.repeat(40));
  const inHistory = new Set([A, B, 'main']);
  const git = ([, , sha]) => {
    if (!inHistory.has(sha)) throw new Error('exit 1');
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

  // Each run that must lose is removed by one filter or by the sort: a failure, a commit named
  // by a branch name, a commit outside the history, a run on another branch, and the older A.
  test('takes the newest successful run on main with a full commit id in the history', () => {
    const raw = runs(
      run(A, 1, '2026-10-01T00:00:00Z'),
      run(B, 2, '2026-10-02T00:00:00Z'),
      run('main', 3, '2026-10-03T00:00:00Z'),
      run(C, 4, '2026-10-04T00:00:00Z'),
      run(B, 5, '2026-10-05T00:00:00Z', 'failure'),
      run(A, 6, '2026-10-06T00:00:00Z', 'success', 'feature'),
    );
    expect(lastDeployedRun(raw, 'HEAD', { git })).toEqual({ sha: B, number: 2 });
  });

  // Unfiltered on purpose: GitHub's list filtered by branch and status was stale for this
  // repository (deployedRunsPath says how to see it). successfulRuns filters instead.
  test('asks GitHub for the newest runs without a filter', () => {
    expect(deployedRunsPath('o/r')).toBe('repos/o/r/actions/workflows/deploy.yml/runs?per_page=100');
  });

  test('answers null when no run qualifies, and throws on an answer that is not a run list', () => {
    expect(lastDeployedRun(runs(run(C, 4, '2026-10-04T00:00:00Z')), 'HEAD', { git })).toBeNull();
    expect(() => lastDeployedRun('<html>', 'HEAD', { git })).toThrow('JSON');
    expect(() => lastDeployedRun('{"message":"Not Found"}', 'HEAD', { git })).toThrow('lista');
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

describe('approvalProblem', () => {
  const entry = (state, ...names) => ({ state, environments: names.map((name) => ({ name })) });
  const answer = (...entries) => JSON.stringify(entries);

  test('an approval for backend lets the run deploy', () => {
    expect(approvalProblem(answer(entry('approved', 'backend')))).toBeNull();
    expect(approvalProblem(answer(entry('approved', 'backend'), entry('approved', 'backend')))).toBeNull();
    expect(approvalProblem(answer(entry('approved', 'other', 'backend')))).toBeNull();
  });

  test('no approval, or one for another environment only, is refused', () => {
    const NOBODY = 'ingen har godkänt backend i den här körningen';
    expect(approvalProblem(answer())).toBe(NOBODY);
    expect(approvalProblem(answer(entry('approved', 'production')))).toBe(NOBODY);
    expect(approvalProblem(answer({ state: 'approved', environments: null }))).toBe(NOBODY);
  });

  test('a rejection is refused, even beside a later approval', () => {
    expect(approvalProblem(answer(entry('rejected', 'backend')))).toMatch(/svaret 'rejected' för backend/);
    expect(approvalProblem(answer(entry('rejected', 'backend'), entry('approved', 'backend')))).toMatch(/'rejected'/);
    expect(approvalProblem(answer(entry('approved', 'backend'), entry('pending', 'backend')))).toMatch(/'pending'/);
  });

  test('an answer that is not a list of approvals is refused', () => {
    expect(approvalProblem('<html>')).toBe('GitHub svarade inte med JSON om godkännanden');
    expect(approvalProblem('{"message":"Not Found"}')).toBe('GitHub svarade inte med en lista över godkännanden');
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

describe('gateProblem', () => {
  const SHA = 'a'.repeat(40);
  const ENV = { GITHUB_REF: 'refs/heads/main', GITHUB_SHA: SHA, GITHUB_REPOSITORY: 'Malingisslen/binge', GITHUB_RUN_ID: '42' };
  const APPROVALS = 'repos/Malingisslen/binge/actions/runs/42/approvals';
  const TIP = 'repos/Malingisslen/binge/git/ref/heads/main';
  const APPROVED = JSON.stringify([{ state: 'approved', environments: [{ name: 'backend' }] }]);
  const tipAt = (sha) => JSON.stringify({ ref: 'refs/heads/main', object: { sha, type: 'commit' } });
  // GitHub's answers by path; an Error is thrown, and any other path is a call the gate
  // should not make.
  const github = (answers) => (path) => {
    if (!(path in answers)) throw new Error(`unexpected gh ${path}`);
    if (answers[path] instanceof Error) throw answers[path];
    return answers[path];
  };
  const approvedAt = (tip) => github({ [APPROVALS]: APPROVED, [TIP]: tipAt(tip) });
  // HEAD at `head`; anything else is a call the gate should not make.
  const gitAt = (head) => (args) => {
    if (args.join(' ') === 'rev-parse HEAD') return `${head}\n`;
    throw new Error(`unexpected git ${args.join(' ')}`);
  };

  test('an approved run of the commit main points at may deploy, asking GitHub for the approvals and for main', () => {
    const asked = [];
    const answer = approvedAt(SHA);
    const gh = (path) => {
      asked.push(path);
      return answer(path);
    };
    expect(gateProblem({ env: ENV, gh, git: gitAt(SHA) })).toBeNull();
    expect(asked).toEqual([APPROVALS, TIP]);
  });

  test.each(['refs/heads/feature', 'refs/pull/1/merge', 'refs/tags/v1', undefined])('a run for %s is refused', (ref) => {
    expect(gateProblem({ env: { ...ENV, GITHUB_REF: ref }, gh: approvedAt(SHA), git: gitAt(SHA) })).toMatch(
      /inte refs\/heads\/main/,
    );
  });

  test('a commit id that is not one is refused', () => {
    expect(gateProblem({ env: { ...ENV, GITHUB_SHA: 'main' }, gh: approvedAt(SHA), git: gitAt(SHA) })).toBe(
      'GITHUB_SHA är inget commit-id',
    );
  });

  test('a missing or malformed repository or run id is refused', () => {
    const gate = (env) => gateProblem({ env: { ...ENV, ...env }, gh: approvedAt(SHA), git: gitAt(SHA) });
    expect(gate({ GITHUB_REPOSITORY: undefined })).toBe('GITHUB_REPOSITORY eller GITHUB_RUN_ID saknas');
    expect(gate({ GITHUB_RUN_ID: '42/../../x' })).toBe('GITHUB_REPOSITORY eller GITHUB_RUN_ID saknas');
  });

  test('a checkout of another commit is refused', () => {
    expect(gateProblem({ env: ENV, gh: approvedAt(SHA), git: gitAt('b'.repeat(40)) })).toMatch(/utcheckade commiten bbbb/);
  });

  test('an approvals call that fails is refused', () => {
    const gh = github({ [APPROVALS]: new Error('HTTP 403') });
    expect(gateProblem({ env: ENV, gh, git: gitAt(SHA) })).toBe('frågan till GitHub om godkännanden misslyckades: HTTP 403');
  });

  // Without the approval, main is not asked about: the stub throws on that path.
  test('a run without an approval for backend is refused', () => {
    expect(gateProblem({ env: ENV, gh: github({ [APPROVALS]: '[]' }), git: gitAt(SHA) })).toBe(
      'ingen har godkänt backend i den här körningen',
    );
  });

  test('a main GitHub cannot name is refused', () => {
    for (const answer of [new Error('HTTP 404'), '<html>', tipAt('main')]) {
      const gh = github({ [APPROVALS]: APPROVED, [TIP]: answer });
      expect(gateProblem({ env: ENV, gh, git: gitAt(SHA) })).toMatch(/^frågan till GitHub om main misslyckades: /);
    }
  });

  test('a commit that is not on main is refused', () => {
    const MAIN = 'c'.repeat(40);
    const git = (args) => {
      if (args[0] === 'merge-base') throw new Error('not an ancestor');
      if (args.join(' ') === `rev-parse --verify --quiet ${MAIN}^{commit}`) return `${MAIN}\n`;
      return gitAt(SHA)(args);
    };
    expect(gateProblem({ env: ENV, gh: approvedAt(MAIN), git })).toBe(`${SHA.slice(0, 12)} finns inte på main`);
  });

  // The exit code is what stops the job; a refusal that is only printed lets the key step run.
  test('through main, a refusal exits 1 with its reason and an approved run exits 0', () => {
    const gate = (gh) => {
      const out = [];
      const errors = [];
      const code = main(['--approval-gate'], {
        env: ENV,
        gh,
        git: gitAt(SHA),
        log: (l) => out.push(l),
        err: (l) => errors.push(l),
      });
      return { code, out, errors };
    };
    expect(gate(github({ [APPROVALS]: '[]' }))).toEqual({
      code: 1,
      out: [],
      errors: ['::error::Regler och funktioner deployas inte: ingen har godkänt backend i den här körningen.'],
    });
    expect(gate(approvedAt(SHA))).toEqual({
      code: 0,
      out: ['Godkänt för backend i den här körningen, på main, och main har ingen nyare backendändring.'],
      errors: [],
    });
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

  test('main reads the real git, gh, environment and output file, and dispatches every mode', () => {
    const body = declared('main');
    for (const fallback of ['git = runGit', 'env = process.env', 'gh = runGh', 'write = appendFileSync']) {
      expect(body).toContain(fallback);
    }
    expect(body).toContain("if (argv[0] === '--approval-gate') return gateMain({ env, gh, git, log, err });");
    expect(body).toContain("if (argv[0] === '--site-gate') return siteGateMain({ env, gh, git, log, err });");
    expect(body).toContain(
      "if (argv[0] === '--github-output') return reportMain(argv.slice(1), { git, log, err, write, env, gh });",
    );
    expect(SOURCE).toMatch(/^ {2}process\.exit\(main\(process\.argv\.slice\(2\)\)\);$/m);
  });

  test('--since-last-deploy asks GitHub for the runs and compares with the newest successful run on main in the history', () => {
    const body = declared('sinceLastDeploy');
    expect(body).toContain('gh = runGh');
    expect(body).toContain('lastDeployedRun(gh(deployedRunsPath(repo)), head, { git })');
    expect(body).toContain('if (run) return report(run.sha, head, { git, baseRun: run });');
    expect(body).toContain('deploy: EXCEPT_HOSTING');
  });

  test('the gate asks gh for the approvals and for where main points, not the clone', () => {
    expect(declared('gateMain')).toContain('gateProblem({ env, gh, git })');
    const gate = declared('gateProblem');
    expect(gate).toContain('gh = runGh');
    expect(gate).toContain('tip = mainTip(gh(mainTipPath(repo)));');
    expect(gate).toContain('return staleProblem(sha, tip, { git });');
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
    expect(body).toContain('decided = sinceLastDeploy(what[1], { git, gh, env });');
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

  test('the backend job restores no cache, and its npm installs run no install script', () => {
    const text = jobs.backend.join('\n');
    expect(text).not.toMatch(/^\s*cache:/m);
    expect(text).not.toContain('actions/cache');
    const installs = scripts(jobs.backend).filter((s) => /\bnpm\b/.test(s));
    expect(installs.length).toBeGreaterThan(0);
    for (const script of installs) expect(script).toMatch(/^npm ci --ignore-scripts$/);
  });

  test('the approval gate runs before anything reads the key, and only the deploy step reads it', () => {
    const backend = steps(jobs.backend);
    const gate = backend.findIndex((s) => s.includes('node scripts/check-deploy-drift.mjs --approval-gate'));
    const keyed = backend.flatMap((s, i) => (s.includes('secrets.') ? [i] : []));
    const firstInstall = backend.findIndex((s) => s.includes('npm ci --ignore-scripts'));
    expect(firstInstall).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(firstInstall);
    expect(keyed).toHaveLength(1);
    expect(keyed[0]).toBeGreaterThan(gate);
    expect(backend[keyed[0]]).toContain('FIREBASE_BACKEND_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_BACKEND_SERVICE_ACCOUNT }}');
    // The gate runs exactly its command, and neither it nor the key step can be skipped,
    // run after a failure, or have its failure ignored.
    expect(scripts(backend[gate].split('\n'))).toEqual(['node scripts/check-deploy-drift.mjs --approval-gate']);
    for (const step of [backend[gate], backend[keyed[0]]]) {
      expect(step).not.toMatch(/^\s*(- )?if:/m);
      expect(step).not.toContain('continue-on-error');
    }
    // Every step between the gate and the key installs the functions dependencies, nothing else.
    for (const between of backend.slice(gate + 1, keyed[0])) {
      expect(scripts(between.split('\n'))).toEqual(['npm ci --ignore-scripts']);
    }
  });

  test('the backend key is read in that one step, and the hosting key never in the backend job', () => {
    const everywhere = lines.join('\n').split('secrets.FIREBASE_BACKEND_SERVICE_ACCOUNT').length - 1;
    expect(everywhere).toBe(1);
    expect(jobs.backend.join('\n')).not.toContain('secrets.FIREBASE_SERVICE_ACCOUNT');
  });

  test('the backend deploy names the project, takes its arguments from the environment, and forces nothing', () => {
    const text = jobs.backend.join('\n');
    for (const banned of ['--force', '--token', '--debug', 'set -x']) expect(text, banned).not.toContain(banned);
    const deploy = scripts(jobs.backend).filter((s) => s.includes('firebase-tools'));
    expect(deploy).toHaveLength(1);
    expect(deploy[0]).toContain('deploy "${ARGS[@]}" --project binge-nu --non-interactive');
    expect(deploy[0]).toContain('read -ra ARGS <<< "$DEPLOY_ARGS"');
    expect(text).toContain('DEPLOY_ARGS: ${{ needs.checks.outputs.deploy }}');
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
});
