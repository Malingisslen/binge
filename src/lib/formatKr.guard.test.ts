import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * BIN-1374 — a kronbelopp written straight into JSX (`{x} kr`) skips the
 * thousands grouping `formatKr` gives it, so "1234 kr" sits next to "1 234 kr"
 * on the same screen. BIN-1365, BIN-1373 and BIN-1374 each found the next such
 * surface by hand; this test reads the source so the next one fails here instead.
 *
 * It scans raw text of every non-test `.tsx` under `src/`, so a comment quoting
 * the pattern trips it too. That fails closed: route the amount through
 * `formatKr`, or reword the comment.
 *
 * What it does NOT catch: an amount computed inline (`{a + b} kr`), a call
 * (`{x.toFixed(1)} kr`), or a string built in a `.ts` file. It catches a bare
 * identifier or property path.
 */

const SRC = join(process.cwd(), 'src');

/** `{amount} kr`, `{row.cost} kr/mån`, `${x} kr` — an identifier path directly before "kr". */
const RAW_KR = /\{[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*\}\s*kr(?!\p{L})/u;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return full;
  });
}

const tsxFiles = walk(SRC).filter(f => f.endsWith('.tsx') && !/\.test\.tsx$/.test(f));

function rawKrHits(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => RAW_KR.test(line))
    .map(({ line, n }) => `${n}: ${line.trim()}`);
}

describe('formatKr guard (BIN-1374)', () => {
  it('scans the component tree, not an empty list', () => {
    expect(tsxFiles.length).toBeGreaterThan(0);
  });

  it('recognises the spellings it exists to catch', () => {
    expect(rawKrHits('<option>{t.name} — {t.cost} kr</option>')).toHaveLength(1);
    expect(rawKrHits('<span>{campaign.monthlyCost} kr</span>')).toHaveLength(1);
    expect(rawKrHits('<span>{total} kr/mån</span>')).toHaveLength(1);
    expect(rawKrHits('`${user?.cost} kr`')).toHaveLength(1);
  });

  it('lets formatted amounts and unrelated words through', () => {
    expect(rawKrHits('<span>{formatKr(total)} kr/mån</span>')).toEqual([]);
    expect(rawKrHits('<span>{count} krönikor</span>')).toEqual([]);
  });

  it('no non-test .tsx writes a raw {amount} kr', () => {
    const offenders = tsxFiles.flatMap(f =>
      rawKrHits(readFileSync(f, 'utf8')).map(hit => `${relative(SRC, f).split(sep).join('/')}:${hit}`),
    );
    expect(offenders, 'route the amount through formatKr from @/lib/formatKr').toEqual([]);
  });
});
