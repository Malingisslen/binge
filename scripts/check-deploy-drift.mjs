/**
 * Which rules, indexes and functions changes a range of commits carries — the backend
 * deploy, everything firebase.json names except hosting. deploy.yml runs these modes (BIN-1426):
 *   · `--github-output` (report mode) in the `checks` job says what the `backend` job
 *     deploys once Malin approves the run in the `backend` environment. With
 *     `--since-last-deploy <ref>` it compares with the commit of the last successful
 *     deploy.yml run on main; with `--all` it names every target but hosting, for the
 *     `deploy_all_backend` dispatch;
 *   · `--approval-gate` runs in the `backend` job before anything reads the key;
 *   · `--site-gate` runs in the hosting job before the build, and refuses a run whose
 *     commit is older than one a successful run already deployed.
 * Without a mode it exits 1 on a change the backend deploy must ship, for a check by hand.
 *
 * A change that CANNOT reach production — a comment in the rules, a comment or a type in
 * a function source file, a test file the functions build excludes — does not count, so it
 * neither asks for an approval nor deploys.
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
 *   · `firestore.indexes.json` and `.firebaserc`, modified: equal once parsed as
 *     JSON, so a whitespace-only edit passes. The indexes deploy alongside the
 *     rules; `.firebaserc` names the project a deploy by hand targets.
 * Everything else under those paths is a real change without further thought:
 * added, deleted or renamed files, manifests, lockfiles, tsconfig, functions/scripts.
 *
 * FAIL CLOSED. "I could not compare" never reads as "nothing changed": without a mode it
 * exits 1, exactly like "they differ", and report mode answers it with EXCEPT_HOSTING —
 * every target but hosting, behind the same approval. An unresolvable revision, a source
 * that does not parse, an unterminated string or comment, or any other throw counts.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const RULES = 'firestore.rules';
const FUNCTIONS = 'functions/';
const FUNCTIONS_SRC = 'functions/src/';
const FUNCTIONS_TSCONFIG = 'functions/tsconfig.json';
const FIREBASE_JSON = 'firebase.json';
const INDEXES = 'firestore.indexes.json';
const FIREBASERC = '.firebaserc';
// Always diffed, whatever firebase.json says: firebase.json and .firebaserc steer a
// deploy themselves, and the rest keeps the guard from narrowing when a
// firebase.json stops naming one of them. watchedPaths adds what firebase.json names.
const WATCHED_FLOOR = [RULES, FUNCTIONS, FIREBASE_JSON, INDEXES, FIREBASERC];
// Keys inside a deployed firebase.json block whose value is a path the backend deploy reads.
const FIREBASE_JSON_PATH_KEYS = ['rules', 'indexes', 'source', 'template'];
// The firebase.json keys the backend deploy never reads. Every key NOT listed here is
// compared, so a key this check has never seen (storage, database, extensions, one
// Firebase adds later) counts as drift rather than slipping through.
const FIREBASE_JSON_UNDEPLOYED_KEYS = [
  // Deployed by deploy.yml's hosting job, never by the backend deploy.
  'hosting',
  // Read only by the local emulator suite; no deploy target consumes it.
  'emulators',
];

// Shared by runGit and runGh, which read the whole answer into memory. GitHub's run list
// outgrew execFileSync's default buffer of 1 MiB; measure it with
//   gh api "repos/Malingisslen/binge/actions/workflows/deploy.yml/runs?per_page=100" | wc -c
export const RUN_OPTIONS = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 };

function runGit(args) {
  return execFileSync('git', args, RUN_OPTIONS);
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
export function listChanges(before, after, { git = runGit, watched = WATCHED_FLOOR } = {}) {
  const out = git(['diff', '--name-status', '--no-renames', '-z', before, after, '--', ...watched]);
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

  if (path === INDEXES || path === FIREBASERC) {
    return parsedJson(show(before), path) === parsedJson(show(after), path) ? null : `${path} content changed`;
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
 * firebase.json without the keys the backend deploy never reads. A file that does not
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

/**
 * Every path a deployed firebase.json block names under FIREBASE_JSON_PATH_KEYS, as
 * `{ key, pathKey, path }` so watchedPaths and deployCommand read the same walk —
 * read one level into each block, or into each entry of a block that is an array.
 * A path value that is not a string, or points outside the repository, throws.
 */
