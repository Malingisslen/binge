import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  REVIEWER_ARTIFACT,
  stagedRoutingUnion,
  panelNumbers,
  roleNumberByName,
  loggedPanel,
  gradeStagedRouting,
  refusalLines,
} from './check_staged_routing.mjs';
import { readReviewGates, route } from '../route.mjs';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'docs', 'org', 'metrics', 'check_staged_routing.mjs');

/** A `review` row as the log actually writes them, numeric panel. */
const row = (ticket, panel) => ({ type: 'review', ticket, panel });

describe('panelNumbers — the log writes the panel two ways', () => {
  it('reads a numeric panel', () => {
    expect(panelNumbers([27, 4, 6])).toEqual([27, 4, 6]);
  });

  it('reads the STRING panel too — the live log is written that way on many rows', () => {
    // The distribution is not asserted here (it moves with every sprint); the SHAPE is. The
    // docblock in the module carries the command that re-derives the mix.
    expect(panelNumbers(['#25 Engineering Manager / Release Manager'])).toEqual([25]);
    expect(panelNumbers(['#4 Security Architect', '#27 DBA'])).toEqual([4, 27]);
  });

  it('reads a panel written by bare title or slug, without a number (BIN-1368)', () => {
    expect(panelNumbers(['DevOps / SRE'])).toEqual([8]);
    expect(panelNumbers(['Trust & Safety / Content Moderation'])).toEqual([12]);
    expect(panelNumbers(['security-architect', 'Data Protection Officer'])).toEqual([4, 6]);
    // A word-boundary prefix of exactly one role's slug, and the two short aliases in the log.
    expect(panelNumbers(['database-administrator', 'qa-test-engineer'])).toEqual([27, 7]);
    expect(panelNumbers(['dpo', 'DBA'])).toEqual([6, 27]);
  });

  it('every role in the ownership map round-trips by title AND by slug to its own number', () => {
    const roles = Object.entries(JSON.parse(readFileSync(join(ROOT, 'docs', 'org', 'ownership-map.json'), 'utf8')).roles);
    expect(roles.length).toBeGreaterThan(0);
    for (const [num, r] of roles) {
      expect(panelNumbers([r.title]), r.title).toEqual([Number(num)]);
      expect(panelNumbers([r.slug]), r.slug).toEqual([Number(num)]);
    }
  });

  it('a name that is ambiguous or no routed role resolves to NOTHING — the gate credits no one by guess', () => {
    // `data` prefixes three roles' slugs; `product` two; the archaeologist is a persona, not a role.
    expect(panelNumbers(['data', 'product', 'Codebase Archaeologist', 'security-arch'])).toEqual([]);
    expect(roleNumberByName('')).toBe(null);
  });

  it('an empty or missing panel is no roles, never a crash', () => {
    expect(panelNumbers([])).toEqual([]);
    expect(panelNumbers(undefined)).toEqual([]);
    expect(panelNumbers(null)).toEqual([]);
    expect(panelNumbers('25')).toEqual([]);
  });
});

describe('the routed union — the decision the ticket asked to be made and written down', () => {
  it('a reviewer\'s own knowledge file is NOT part of the union', () => {
    expect(REVIEWER_ARTIFACT.test('.claude/agents/binge-test-reviewer.knowledge.md')).toBe(true);
    expect(REVIEWER_ARTIFACT.test('.claude/agents/binge-test-reviewer.knowledge.archive.md')).toBe(true);
    expect(stagedRoutingUnion([
      'src/lib/foo.ts',
      '.claude/agents/binge-test-reviewer.knowledge.md',
    ])).toEqual(['src/lib/foo.ts']);
  });

  it('the reviewer\'s INSTRUCTION file is still part of it — only the notebook is excluded', () => {
    // `.claude/agents/binge-integration-reviewer.md` is a gated security surface in
    // shared-plugin.json. Excluding the notebook must not quietly exclude its neighbour.
    expect(REVIEWER_ARTIFACT.test('.claude/agents/binge-integration-reviewer.md')).toBe(false);
    expect(stagedRoutingUnion(['.claude/agents/binge-integration-reviewer.md']))
      .toEqual(['.claude/agents/binge-integration-reviewer.md']);
  });
});

