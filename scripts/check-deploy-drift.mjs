/**
 * The deploy workflow ships hosting only. `firestore.rules` and `functions/` are
 * deployed by hand, so a push that changes what those deploy must fail loudly —
 * otherwise production keeps running the old rules or functions without anyone
 * noticing. That part is unchanged.
 *
 * What this adds: a push whose change to those paths CANNOT reach production —
 * a comment in the rules, a comment or a type in a function source file, a test
 * file the functions build excludes — no longer fails the hosting deploy. Before
 * this the guard compared file NAMES, so a comment-only push needed the manual
 * "Run workflow" detour.
 *
 * The kinds of change let through are these, and each is COMPARED, not assumed:
 *   · `firestore.rules`, modified: equal once comments are removed and whitespace
 *     outside strings is collapsed.
 *   · `functions/src/**\/*.ts`, modified: equal once transpiled with comments
 *     removed, and exporting the same names — or matched by the build's own
 *     `exclude` in functions/tsconfig.json
 *     and not found by `isImported`.
 *   · `firebase.json`, modified: equal once the keys in FIREBASE_JSON_UNDEPLOYED_KEYS
 *     are removed. Any other key, known or not, is compared.
 * Everything else under those paths is a real change without further thought:
 * added, deleted or renamed files, manifests, lockfiles, tsconfig, functions/scripts.
 *
 * FAIL CLOSED. "I could not compare" exits 1, exactly like "they differ". An
 * unresolvable revision, a source that does not parse, an unterminated string or
 * comment, or any other throw is red.
 */

import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const RULES = 'firestore.rules';
const FUNCTIONS = 'functions/';
const FUNCTIONS_SRC = 'functions/src/';
const FUNCTIONS_TSCONFIG = 'functions/tsconfig.json';
const FIREBASE_JSON = 'firebase.json';
// The firebase.json keys a manual deploy never reads. Every key NOT listed here is
// compared, so a key this check has never seen (storage, database, extensions, one
// Firebase adds later) counts as drift rather than slipping through.
const FIREBASE_JSON_UNDEPLOYED_KEYS = [
  // Deployed by this workflow itself, not by hand.
  'hosting',
  // Read only by the local emulator suite; no deploy target consumes it.
  'emulators',
];

function runGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function assertRefReachable(ref, { git = runGit } = {}) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    throw new Error(`cannot resolve '${ref}' — refusing to call the push harmless without reading it`);
  }
}

/**
 * `--no-renames` so a rename arrives as a delete plus an add, both real changes.
 * `-z` so a path is never split on whitespace.
 */
export function listChanges(before, after, { git = runGit } = {}) {
  const out = git(['diff', '--name-status', '--no-renames', '-z', before, after, '--', RULES, FUNCTIONS, FIREBASE_JSON]);
  const parts = out.split('\0').filter((p) => p !== '');
  if (parts.length % 2 !== 0) throw new Error('could not parse git diff --name-status output');
  const changes = [];
  for (let i = 0; i < parts.length; i += 2) changes.push({ status: parts[i], path: parts[i + 1] });
  return changes;
}

/**
 * Removes `//` and `/* *\/` comments and collapses whitespace, leaving every
 * string literal byte-for-byte as written — a `//` inside a string is not a
 * comment. Throws on an unterminated string or block comment, since a half-read
 * file is not "equal".
 */
export function normalizeRules(text) {
  let out = '';
  let pendingSpace = false;
  let i = 0;
  const emit = (s) => {
    if (pendingSpace && out !== '') out += ' ';
    pendingSpace = false;
    out += s;
  };
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      pendingSpace = true;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated block comment in firestore.rules');
      i = end + 2;
      pendingSpace = true;
    } else if (c === '"' || c === "'") {
      // A raw (r'…') or triple-quoted string does not read escapes the way this
      // scanner does, so either one is refused rather than guessed at.
      if (/[rR]/.test(text[i - 1] ?? '') && !/[\w]/.test(text[i - 2] ?? '')) {
        throw new Error('raw string in firestore.rules, which this check cannot compare');
      }
      if (text.startsWith(c.repeat(3), i)) {
        throw new Error('triple-quoted string in firestore.rules, which this check cannot compare');
      }
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length || text[j] !== c) throw new Error('unterminated string in firestore.rules');
      emit(text.slice(i, j + 1));
      i = j + 1;
    } else if (/\s/.test(c)) {
      pendingSpace = true;
      i++;
    } else {
      emit(c);
      i++;
    }
  }
  return out;
}