export function deployedPathsIn(text) {
  const paths = [];
  for (const [key, block] of JSON.parse(firebaseDeployedBlocks(text))) {
    for (const entry of Array.isArray(block) ? block : [block]) {
      if (entry === null || typeof entry !== 'object') continue;
      for (const pathKey of FIREBASE_JSON_PATH_KEYS) {
        const value = entry[pathKey];
        if (value === undefined) continue;
        if (typeof value !== 'string') throw new Error(`${FIREBASE_JSON} ${key}.${pathKey} is not a path`);
        const path = posix.normalize(value.split('\\').join('/')).replace(/\/+$/, '');
        if (path === '' || path === '.' || path === '..' || path.startsWith('/') || path.startsWith('../')) {
          throw new Error(`${FIREBASE_JSON} ${key}.${pathKey} points outside the repository: ${value}`);
        }
        paths.push({ key, pathKey, path });
      }
    }
  }
  return paths;
}

/** The firebase.json text at `ref`, or `null` when that ref has none. */
function firebaseJsonAt(ref, { git }) {
  const listed = git(['ls-tree', '--name-only', '-z', ref, '--', FIREBASE_JSON]).split('\0');
  return listed.includes(FIREBASE_JSON) ? git(['show', `${ref}:${FIREBASE_JSON}`]) : null;
}

/**
 * WATCHED_FLOOR plus every path firebase.json names at EITHER ref, so a push that
 * moves a rules file is diffed at its old place and its new one. A ref without a
 * firebase.json adds nothing; one that does not parse throws.
 */
export function watchedPaths(before, after, { git = runGit } = {}) {
  const paths = new Set(WATCHED_FLOOR);
  for (const ref of [before, after]) {
    const text = firebaseJsonAt(ref, { git });
    if (text === null) continue;
    for (const { path } of deployedPathsIn(text)) paths.add(path);
  }
  return [...paths].sort();
}

/** The file parsed and re-serialized. A file that does not parse throws. */
export function parsedJson(text, path) {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch (error) {
    throw new Error(`${path} does not parse: ${error.message}`);
  }
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
  const watched = watchedPaths(before, after, { git });
  return listChanges(before, after, { git, watched }).map((change) => ({
    ...change,
    reason: classifyChange(change, before, after, { git, tsconfig, pointers }),
  }));
}

// The deploy target for each floor path, used when no firebase.json block names the path.
const FLOOR_TARGETS = { [RULES]: 'firestore:rules', [INDEXES]: 'firestore:indexes', functions: 'functions' };
// Every deploy target except hosting, which deploy.yml's hosting job ships.
const DEPLOY_ALL = 'firebase deploy --except hosting';

/** `firestore` deploys as two targets; every other firebase.json key is a target of its own. */
function targetFor(key, pathKey) {
  return key === 'firestore' ? `firestore:${pathKey}` : key;
}

const within = (path, root) => path === root || path.startsWith(`${root}/`);

/**
 * The targets that ship the changed paths: those whose firebase.json block names each path,
 * at either ref. `null` — every target but hosting — when some path maps to no target
 * (firebase.json and .firebaserc themselves, for instance), or when anything here throws:
 * an answer that covers too much beats one that misses.
 */
export function deployTargets(changes, before, after, { git = runGit } = {}) {
  try {
    const named = [];
    for (const ref of [before, after]) {
      const text = firebaseJsonAt(ref, { git });
      if (text === null) continue;
      for (const { key, pathKey, path } of deployedPathsIn(text)) {
        named.push({ root: path, target: targetFor(key, pathKey) });
      }
    }
    const targets = new Set();
    for (const { path } of changes) {
      const hits = named.filter(({ root }) => within(path, root)).map(({ target }) => target);
      if (hits.length === 0) {
        const floor = Object.keys(FLOOR_TARGETS).find((root) => within(path, root));
        if (!floor) return null;
        hits.push(FLOOR_TARGETS[floor]);
      }
      for (const target of hits) targets.add(target);
    }
    return [...targets].sort();
  } catch {
    return null;
  }
}