describe('loggedPanel', () => {
  it('unions the roles across every row for the commit\'s tickets', () => {
    const rows = [row('BIN-1', [25]), row('BIN-2', ['#4 Security Architect']), row('BIN-3', [13])];
    expect(loggedPanel(rows, ['BIN-1', 'BIN-2'])).toEqual({ roles: [4, 25], rowsFound: 2 });
  });

  it('reports rowsFound 0 when no row belongs to the tickets', () => {
    expect(loggedPanel([row('BIN-9', [25])], ['BIN-1'])).toEqual({ roles: [], rowsFound: 0 });
  });

  it('ignores rows that are not reviews', () => {
    const rows = [{ type: 'correction', ticket: 'BIN-1', panel: [25] }];
    expect(loggedPanel(rows, ['BIN-1'])).toEqual({ roles: [], rowsFound: 0 });
  });
});

describe('gradeStagedRouting — both directions, against the real router', () => {
  // `lefthook.yml` is owned by #25 (`node docs/org/route.mjs lefthook.yml`). Routed live
  // rather than hard-coded, so this test reddens if the ownership map moves rather than
  // silently pinning a stale answer.
  const STAGED = ['lefthook.yml'];

  it('BLOCKS when the staged files route to a role no row names', () => {
    const v = gradeStagedRouting({
      subject: 'feat(gates): something (BIN-1059)',
      stagedPaths: STAGED,
      rows: [row('BIN-1059', [13])],
    });
    expect(v.ok).toBe(false);
    expect(v.routed.length).toBeGreaterThan(0);
    expect(v.missing).toEqual(v.routed);
  });

  it('PASSES when the logged panel covers the routed one', () => {
    const routedOnly = gradeStagedRouting({
      subject: 'feat(gates): something (BIN-1059)',
      stagedPaths: STAGED,
      rows: [],
    });
    const v = gradeStagedRouting({
      subject: 'feat(gates): something (BIN-1059)',
      stagedPaths: STAGED,
      rows: [row('BIN-1059', routedOnly.routed)],
    });
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
  });

  it('a logged panel written as STRINGS covers the same routed roles', () => {
    const routedOnly = gradeStagedRouting({
      subject: 'feat(gates): something (BIN-1059)',
      stagedPaths: STAGED,
      rows: [],
    });
    const asStrings = routedOnly.routed.map((n) => `#${n} some role title`);
    const v = gradeStagedRouting({
      subject: 'feat(gates): something (BIN-1059)',
      stagedPaths: STAGED,
      rows: [row('BIN-1059', asStrings)],
    });
    expect(v.ok, 'a string-shaped panel was read as covering nothing').toBe(true);
  });

  // BIN-1368. The shape is copied from a real `declined-unattended` row the sprint engine
  // wrote: bare titles, `ran:false`, and the ticket id only at the head of `plan`.
  const TOP_STAGED = ['firestore.rules'];
  const declinedRow = (ticket, panel) => ({
    type: 'review', tier: 'full', panel, outcome: 'declined-unattended', ran: false,
    via: 'sprint-parallel', plan: `${ticket} — pulled out before the build; an unattended sprint cannot convene this review`,
  });
  const titleOf = (n) => gradeStagedRouting({ subject: 'x (BIN-1368)', stagedPaths: TOP_STAGED, rows: [] }).roleTitles.get(n);

  it('a declined row naming the top panel by bare TITLE covers it (BIN-1368)', () => {
    const { routed, tier } = gradeStagedRouting({ subject: 'fix(rules): x (BIN-1368)', stagedPaths: TOP_STAGED, rows: [] });
    expect(tier).toBe('top');
    const v = gradeStagedRouting({
      subject: 'fix(rules): x (BIN-1368)',
      stagedPaths: TOP_STAGED,
      rows: [declinedRow('BIN-1368', routed.map(titleOf))],
    });
    expect(v.ok, `titles ${routed.map(titleOf)} were read as naming nobody`).toBe(true);
  });

  it('a declined row that leaves out one routed role is still REFUSED (BIN-1368)', () => {
    const { routed } = gradeStagedRouting({ subject: 'fix(rules): x (BIN-1368)', stagedPaths: TOP_STAGED, rows: [] });
    const [dropped, ...kept] = routed;
    const v = gradeStagedRouting({
      subject: 'fix(rules): x (BIN-1368)',
      stagedPaths: TOP_STAGED,
      rows: [declinedRow('BIN-1368', kept.map(titleOf))],
    });
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual([dropped]);
  });

  it('a subject naming no ticket passes — there is nothing to compare against', () => {
    expect(gradeStagedRouting({ subject: 'chore: tidy', stagedPaths: STAGED, rows: [] }).ok).toBe(true);
  });

  it('tickets with NO review row pass here — this check grades roles, not their absence', () => {
    const v = gradeStagedRouting({
      subject: 'feat(gates): something (BIN-1059)',
      stagedPaths: STAGED,
      rows: [row('BIN-999', [25])],
    });
    expect(v.ok).toBe(true);
    expect(v.reason).toMatch(/no review row for these tickets/);
  });

  // A feat subject owes a review row, so these reach the routing branches they are named
  // for; a docs subject would stop at "owes no review row" first.
  it('a doc-only stage routes to no role and is not blocked', () => {
    const v = gradeStagedRouting({
      subject: 'feat: a note (BIN-1059)',
      stagedPaths: ['README.md'],
      rows: [row('BIN-1059', [])],
    });
    expect(v.ok).toBe(true);
    expect(v.reason).toMatch(/route to tier "skip"/);
  });

  it('the reviewer notebook alone cannot make a commit owe a panel', () => {
    const v = gradeStagedRouting({
      subject: 'feat: a lesson (BIN-1059)',
      stagedPaths: ['.claude/agents/binge-test-reviewer.knowledge.md'],
      rows: [row('BIN-1059', [])],
    });
    expect(v.ok).toBe(true);
    expect(v.paths).toEqual([]);
    expect(v.reason).toBe('nothing is staged that the router reads');
  });
});

