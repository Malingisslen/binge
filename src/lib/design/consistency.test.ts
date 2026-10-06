import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PAGES_DIR = join(process.cwd(), 'src', 'components', 'pages');
// text-xl is the type-scale name the 18px titles were snapped to (paket N).
const BANNED = /text-(?:\[18px\]|xl)\s+font-bold/;

// Raw Tailwind reds — design rules require the danger token instead.
const RAW_RED = /\b(?:text|bg|border|ring|from|to|via)-red-\d/;
// Legacy token aliases that the settings page has been migrated off of.
const LEGACY_TOKENS =
  /\b(?:border-border-(?:main|light)|text-text-(?:primary|secondary|muted)|bg-surface-hover|hover:bg-surface-hover|bg-page\b|accent-accent\b|(?:bg|text|border)-accent\b)/;

function tsxFilesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter(f => f.endsWith('.tsx'))
    .map(f => join(dir, f));
}

function tsxFilesRecursive(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFilesRecursive(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

// BIN-1263: the sweeps that read every .tsx under src/components and src/app get
// their own clock. Alone they finish in tens of milliseconds; in a full-suite run on
// a loaded machine they have been measured past the 5 000 ms default, so a red
// line there said "busy CPU", not "design rule broken". Per test, not per file or
// global, so the fast cases in this file keep failing loudly.
const TREE_SWEEP_TIMEOUT_MS = 30_000;

// X2: bare "Laddar…" JSX-textnoder är förbjudna — använd <LoadingView>.
// Regexen matchar bara literala textnoder (>Laddar…<), inte knapp-copy i
// expressions ({isLoading ? 'Laddar…' : 'Visa fler'}) eller LoadingViews
// default-label (som är en prop, inte en textnod).
const BARE_LOADING_TEXT = />\s*Laddar…\s*</;

describe('design consistency — loading states', () => {
  it('no component or page renders a bare "Laddar…" text node (use LoadingView)', () => {
    const roots = [
      join(process.cwd(), 'src', 'components'),
      join(process.cwd(), 'src', 'app'),
    ];
    const offenders = roots
      .flatMap(tsxFilesRecursive)
      .filter(f => BARE_LOADING_TEXT.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.replace(process.cwd(), ''))).toEqual([]);
  }, TREE_SWEEP_TIMEOUT_MS);
});

describe('design consistency — dynamic route headers', () => {
  it('no page client uses the bare 18px font-bold page-title anti-pattern', () => {
    const offenders = tsxFilesIn(PAGES_DIR).filter(f => BANNED.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.replace(process.cwd(), ''))).toEqual([]);
  });
});

// BIN-324: --season-done is the single source of truth for the green
// "avslutad / sett avsnitt" status color. The raw oklch literal must never
// reappear outside its one :root declaration — every consumer references
// var(--season-done) (globals.css) or the season-done Tailwind token.
const SEASON_DONE_LITERAL = 'oklch(0.52 0.13 145)';
const SEASON_DONE_DECL = '--season-done:';