/** The `firebase deploy` command that ships the changed paths, for a person to read. */
export function deployCommand(changes, before, after, { git = runGit } = {}) {
  const targets = deployTargets(changes, before, after, { git });
  return targets ? `firebase deploy --only ${targets.join(',')}` : DEPLOY_ALL;
}

// ── Report mode and the approval gate (BIN-1426) ─────────────────────────────────────

// The only targets report mode names after `--only`. A target name is a firebase.json key
// read from the pushed commit, so the workflow must never receive one this list has not
// judged: anything else becomes EXCEPT_HOSTING, which deploys every non-hosting target
// firebase.json names, behind the same approval.
export const KNOWN_TARGETS = ['firestore:indexes', 'firestore:rules', 'functions'];
export const EXCEPT_HOSTING = '--except hosting';

/** The `firebase deploy` arguments for the changed paths: known targets, or EXCEPT_HOSTING. */
export function deployArgs(changes, before, after, { git = runGit } = {}) {
  const targets = deployTargets(changes, before, after, { git });
  const known = targets !== null && targets.length > 0 && targets.every((t) => KNOWN_TARGETS.includes(t));
  return known ? `--only ${targets.join(',')}` : EXCEPT_HOSTING;
}

// Files that change HOW the deploy runs rather than what it ships. The run summary names a
// change to one, so an approval is never given without seeing it.
export const DEPLOY_MACHINERY = ['.github', FIREBASE_JSON, FIREBASERC];

// A path or a message as the run summary prints it: Markdown and HTML characters, and line
// breaks, are replaced, because both come from the pushed commit.
const printable = (text) => String(text).replace(/[^\w ./@:+,()=-]/g, '?');
const short = (sha) => printable(sha).slice(0, 12);

const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const shipsToBrowsers = (path) => !path.startsWith('src/test/') && !TEST_FILE.test(path);

/**
 * Two orders a single `firebase deploy` cannot get right, said before the approval: the
 * backend job runs before the hosting job, and firestore before functions.
 */
export function orderWarnings(real, before, after, { git = runGit } = {}) {
  const paths = real.map((c) => c.path);
  const rules = paths.includes(RULES);
  const warnings = [];
  if (paths.includes(INDEXES) && (rules || paths.some((p) => p.startsWith(FUNCTIONS)))) {
    warnings.push(
      '> **Varning:** index ändras i samma körning som regler eller funktioner. Ett nytt index byggs först efter deployen, och kod som behöver det får fel tills bygget är klart (BIN-1147). Säkrast är två pushar, index först.',
    );
  }
  if (rules) {
    let client;
    try {
      client = listChanges(before, after, { git, watched: ['src'] }).some((c) => shipsToBrowsers(c.path));
    } catch {
      client = null;
    }
    if (client !== false) {
      warnings.push(
        '> **Varning:** reglerna ändras i samma körning som appens kod under src/. Reglerna går ut före webbplatsen, så en skärpning som dagens app inte klarar ger besökarna fel tills webbplatsen är ute (BIN-540). Säkrast är två pushar, appen först.',
      );
    }
  }
  return warnings;
}

/**
 * What the `backend` job deploys for the range `before`..`after`, and the run summary that
 * says so: `deploy` is '' when nothing deployable changed, `--only <known targets>`, or
 * EXCEPT_HOSTING when the comparison throws. `baseRun` names the run `before` came from.
 * Never throws.
 */