describe('decision 1 (BIN-1426): only a commit that owes a review row is graded', () => {
  // The real gates, as this commit ships them, so the router and `owesReview` read one config.
  const gates = readReviewGates();

  it('a docs commit touching a gated file owes no row, so a ticket named in it is not graded', () => {
    // deploy.yml sits under a review gate and routes to a role of its own; the docs subject
    // makes the commit ordinary, so no panel is owed whatever the ticket's rows say.
    const v = gradeStagedRouting({
      subject: 'docs(deploy): en kommentar (BIN-1059)',
      stagedPaths: ['.github/workflows/deploy.yml'],
      rows: [row('BIN-1059', [25])],
      gates,
    });
    expect(v.ok).toBe(true);
    expect(v.reason).toBe('this commit owes no review row');
    const asFix = gradeStagedRouting({
      subject: 'fix(deploy): ett steg (BIN-1059)',
      stagedPaths: ['.github/workflows/deploy.yml'],
      rows: [row('BIN-1059', [25])],
      gates,
    });
    expect(asFix.ok, 'the same files under a code type owe the routed role').toBe(false);
    expect(asFix.missing.length).toBeGreaterThan(0);
  });

  it('an ordinary fix is not graded even when its ticket\'s rows name another role', () => {
    const v = gradeStagedRouting({
      subject: 'fix(ui): knappen (BIN-1059)',
      stagedPaths: ['src/components/ui/DuotonePoster.tsx'],
      rows: [row('BIN-1059', [13])],
      gates,
    });
    expect(v.ok).toBe(true);
    expect(v.reason).toBe('this commit owes no review row');
  });

  it('a feat on the same ordinary file is routed as a feature and owes its owner', () => {
    const v = gradeStagedRouting({
      subject: 'feat(ui): en ny affisch (BIN-1059)',
      stagedPaths: ['src/components/ui/DuotonePoster.tsx'],
      rows: [row('BIN-1059', [13])],
      gates,
    });
    expect(v.feature).toBe(true);
    expect(v.tier).toBe('medium');
    expect(v.ok).toBe(false);
    expect(v.routed.length).toBeGreaterThan(0);
  });

  it('an added page makes a fix a feature here too', () => {
    const page = 'src/app/ny-sida/page.tsx';
    const v = gradeStagedRouting({
      subject: 'fix(ui): en ny sida (BIN-1059)',
      stagedPaths: [page],
      rows: [row('BIN-1059', [])],
      added: [page],
      gates,
    });
    expect(v.feature).toBe(true);
    expect(v.reason).not.toBe('this commit owes no review row');
    expect(v.routed.length, 'a new screen routed as a feature owes some role').toBeGreaterThan(0);
  });

  describe('a fix logged the way a sprint routes it (as a feature) is not refused', () => {
    // A sensitive file and an ordinary one: the default routing seats the sensitive file's
    // owner, the feature routing another role. The router's own selftest pins this pair.
    const pair = ['src/components/ui/DuotonePoster.tsx', 'src/lib/firebase/friends.ts'];
    const panel = (r) => [...new Set(panelNumbers(r.panel))];
    const byDefault = panel(route(pair, { gates }));
    const asFeature = panel(route(pair, { feature: true, gates }));
    const grade = (roles, subject = 'fix(data): vänner (BIN-1059)') =>
      gradeStagedRouting({ subject, stagedPaths: pair, rows: [row('BIN-1059', roles)], gates });

    it('the two routings seat different roles, or this block proves nothing', () => {
      expect(byDefault.length).toBeGreaterThan(0);
      expect(asFeature.length).toBeGreaterThan(0);
      expect(asFeature.some((n) => !byDefault.includes(n))).toBe(true);
    });

    it('passes with the default panel and with the feature panel', () => {
      expect(grade(byDefault).ok).toBe(true);
      const v = grade(asFeature);
      expect(v.ok).toBe(true);
      expect(v.reason).toMatch(/routing as a feature/);
    });

    it('refuses a panel that covers neither, naming the default routing\'s role', () => {
      const v = grade([13]);
      expect(v.ok).toBe(false);
      expect(v.missing).toEqual(byDefault.filter((n) => n !== 13));
    });

    it('routes the second time on the same union, without a reviewer\'s notebook', () => {
      // A reviewer stages its folded lessons in the same commit. Left in, the notebook moves
      // the feature routing to another role, and the fix logged as a sprint routes it is refused.
      const v = gradeStagedRouting({
        subject: 'fix(data): vänner (BIN-1059)',
        stagedPaths: [...pair, '.claude/agents/binge-test-reviewer.knowledge.md'],
        rows: [row('BIN-1059', asFeature)],
        gates,
      });
      expect(v.ok).toBe(true);
      expect(v.reason).toMatch(/routing as a feature/);
    });

    it('a feat is held to the feature routing alone', () => {
      expect(grade(asFeature, 'feat(data): vänner (BIN-1059)').ok).toBe(true);
      expect(grade(byDefault, 'feat(data): vänner (BIN-1059)').ok).toBe(false);
    });
  });
});

