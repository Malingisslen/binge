import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cacheDir,
  BASELINE_FILE,
  findRepresentativePages,
  scriptsIn,
  measure,
  parseBaseline,
  renderSummary,
  run,
  main,
} from './bundle-report.mjs';

const HERE = join(fileURLToPath(import.meta.url), '..');
const OUT = '/build/out';
const DIR = '/cache';
const TARGET = join(DIR, BASELINE_FILE).replace(/\\/g, '/');

// An in-memory stand-in for the IO functions run() takes, built from a plain tree literal.
// Nothing here touches the real filesystem, so a test can never delete a genuine build or
// a genuine cache entry — the failure mode BIN-790 shipped when an env var slipped past
// an injected directory.
function fakeIo(tree = {}, extra = {}) {
  const written = {};
  const appended = {};
  const norm = (p) => String(p).replace(/\\/g, '/');
  const files = {};
  const dirs = new Set([norm(OUT)]);
  (function flatten(node, prefix) {
    for (const [name, value] of Object.entries(node)) {
      const path = prefix + '/' + name;
      if (value !== null && typeof value === 'object') {
        dirs.add(path);
        flatten(value, path);
      } else {
        files[path] = value;
      }
    }
  })(tree, norm(OUT));

  return {
    written,
    appended,
    readdir(path) {
      const p = norm(path);
      if (!dirs.has(p)) throw new Error('ENOENT ' + p);
      const out = [];
      for (const d of dirs) {
        if (d.startsWith(p + '/') && !d.slice(p.length + 1).includes('/')) {
          out.push({ name: d.slice(p.length + 1), isDirectory: true });
        }
      }
      for (const f of Object.keys(files)) {
        if (f.startsWith(p + '/') && !f.slice(p.length + 1).includes('/')) {
          out.push({ name: f.slice(p.length + 1), isDirectory: false });
        }
      }
      return out;
    },
    readText(path) {
      const p = norm(path);
      if (p in files) return files[p];
      if (p in written) return written[p];
      return p in extra ? extra[p] : null;
    },
    sizeOf(path) {
      const p = norm(path);
      return typeof files[p] === 'string' ? files[p].length : 0;
    },
    writeText(path, body) {
      written[norm(path)] = body;
    },
    appendText(path, body) {
      appended[path] = (appended[path] || '') + body;
    },
  };
}

function page(...chunks) {
  return (
    '<html><head>' +
    chunks.map((c) => '<script src="/_next/static/chunks/' + c + '"></script>').join('') +
    '</head></html>'
  );
}

// One shared chunk of 1024 bytes and one page chunk of 1024 bytes → 2048 for the page.
function chunkTree(extra = {}) {
  return {
    _next: { static: { chunks: { 'shared.js': 'x'.repeat(1024), 'page.js': 'y'.repeat(1024) } } },
    'index.html': page('shared.js', 'page.js'),
    ...extra,
  };
}

describe('cacheDir', () => {
  it('honours TMDB_CACHE_DIR so a test can be handed its own directory', () => {
    expect(cacheDir({ TMDB_CACHE_DIR: '/somewhere' })).toBe('/somewhere');
  });

  // The env is read in the SIGNATURE, not the body. If it were read in the body, passing
  // an explicit env would be silently ignored whenever the real variable happened to be
  // set, and the test would measure the developer's machine (BIN-790).
  it('falls back to .tmdb-cache in the working directory when the variable is absent', () => {
    expect(cacheDir({})).toBe(join(process.cwd(), '.tmdb-cache'));
  });

  // Pins the DECLARATION, not just the value: anchoring on the string alone would be
  // satisfied by any comment in buildCache.ts that happens to mention it (BIN-790).
  it('uses the same expression buildCache.ts does', () => {
    const src = readFileSync(join(HERE, '..', 'src', 'lib', 'tmdb', 'buildCache.ts'), 'utf8');
    expect(src).toContain("process.env.TMDB_CACHE_DIR || join(process.cwd(), '.tmdb-cache')");
    const mine = readFileSync(join(HERE, 'bundle-report.mjs'), 'utf8');
    expect(mine).toContain("env.TMDB_CACHE_DIR || join(process.cwd(), '.tmdb-cache')");
  });

  it('does not collide with the two filename shapes already in that directory', () => {
    expect(BASELINE_FILE).not.toMatch(/^selection-/);
    expect(BASELINE_FILE).not.toMatch(/^[a-z]+-\d+\.json$/);
  });
});

