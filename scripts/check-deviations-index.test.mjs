import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { entryHeadings, indexProblem, main, FLOOR, LEDGER, INDEX } from './check-deviations-index.mjs';

const entries = (n) => Array.from({ length: n }, (_, i) => `## BIN-${i + 1}: decision ${i + 1} — 2026-10-06`);
const ledgerOf = (headings) => headings.map((h) => `${h}\n\nWhy: a reason.\n`).join('\n');
const indexOf = (headings) => `---\npaths:\n  - "src/**"\n---\n\n# Index\n\nRead the ledger.\n\n${headings.join('\n')}\n`;

describe('entryHeadings', () => {
  it('collects `## ` and `### [` lines in order', () => {
    const text = '# Title\n\n### [Security] One\nbody\n## BIN-2: two\n#### deeper\n### plain three\n';
    expect(entryHeadings(text)).toEqual(['### [Security] One', '## BIN-2: two']);
  });

  it('skips headings inside a ``` fence', () => {
    const text = '## BIN-1: real\n```\n## BIN-9: inside a fence\n```\n## BIN-2: real\n';
    expect(entryHeadings(text)).toEqual(['## BIN-1: real', '## BIN-2: real']);
  });

  it('reads CRLF files the same as LF files', () => {
    expect(entryHeadings('## BIN-1: a\r\n## BIN-2: b\r\n')).toEqual(['## BIN-1: a', '## BIN-2: b']);
  });
});

describe('indexProblem', () => {
  const headings = entries(FLOOR);

  it('passes when the index lists every ledger heading in order', () => {
    expect(indexProblem(ledgerOf(headings), indexOf(headings))).toBeNull();
  });

  it('refuses an index missing the newest heading', () => {
    const problem = indexProblem(ledgerOf([...headings, '## BIN-999: new']), indexOf(headings));
    expect(problem).toContain('is missing the ledger heading "## BIN-999: new"');
  });

  it('refuses an index heading the ledger does not have', () => {
    const problem = indexProblem(ledgerOf(headings), indexOf([...headings, '## BIN-999: invented']));
    expect(problem).toContain('lists "## BIN-999: invented"');
  });

  it('refuses a heading reworded in the index', () => {
    const changed = [...headings];
    changed[3] = '## BIN-4: reworded';
    const problem = indexProblem(ledgerOf(headings), indexOf(changed));
    expect(problem).toContain('entry 4:');
  });

  it('refuses two headings in swapped order', () => {
    const swapped = [...headings];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(indexProblem(ledgerOf(headings), indexOf(swapped))).toContain('entry 1:');
  });

  it('refuses a ledger below the floor even when both sides agree', () => {
    const few = entries(FLOOR - 1);
    expect(indexProblem(ledgerOf(few), indexOf(few))).toContain('fewer than the floor');
  });
});

describe('main', () => {
  const headings = entries(FLOOR);
  const files = (ledger, index) => (path) => {
    if (path === LEDGER) return ledger;
    if (path === INDEX) return index;
    throw new Error(`unexpected path ${path}`);
  };

  it('exits 0 on a matching pair and 1 on a mismatch', () => {
    const out = [];
    const log = (line) => out.push(line);
    expect(main({ read: files(ledgerOf(headings), indexOf(headings)), log, err: log })).toBe(0);
    expect(main({ read: files(ledgerOf([...headings, '## BIN-999: new']), indexOf(headings)), log, err: log })).toBe(1);
  });

  it('exits 1 when a file cannot be read', () => {
    const read = () => {
      throw new Error('not staged');
    };
    expect(main({ read, log: () => {}, err: () => {} })).toBe(1);
  });
});

describe('the repository', () => {
  it('has an index that matches the ledger', () => {
    const ledger = readFileSync(LEDGER, 'utf8');
    const index = readFileSync(INDEX, 'utf8');
    expect(entryHeadings(ledger).length).toBeGreaterThanOrEqual(FLOOR);
    expect(indexProblem(ledger, index)).toBeNull();
  });

  it('keeps the trigger on the index and none on the ledger', () => {
    expect(readFileSync(INDEX, 'utf8')).toMatch(/^---\npaths:\n/);
    expect(readFileSync(LEDGER, 'utf8')).not.toMatch(/^---\n/);
  });
});
