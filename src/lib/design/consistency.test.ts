import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PAGES_DIR = join(process.cwd(), 'src', 'components', 'pages');
const BANNED = /text-\[18px\]\s+font-bold/;

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
  });
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
const SEASON_DONE_LITERAL = 'oklch(0.55 0.13 145)';
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
  });

  it('no component or page uses legacy token aliases (use Direction-H tokens)', () => {
    const offenders = roots
      .flatMap(tsxFilesRecursive)
      .filter(f => LEGACY_TOKENS.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.replace(process.cwd(), ''))).toEqual([]);
  });
});
