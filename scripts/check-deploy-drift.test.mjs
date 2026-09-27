// Self-test for the deploy workflow's rules/functions guard.
//
// Run: npm test
//
// Both directions are pinned against a REAL git repository built in a temp dir:
// a comment-only push must go green, and a real rules or functions change must
// stay red. The fail-closed cases are pinned just as hard — "could not compare"
// must never share an exit code with "nothing changed".

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import ts from 'typescript';
import { normalizeRules, transpileForComparison, globToRegExp, main } from './check-deploy-drift.mjs';

const OPTIONS = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };

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

describe('main against a real git repository', () => {
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
    // A refusal tells the operator what to do, as a real change does.
    expect(out).toContain('firebase deploy --only firestore:rules');
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
    expect(out).toContain('firebase deploy --only firestore:rules');
  });

  test('a real function change stays red, even when the same push also edits a comment', () => {
    onBase();
    write('functions/src/send.ts', SRC.replace('n * 2', 'n * 3').replace('sends', 'sends (tripled)'));
    const { code, out } = run(base, commit('triple'));
    expect(code).toBe(1);
    expect(out).toContain('functions/src/send.ts  (compiled code changed)');
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
});