describe('scriptsIn', () => {
  it('finds every _next script tag', () => {
    expect(scriptsIn(page('a.js', 'b.js'))).toEqual([
      '/_next/static/chunks/a.js',
      '/_next/static/chunks/b.js',
    ]);
  });

  it('counts a chunk listed twice only once', () => {
    expect(scriptsIn(page('a.js', 'a.js'))).toEqual(['/_next/static/chunks/a.js']);
  });

  it('ignores scripts served from anywhere but the build output', () => {
    expect(scriptsIn('<script src="https://cdn.example.com/x.js"></script>')).toEqual([]);
  });
});

describe('findRepresentativePages', () => {
  it('takes one page per top-level route', () => {
    const io = fakeIo(
      chunkTree({
        movie: {
          603: { 'index.html': page('shared.js') },
          604: { 'index.html': page('shared.js') },
        },
        login: { 'index.html': page('shared.js') },
      })
    );
    expect([...findRepresentativePages(OUT, io.readdir).keys()].sort()).toEqual([
      '/',
      '/login',
      '/movie',
    ]);
  });

  // The build output is not a route and must never be reported as one. The fixture puts a
  // stray .html INSIDE _next on purpose: without one, "we skip _next" is satisfied by the
  // fact that _next holds no HTML, and the skip could be deleted with the suite still
  // green — it was, on the first version of this test.
  it('never reports _next as a route, even when it contains HTML', () => {
    const tree = chunkTree();
    tree._next['stray.html'] = page('shared.js');
    const io = fakeIo(tree);
    expect([...findRepresentativePages(OUT, io.readdir).keys()]).toEqual(['/']);
  });

  // 15k exported pages collapse into a handful of distinct script sets, so the walk stops
  // at the first HTML it finds under a route. Counting the group total cannot see that —
  // it is the same whether the walk stops early or scans all fifty — so this counts the
  // readdir calls, which is the thing that decides whether the step fits its ceiling.
  it('stops at the first page under a route instead of scanning them all', () => {
    const many = {};
    for (let i = 0; i < 50; i++) many[String(i)] = { 'index.html': page('shared.js') };
    const io = fakeIo(chunkTree({ movie: many }));
    let calls = 0;
    const counting = (path) => {
      calls++;
      return io.readdir(path);
    };
    const found = findRepresentativePages(OUT, counting);
    expect([...found.keys()].sort()).toEqual(['/', '/movie']);
    // out/, out/movie/, and out/movie/<first>/. Not fifty-something.
    expect(calls).toBe(3);
  });

  // MAX_DEPTH is a threshold this change introduces, so both sides of it are driven with
  // literal depths rather than described. A route whose only HTML sits deeper than the
  // walk goes is reported as no route at all, not as a route weighing nothing.
  it.each([
    ['at the last depth the walk reaches', 7, true],
    ['one level deeper than the walk reaches', 8, false],
  ])('finds a page nested %s', (_label, depth, expected) => {
    let node = { 'index.html': page('shared.js') };
    for (let i = 0; i < depth; i++) node = { ['d' + i]: node };
    const io = fakeIo(chunkTree({ deep: node }));
    const found = findRepresentativePages(OUT, io.readdir);
    expect(found.has('/deep')).toBe(expected);
  });

  it('returns nothing when the export directory does not exist', () => {
    const io = fakeIo({});
    expect(findRepresentativePages('/no/such/dir', io.readdir).size).toBe(0);
  });
});