describe('design consistency — season-done token (BIN-324)', () => {
  it('the raw season-done oklch literal appears only in its :root declaration', () => {
    const files = [
      join(process.cwd(), 'src', 'app', 'globals.css'),
      join(process.cwd(), 'tailwind.config.ts'),
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // Exempt the canonical declaration line itself; anchor on the token,
        // not a brittle line number.
        if (line.includes(SEASON_DONE_DECL)) return;
        if (line.includes(SEASON_DONE_LITERAL)) {
          offenders.push(`${file.replace(process.cwd(), '')}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the :root declaration of --season-done exists (guard is not vacuous)', () => {
    const globals = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');
    expect(globals).toContain(`${SEASON_DONE_DECL} ${SEASON_DONE_LITERAL};`);
  });
});

// BIN-356: broadened from settings/ only to all of src/components + src/app,
// landed together with the ~1034-site legacy-alias → Direction-H token migration
// (guard + migration must ship together — a guard we know fails is an anti-pattern).
describe('design consistency — token vocabulary (app-wide, BIN-356)', () => {
  const roots = [
    join(process.cwd(), 'src', 'components'),
    join(process.cwd(), 'src', 'app'),
  ];
  it('no component or page uses raw Tailwind red-* (use the danger token)', () => {
    const offenders = roots
      .flatMap(tsxFilesRecursive)
      .filter(f => RAW_RED.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.replace(process.cwd(), ''))).toEqual([]);
  }, TREE_SWEEP_TIMEOUT_MS);

  it('no component or page uses legacy token aliases (use Direction-H tokens)', () => {
    const offenders = roots
      .flatMap(tsxFilesRecursive)
      .filter(f => LEGACY_TOKENS.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.replace(process.cwd(), ''))).toEqual([]);
  }, TREE_SWEEP_TIMEOUT_MS);

  it('scans a non-empty set of files (guard is not vacuous)', () => {
    // An empty-path misconfig would make the sweeps above pass trivially.
    expect(roots.flatMap(tsxFilesRecursive).length).toBeGreaterThan(0);
  });
});

// BIN-441 (BIN-439 follow-up): the app-wide BIN-356 sweep above already covers
// src/components/savings recursively, but the Streamingrådgivaren cluster is a
// hot, frequently-extended surface (BIN-430/433/439) — so pin an explicit
// sub-scoped guard as belt-and-suspenders. A raw-red / legacy-alias regression
// introduced here then fails a savings-named test, not just the broad sweep,
// making the offending cluster obvious at a glance.
describe('design consistency — savings cluster tokens (BIN-441)', () => {
  const SAVINGS_DIR = join(process.cwd(), 'src', 'components', 'savings');
  const savingsFiles = () => tsxFilesRecursive(SAVINGS_DIR);

  it('no savings component uses raw Tailwind red-* (use the danger token)', () => {
    const offenders = savingsFiles().filter(f => RAW_RED.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.replace(process.cwd(), ''))).toEqual([]);
  });

  it('no savings component uses legacy token aliases (use Direction-H tokens)', () => {
    const offenders = savingsFiles().filter(f => LEGACY_TOKENS.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.replace(process.cwd(), ''))).toEqual([]);
  });

  it('scans a non-empty set of savings files (guard is not vacuous)', () => {
    expect(savingsFiles().length).toBeGreaterThan(0);
  });
});

// UX-2 (mörkt läge): en hårdkodad vit yta förblir vit i mörkt tema medan texten
// ovanpå blir ljus — inskriven text i inloggningen blev vitt på vitt. Ytor tar
// bg-surface, som följer temat. bg-white/<opacitet> är undantaget: det är en
// genomskinlig ljusning ovanpå något som redan är mörkt (startsidans hero).
const HARDCODED_WHITE_SURFACE = /\bbg-white\b(?!\/)/;

describe('design consistency — no hard-coded white surfaces (UX-2)', () => {
  it('the pattern flags bg-white and lets bg-white/<opacity> through', () => {
    expect(HARDCODED_WHITE_SURFACE.test('border bg-white px-2')).toBe(true);
    expect(HARDCODED_WHITE_SURFACE.test('className="bg-white"')).toBe(true);
    expect(HARDCODED_WHITE_SURFACE.test('hover:bg-white')).toBe(true);
    expect(HARDCODED_WHITE_SURFACE.test('bg-white/[0.08] border')).toBe(false);
    expect(HARDCODED_WHITE_SURFACE.test('bg-white/10')).toBe(false);
    expect(HARDCODED_WHITE_SURFACE.test('bg-surface')).toBe(false);
  });

  it('no .tsx under src uses bg-white as a surface (use bg-surface)', () => {
    const files = tsxFilesRecursive(join(process.cwd(), 'src'));
    // Floor: an empty sweep would pass silently.
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter(f => HARDCODED_WHITE_SURFACE.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.replace(process.cwd(), ''))).toEqual([]);
  }, TREE_SWEEP_TIMEOUT_MS);
});

// BIN-1434: text on an acc-deep fill takes on-acc, which is dark in dark mode —
// white on the dark-mode acc-deep misses AA. Per line, since a className list
// is one line in this codebase; the black poster overlay that only turns
// saffron on hover pairs hover:bg-acc-deep with hover:text-on-acc instead.
const WHITE_ON_ACC = /(?<!hover:)\bbg-acc-deep\b(?!\/).*(?<![\w:-])text-white\b|(?<![\w:-])text-white\b.*(?<!hover:)\bbg-acc-deep\b(?!\/)/;

// A hover-only saffron fill needs its own hover text colour, and an inline style
// can pair the two outside any className.
const HOVER_ACC_FILL = /\bhover:bg-acc-deep\b(?!\/)/;
const INLINE_WHITE_ON_ACC = /var\(--acc-deep\)'\s*,\s*color:\s*'white'/;
function isWhiteOnAccLine(line: string): boolean {
  if (WHITE_ON_ACC.test(line) || INLINE_WHITE_ON_ACC.test(line)) return true;
  return HOVER_ACC_FILL.test(line) && /\btext-white\b/.test(line) && !line.includes('hover:text-on-acc');
}

describe('design consistency — text on saffron fills (BIN-1434)', () => {
  it('the pattern flags white text on bg-acc-deep and lets on-acc and hover pairs through', () => {
    expect(WHITE_ON_ACC.test("'bg-acc-deep text-white'")).toBe(true);
    expect(WHITE_ON_ACC.test("'text-white bg-acc-deep px-2'")).toBe(true);
    expect(WHITE_ON_ACC.test("'bg-acc-deep text-on-acc'")).toBe(false);
    expect(WHITE_ON_ACC.test("'bg-black/60 text-white hover:bg-acc-deep hover:text-on-acc'")).toBe(false);
    expect(WHITE_ON_ACC.test("'bg-acc-deep/[0.1] text-white'")).toBe(false);
  });

  it('the hover and inline-style shapes are flagged too', () => {
    expect(isWhiteOnAccLine("'bg-surface text-acc-deep hover:bg-acc-deep hover:text-white'")).toBe(true);
    expect(isWhiteOnAccLine("'bg-black/60 text-white hover:bg-acc-deep'")).toBe(true);
    expect(isWhiteOnAccLine("background: 'var(--acc-deep)', color: 'white',")).toBe(true);
    expect(isWhiteOnAccLine("'bg-black/60 text-white hover:bg-acc-deep hover:text-on-acc'")).toBe(false);
    expect(isWhiteOnAccLine("background: 'var(--acc-deep)', color: 'var(--on-acc)',")).toBe(false);
  });

  it('no globals.css rule fills with acc-deep under white text', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');
    const blocks = css.split('}');
    // Floor: the sweep must actually see the acc-deep fills it guards.
    expect(blocks.filter(b => /background:\s*var\(--acc-deep\)/.test(b)).length).toBeGreaterThan(0);
    const offenders = blocks
      .filter(b => /background:\s*var\(--acc-deep\)/.test(b) && /(?<![\w-])color:\s*(?:white|#fff\b)/.test(b))
      .map(b => b.trim().split('\n')[0]);
    expect(offenders).toEqual([]);
  });

  it('no .tsx under src puts text-white on a bg-acc-deep fill', () => {
    const files = tsxFilesRecursive(join(process.cwd(), 'src'));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap(f =>
      readFileSync(f, 'utf8').split('\n')
        .map((line, i) => (isWhiteOnAccLine(line) ? `${f.replace(process.cwd(), '')}:${i + 1}` : null))
        .filter((x): x is string => x !== null),
    );
    expect(offenders).toEqual([]);
  }, TREE_SWEEP_TIMEOUT_MS);
});

// Paket N (designsystemet): textstorlekar kommer från typskalan i tailwind.config.ts.
// Ett godtyckligt text-[13px] var hur 18 olika storlekar uppstod; en storlek som
// saknas läggs till i skalan, inte vid anropet.
const ARBITRARY_TEXT_SIZE = /\btext-\[\d[\d.]*(?:px|rem|em)\]/;

function sourceFilesRecursive(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesRecursive(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('design consistency — type scale (paket N)', () => {
  it('the pattern flags arbitrary sizes and lets scale tokens and colours through', () => {
    expect(ARBITRARY_TEXT_SIZE.test('text-[11px] font-bold')).toBe(true);
    expect(ARBITRARY_TEXT_SIZE.test('md:text-[13.5px]')).toBe(true);
    expect(ARBITRARY_TEXT_SIZE.test('text-[0.8rem]')).toBe(true);
    expect(ARBITRARY_TEXT_SIZE.test('text-xs font-bold')).toBe(false);
    expect(ARBITRARY_TEXT_SIZE.test('text-[var(--ink)]')).toBe(false);
  });

  it('no .ts or .tsx under src uses an arbitrary text-[N] size (use the type scale)', () => {
    const files = sourceFilesRecursive(join(process.cwd(), 'src'));
    // Floor: an empty or broken walk would pass silently.
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap(f =>
      readFileSync(f, 'utf8').split('\n')
        .map((line, i) => (ARBITRARY_TEXT_SIZE.test(line) ? `${f.replace(process.cwd(), '')}:${i + 1}` : null))
        .filter((x): x is string => x !== null),
    );
    expect(offenders).toEqual([]);
  }, TREE_SWEEP_TIMEOUT_MS);

  it('every font-size in globals.css reads a --fs-* step', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');
    const decls = css.match(/(?<![\w-])font-size:[^;]+;/g) ?? [];
    // Floor: the sweep must see the declarations it guards.
    expect(decls.length).toBeGreaterThan(50);
    expect(decls.filter(d => !/^font-size:\s*var\(--fs-[\w-]+\);$/.test(d))).toEqual([]);
  });

  it('no .tsx under src uses btn-primary, which globals.css never defined (use <Button variant="acc">)', () => {
    const files = tsxFilesRecursive(join(process.cwd(), 'src'));
    expect(files.length).toBeGreaterThan(0);
    const css = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');
    expect(css).not.toMatch(/\.btn-primary\b/);
    const offenders = files.filter(f => /\bbtn-primary\b/.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.replace(process.cwd(), ''))).toEqual([]);
  }, TREE_SWEEP_TIMEOUT_MS);
});