/** `**\/` spans directories, `*` stays inside one — the two forms the build's exclude uses. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    if (glob.startsWith('**/', i)) {
      re += '(?:.*/)?';
      i += 2;
    } else if (glob[i] === '*') {
      re += '[^/]*';
    } else {
      re += glob[i].replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

const TSCONFIG_KEYS = ['compilerOptions', 'include', 'exclude'];
// Keys AND values: `module: "node16"`, for one, turns on package.json `imports`
// resolution, a non-relative route to an excluded file that pointersAt does not see.
const COMPILER_OPTIONS = {
  module: 'commonjs',
  target: 'es2022',
  moduleResolution: 'node',
  lib: ['es2022'],
  outDir: 'lib',
  sourceMap: true,
  strict: true,
  noImplicitReturns: true,
  noUnusedLocals: true,
  esModuleInterop: true,
  skipLibCheck: true,
  resolveJsonModule: true,
};

export function readFunctionsTsconfig(ref, { git = runGit } = {}) {
  const config = JSON.parse(git(['show', `${ref}:${FUNCTIONS_TSCONFIG}`]));
  // Inherited options would be missing from the comparison; refuse instead.
  if ('extends' in config) throw new Error(`${FUNCTIONS_TSCONFIG} uses extends, which this check does not follow`);
  const { options, errors } = ts.convertCompilerOptionsFromJson(config.compilerOptions ?? {}, 'functions');
  if (errors.length > 0) throw new Error(`${FUNCTIONS_TSCONFIG}: ${errors[0].messageText}`);
  // An ALLOWLIST, not a list of known-bad keys: many settings can pull a file into
  // the build past `exclude` or make one file's output depend on another's, and a
  // denylist only ever names the ones someone already thought of. A key outside this
  // list fails the check until it is judged and added here.
  for (const key of Object.keys(config)) {
    if (!key.startsWith('//') && !TSCONFIG_KEYS.includes(key)) {
      throw new Error(`${FUNCTIONS_TSCONFIG} sets ${key}, which this check does not follow`);
    }
  }
  for (const [key, value] of Object.entries(config.compilerOptions ?? {})) {
    if (!(key in COMPILER_OPTIONS) || JSON.stringify(value) !== JSON.stringify(COMPILER_OPTIONS[key])) {
      throw new Error(`${FUNCTIONS_TSCONFIG} sets ${key}, which this check does not follow`);
    }
  }
  // pointersAt scans functions/src and nothing else, so the build must see nothing else.
  if (JSON.stringify(config.include) !== JSON.stringify(['src'])) {
    throw new Error(`${FUNCTIONS_TSCONFIG} sets include to something other than ["src"], which this check does not follow`);
  }
  return { options, exclude: (config.exclude ?? []).map(globToRegExp) };
}

/**
 * Per-file transpile, the same module/target as the real build, comments removed.
 * A `const enum` is refused: its values are inlined into OTHER files at build
 * time, which a per-file comparison cannot see.
 */
export function transpileForComparison(source, fileName, options) {
  if (/\bconst\s+enum\b/.test(source)) {
    throw new Error(`${fileName} declares a const enum, which a per-file comparison cannot judge`);
  }
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      ...options,
      removeComments: true,
      sourceMap: false,
      inlineSourceMap: false,
      declaration: false,
      noEmit: false,
    },
  });
  if (result.diagnostics && result.diagnostics.length > 0) {
    const d = result.diagnostics[0];
    throw new Error(`${fileName} does not parse: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
  }
  return result.outputText;
}

/** Returns `null` when the change cannot reach production, else the reason it does. */
export function classifyChange(change, before, after, { git = runGit, tsconfig, pointers } = {}) {
  const { status, path } = change;
  if (status !== 'M') return `${statusWord(status)}`;

  const show = (ref) => git(['show', `${ref}:${path}`]);

  if (path === RULES) {
    return normalizeRules(show(before)) === normalizeRules(show(after)) ? null : 'rules content changed';
  }

  if (path === FIREBASE_JSON) {
    return firebaseDeployedBlocks(show(before)) === firebaseDeployedBlocks(show(after))
      ? null
      : `a firebase.json key other than ${FIREBASE_JSON_UNDEPLOYED_KEYS.join(' or ')} changed`;
  }

  if (path.startsWith(FUNCTIONS_SRC) && path.endsWith('.ts') && !path.endsWith('.d.ts')) {
    const relative = path.slice(FUNCTIONS.length);
    const config = tsconfig();
    if (config.exclude.some((re) => re.test(relative)) && !isImported(path, after, { git, pointers: pointers() })) return null;
    const beforeText = show(before);
    const afterText = show(after);
    const a = transpileForComparison(beforeText, path, config.options);
    const b = transpileForComparison(afterText, path, config.options);
    if (a !== b) return 'compiled code changed';
    // A `declare` value or a new type can leave this file's output unchanged and still
    // change what a file re-exporting it emits.
    return exportedNames(beforeText, path) === exportedNames(afterText, path) ? null : 'exported names changed';
  }

  return 'not a file this check can compare';
}

/**
 * firebase.json without the keys a manual deploy never reads. A file that does not
 * parse, or does not parse to an object, throws.
 */
export function firebaseDeployedBlocks(text) {
  const config = JSON.parse(text);
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${FIREBASE_JSON} is not a JSON object`);
  }
  const deployed = Object.keys(config)
    .filter((key) => !FIREBASE_JSON_UNDEPLOYED_KEYS.includes(key))
    .sort()
    .map((key) => [key, config[key]]);
  return JSON.stringify(deployed);
}