export function report(before, after, { git = runGit, baseRun = null } = {}) {
  const since = baseRun ? `körning #${printable(baseRun.number)} (${short(before)})` : short(before);
  const summary = [];
  let deploy;
  try {
    const real = findDrift(before, after, { git }).filter((c) => c.reason !== null);
    if (real.length === 0) {
      deploy = '';
      summary.push(`Regler och funktioner: inget som deployas har ändrats sedan ${since}. Bara webbplatsen deployas.`);
    } else {
      deploy = deployArgs(real, before, after, { git });
      summary.push(`### Regler och funktioner väntar på ditt godkännande`, '', `Ändrat sedan ${since}:`, '');
      for (const c of real) summary.push(`- ${printable(c.path)}: ${printable(c.reason)}`);
      summary.push('', `Deployas efter godkännande: firebase deploy ${deploy}`);
      for (const warning of orderWarnings(real, before, after, { git })) summary.push('', warning);
    }
  } catch (error) {
    deploy = EXCEPT_HOSTING;
    summary.push(
      `### Regler och funktioner väntar på ditt godkännande`,
      '',
      `Kunde inte jämföra med ${since} (${printable(error.message)}).`,
      '',
      `Deployas efter godkännande: firebase deploy ${deploy}`,
    );
  }
  let machinery;
  try {
    machinery = listChanges(before, after, { git, watched: DEPLOY_MACHINERY }).map((c) => printable(c.path));
  } catch {
    machinery = null;
  }
  // With nothing to deploy the backend job is skipped and nobody is asked to approve.
  const beforeApproval = deploy === '' ? '' : ' Läs ändringen innan du godkänner.';
  if (machinery === null) {
    summary.push('', `> **Varning:** kunde inte läsa om .github/, firebase.json eller .firebaserc ändrats.${beforeApproval}`);
  } else if (machinery.length > 0) {
    summary.push('', `> **Varning:** ändringen rör också hur deployen går till: ${machinery.join(', ')}.${beforeApproval}`);
  }
  return { deploy, summary };
}

/** Run workflow with `deploy_all_backend`: every target but hosting, whatever changed. */
export function reportAll() {
  return {
    deploy: EXCEPT_HOSTING,
    summary: [
      '### Hela backend väntar på ditt godkännande',
      '',
      'Run workflow med deploy_all_backend: regler, index och alla funktioner deployas, oavsett vad som ändrats.',
      '',
      `Deployas efter godkännande: firebase deploy ${EXCEPT_HOSTING}`,
    ],
  };
}

/** The lines report mode appends to $GITHUB_OUTPUT. A line break would forge another output. */
export function githubOutput(deploy) {
  if (/[\r\n]/.test(deploy)) throw new Error('the deploy arguments contain a line break');
  return `deploy=${deploy}\nchecked=true\n`;
}

export const BACKEND_ENVIRONMENT = 'backend';
const MAIN_REF = 'refs/heads/main';
const COMMIT_ID = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

function runGh(path) {
  return execFileSync('gh', ['api', path], RUN_OPTIONS);
}

// ── Where the comparison starts (BIN-1426) ──────────────────────────────────────────────

export const RUNS_PER_PAGE = 100;

/**
 * deploy.yml's newest runs, unfiltered; successfulRuns picks the successful ones on main.
 * GitHub's filtered list was stale for this repository: on 2026-10-05, with branch=main and
 * status=success, it ended at run #786 of 2026-09-07 while run #986 had succeeded. Compare
 *   gh api "repos/Malingisslen/binge/actions/workflows/deploy.yml/runs?branch=main&status=success&per_page=1"
 * with the same path without the filters.
 */
export function deployedRunsPath(repo) {
  return `repos/${repo}/actions/workflows/deploy.yml/runs?per_page=${RUNS_PER_PAGE}`;
}

/**
 * The successful runs on main in a workflow-runs answer that name a full commit id, newest
 * first. Throws on an answer it cannot read, which is not "no runs".
 */
function successfulRuns(raw) {
  let answer;
  try {
    answer = JSON.parse(raw);
  } catch {
    throw new Error('GitHub svarade inte med JSON om tidigare körningar');
  }
  if (!Array.isArray(answer?.workflow_runs)) throw new Error('GitHub svarade inte med en lista över tidigare körningar');
  return answer.workflow_runs
    .filter((run) => run?.head_branch === 'main' && run.conclusion === 'success' && COMMIT_ID.test(run.head_sha ?? ''))
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
}

/**
 * The newest successful deploy.yml run on main whose commit is `head` or an ancestor of it, as
 * `{ sha, number }`, or `null` when the answer holds none. A run of any event counts: a run
 * succeeds only when its backend was deployed, had nothing to deploy, or was deployed by
 * hand and the run said so. Throws on an answer it cannot read.
 */
