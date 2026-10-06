import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryHeadings, indexProblem, main, FLOOR, LEDGER, INDEX } from './check-deviations-index.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-deviations-index.mjs');

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

  // `\r?` because a Windows checkout with core.autocrlf=true reads these files as CRLF.
  it('keeps the trigger on the index and none on the ledger', () => {
    expect(readFileSync(INDEX, 'utf8')).toMatch(/^---\r?\npaths:\r?\n/);
    expect(readFileSync(LEDGER, 'utf8')).not.toMatch(/^---\r?\n/);
  });

  // The value the floor's comment argues for; fixtures above derive their sizes from FLOOR, so
  // without this a lowered floor would pass them.
  it('keeps the floor near the ledger size', () => {
    expect(FLOOR).toBeGreaterThanOrEqual(60);
    expect(entryHeadings(readFileSync(LEDGER, 'utf8')).length).toBeGreaterThanOrEqual(FLOOR);
  });
});

// The live test above runs in `process`, which only warns in deploy, so lefthook is what
// refuses a commit. These pin that it is wired in and that the real entry point reads the
// STAGED copies, not the working tree or HEAD.
describe('the script lefthook runs', () => {
  it('is wired into pre-commit, on both files', () => {
    const lefthook = readFileSync('lefthook.yml', 'utf8');
    const block = lefthook.slice(lefthook.indexOf('    deviations-index:'));
    expect(lefthook.indexOf('    deviations-index:')).toBeGreaterThan(lefthook.indexOf('pre-commit:'));
    expect(lefthook.indexOf('    deviations-index:')).toBeLessThan(lefthook.indexOf('commit-msg:'));
    expect(block).toMatch(/^\s*run: node scripts\/check-deviations-index\.mjs\s*$/m);
    expect(block).toMatch(/^\s*- "\.claude\/accepted-deviations\.md"\s*$/m);
    expect(block).toMatch(/^\s*- "\.claude\/rules\/accepted-deviations\.md"\s*$/m);
  });

  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const run = (cwd) => spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' }).status;
  const write = (dir, path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };

  it('judges the staged copies: a staged mismatch exits 1, one only in the working tree exits 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deviations-index-'));
    try {
      git(dir, 'init', '-q');
      git(dir, 'config', 'user.email', 'test@example.invalid');
      git(dir, 'config', 'user.name', 'test');
      git(dir, 'config', 'commit.gpgsign', 'false');
      git(dir, 'config', 'core.hooksPath', join(dir, 'no-hooks'));
      const headings = entries(FLOOR);
      write(dir, LEDGER, ledgerOf(headings));
      write(dir, INDEX, indexOf(headings));
      git(dir, 'add', '.');
      git(dir, 'commit', '-q', '-m', 'base');
      expect(run(dir)).toBe(0);

      // Staged: a new ledger entry without its index heading.
      write(dir, LEDGER, ledgerOf([...headings, '## BIN-999: new']));
      git(dir, 'add', LEDGER);
      expect(run(dir)).toBe(1);

      // Staged heading added too, then broken only in the working tree.
      write(dir, INDEX, indexOf([...headings, '## BIN-999: new']));
      git(dir, 'add', INDEX);
      expect(run(dir)).toBe(0);
      write(dir, INDEX, indexOf(headings));
      expect(run(dir)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
