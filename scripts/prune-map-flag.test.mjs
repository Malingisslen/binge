// Tests for the pre-commit workflow-map flag pruner (BIN-790).
//
// Run: npm test — matched by vitest.config.ts's `scripts/**/*.{test,spec}.mjs` include.
// A test file outside the runner's globs is silently never run while passing when invoked
// by hand (BIN-802), so if you move this file, move that glob.
//
// WHY THIS FILE EXISTS. `prune-map-flag.mjs` DELETES work orders. Both directions cost, and
// they cost differently:
//   • dropping a live trigger sends the map's prose permanently out of date with nobody
//     asked to fix it, and the map linter cannot notice because it does not read prose;
//   • keeping a ghost costs one session a grep.
// So the tests below drive both branches, and the never-blocks contract is asserted rather
// than asserted-about: a cleanup that can fail a commit is a different kind of change from
// the one this was allowed to be.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruneTriggers, hasCommitSince, hasWorkingTreeChange, findRepoRoot, run, patchPaths, isHeldSince } from './prune-map-flag.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FLAG_REL = '.claude/state/workflow-map-stale.json';

let dir;

/**
 * A real, throwaway git repo. `hasCommitSince` hands a date string to `git log --since`,
 * and the question "does git read a `Z`-suffixed ISO string as UTC" cannot be answered by
 * a stub of git — only by git.
 */
function makeRepo() {
  const d = mkdtempSync(join(tmpdir(), 'prune-map-flag-'));
  const run = (...args) => execFileSync('git', args, { cwd: d, stdio: ['ignore', 'pipe', 'pipe'] });
  run('init', '-q');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  run('commit', '-q', '--allow-empty', '-m', 'root');
  return d;
}