const printer = ts.createPrinter({ removeComments: true });

/**
 * Every name the file exports, each with the kind of statement that declares it —
 * a type becoming a value under the same name must count as a change.
 */
export function exportedNames(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false);
  const names = [];
  for (const statement of sf.statements) {
    // Whether a namespace holds values or only types decides whether a file
    // re-exporting it emits the name, and neither the statement's kind nor this
    // file's own output shows it — so the whole namespace is compared, comments removed.
    if (ts.isModuleDeclaration(statement)) {
      names.push(printer.printNode(ts.EmitHint.Unspecified, statement, sf).replace(/\s+/g, ' '));
    }
    if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
      names.push(statement.getText(sf).replace(/\s+/g, ' '));
      continue;
    }
    const modifiers = ts.getModifiers(statement) ?? [];
    if (!modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    const kind = ts.SyntaxKind[statement.kind];
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) names.push(`${kind}:${d.name.getText(sf)}`);
    } else if (statement.name) {
      names.push(`${kind}:${statement.name.getText(sf)}`);
    }
  }
  return JSON.stringify(names.sort());
}

/**
 * `exclude` keeps a file out of the build only while nothing imports it — tsc still
 * compiles an excluded file that a built file imports, directly or through another
 * excluded file. So a file that ANY other source file under functions/src points at
 * is sent to the comparison. Every file is read with TypeScript's real parser, and
 * EVERY relative string literal in it counts as a pointer, whether or not it sits in
 * an import — over-matching is the safe direction. Comments are not string literals,
 * so a file merely named in a comment does not count.
 */
export function isImported(path, ref, { git = runGit, pointers = pointersAt(ref, { git }) } = {}) {
  const targets = new Set([path, path.replace(/\.ts$/, ''), path.replace(/\.ts$/, '.js')]);
  return pointers.some(({ from, to }) => from !== path && targets.has(to));
}

const SOURCE = /\.(ts|tsx|mts|cts)$/;

