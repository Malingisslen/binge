// Self-test for check-knowledge-caps.mjs (BIN-997), and the place the file-count FLOOR is
// actually enforced.
//
// Run: npm test
//
// The script warns and exits 0 on a cap overrun — Malin's call 2026-08-25: the cap is a
// recommendation a warning reminds you of, not a mechanism that reddens a build. Nothing
// here may assert that the live files are UNDER the cap; that would turn `npm test` into
// the gate she declined.
//
// What does have teeth is the floor, and a floor only has teeth where something acts on a
// failure. The script does exit non-zero on one — and `npm run check:knowledge-caps` shows
// it — but the weekly deploy step is `continue-on-error`, so on the one path that runs
// unattended that exit code is discarded. The floor is therefore asserted here as well: if
// `*.knowledge.md` stops matching, `npm test` goes red. Without this file the whole check
// could quietly measure an empty set and report a clean run forever — the shape
// BIN-838/850/852 exist to stop.

import { describe, it, expect } from 'vitest';
import { CAP_CHARS, MIN_KNOWLEDGE_FILES, knowledgeFiles, report } from './check-knowledge-caps.mjs';

describe('check-knowledge-caps (BIN-997)', () => {
  it('finds at least the floor number of live knowledge files', () => {
    const files = knowledgeFiles();
    expect(
      files.length,
      'the *.knowledge.md glob has stopped matching — this check was measuring nothing',
    ).toBeGreaterThanOrEqual(MIN_KNOWLEDGE_FILES);
  });

  it('never counts the archive files, which carry no cap by design', () => {
    // The archives are the overflow the cap creates — they are where a trim is PAID INTO.
    // A looser `*knowledge*.md` would warn about exactly the files the rule tells you to
    // grow, which would teach the next reader to ignore the warning.
    for (const f of knowledgeFiles()) {
      expect(f.name.endsWith('.knowledge.archive.md')).toBe(false);
    }
  });

  it('reports a file over the cap and stays silent about one under it', () => {
    const lines = report(
      [
        { name: 'over.knowledge.md', chars: CAP_CHARS + 1 },
        { name: 'exactly-at.knowledge.md', chars: CAP_CHARS },
        { name: 'under.knowledge.md', chars: CAP_CHARS - 1 },
      ],
      CAP_CHARS,
    );
    // The boundary is pinned from both sides on purpose: a `>=` in `report` would flag a
    // file that is complying, and "exactly at the cap" is complying.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('over.knowledge.md');
    expect(lines[0]).toContain('over by 1');
  });

  it('says nothing when every file is under the cap', () => {
    expect(report([{ name: 'a.knowledge.md', chars: 1 }], CAP_CHARS)).toEqual([]);
  });
});