describe('the refusal message', () => {
  const v = gradeStagedRouting({
    subject: 'feat(gates): something (BIN-1059)',
    stagedPaths: ['lefthook.yml'],
    rows: [row('BIN-1059', [13])],
  });
  const text = refusalLines(v).join('\n');

  it('names the missing role by number AND title', () => {
    for (const n of v.missing) {
      expect(text).toContain(`#${n} `);
      expect(text, `role #${n} was named by number but not by title`).toContain(v.roleTitles.get(n));
    }
  });

  it('carries the command that reproduces the routing, with the staged paths in it', () => {
    // A `feat` subject is routed as a feature, so the command has to say so or it reproduces
    // a different answer.
    expect(text).toContain('node docs/org/route.mjs --feature lefthook.yml');
    const fix = gradeStagedRouting({
      subject: 'fix(gates): something (BIN-1059)',
      stagedPaths: ['lefthook.yml'],
      rows: [row('BIN-1059', [13])],
    });
    expect(fix.ok).toBe(false);
    expect(refusalLines(fix).join('\n')).toContain('node docs/org/route.mjs lefthook.yml');
  });

  it('does not offer LEFTHOOK=0 or any way to skip', () => {
    expect(text).not.toMatch(/LEFTHOOK=0|--no-verify/);
  });
});