export function lastDeployedRun(raw, head, { git = runGit } = {}) {
  for (const run of successfulRuns(raw)) {
    try {
      git(['merge-base', '--is-ancestor', run.head_sha, head]);
      return { sha: run.head_sha, number: run.run_number };
    } catch {
      // Not in head's history, or a commit this clone does not have.
    }
  }
  return null;
}

/**
 * A successful deploy.yml run on main of a commit that comes after `sha` in history, as
 * `{ sha, number }`, or `null`. That run deployed a newer site than this run would.
 * Throws on an answer it cannot read.
 */
export function newerDeployedRun(raw, sha, { git = runGit } = {}) {
  for (const run of successfulRuns(raw)) {
    if (run.head_sha === sha) continue;
    try {
      git(['merge-base', '--is-ancestor', sha, run.head_sha]);
      return { sha: run.head_sha, number: run.run_number };
    } catch {
      // An older commit, one outside this history, or one this clone does not have.
    }
  }
  return null;
}

/**
 * Report mode for a push, the weekly run and Run workflow: compares with the commit of the
 * last successful run, so a change whose run failed, was rejected or was cancelled is found
 * again. No such run among the newest RUNS_PER_PAGE deploys everything but hosting. Throws
 * when GitHub cannot be asked.
 */
export function sinceLastDeploy(after, { git = runGit, gh = runGh, env }) {
  const repo = env.GITHUB_REPOSITORY;
  if (!REPOSITORY.test(repo ?? '')) throw new Error('GITHUB_REPOSITORY saknas');
  const head = git(['rev-parse', '--verify', '--quiet', `${after}^{commit}`]).trim();
  const run = lastDeployedRun(gh(deployedRunsPath(repo)), head, { git });
  if (run) return report(run.sha, head, { git, baseRun: run });
  return {
    deploy: EXCEPT_HOSTING,
    summary: [
      '### Regler och funktioner väntar på ditt godkännande',
      '',
      `Hittade ingen lyckad körning på main bland de ${RUNS_PER_PAGE} senaste vars commit finns i den här historiken, så allt utom webbplatsen deployas.`,
      '',
      `Deployas efter godkännande: firebase deploy ${EXCEPT_HOSTING}`,
    ],
  };
}

/**
 * Why the run's approvals do not let it deploy the backend, or `null` when they do: at least
 * one approval for `environment`, and nothing for it in any other state. An approval for
 * another environment does not count.
 */
export function approvalProblem(raw, environment = BACKEND_ENVIRONMENT) {
  let approvals;
  try {
    approvals = JSON.parse(raw);
  } catch {
    return 'GitHub svarade inte med JSON om godkännanden';
  }
  if (!Array.isArray(approvals)) return 'GitHub svarade inte med en lista över godkännanden';
  const mine = approvals.filter(
    (a) => Array.isArray(a?.environments) && a.environments.some((e) => e?.name === environment),
  );
  const other = mine.find((a) => a.state !== 'approved');
  if (other) return `körningen har svaret '${printable(other.state)}' för ${environment}`;
  if (mine.length === 0) return `ingen har godkänt ${environment} i den här körningen`;
  return null;
}

/** Where main points, as GitHub has it now. */
export function mainTipPath(repo) {
  return `repos/${repo}/git/ref/heads/main`;
}

/** The commit id in GitHub's answer for refs/heads/main. Throws on any other answer. */
export function mainTip(raw) {
  let answer;
  try {
    answer = JSON.parse(raw);
  } catch {
    throw new Error('GitHub svarade inte med JSON om main');
  }
  const sha = answer?.object?.sha;
  if (answer?.ref !== MAIN_REF || answer?.object?.type !== 'commit' || !COMMIT_ID.test(sha ?? '')) {
    throw new Error('GitHub svarade inte med commiten som main pekar på');
  }
  return sha;
}

/**
 * Why deploying `sha` would roll something back, or `null`. `tip` is main's commit as GitHub
 * has it: `sha` must be in its history, and nothing the backend deploy ships may differ
 * between the two. A re-run of an older run is the case this stops — the run for the newer
 * commit deploys that commit's rules.
 */
