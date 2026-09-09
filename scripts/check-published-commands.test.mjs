// BIN-1122. The published-command floor, tested by CALLING it.
//
// Run: npm test
//
// The two halves this file has to keep apart, because they fail in opposite directions:
//   * a command that opens a Firestore without naming a project must be CAUGHT, in both
//     command families — the Admin SDK names the project inside an object, gcloud in a flag,
//     and a check that knows one form is the defect this ticket books twice.
//   * prose that DESCRIBES the hazard must be caught by nothing. `tasks/lessons.md` carries
//     the lesson that produced this check and names the same expressions; a floor that
//     reddens on it is a floor someone switches off.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  REPO_ROOT,
  fencedBlocks,
  joinContinuations,
  offendersIn,
  trackedMarkdown,
  isReviewerRecord,
  findOffenders,
  main,
} from './check-published-commands.mjs';

const fence = (body) => ['```bash', body, '```'].join('\n');

describe('fencedBlocks', () => {
  it('returns only what is inside a fence', () => {
    expect(fencedBlocks('before\n```\ninside\n```\nafter')).toEqual(['inside']);
  });

  it('ignores prose entirely', () => {
    expect(fencedBlocks('a paragraph that mentions ```nothing opened')).toEqual([]);
  });

  it('keeps a block whose fence is never closed', () => {
    // Dropping it would let a command hide behind a missing close. The trailing newline is
    // kept as-is: what matters is that the content survives, and the matchers downstream do
    // not care about a final blank line.
    expect(fencedBlocks('```\ninside\n')).toEqual(['inside\n']);
  });

  it('lets a longer fence contain a shorter run of backticks', () => {
    expect(fencedBlocks('````\na ``b`` c\n````')).toEqual(['a ``b`` c']);
  });

  // Pins that a fence closes only on its OWN delimiter. Without it the parser ends a
  // tilde block at the first backtick fence, so everything after that point in the file
  // reads as prose and any command there goes unseen. Every other fixture here uses one
  // delimiter throughout, so nothing else would notice the clause going.
  it('does not close a tilde fence with a backtick fence', () => {
    expect(fencedBlocks('~~~\ninside\n```\nstill inside\n~~~')).toEqual(['inside\n```\nstill inside']);
  });
});

describe('joinContinuations', () => {
  it('joins a backslash-continued shell command into one string', () => {
    // The shape that motivated it: read line by line, the invocation and its --project sit
    // in different strings and the flag is never seen.
    //
    // Two spaces, and asserted as it really behaves rather than as it reads more nicely: the
    // join contributes one space and the source already had one before the backslash. What
    // the check needs is the flag landing in the same string as the invocation, which it does.
    expect(joinContinuations('gcloud x \\\n  --project=p')).toBe('gcloud x  --project=p');
  });
});

describe('offendersIn — the Admin SDK family', () => {
  it('catches an unnamed application-default call', () => {
    const found = offendersIn(fence("initializeApp({ credential: applicationDefault() });"));
    expect(found).toHaveLength(1);
    expect(found[0].family).toBe('admin-sdk');
  });

  it('lets a named one through', () => {
    expect(offendersIn(fence("initializeApp({ credential: applicationDefault(), projectId: 'binge-nu' });"))).toEqual([]);
  });

  it('ignores a call that does not use application-default credentials', () => {
    expect(offendersIn(fence("initializeApp({ credential: cert(key) });"))).toEqual([]);
  });

  it('names a call whose argument it cannot read rather than waving it through', () => {
    // The safe direction: a false alarm on an unusual but correct command, never silence
    // over an unnamed project.
    const found = offendersIn(fence('initializeApp(config);'));
    expect(found).toHaveLength(1);
    expect(found[0].call).toMatch(/not readable/);
  });
});

describe('offendersIn — the gcloud family', () => {
  it('catches an unnamed firestore command', () => {
    const found = offendersIn(fence('gcloud firestore import --database="(default)" gs://b/x'));
    expect(found).toHaveLength(1);
    expect(found[0].family).toBe('gcloud');
  });

  it('catches one whose flags are on continuation lines', () => {
    expect(offendersIn(fence('gcloud firestore import \\\n  --database="(default)"'))).toHaveLength(1);
  });

  it('lets a named one through, including across continuation lines', () => {
    expect(offendersIn(fence('gcloud firestore import \\\n  --project=binge-nu \\\n  --database="(default)"'))).toEqual([]);
  });

  it('ignores a gcloud command that opens no Firestore', () => {
    expect(offendersIn(fence('gcloud auth login'))).toEqual([]);
  });

  it('judges two invocations in one block separately', () => {
    const found = offendersIn(fence('gcloud firestore backups list --project=binge-nu\ngcloud firestore import gs://b/x'));
    expect(found).toHaveLength(1);
    expect(found[0].call).toContain('import');
  });
});