function commitFile(root, rel, body, when) {
  mkdirSync(join(root, dirname(rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
  execFileSync('git', ['add', rel], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['commit', '-q', '-m', `touch ${rel}`], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: when
      ? { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }
      : process.env,
  });
}

function writeFlag(root, flag) {
  mkdirSync(join(root, '.claude', 'state'), { recursive: true });
  writeFileSync(join(root, FLAG_REL), JSON.stringify(flag, null, 2) + '\n');
}

/** Spawns the script exactly as lefthook.yml does. Returns { status, stdout }. */
function runScript(projectDir) {
  const res = execFileSync(
    process.execPath,
    [join(REPO_ROOT, 'scripts', 'prune-map-flag.mjs')],
    {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    },
  );
  return res;
}

beforeEach(() => { dir = makeRepo(); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('pruneTriggers — grenarna', () => {
  it('SLÄPPER en trigger som varken syns i trädet eller i någon commit sedan stämplingen', () => {
    const { kept, dropped } = pruneTriggers('/irrelevant', {
      firstStampedAt: '2026-09-01T00:00:00Z',
      triggers: ['src/spoke.tsx'],
    }, {
      workingTreeChange: () => false,
      commitSince: () => false,
    });

    expect(dropped).toEqual(['src/spoke.tsx']);
    expect(kept).toEqual([]);
  });

  it('BEHÅLLER en trigger vars redigering ligger kvar i arbetsträdet', () => {
    const { kept, dropped } = pruneTriggers('/irrelevant', {
      firstStampedAt: '2026-09-01T00:00:00Z',
      triggers: ['src/levande.tsx'],
    }, {
      workingTreeChange: () => true,
      // Aldrig committad — och ändå levande. Att bara fråga efter en commit hade
      // släppt den.
      commitSince: () => false,
    });

    expect(kept).toEqual(['src/levande.tsx']);
    expect(dropped).toEqual([]);
  });

  it('BEHÅLLER en trigger vars kod är committad men vars karta ännu inte är det', () => {
    // Det normala, korrekta flödet: koden committad ensam (så trädet är rent mot HEAD),
    // kartan i en egen commit som ännu inte finns. Den tidigare föreslagna regeln —
    // "oförändrad mot HEAD ⇒ släpp" — raderade arbetsordern precis här.
    const { kept, dropped } = pruneTriggers('/irrelevant', {
      firstStampedAt: '2026-09-01T00:00:00Z',
      triggers: ['src/committad.tsx'],
    }, {
      workingTreeChange: () => false,
      commitSince: () => true,
    });

    expect(kept).toEqual(['src/committad.tsx']);
    expect(dropped).toEqual([]);
  });

  it('BEHÅLLER när git-frågan kastar — ett obesvarat anrop är inte ett spöke', () => {
    const { kept, dropped } = pruneTriggers('/irrelevant', {
      firstStampedAt: '2026-09-01T00:00:00Z',
      triggers: ['src/okant.tsx'],
    }, {
      workingTreeChange: () => { throw new Error('git kraschade'); },
      commitSince: () => false,
    });

    expect(kept).toEqual(['src/okant.tsx']);
    expect(dropped).toEqual([]);
  });

  it('BEHÅLLER allt när flaggan saknar firstStampedAt — fönstret går inte att datera', () => {
    const { kept, dropped } = pruneTriggers('/irrelevant', {
      triggers: ['src/odaterad.tsx'],
    }, {
      workingTreeChange: () => false,
      commitSince: () => false,
    });

    expect(kept).toEqual(['src/odaterad.tsx']);
    expect(dropped).toEqual([]);
  });
});

describe('git-frågorna mot ett riktigt repo', () => {
  it('ser en commit som ligger inom SAMMA minut som stämplingen', () => {
    // BIN-1050:s fotangel: `%cI` bär en lokal offset, så en naiv strängjämförelse mellan
    // stämpeln och commitens datum glider med tidszonen. Här stämplas 12:00:00Z och
    // commiten läggs 12:00:30Z — samma minut. Går jämförelsen genom en lokal klocka
    // hamnar commiten timmar utanför fönstret och triggern släpps som spöke.
    const stamped = '2026-09-01T12:00:00Z';
    commitFile(dir, 'src/inom.tsx', 'x', '2026-09-01T12:00:30+0000');

    expect(hasCommitSince(dir, 'src/inom.tsx', stamped)).toBe(true);
  });

  it('ser INTE en commit som ligger före stämplingen', () => {
    commitFile(dir, 'src/fore.tsx', 'x', '2026-09-01T11:00:00+0000');

    expect(hasCommitSince(dir, 'src/fore.tsx', '2026-09-01T12:00:00Z')).toBe(false);
  });

  it('ser en oförändrad fil som oförändrad, och en ändrad som ändrad', () => {
    commitFile(dir, 'src/stilla.tsx', 'x', '2026-09-01T10:00:00+0000');
    expect(hasWorkingTreeChange(dir, 'src/stilla.tsx')).toBe(false);

    writeFileSync(join(dir, 'src/stilla.tsx'), 'y');
    expect(hasWorkingTreeChange(dir, 'src/stilla.tsx')).toBe(true);
  });
});

describe('skriptet som lefthook faktiskt kör', () => {
  // Enhetstesterna ovan når bara de exporterade hjälparna. `freshness.test.mjs` lärde sig
  // det dyrt: hela `stampDossier(...)`-anropet gick att radera ur `main()` med sviten grön,
  // eftersom ingenting drev inkopplingen. Därför spawnas skriptet här.

  it('släpper spöket och skriver EN rad om det', () => {
    commitFile(dir, 'src/spoke.tsx', 'x', '2026-09-01T10:00:00+0000');
    // Stämplad EFTER commiten, och filen är oförändrad ⇒ spöke.
    writeFlag(dir, {
      map: 'docs/workflow-map.html',
      triggers: ['src/spoke.tsx'],
      firstStampedAt: '2026-09-01T12:00:00Z',
      lastStampedAt: '2026-09-01T12:00:00Z',
    });

    const out = runScript(dir);

    expect(out).toContain('släppte 1 spöktrigger');
    expect(out).toContain('src/spoke.tsx');
    // Inga triggers kvar ⇒ flaggan ska vara borta, inte ligga tom.
    expect(existsSync(join(dir, FLAG_REL))).toBe(false);
  });

  it('behåller den levande triggern och skriver om flaggan i stället för att radera den', () => {
    commitFile(dir, 'src/spoke.tsx', 'x', '2026-09-01T10:00:00+0000');
    commitFile(dir, 'src/levande.tsx', 'x', '2026-09-01T10:00:00+0000');
    writeFileSync(join(dir, 'src/levande.tsx'), 'redigerad, inte committad');
    writeFlag(dir, {
      map: 'docs/workflow-map.html',
      triggers: ['src/levande.tsx', 'src/spoke.tsx'],
      firstStampedAt: '2026-09-01T12:00:00Z',
      lastStampedAt: '2026-09-01T12:00:00Z',
    });

    runScript(dir);

    const flag = JSON.parse(readFileSync(join(dir, FLAG_REL), 'utf8'));
    expect(flag.triggers).toEqual(['src/levande.tsx']);
    // Och resten av flaggan är orörd — den bär stämplingstiden nästa körning mäter mot.
    expect(flag.firstStampedAt).toBe('2026-09-01T12:00:00Z');
  });

  it('släpper FLERA spöken i samma flagga och behåller den levande', () => {
    // Det normala fallet, inte ett kantfall: en utdragen bunt rör oftast flera filer,
    // och hooken stämplar en trigger per fil — så en flagga med två eller tre spöken
    // är precis vad BIN-790 handlar om. Varje annat test här släpper högst EN, så en
    // bugg som tystnar så snart två spöken ligger i samma flagga hade sluppit igenom:
    // testgranskningen prövade `if (dropped.length > 1) return;` och hela sviten förblev
    // grön.
    commitFile(dir, 'src/spoke-a.tsx', 'x', '2026-09-01T10:00:00+0000');
    commitFile(dir, 'src/spoke-b.tsx', 'x', '2026-09-01T10:00:00+0000');
    commitFile(dir, 'src/levande.tsx', 'x', '2026-09-01T10:00:00+0000');
    writeFileSync(join(dir, 'src/levande.tsx'), 'redigerad, inte committad');

    writeFlag(dir, {
      map: 'docs/workflow-map.html',
      triggers: ['src/levande.tsx', 'src/spoke-a.tsx', 'src/spoke-b.tsx'],
      firstStampedAt: '2026-09-01T12:00:00Z',
      lastStampedAt: '2026-09-01T12:00:00Z',
    });

    const out = runScript(dir);

    expect(out).toContain('släppte 2 spöktrigger');
    expect(out).toContain('src/spoke-a.tsx');
    expect(out).toContain('src/spoke-b.tsx');

    const flag = JSON.parse(readFileSync(join(dir, FLAG_REL), 'utf8'));
    expect(flag.triggers).toEqual(['src/levande.tsx']);
  });

  it('tiger när ingenting släpps', () => {
    commitFile(dir, 'src/levande.tsx', 'x', '2026-09-01T10:00:00+0000');
    writeFileSync(join(dir, 'src/levande.tsx'), 'redigerad');
    writeFlag(dir, {
      map: 'docs/workflow-map.html',
      triggers: ['src/levande.tsx'],
      firstStampedAt: '2026-09-01T12:00:00Z',
      lastStampedAt: '2026-09-01T12:00:00Z',
    });

    expect(runScript(dir)).toBe('');
  });

  it('avslutar 0 och rör ingenting när flaggan är trasig JSON', () => {
    mkdirSync(join(dir, '.claude', 'state'), { recursive: true });
    writeFileSync(join(dir, FLAG_REL), '{ trasig');

    expect(() => runScript(dir)).not.toThrow();
    expect(readFileSync(join(dir, FLAG_REL), 'utf8')).toBe('{ trasig');
  });

  it('avslutar 0 när git inte kan svara alls — katalogen är inget repo', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'prune-map-flag-norepo-'));
    try {
      mkdirSync(join(notARepo, '.claude', 'state'), { recursive: true });
      writeFileSync(join(notARepo, FLAG_REL), JSON.stringify({
        triggers: ['src/nagot.tsx'],
        firstStampedAt: '2026-09-01T12:00:00Z',
      }));

      expect(() => runScript(notARepo)).not.toThrow();
      // Och den släppte ingenting — ett obesvarat git-anrop får aldrig läsas som ett spöke.
      const flag = JSON.parse(readFileSync(join(notARepo, FLAG_REL), 'utf8'));
      expect(flag.triggers).toEqual(['src/nagot.tsx']);
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it('avslutar 0 utan flagga — och det är det billiga normalfallet', () => {
    expect(() => runScript(dir)).not.toThrow();
    expect(runScript(dir)).toBe('');
  });
});

describe('per trigger-fönstret (BIN-1081)', () => {
  it('daterar mot postens EGEN tid, inte mot flaggans äldsta', () => {
    // The defect: one `firstStampedAt` for the whole flag means a path stamped days later
    // inherits the oldest window, and a genuine ghost there is less likely to be seen as one.
    const seen = [];
    pruneTriggers('/irrelevant', {
      firstStampedAt: '2026-09-01T00:00:00Z',
      triggerStampedAt: { 'src/sen.tsx': '2026-09-03T00:00:00Z' },
      triggers: ['src/sen.tsx'],
    }, {
      workingTreeChange: () => false,
      commitSince: (_root, _rel, since) => { seen.push(since); return false; },
      heldFiles: () => [],
    });

    expect(seen).toEqual(['2026-09-03T00:00:00Z']);
  });

  it('faller tillbaka på firstStampedAt för en flagga skriven före fältet fanns', () => {
    // The flag is gitignored and re-created per run, so there is no migration — but one
    // written by yesterday's hook can be sitting there when this lands, and it must behave
    // exactly as it did before rather than throw or silently keep everything.
    const seen = [];
    const { dropped } = pruneTriggers('/irrelevant', {
      firstStampedAt: '2026-09-01T00:00:00Z',
      triggers: ['src/gammal.tsx'],
    }, {
      workingTreeChange: () => false,
      commitSince: (_root, _rel, since) => { seen.push(since); return false; },
      heldFiles: () => [],
    });

    expect(seen).toEqual(['2026-09-01T00:00:00Z']);
    expect(dropped).toEqual(['src/gammal.tsx']);
  });
});

describe('patchPaths — sökvägarna läses ur INNEHÅLLET', () => {
  it('tar sökvägarna ur +++-raderna och hoppar över /dev/null', () => {
    // Never from the patch file's NAME: the names under sprint-patches/ come in at least
    // three formats, and a name-based guess would be a second, unaudited path detector.
    const patch = [
      'diff --git a/src/en.tsx b/src/en.tsx',
      '--- a/src/en.tsx',
      '+++ b/src/en.tsx',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      'diff --git a/src/raderad.tsx b/src/raderad.tsx',
      '--- a/src/raderad.tsx',
      '+++ /dev/null',
    ].join('\n');

    expect(patchPaths(patch)).toEqual(['src/en.tsx']);
  });
});

describe('isHeldSince — gränsen', () => {
  it('BEHÅLLER ett håll som ligger på exakt samma millisekund som stämplingen', () => {
    // The boundary itself, because `>=` mutated to `>` leaves every other case in this
    // file green: they are all an hour to either side. A same-millisecond collision means
    // the hold was created no earlier than the stamp, which is the held case, not the ghost.
    const stamp = '2026-09-01T12:00:00.000Z';
    const held = [{ rel: 'src/grans.tsx', at: Date.parse(stamp) }];

    expect(isHeldSince(held, 'src/grans.tsx', stamp)).toBe(true);
    // The control: one millisecond earlier is a different hold and must NOT count.
    expect(isHeldSince([{ rel: 'src/grans.tsx', at: Date.parse(stamp) - 1 }], 'src/grans.tsx', stamp))
      .toBe(false);
  });
});

describe('en HÅLLEN bunt är inget spöke (BIN-1082)', () => {
  function writePatchFile(root, name, paths, mtimeIso) {
    const pdir = join(root, '.claude', 'state', 'sprint-patches');
    mkdirSync(pdir, { recursive: true });
    const file = join(pdir, name);
    writeFileSync(file, paths.map((p) => [
      `diff --git a/${p} b/${p}`, `--- a/${p}`, `+++ b/${p}`, '@@ -1 +1 @@', '-x', '+y', '',
    ].join('\n')).join(''));
    const t = new Date(mtimeIso);
    utimesSync(file, t, t);
    return file;
  }

  function stashEdit(root, rel, whenIso) {
    writeFileSync(join(root, rel), 'håller för senare');
    execFileSync('git', ['stash', 'push', '-q', '-m', 'held', '--', rel], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_AUTHOR_DATE: whenIso, GIT_COMMITTER_DATE: whenIso },
    });
  }

  function flagFor(rel) {
    return {
      map: 'docs/workflow-map.html',
      triggers: [rel],
      triggerStampedAt: { [rel]: '2026-09-01T12:00:00Z' },
      firstStampedAt: '2026-09-01T12:00:00Z',
      lastStampedAt: '2026-09-01T12:00:00Z',
    };
  }

  it('BEHÅLLER en trigger som ligger i en patchfil skriven EFTER stämplingen', () => {
    commitFile(dir, 'src/hallen.tsx', 'x', '2026-09-01T10:00:00+0000');
    writeFlag(dir, flagFor('src/hallen.tsx'));
    writePatchFile(dir, 'batch-7.patch', ['src/hallen.tsx'], '2026-09-01T13:00:00Z');

    expect(runScript(dir)).toBe('');
    const flag = JSON.parse(readFileSync(join(dir, FLAG_REL), 'utf8'));
    expect(flag.triggers).toEqual(['src/hallen.tsx']);
  });

  it('SLÄPPER ändå när patchfilen är äldre än stämplingen — datumgrinden är hela poängen', () => {
    // Without it, the patch files sitting in that directory since August would keep their
    // paths alive forever and BIN-790's prune would be inert. This is the direction that
    // fails silently, so it gets its own case with literal dates.
    commitFile(dir, 'src/spoke.tsx', 'x', '2026-09-01T10:00:00+0000');
    writeFlag(dir, flagFor('src/spoke.tsx'));
    writePatchFile(dir, 'batch-gammal.patch', ['src/spoke.tsx'], '2026-09-01T11:00:00Z');

    expect(runScript(dir)).toContain('släppte 1 spöktrigger');
    expect(existsSync(join(dir, FLAG_REL))).toBe(false);
  });

  it('BEHÅLLER en trigger som ligger i en stash gjord EFTER stämplingen', () => {
    commitFile(dir, 'src/stashad.tsx', 'x', '2026-09-01T10:00:00+0000');
    stashEdit(dir, 'src/stashad.tsx', '2026-09-01T13:00:00+0000');
    writeFlag(dir, flagFor('src/stashad.tsx'));

    expect(runScript(dir)).toBe('');
    const flag = JSON.parse(readFileSync(join(dir, FLAG_REL), 'utf8'));
    expect(flag.triggers).toEqual(['src/stashad.tsx']);
  });

  it('BEHÅLLER en trigger vars fil bara SKAPADES i en stash (-u)', () => {
    // `git stash show` reports nothing about untracked files unless it is asked to. Without
    // `--include-untracked` a withdrawn batch that ADDED a file under a mapped directory is
    // still dropped as a ghost — the direction that loses a work order, and the one this whole
    // script exists to avoid. The file is untracked AND stashed away, so neither of the two
    // cheap questions can keep it: only the hold can.
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'nyskapad.tsx'), 'ny fil, hålls för senare');
    execFileSync('git', ['stash', 'push', '-q', '-u', '-m', 'held-new', '--', 'src/nyskapad.tsx'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_AUTHOR_DATE: '2026-09-01T13:00:00+0000', GIT_COMMITTER_DATE: '2026-09-01T13:00:00+0000' },
    });
    writeFlag(dir, flagFor('src/nyskapad.tsx'));

    expect(runScript(dir)).toBe('');
    const flag = JSON.parse(readFileSync(join(dir, FLAG_REL), 'utf8'));
    expect(flag.triggers).toEqual(['src/nyskapad.tsx']);
  });
  it('SLÄPPER ändå när stashen är äldre än stämplingen', () => {
    commitFile(dir, 'src/gammal-stash.tsx', 'x', '2026-09-01T10:00:00+0000');
    stashEdit(dir, 'src/gammal-stash.tsx', '2026-09-01T11:00:00+0000');
    writeFlag(dir, flagFor('src/gammal-stash.tsx'));

    expect(runScript(dir)).toContain('släppte 1 spöktrigger');
  });

  it('skriver INGENTING tillbaka till flaggan när hållet är det som räddar den', () => {
    // A KEEP that quietly re-stamped would be the clock-resets-itself failure wearing this
    // ticket's clothes: the window would move forward every commit and never run out.
    commitFile(dir, 'src/orord.tsx', 'x', '2026-09-01T10:00:00+0000');
    writeFlag(dir, flagFor('src/orord.tsx'));
    writePatchFile(dir, 'batch-9.patch', ['src/orord.tsx'], '2026-09-01T13:00:00Z');
    const before = readFileSync(join(dir, FLAG_REL), 'utf8');

    runScript(dir);

    expect(readFileSync(join(dir, FLAG_REL), 'utf8')).toBe(before);
  });

  it('tar bort ett SLÄPPT spökes stämplingstid ur flaggan', () => {
    // Left behind, it would hand a later stamp of the same path the old, wider window back.
    commitFile(dir, 'src/spoke.tsx', 'x', '2026-09-01T10:00:00+0000');
    commitFile(dir, 'src/levande.tsx', 'x', '2026-09-01T10:00:00+0000');
    writeFileSync(join(dir, 'src/levande.tsx'), 'redigerad, inte committad');
    writeFlag(dir, {
      map: 'docs/workflow-map.html',
      triggers: ['src/levande.tsx', 'src/spoke.tsx'],
      triggerStampedAt: {
        'src/levande.tsx': '2026-09-01T12:00:00Z',
        'src/spoke.tsx': '2026-09-01T12:00:00Z',
      },
      firstStampedAt: '2026-09-01T12:00:00Z',
    });

    runScript(dir);

    const flag = JSON.parse(readFileSync(join(dir, FLAG_REL), 'utf8'));
    expect(flag.triggers).toEqual(['src/levande.tsx']);
    expect(Object.keys(flag.triggerStampedAt)).toEqual(['src/levande.tsx']);
  });

  it('frågar efter hållet arbete EN gång, inte en gång per trigger', () => {
    // The stash list and the patch directory give the same answer for every trigger. Asking
    // per trigger is O(triggers × stashes), and this repo has held 55 stashes at once.
    // Counted, not read out of the source — the lesson one describe block down.
    commitFile(dir, 'src/a.tsx', 'x', '2026-09-01T10:00:00+0000');
    commitFile(dir, 'src/b.tsx', 'x', '2026-09-01T10:00:00+0000');
    commitFile(dir, 'src/c.tsx', 'x', '2026-09-01T10:00:00+0000');
    writeFlag(dir, {
      triggers: ['src/a.tsx', 'src/b.tsx', 'src/c.tsx'],
      firstStampedAt: '2026-09-01T12:00:00Z',
    });

    const stashListCalls = [];
    const counting = (_root, args) => {
      if (args[0] === 'stash' && args[1] === 'list') stashListCalls.push(args.join(' '));
      return '';
    };

    run({ cwd: dir, projectDir: null, gitRunner: counting, out: { write: () => {} } });

    expect(stashListCalls.length).toBe(1);
  });
});