describe('measure', () => {
  it('sums the bytes of every script the page loads', () => {
    const io = fakeIo(chunkTree());
    expect(measure(OUT, io.readdir, io.readText, io.sizeOf)).toEqual({ '/': 2048 });
  });

  it('returns null when there is no build to read', () => {
    const io = fakeIo({});
    expect(measure('/no/such/dir', io.readdir, io.readText, io.sizeOf)).toBeNull();
  });

  // A route whose chunks are all missing from disk weighs 0, and 0 is not reported as a
  // route that weighs nothing — it is not reported at all.
  it('drops a route whose chunks cannot be found rather than reporting it as empty', () => {
    const io = fakeIo({ _next: { static: { chunks: {} } }, 'index.html': page('gone.js') });
    expect(measure(OUT, io.readdir, io.readText, io.sizeOf)).toBeNull();
  });
});

describe('parseBaseline — the untrusted-input contract', () => {
  it('accepts a well-formed baseline', () => {
    expect(parseBaseline('{"routes":{"/":1024}}')).toEqual({ '/': 1024 });
  });

  it.each([
    ['not json at all', 'not json'],
    ['an array at the top level', '[1,2,3]'],
    ['no routes key', '{"other":1}'],
    ['routes as an array', '{"routes":[1]}'],
    ['a size that is a string', '{"routes":{"/":"1024"}}'],
    ['a size that is negative', '{"routes":{"/":-1}}'],
    ['a size that is not finite', '{"routes":{"/":1e999}}'],
    ['an empty routes object', '{"routes":{}}'],
    ['a route key that is the empty string', '{"routes":{"":1024}}'],
  ])('demotes %s to "no baseline" instead of throwing', (_label, text) => {
    expect(parseBaseline(text)).toBeNull();
  });

  // One bad entry drops the WHOLE comparison. Keeping the good half would print
  // "unchanged" for the dropped route, which is worse than printing nothing.
  it('rejects a baseline where only one of several entries is malformed', () => {
    expect(parseBaseline('{"routes":{"/":1024,"/x":"big"}}')).toBeNull();
  });
});

describe('run', () => {
  const withBaseline = (json) => fakeIo(chunkTree(), { [TARGET]: json });

  it('records a baseline and says so when none existed', () => {
    const io = fakeIo(chunkTree());
    const r = run({ outDir: OUT, dir: DIR, summaryPath: '/sum', ...io });
    expect(r.status).toBe('no-baseline');
    expect(JSON.parse(io.written[TARGET])).toEqual({ routes: { '/': 2048 } });
    expect(io.appended['/sum']).toContain('Ingen baslinje fanns');
  });

  it('reports an unchanged route with a dash, not a zero', () => {
    const io = withBaseline('{"routes":{"/":2048}}');
    const r = run({ outDir: OUT, dir: DIR, summaryPath: '/sum', ...io });
    expect(r.status).toBe('compared');
    expect(io.appended['/sum']).toMatch(/\| — \|/);
  });

  it('reports a growth with a signed delta', () => {
    const io = withBaseline('{"routes":{"/":1024}}');
    run({ outDir: OUT, dir: DIR, summaryPath: '/sum', ...io });
    expect(io.appended['/sum']).toContain('+1.0 kB');
  });

  it('reports a shrink with a negative delta', () => {
    const io = withBaseline('{"routes":{"/":4096}}');
    run({ outDir: OUT, dir: DIR, summaryPath: '/sum', ...io });
    expect(io.appended['/sum']).toContain('-2.0 kB');
  });

  it('treats a corrupt baseline as absent, and overwrites it with a good one', () => {
    const io = withBaseline('{oh no');
    const r = run({ outDir: OUT, dir: DIR, summaryPath: '/sum', ...io });
    expect(r.status).toBe('no-baseline');
    expect(JSON.parse(io.written[TARGET])).toEqual({ routes: { '/': 2048 } });
  });

  it('names a route the baseline had and this build does not', () => {
    const io = withBaseline('{"routes":{"/":2048,"/gone":512}}');
    run({ outDir: OUT, dir: DIR, summaryPath: '/sum', ...io });
    expect(io.appended['/sum']).toContain('`/gone`');
  });

  // A report that finds nothing must SAY nothing-was-found, in the place a reader looks.
  // Staying silent makes "ran and measured nothing" identical to "never ran" — which is
  // what an earlier version of this script would have been, silently and forever: it read
  // a manifest filename Next does not emit.
  it('records no baseline when there is no build, but says so in the summary', () => {
    const io = fakeIo({});
    const r = run({ outDir: '/no/such/dir', dir: DIR, summaryPath: '/sum', ...io });
    expect(r).toEqual({ status: 'no-build', wrote: false });
    expect(io.written).toEqual({});
    expect(io.appended['/sum']).toContain('Ingen mätning');
  });
});