/** Every relative string literal and `/// <reference path>` under functions/src, resolved. */
export function pointersAt(ref, { git = runGit } = {}) {
  const files = git(['ls-tree', '-r', '--name-only', '-z', ref, '--', FUNCTIONS_SRC])
    .split('\0')
    .filter((file) => SOURCE.test(file));
  const pointers = [];
  for (const file of files) {
    const sf = ts.createSourceFile(file, git(['show', `${ref}:${file}`]), ts.ScriptTarget.Latest, false);
    const add = (spec) => {
      if (spec.startsWith('.')) pointers.push({ from: file, to: posix.join(posix.dirname(file), spec) });
    };
    sf.referencedFiles.forEach(({ fileName }) => add(fileName));
    const visit = (node) => {
      if (ts.isStringLiteralLike(node)) add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return pointers;
}

const insideFunctions = (path) => path === 'functions' || path.startsWith(FUNCTIONS);

/**
 * A relative import out of functions/ pulls a file into the functions build that
 * the diff above never lists, so a change to it would pass unseen. A built file
 * pointing outside functions/ fails the check instead. A file the build excludes
 * and nothing imports is not built, so what it points at does not count.
 */
export function assertNoImportOutsideFunctions({ tsconfig, pointers }) {
  const all = pointers();
  const escaping = all.filter(({ to }) => !insideFunctions(to));
  if (escaping.length === 0) return;
  const { exclude } = tsconfig();
  for (const { from, to } of escaping) {
    const excluded = exclude.some((re) => re.test(from.slice(FUNCTIONS.length)));
    if (!excluded || isImported(from, null, { pointers: all })) {
      throw new Error(`${from} points at ${to}, outside functions/, which this check does not follow`);
    }
  }
}

function statusWord(status) {
  if (status === 'A') return 'added';
  if (status === 'D') return 'deleted';
  return `git status ${status}`;
}

export function findDrift(before, after, { git = runGit } = {}) {
  assertRefReachable(before, { git });
  assertRefReachable(after, { git });
  let cachedConfig;
  let cachedPointers;
  const tsconfig = () => (cachedConfig ??= readFunctionsTsconfig(after, { git }));
  const pointers = () => (cachedPointers ??= pointersAt(after, { git }));
  assertNoImportOutsideFunctions({ tsconfig, pointers });
  return listChanges(before, after, { git }).map((change) => ({
    ...change,
    reason: classifyChange(change, before, after, { git, tsconfig, pointers }),
  }));
}

export function main(argv, { git = runGit, log = console.log, err = console.error } = {}) {
  const [before, after] = argv;
  if (!before || !after) {
    err('usage: check-deploy-drift.mjs <before-ref> <after-ref>');
    return 1;
  }

  let changes;
  try {
    changes = findDrift(before, after, { git });
  } catch (error) {
    err(`::error::Could not compare firestore.rules / functions / firebase.json between ${before} and ${after} — ${error.message}`);
    err('Treating this push as a rules/functions change.');
    err('Deploy manually:  firebase deploy --only firestore:rules    # and/or --only functions');
    err("Then ship hosting via the 'Run workflow' button (workflow_dispatch) — that skips this guard.");
    err('If the cause is a setting this check does not follow, the lists it reads are in scripts/check-deploy-drift.mjs.');
    return 1;
  }

  const real = changes.filter((c) => c.reason !== null);
  for (const c of changes.filter((c) => c.reason === null)) {
    log(`  no deployed change: ${c.path}`);
  }
  if (real.length === 0) {
    log('No firestore.rules / functions change that reaches production in this push — proceeding.');
    return 0;
  }

  err('::error::firestore.rules, functions/** or firebase.json changed — these are NOT auto-deployed by this workflow.');
  err('Changed files:');
  for (const c of real) err(`${c.path}  (${c.reason})`);
  err('Deploy manually:  firebase deploy --only firestore:rules    # and/or --only functions');
  err("Then ship hosting via the 'Run workflow' button (workflow_dispatch) — that skips this guard.");
  return 1;
}

// Importing this file from a test must not run the CLI (BIN-802).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