describe('den billiga vägen är verkligen billig', () => {
  it('kör NOLL git-subprocesser när flaggan saknas — RÄKNADE, inte lästa ur källan', () => {
    // Den tidiga returen är vad som ersätter glob-gaten, så den är värd ett test: en
    // `git rev-parse` per commit på varje maskin är precis den sortens avgift
    // `lefthook.yml`s huvud varnar för.
    //
    // FÖRSTA VERSIONEN AV DET HÄR TESTET SKANNADE KÄLLAN efter den tidiga returen och
    // passerade medan ett `git rev-parse --show-toplevel` kördes ett steg upp, inne i
    // rot-upplösningen — utanför den kropp skanningen läste. Utfallsverifieraren fann det.
    // Att räkna anropen är det enda som mäter saken; en assertion om koden gjorde det inte.
    const calls = [];
    const counting = (root, args) => { calls.push(args.join(' ')); return ''; };

    // `projectDir: null` is load-bearing, not tidy: without it an ambient
    // CLAUDE_PROJECT_DIR wins over the injected `cwd`, and this test would read — and with
    // a stubbed git, DELETE — the real repo's flag.
    run({ cwd: dir, projectDir: null, gitRunner: counting, out: { write: () => {} } });

    expect(calls).toEqual([]);
  });

  it('och kör dem när det FINNS en flagga — annars mäter testet ovan ingenting', () => {
    // Kontrollprovet. Utan det uppfylls "noll anrop" lika gärna av en rensning som aldrig
    // gör något alls, vilket är samma frånvaro-fälla som BIN-1069.
    commitFile(dir, 'src/spoke.tsx', 'x', '2026-09-01T10:00:00+0000');
    writeFlag(dir, {
      triggers: ['src/spoke.tsx'],
      firstStampedAt: '2026-09-01T12:00:00Z',
    });

    const calls = [];
    const counting = (root, args) => { calls.push(args[0]); return ''; };

    run({ cwd: dir, projectDir: null, gitRunner: counting, out: { write: () => {} } });

    expect(calls.length).toBeGreaterThan(0);
  });

  it('löser upp repo-roten utan att spawna något', () => {
    // Den fs-baserade uppgången är hela skälet att raden ovan kan vara noll. Drivs den
    // härifrån snarare än genom `run` syns det direkt om någon byter tillbaka till
    // `git rev-parse`: den här funktionen tar inga beroenden och kan inte spawna.
    const nested = join(dir, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });

    expect(findRepoRoot(nested)).toBe(realpathSync(dir));
    expect(findRepoRoot(tmpdir())).toBe(null);
  });

  it('är inkopplad i lefthook.yml, och posten förklarar varför den inte är glob-gatad', () => {
    // "Spärren finns" och "spärren körs" är olika påståenden (BIN-776). Utan den här
    // raden går hela steget att lyfta ur lefthook.yml med sviten grön.
    const lefthook = readFileSync(join(REPO_ROOT, 'lefthook.yml'), 'utf8');

    expect(lefthook).toMatch(/^\s*run: node scripts\/prune-map-flag\.mjs\s*$/m);
    // Motiveringen ska stå ovanför posten, inte bara i skriptet.
    const idx = lefthook.indexOf('prune-map-flag:');
    // Skiftlägesokänsligt, och på ordet i sig: motiveringens LYDELSE är inte det som
    // skyddas här — att den står ovanför posten är det.
    expect(lefthook.slice(Math.max(0, idx - 2000), idx)).toMatch(/not glob-gated/i);
  });
});