describe('prose is not a command', () => {
  it('does not fire on an unfenced sentence naming the same expressions', () => {
    expect(offendersIn('Ett skript som kör med `initializeApp({ credential: applicationDefault() })` öppnar fel databas.')).toEqual([]);
  });

  it('does not fire on an unfenced gcloud mention', () => {
    expect(offendersIn('PITR slås på via `gcloud firestore databases update --enable-pitr`.')).toEqual([]);
  });

  // The fixture is the REAL lessons file, not a hand-written imitation of it. A guard proven
  // only against a copy of the thing it must not fire on has proven nothing about the thing.
  it('does not fire on tasks/lessons.md, which describes this very hazard', () => {
    expect(offendersIn(readFileSync(join(REPO_ROOT, 'tasks/lessons.md'), 'utf8'))).toEqual([]);
  });
});

describe('the set it reads', () => {
  it('reads the files git tracks', () => {
    const tracked = execFileSync('git', ['ls-files', '--', '*.md'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const read = trackedMarkdown();
    expect(read.length).toBeGreaterThan(0);
    for (const f of read) expect(tracked).toContain(f);
  });

  // The ANCHOR, pinned on its own. Reaching the predicate through `trackedMarkdown` proves
  // only the suffix half — no path outside the agents directory carries that suffix today,
  // so the anchor could be deleted with the whole suite green while a future
  // `docs/ops/*.knowledge.md` holding a real restore command went silently unread.
  it('exempts only records under the agents directory, not the suffix anywhere', () => {
    expect(isReviewerRecord('.claude/agents/binge-security-reviewer.knowledge.md')).toBe(true);
    expect(isReviewerRecord('.claude/agents/binge-test-reviewer.knowledge.archive.md')).toBe(true);
    expect(isReviewerRecord('docs/ops/db-restore.knowledge.md')).toBe(false);
    expect(isReviewerRecord('docs/RUNBOOK.md')).toBe(false);
  });

  it('exempts a reviewer knowledge record, which quotes the defect as evidence', () => {
    // Not a filename list: the suffix pattern covers a new reviewer's records too. Both
    // spellings, because the archive and the live file are one class.
    const read = trackedMarkdown();
    expect(read.some((f) => /\.knowledge\.md$/.test(f))).toBe(false);
    expect(read.some((f) => /\.knowledge\.archive\.md$/.test(f))).toBe(false);
    // …and the exemption is load-bearing, not defensive: at least one of those records really
    // does carry a block this check would otherwise name.
    const records = execFileSync('git', ['ls-files', '--', '*.knowledge.md', '*.knowledge.archive.md'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
    const wouldFire = records.some((f) => offendersIn(readFileSync(join(REPO_ROOT, f), 'utf8')).length > 0);
    expect(wouldFire).toBe(true);
  });
});

describe('findOffenders', () => {
  it('reports the file each offender came from', () => {
    const found = findOffenders({
      files: ['docs/made-up.md'],
      read: () => fence('gcloud firestore import gs://b/x'),
    });
    expect(found).toEqual([{ file: 'docs/made-up.md', family: 'gcloud', call: 'gcloud firestore import gs://b/x' }]);
  });

  it('is clean against the repository as it actually stands', () => {
    // The run that matters. A unit test against its own fixtures proves the mechanism; only
    // this proves the tree is clean, and it is what reddens when someone publishes a command
    // that forgets its project.
    expect(findOffenders()).toEqual([]);
  });
});

describe('main', () => {
  it('returns zero against the real tree', () => {
    expect(main()).toBe(0);
  });

  // BOTH codes, and the failure one through `main` itself. Asserting only the clean-tree
  // zero and checking the offender separately via findOffenders leaves `return 1` unreached:
  // it could become `return 0` — the check reporting success over every offender it finds —
  // with the whole suite green.
  it('returns non-zero when offenders exist', () => {
    expect(main({ offenders: [{ file: 'x.md', family: 'gcloud', call: 'gcloud firestore import gs://b/x' }] })).toBe(1);
  });
});