export function staleProblem(sha, tip, { git = runGit } = {}) {
  if (tip === sha) return null;
  try {
    git(['rev-parse', '--verify', '--quiet', `${tip}^{commit}`]);
  } catch {
    return `main pekar på ${short(tip)}, som den här körningen inte har hämtat. Kör om jobbet med Re-run failed jobs`;
  }
  try {
    git(['merge-base', '--is-ancestor', sha, tip]);
  } catch {
    return `${short(sha)} finns inte på main`;
  }
  let real;
  try {
    real = findDrift(sha, tip, { git }).filter((c) => c.reason !== null);
  } catch (error) {
    return `kan inte jämföra ${short(sha)} med main: ${printable(error.message)}`;
  }
  if (real.length === 0) return null;
  return `main har gått vidare till ${short(tip)}, som ändrar ${real.map((c) => printable(c.path)).join(', ')}. Den här körningen skulle backa det; godkänn körningen för den nyare commiten i stället`;
}

/**
 * Every check the `backend` job runs before it reads the key: `null` when all pass. Where
 * main points is asked of GitHub, not read from the clone: the checkout may have pointed
 * origin/main at this run's own commit, and then a re-run of an older run looks current.
 */
export function gateProblem({ env, gh = runGh, git = runGit }) {
  const { GITHUB_REF: ref, GITHUB_SHA: sha, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: runId } = env;
  if (ref !== MAIN_REF) return `körningen gäller ${printable(ref ?? 'ingen ref')}, inte ${MAIN_REF}`;
  if (!COMMIT_ID.test(sha ?? '')) return 'GITHUB_SHA är inget commit-id';
  if (!REPOSITORY.test(repo ?? '') || !/^\d+$/.test(runId ?? '')) {
    return 'GITHUB_REPOSITORY eller GITHUB_RUN_ID saknas';
  }
  let head;
  try {
    head = git(['rev-parse', 'HEAD']).trim();
  } catch {
    return 'kan inte läsa den utcheckade commiten';
  }
  if (head !== sha) return `den utcheckade commiten ${short(head)} är inte ${short(sha)}`;
  let raw;
  try {
    raw = gh(`repos/${repo}/actions/runs/${runId}/approvals`);
  } catch (error) {
    return `frågan till GitHub om godkännanden misslyckades: ${printable(error.message)}`;
  }
  const refused = approvalProblem(raw);
  if (refused) return refused;
  let tip;
  try {
    tip = mainTip(gh(mainTipPath(repo)));
  } catch (error) {
    return `frågan till GitHub om main misslyckades: ${printable(error.message)}`;
  }
  return staleProblem(sha, tip, { git });
}

/**
 * The hosting job's check before it builds: `null` unless a successful run of a newer commit
 * exists, whose site this run would replace with an older one. It reads history, so a
 * shallow clone is refused rather than read as "nothing newer".
 */
export function siteGateProblem({ env, gh = runGh, git = runGit }) {
  const { GITHUB_SHA: sha, GITHUB_REPOSITORY: repo } = env;
  if (!COMMIT_ID.test(sha ?? '')) return 'GITHUB_SHA är inget commit-id';
  if (!REPOSITORY.test(repo ?? '')) return 'GITHUB_REPOSITORY saknas';
  let shallow;
  try {
    shallow = git(['rev-parse', '--is-shallow-repository']).trim();
  } catch {
    return 'kan inte läsa om klonen har hela historiken';
  }
  if (shallow !== 'false') return 'klonen saknar historiken som visar om en nyare körning redan deployat';
  let newer;
  try {
    newer = newerDeployedRun(gh(deployedRunsPath(repo)), sha, { git });
  } catch (error) {
    return `frågan till GitHub om tidigare körningar misslyckades: ${printable(error.message)}`;
  }
  if (newer === null) return null;
  return `körning #${printable(newer.number)} har redan deployat den nyare commiten ${short(newer.sha)}, och den här körningen skulle ersätta webbplatsen med en äldre. Vill du deploya igen: Run workflow på main`;
}

const REPORT_USAGE =
  'usage: check-deploy-drift.mjs --github-output <file> [--github-summary <file>] (--all | --since-last-deploy <after-ref> | <before-ref> <after-ref>)';