describe('flaggans sökväg är samma sträng som stämplarens', () => {
  it('finns ordagrant i .claude/hooks/freshness.mjs', () => {
    // Sökvägen är ett eget literal i stämplaren, i rensningen och i den här filen. Döps den
    // om på stämplarsidan blir rensningen en PERMANENT tyst no-op — `existsSync` faller,
    // tidig retur, avslutskod 0 — med hela sviten grön, eftersom testerna här bygger sin
    // egen flagga ur sitt eget literal. Det är precis den klass av tystnad BIN-790 finns
    // för att stänga, ett steg bort. Hittad av push-grinden.
    //
    // Pinnas på KONSTANTEN, inte på strängen var som helst i filen: sökvägen står också i
    // stämplarens egen huvudkommentar, så en `toContain(FLAG_REL)` matchar den och överlever
    // en omdöpning. Den formen skrevs först här och muteringsprövades — den lämnade sviten
    // grön. Det är fällan att pinna kommentaren bredvid symbolen i stället för symbolen.
    const stamper = readFileSync(join(REPO_ROOT, '.claude', 'hooks', 'freshness.mjs'), 'utf8');

    expect(stamper).toContain(`const FLAG_REL = '${FLAG_REL}';`);
  });

  it('och triggerStampedAt-fältet heter samma sak på båda sidor', () => {
    // The pruner reads this key; the stamper writes it. Both are bare literals, and a rename
    // carried out consistently on the stamper side leaves `pruneTriggers` reading a dead key and
    // falling back to the flag-wide date — BIN-1081 silently reverted, whole suite green, and no
    // diff to show it because the flag is gitignored. Same class as FLAG_REL one test up.
    const stamper = readFileSync(join(REPO_ROOT, '.claude', 'hooks', 'freshness.mjs'), 'utf8');

    expect(stamper).toContain('flag.triggerStampedAt = stampedAt;');
  });
});
