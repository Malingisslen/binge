#!/usr/bin/env node
// bundle-report.mjs — post-build First Load JS report for deploy.yml (BIN-613).
//
// WHAT IT IS. After the build, this reads the EXPORTED HTML, adds up the JavaScript each
// page makes a first-time visitor download, compares that against the previous BUILD's
// numbers, and writes a table into the GitHub Actions run summary.
//
// The previous BUILD, not the previous release: this step runs before the hosting deploy,
// so a run that built and then failed to ship still records its baseline.
//
// WHY THE EXPORTED HTML AND NOT A BUILD MANIFEST. The first version of this script read
// `.next/app-build-manifest.json`. No such file exists: `next`'s own constants module
// (`node_modules/next/dist/shared/lib/constants.js`) declares BUILD_MANIFEST,
// APP_PATHS_MANIFEST and APP_PATH_ROUTES_MANIFEST, and nothing named APP_BUILD_MANIFEST —
// so `measure()` would have returned null on every real run and this whole report would
// have been a permanent no-op that only ever printed a status line. The exported HTML is
// the ground truth instead: `output: 'export'` writes the <script> tags a browser will
// actually fetch, and those tags do not depend on which manifests a future Next version
// happens to emit.
//
// WHAT IT IS NOT. It never fails anything. Malin's decision 2026-09-03 chose the
// reporting form over a gate: `deploy.yml` is the ONLY path to production for binge.nu,
// so a measurement bug here would stop releases rather than report on them. Wanting a
// threshold that blocks is a separate decision with its own number.
//
// FAIL-OPEN BY CONSTRUCTION, TWICE. `main()` swallows everything and returns 0, and the
// workflow step also carries `continue-on-error: true`. Both, deliberately: the internal
// catch stops a throw from surfacing at all, and the step flag is the backstop for a
// failure the catch cannot see (an OOM, a Node-level abort, the step's own timeout).
// Neither one alone is the contract. `run()` is the part allowed to throw; `main()` is
// the part that must not.
//
// THE BASELINE IS UNTRUSTED INPUT. It is restored from an `actions/cache` entry into a
// workflow that holds deploy secrets, so it is treated the way selectionManifest.ts
// treats its manifest: JSON.parse inside a try/catch, every field type-checked before
// use, anything unexpected demoted to "no baseline" rather than thrown. Nothing read
// from it is ever evaluated, required, imported, joined into a filesystem path, or
// passed to a shell — this script starts no subprocess at all.
//
// NO BASELINE IS A NORMAL OUTCOME, not an error: the first run after this ships, and any
// run whose cache entry was evicted. It reports the sizes and records a new baseline.

