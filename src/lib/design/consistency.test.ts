import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PAGES_DIR = join(process.cwd(), 'src', 'components', 'pages');
const SETTINGS_DIR = join(process.cwd(), 'src', 'components', 'settings');
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

describe('design consistency — dynamic route headers', () => {
  it('no page client uses the bare 18px font-bold page-title anti-pattern', () => {
    const offenders = tsxFilesIn(PAGES_DIR).filter(f => BANNED.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.replace(process.cwd(), ''))).toEqual([]);
  });
});

describe('design consistency — settings vocabulary', () => {
  it('no settings component uses raw Tailwind red-* (use the danger token)', () => {
    const offenders = tsxFilesIn(SETTINGS_DIR).filter(f => RAW_RED.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.replace(process.cwd(), ''))).toEqual([]);
  });

  it('no settings component uses legacy token aliases (use Direction-H tokens)', () => {
    const offenders = tsxFilesIn(SETTINGS_DIR).filter(f => LEGACY_TOKENS.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.replace(process.cwd(), ''))).toEqual([]);
  });
});