function reportMain(argv, { git, log, err, write, env, gh }) {
  const [outFile, ...rest] = argv;
  const summaryFile = rest[0] === '--github-summary' ? rest[1] : null;
  const what = summaryFile === null ? rest : rest.slice(2);
  if (!outFile || (rest[0] === '--github-summary' && !summaryFile)) {
    err(REPORT_USAGE);
    return 1;
  }
  let decided;
  if (what.length === 1 && what[0] === '--all') {
    decided = reportAll();
  } else if (what.length === 2 && what[0] === '--since-last-deploy') {
    try {
      decided = sinceLastDeploy(what[1], { git, gh, env });
    } catch (error) {
      err(`::error::Kunde inte avgöra vad som ska deployas: ${error.message}`);
      return 1;
    }
  } else if (what.length === 2 && !what.some((arg) => arg.startsWith('--'))) {
    decided = report(what[0], what[1], { git });
  } else {
    err(REPORT_USAGE);
    return 1;
  }
  const { deploy, summary } = decided;
  try {
    write(outFile, githubOutput(deploy));
    if (summaryFile) write(summaryFile, `${summary.join('\n')}\n`);
  } catch (error) {
    err(`::error::Kunde inte skriva deployrapporten: ${error.message}`);
    return 1;
  }
  for (const line of summary) log(line);
  return 0;
}

function gateMain({ env, gh, git, log, err }) {
  const problem = gateProblem({ env, gh, git });
  if (problem) {
    err(`::error::Regler och funktioner deployas inte: ${problem}.`);
    return 1;
  }
  log(`Godkänt för ${BACKEND_ENVIRONMENT} i den här körningen, på main, och main har ingen nyare backendändring.`);
  return 0;
}

function siteGateMain({ env, gh, git, log, err }) {
  const problem = siteGateProblem({ env, gh, git });
  if (problem) {
    err(`::error::Webbplatsen deployas inte: ${problem}.`);
    return 1;
  }
  log('Ingen lyckad körning har deployat en nyare commit, så webbplatsen från den här körningen kan gå ut.');
  return 0;
}

export function main(
  argv,
  { git = runGit, log = console.log, err = console.error, env = process.env, gh = runGh, write = appendFileSync } = {},
) {
  if (argv[0] === '--approval-gate') return gateMain({ env, gh, git, log, err });
  if (argv[0] === '--site-gate') return siteGateMain({ env, gh, git, log, err });
  if (argv[0] === '--github-output') return reportMain(argv.slice(1), { git, log, err, write, env, gh });

  const [before, after] = argv;
  if (!before || !after) {
    err('usage: check-deploy-drift.mjs <before-ref> <after-ref>');
    return 1;
  }

  let changes;
  try {
    changes = findDrift(before, after, { git });
  } catch (error) {
    err(`::error::Could not compare the files the backend deploy ships between ${before} and ${after} — ${error.message}`);
    err('Treating this range as a change the backend deploy must ship.');
    err(`Deploy manually:  ${DEPLOY_ALL}`);
    err(HAND_DEPLOY_HOSTING);
    err('If the cause is a setting this check does not follow, the lists it reads are in scripts/check-deploy-drift.mjs.');
    return 1;
  }

  const real = changes.filter((c) => c.reason !== null);
  for (const c of changes.filter((c) => c.reason === null)) {
    log(`  no deployed change: ${c.path}`);
  }
  if (real.length === 0) {
    log('No change to a file the backend deploy ships reaches production in this range.');
    return 0;
  }

  err('::error::This range changes what the backend deploy ships.');
  err('Changed files:');
  for (const c of real) err(`${c.path}  (${c.reason})`);
  err(`Deploy manually:  ${deployCommand(real, before, after, { git })}`);
  if (real.some((c) => c.path === FIREBASERC)) {
    err(`${FIREBASERC} names the project a manual deploy targets — check it before deploying by hand.`);
  }
  err(HAND_DEPLOY_HOSTING);
  return 1;
}

const HAND_DEPLOY_HOSTING =
  "deploy.yml's backend job deploys this after approval. After a deploy by hand instead, ship hosting with 'Run workflow' and tick backend_deployed_by_hand.";

// Importing this file from a test must not run the CLI (BIN-802).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