import { readFileSync, writeFileSync, mkdirSync, renameSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Duplicated from src/lib/tmdb/buildCache.ts's buildCacheDir() ON PURPOSE — and it is a
// duplicate, not a shared import: that file is TypeScript and nothing compiles it ahead
// of a plain .mjs script. buildCache.ts's own header warns that two copies of this path
// drifting apart leaves files written outside the cache, which is what the
// `uses the same expression buildCache.ts does` test pins: it asserts each side's own
// literal, so it goes red whichever side moves. The env is read in the SIGNATURE here and
// in the body there, deliberately — a test must be able to hand this one its own
// directory (BIN-790).
export function cacheDir(env = process.env) {
  return env.TMDB_CACHE_DIR || join(process.cwd(), '.tmdb-cache');
}

// One fixed filename, never built from anything the baseline itself contains. It must not
// collide with the two shapes already sharing that directory: `{kind}-{id}.json` (numeric
// id) and `selection-{type}.json`.
export const BASELINE_FILE = 'bundle-baseline.json';

// The export has ~15k pages but they collapse into a handful of distinct script sets, so
// measuring every file would spend minutes to print the same numbers many times over.
// One representative page per top-level route segment is enough AND needs no hand-kept
// list of routes — a list is the thing that goes stale the first time a route is added.
const MAX_DEPTH = 8;

export function findRepresentativePages(outDir, readdir) {
  const groups = new Map();

  function firstHtml(dir, depth) {
    if (depth > MAX_DEPTH) return null;
    let entries;
    try {
      entries = readdir(dir);
    } catch {
      return null;
    }
    const files = entries.filter((e) => !e.isDirectory && e.name.endsWith('.html'));
    if (files.length) return join(dir, files[0].name);
    for (const e of entries) {
      if (!e.isDirectory || e.name === '_next') continue;
      const hit = firstHtml(join(dir, e.name), depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  let top;
  try {
    top = readdir(outDir);
  } catch {
    return groups;
  }
  for (const e of top) {
    if (e.isDirectory) {
      if (e.name === '_next') continue;
      const hit = firstHtml(join(outDir, e.name), 1);
      if (hit) groups.set('/' + e.name, hit);
    } else if (e.name === 'index.html') {
      groups.set('/', join(outDir, e.name));
    }
  }
  return groups;
}

// Every `<script src="/_next/static/....js">` the page carries. That IS the first load:
// the browser fetches each one before the page is interactive. Deduped, because a chunk
// listed twice is downloaded once — measured on an exported page: the one chunk that also
// appears as `<link rel="preload" as="script">` is already among the script tags.
//
// Third-party scripts are deliberately NOT counted. The prefix filter excludes them by
// construction. A third-party script is not ours, it is not in the build output, and
// its size is not something a change to this repo moves.
export function scriptsIn(html) {
  const found = new Set();
  for (const m of String(html).matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)) {
    found.add(m[1]);
  }
  return [...found];
}

export function measure(outDir, readdir, readText, sizeOf) {
  const pages = findRepresentativePages(outDir, readdir);
  const routes = {};
  for (const [route, file] of pages) {
    const html = readText(file);
    if (typeof html !== 'string') continue;
    let total = 0;
    for (const src of scriptsIn(html)) {
      // The href is site-absolute (`/_next/...`); the file sits at `<outDir>/_next/...`.
      const n = sizeOf(join(outDir, src.replace(/^\//, '')));
      if (Number.isFinite(n) && n > 0) total += n;
    }
    if (total > 0) routes[route] = total;
  }
  return Object.keys(routes).length ? routes : null;
}

// Anything that is not an object of route -> finite non-negative number is "no baseline".
// A partially valid file is not partially trusted: one bad entry drops the whole
// comparison, because a silently-skipped route reads as "unchanged" in the table, which
// is the one wrong answer this report must never give.
export function parseBaseline(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const routes = raw.routes;
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) return null;
  const out = {};
  for (const [route, size] of Object.entries(routes)) {
    if (typeof route !== 'string' || !route) return null;
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null;
    out[route] = size;
  }
  return Object.keys(out).length ? out : null;
}

function kb(bytes) {
  return (bytes / 1024).toFixed(1) + ' kB';
}

function delta(now, before) {
  if (before === undefined) return 'ny';
  const d = now - before;
  if (d === 0) return '—';
  return (d > 0 ? '+' : '') + (d / 1024).toFixed(1) + ' kB';
}

// Route names and byte counts only. Never an environment value and never an absolute
// runner path: the run summary is visible to everyone who can read this repo's Actions.
export function renderSummary(routes, baseline) {
  const names = Object.keys(routes).sort();
  const lines = [];
  lines.push('## First Load JS');
  lines.push('');
  lines.push(
    'En representativ sida per rutt, mätt ur den exporterade HTML:en. Okomprimerade bytes ' +
      'på disk, samma storhet som Next egen First Load JS — en besökare hämtar dem ' +
      'komprimerade, så talen är jämförbara mellan körningar men inte lika trafiken. ' +
      'Rapporterar bara — fäller aldrig bygget.'
  );
  lines.push('');
  if (!baseline) {
    lines.push(
      'Ingen baslinje fanns (första körningen, eller en utrymd byggcache). Den skrivs nu; nästa bygge har något att jämföra mot.'
    );
    lines.push('');
  }
  lines.push('| Sida | First Load JS | Mot förra bygget |');
  lines.push('| --- | ---: | ---: |');
  for (const name of names) {
    const cell = baseline ? delta(routes[name], baseline[name]) : 'ny';
    lines.push('| `' + name + '` | ' + kb(routes[name]) + ' | ' + cell + ' |');
  }
  if (baseline) {
    const gone = Object.keys(baseline)
      .filter((n) => !(n in routes))
      .sort();
    if (gone.length) {
      lines.push('');
      lines.push(
        'Rutter som fanns i baslinjen men inte i det här bygget: ' +
          gone.map((n) => '`' + n + '`').join(', ')
      );
    }
  }
  return lines.join('\n') + '\n';
}

export function run({ outDir, dir, summaryPath, readdir, readText, sizeOf, writeText, appendText }) {
  const routes = measure(outDir, readdir, readText, sizeOf);
  if (!routes) {
    // Say so IN THE SUMMARY, not only in the step log. A report that finds nothing and
    // stays quiet is indistinguishable from one that never ran — which is exactly what
    // the first version of this script would have been, silently, forever.
    if (summaryPath) {
      appendText(
        summaryPath,
        '## First Load JS\n\nIngen mätning: bygget lämnade ingen läsbar exporterad HTML.\n' +
          'Rapporten körde och hittade ingenting — det är inte samma sak som att den hoppades över.\n'
      );
    }
    return { status: 'no-build', wrote: false };
  }

  const target = join(dir, BASELINE_FILE);
  let baseline = null;
  const text = readText(target);
  if (typeof text === 'string') baseline = parseBaseline(text);

  if (summaryPath) appendText(summaryPath, renderSummary(routes, baseline));

  writeText(target, JSON.stringify({ routes }));
  return { status: baseline ? 'compared' : 'no-baseline', wrote: true, routes, baseline };
}

function realIo(dir) {
  return {
    readdir(path) {
      return readdirSync(path, { withFileTypes: true }).map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
      }));
    },
    readText(path) {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    sizeOf(path) {
      try {
        return statSync(path).size;
      } catch {
        return 0;
      }
    },
    // Temp-file + rename, the pattern buildCache.ts and selectionManifest.ts already use.
    // The cache's "Save" step runs on `if: always()`, so a half-written baseline would be
    // packed into the tarball and misread by the next run's comparison.
    writeText(path, body) {
      mkdirSync(dir, { recursive: true });
      const tmp = path + '.' + process.pid + '.tmp';
      writeFileSync(tmp, body);
      renameSync(tmp, path);
    },
    appendText(path, body) {
      writeFileSync(path, body, { flag: 'a' });
    },
  };
}

export function main() {
  try {
    const dir = cacheDir();
    const result = run({
      outDir: join(process.cwd(), 'out'),
      dir,
      summaryPath: process.env.GITHUB_STEP_SUMMARY || '',
      ...realIo(dir),
    });
    console.log('bundle-report: ' + result.status);
  } catch (err) {
    // The whole point. Never rethrow, never a non-zero exit.
    console.log('bundle-report: skipped — ' + (err && err.message ? err.message : 'unknown error'));
  }
  return 0;
}

// The CLI runs ONLY when this file is the entry point. Imported by its test, the module
// must define functions and do nothing else: a CLI that runs at import eats the test
// runner's argv, and the symptom is vitest hanging with no output at all (BIN-802).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