describe('the check is WIRED — "it exists" and "it runs" are different claims', () => {
  // BIN-1040's shape: a check installed in a function nothing calls is inert exactly where
  // it was reported. BIN-852's shape: pin the ARGUMENTS, because `[^)]*` is arity-blind and
  // a removed middle argument would still match.
  const src = readFileSync(SCRIPT, 'utf8');
  // Scoped to mainMessage's own body: the file also DECLARES gradeStagedRouting with the
  // same three names in its parameter list, and a scan that reads the declaration is
  // satisfied by a function nobody calls — the very shape being guarded against.
  const mainBody = src.slice(src.indexOf('export function mainMessage'));

  it('mainMessage calls gradeStagedRouting with subject, stagedPaths, rows, added AND gates', () => {
    expect(src.indexOf('export function mainMessage'), 'mainMessage is gone').toBeGreaterThan(-1);
    const call = mainBody.match(/gradeStagedRouting\(\{([\s\S]*?)\}\)/);
    expect(call, 'mainMessage no longer calls gradeStagedRouting at all').not.toBeNull();
    for (const arg of ['subject', 'stagedPaths', 'rows', 'added', 'gates']) {
      expect(call[1], `the ${arg} argument was dropped — the check still runs and asks less`)
        .toMatch(new RegExp(`\\b${arg}\\s*[:,]`));
    }
  });

  it('mainMessage reads the STAGED files, not the working tree', () => {
    expect(mainBody).toMatch(/stagedPaths:\s*readStagedPaths\(\)/);
    expect(mainBody).toMatch(/added:\s*stagedAddedFiles\(\)/);
    expect(mainBody).toMatch(/gates:\s*stagedReviewGates\(\)\.gates/);
    expect(src).toMatch(/'diff',\s*'--cached',\s*'--name-only',\s*'--no-renames'/);
  });

  it('mainMessage returns 1 on a refusal, so lefthook fails the commit', () => {
    expect(src).toMatch(/for \(const line of refusalLines\(verdict\)\) console\.error\(line\);\s*return 1;/);
  });

  it('lefthook runs it in the commit-msg phase, where the ticket ids exist', () => {
    const yml = readFileSync(join(ROOT, 'lefthook.yml'), 'utf8');
    const commitMsg = yml.slice(yml.indexOf('commit-msg:'));
    expect(yml.indexOf('commit-msg:'), 'lefthook.yml has no commit-msg phase').toBeGreaterThan(-1);
    expect(
      commitMsg,
      'the staged-routing check is not in lefthook\'s commit-msg list — it would never run',
    ).toMatch(/node docs\/org\/metrics\/check_staged_routing\.mjs --message \{1\}/);
  });

  it('it is NOT wired into pre-commit, where the subject does not exist yet', () => {
    const yml = readFileSync(join(ROOT, 'lefthook.yml'), 'utf8');
    const preCommit = yml.slice(yml.indexOf('pre-commit:'), yml.indexOf('commit-msg:'));
    expect(preCommit).not.toContain('check_staged_routing.mjs');
  });
});