describe('the report can never fail a deploy', () => {
  // The acceptance criterion, driven rather than asserted about. main() runs against the
  // REAL filesystem in a working directory with no export at all.
  it('main() returns 0 with no build present', () => {
    const cwd = process.cwd();
    const summary = process.env.GITHUB_STEP_SUMMARY;
    const fixture = mkdtempSync(join(tmpdir(), 'bundle-report-'));
    try {
      process.chdir(fixture);
      delete process.env.GITHUB_STEP_SUMMARY;
      expect(main()).toBe(0);
    } finally {
      process.chdir(cwd);
      rmSync(fixture, { recursive: true, force: true });
      if (summary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = summary;
    }
  });

  // Drives main() down a path that REALLY throws. The no-build case above cannot: run()
  // returns before it touches the cache, so main()'s catch is never entered and a mutation
  // deleting that catch survives — which it did, on the first attempt at this test. Here
  // the export is real, so the write is reached, and the cache path points under a FILE so
  // mkdirSync throws for real.
  it('main() returns 0 when a real write throws', () => {
    const cwd = process.cwd();
    const dir = process.env.TMDB_CACHE_DIR;
    const summary = process.env.GITHUB_STEP_SUMMARY;
    const fixture = mkdtempSync(join(tmpdir(), 'bundle-report-'));
    try {
      const chunks = join(fixture, 'out', '_next', 'static', 'chunks');
      mkdirSync(chunks, { recursive: true });
      writeFileSync(join(chunks, 'page.js'), 'x'.repeat(1024));
      writeFileSync(join(fixture, 'out', 'index.html'), page('page.js'));
      const blocked = join(fixture, 'blocked');
      writeFileSync(blocked, 'not a directory');
      process.env.TMDB_CACHE_DIR = join(blocked, 'cache');
      delete process.env.GITHUB_STEP_SUMMARY;
      process.chdir(fixture);
      expect(main()).toBe(0);
    } finally {
      process.chdir(cwd);
      rmSync(fixture, { recursive: true, force: true });
      if (dir === undefined) delete process.env.TMDB_CACHE_DIR;
      else process.env.TMDB_CACHE_DIR = dir;
      if (summary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = summary;
    }
  });

  // "The guard exists" and "the guard runs" are different claims (BIN-776). Pin the CLI
  // entry-point check itself: without it the module runs its CLI at import, which makes
  // vitest hang with no output rather than fail (BIN-802).
  it('the CLI is behind an entry-point check', () => {
    const src = readFileSync(join(HERE, 'bundle-report.mjs'), 'utf8');
    expect(src).toContain('fileURLToPath(import.meta.url) === process.argv[1]');
    expect(src).toContain('process.exitCode = main();');
  });

  // No subprocess, no dynamic evaluation, no third-party import. Each would be a new way
  // for cache-restored content to reach something that executes it.
  it('starts no subprocess and evaluates nothing', () => {
    const src = readFileSync(join(HERE, 'bundle-report.mjs'), 'utf8');
    for (const forbidden of ['child_process', 'execSync', 'eval(', 'new Function', 'require(']) {
      expect(src).not.toContain(forbidden);
    }
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.every((s) => s.startsWith('node:'))).toBe(true);
  });
});

describe('renderSummary', () => {
  it('prints route names and sizes and nothing resembling an environment value', () => {
    const out = renderSummary({ '/': 2048 }, { '/': 1024 });
    expect(out).toContain('`/`');
    expect(out).toContain('2.0 kB');
    expect(out).not.toContain(process.cwd());
  });
});
