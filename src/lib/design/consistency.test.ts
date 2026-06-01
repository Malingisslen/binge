import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PAGES_DIR = join(process.cwd(), 'src', 'components', 'pages');
const BANNED = /text-\[18px\]\s+font-bold/;

function pageClientFiles(): string[] {
  return readdirSync(PAGES_DIR)
    .filter(f => f.endsWith('.tsx'))
    .map(f => join(PAGES_DIR, f));
}

describe('design consistency — dynamic route headers', () => {
  it('no page client uses the bare 18px font-bold page-title anti-pattern', () => {
    const offenders = pageClientFiles().filter(f => BANNED.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.replace(process.cwd(), ''))).toEqual([]);
  });
});
