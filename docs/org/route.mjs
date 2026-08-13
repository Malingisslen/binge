// route.mjs — blast-radius router for Binge's virtual role-org.
//
// Given a set of repo-relative file paths (a plan's blast radius, a ticket's touched
// files, or `git diff --name-only`), resolve:
//   - which role(s) own those paths (via the committed docs/org/ownership-map.json), and
//   - the review TIER (top / medium / skip) per the constitution in
//     docs/org/world-watch/DESIGN.md §1.3.
//
// This is the SINGLE SOURCE OF TRUTH for the tier + panel. /linear stamps the owning
// roles into new tickets, /sprint-execute reads the tier to decide whether to convene a
// stakeholder panel before building, and /stakeholder-review uses it to scope its panel —
// so none of them carry a private, drifting copy of the risk logic.
//
// It is deterministic string-matching — NO model call, NO network — so it runs free and
// fits the $0/interactive cost model (DESIGN §0).
//
// Usage:
//   node docs/org/route.mjs <path> [<path> ...]      # paths as args
//   git diff --name-only | node docs/org/route.mjs   # paths on stdin (newline-separated)
//   node docs/org/route.mjs --md <path> ...          # print a ready "## Stakeholders" block
//   node docs/org/route.mjs --selftest               # run golden assertions, exit non-zero on fail
//
// Output (default): one JSON object on stdout —
//   { tier, reason, reasonCode, highStakes: [...], panel: [roleNum...],
//     roles: [{num,title,slug,matched:[...],inherited:[...]}], dropped: [...],
//     unmapped: [...], unmappedCode: [...], unownedCode: [...] }
//   `unmappedCode` = code no pattern matched; `unownedCode` = code no *code* role reviews
//   (that plus code owned only by the Technical Writer). The tier reads `unownedCode`.
//   tier "skip" → panel []. Exit code is always 0 for a successful route (skip is a valid
//   outcome, not an error); 1 only on a usage/IO error or a failed --selftest.
//
// BIN-788 — two things this router used to get wrong, both of which made a risky change
// look cleared:
//   1. The ownership map enumerates FILES (149 exact paths). A brand-new file in a
//      directory with ten owned siblings matched nothing. Resolution is now
//      DIRECTORY-based for code paths: a role that owns a file in a directory owns that
//      directory's other code files too (reported per role in `inherited`).
//   2. "No owning role" and "deliberately trivial" returned the SAME answer (`skip`), so
//      an unmapped path read as a cleared one. An unmapped CODE path is now `medium`
//      (reasonCode `unmapped-code`, fallback seat #14 Software Architect) and is listed
//      in `unownedCode` — a code path with no owning role — while `unmappedCode` carries
//      code paths that matched no role at all. (BIN-834: this comment named the wrong
//      field. Run against the shipped router for `docs/org/route.mjs` before it got an
//      owner, `unmappedCode` was `[]` and the path sat in `unownedCode`.) Only genuinely
//      non-code paths (docs, plans, scratch) still route `skip` (reasonCode `doc-only` /
//      `no-code-paths`). Read `reasonCode`, not the prose in `reason`, when a tool needs
//      to tell those apart.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mapPath = join(repoRoot, 'docs', 'org', 'ownership-map.json');

// ── Constitution constants (DESIGN.md §1.3) — keep in sync with that doc ──────────────

// High-stakes paths: ANY hit forces the full panel (TOP). This is the exact list from
// DESIGN §1.3 / the /stakeholder-review skill — security rules, GDPR data, moderation,
// auth. Path-based proxies only; a *semantic* high-stakes change (deletes/migrates user
// data) that touches none of these is a manual --force-top override by the caller.
const HIGH_STAKES = [
  'firestore.rules',
  'firestore.indexes.json',
  'src/lib/firebase/groups.ts',
  'src/lib/firebase/userData.ts',
  'src/lib/firebase/dataExport.ts',
  'functions/src/submitReport/',
  'src/contexts/AuthContext.tsx',
];

// Roles that own a high-stakes concern — seated first when capping a TOP panel.
const HIGH_STAKES_ROLES = new Set([4, 5, 6, 27]); // Security, Legal, DPO, DBA

// Technical Writer: a doc-only change owned ONLY by #21 is a SKIP, and #21 is never the
// sole MEDIUM reviewer for a code change.
const TECH_WRITER = 21;

// TOP panels are capped to keep the (expensive) blind panel right-sized (DESIGN §2.6).
const PANEL_CAP = 5;

// Software Architect — the seat for a CODE path no role owns (BIN-788). Someone reviews
// the unknown; nobody reviewing it is what this ticket was filed about.
const UNMAPPED_FALLBACK_ROLE = 14;

// What counts as CODE for the unmapped/trivial split. Deliberately the same surface the
// repo's own commit gates call production code (.claude/shared-plugin.json →
// productionGlobs + reviewGates.patterns): the app client and the Cloud Functions. Repo
// tooling (scripts/, docs/) and prose are NOT code here — a linter tweak or a doc edit
// must keep routing `skip`, or every ownership gap turns into a review nobody needs.
const CODE_ROOTS = ['src/', 'functions/', 'extension/', 'shared/'];

// …with ONE deliberate exception (BIN-805, Malin's call 2026-08-08, alternative (a)):
// the router itself and the repo's gate scripts ARE code here, even though they live
// under docs/ and scripts/. They reach no user, but they decide who reviews everything
// else — a change to route.mjs that quietly widens `skip` would clear its own review, and
// a change to the workflow-map linter can make a CI/deploy gate stop failing. The narrow
// list is the whole point: the alternative (all of docs/ + scripts/ as code) would pull a
// reviewer into every helper-script tweak, so the rest of that tooling keeps routing as
// before. Test siblings are listed too — deleting a gate's test is the same hole as
// deleting the gate. The commit-gate hooks themselves live outside this repo
// (C:/claude-plugins), so they never appear in a blast radius here.
// BIN-864 + BIN-873 (2026-08-12) added the second pair each: `gen-ownership-map.mjs`
// computes the ownership map this router reads — it decides who owns what — and
// `check-public-env.mjs` is the guard that exists because a public env var went missing
// from the production build for three months with CI and deploy green (BIN-849). Both
// routed `skip` until now. Keep this set and `reviewGates` in `.claude/shared-plugin.json`
// IDENTICAL: one advises, the other blocks, and widening one has never widened the other.
const TOOLING_CODE_FILES = new Set([
  'docs/org/route.mjs',
  'docs/org/route.test.mjs',
  'docs/org/gen-ownership-map.mjs',
  'docs/org/gen-ownership-map.test.mjs',
  'scripts/check-workflow-map.mjs',
  'scripts/check-workflow-map.test.mjs',
  'scripts/check-public-env.mjs',
  'scripts/check-public-env.test.mjs',
]);
const CODE_ROOT_FILES = new Set([
  'firestore.rules',
  'firestore.indexes.json',
  'firebase.json',
  'next.config.mjs',
  'tailwind.config.ts',
  'vitest.config.ts',
  'package.json',
]);
const CODE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|rules)$/;

// ── Path matching ────────────────────────────────────────────────────────────────────

// A pattern from the ownership map is an exact file ("firestore.rules"), a directory
// (trailing slash "src/components/ui/" or bare "src/lib/advisor"), or may contain a glob.
function matches(path, pattern) {
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const pat = pattern.replace(/\\/g, '/');
  if (pat.includes('*')) {
    const re = new RegExp(
      '^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$',
    );
    return re.test(p);
  }
  if (pat.endsWith('/')) return p === pat.slice(0, -1) || p.startsWith(pat);
  return p === pat || p.startsWith(pat + '/');
}

const normalize = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');

// "src/lib/tmdb/client.ts" -> "src/lib/tmdb/"; a root file -> "".
function dirOf(path) {
  const p = normalize(path);
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i + 1);
}

// Is this a path where a MISSING owner is dangerous (app/functions code) rather than
// simply uninteresting (docs, plans, scratch)? Drives the unmapped-vs-trivial split and
// gates directory inheritance, so a doc edit never inherits a code role.
export function isCodePath(path) {
  const p = normalize(path);
  if (CODE_ROOT_FILES.has(p) || TOOLING_CODE_FILES.has(p)) return true;
  return CODE_ROOTS.some((r) => p.startsWith(r)) && CODE_EXT_RE.test(p);
}

// Directory-level ownership (BIN-788). The map lists files, so `src/lib/tmdb/newThing.ts`
// matched nothing even though ten siblings are owned. A role owns a directory when it
// owns at least one concrete file directly in it; the count is the tie-breaker (the role
// with most files there is the more plausible reviewer). Glob and directory patterns are
// skipped — they already match recursively in `matches()`.
function ownedDirs(patterns) {
  const dirs = new Map(); // dir -> how many of this role's files live there
  for (const pat of patterns) {
    if (pat.includes('*') || pat.endsWith('/')) continue;
    const dir = dirOf(pat);
    if (!dir) continue;
    dirs.set(dir, (dirs.get(dir) || 0) + 1);
  }
  return dirs;
}

// ── Routing ──────────────────────────────────────────────────────────────────────────

export function route(paths) {
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  const clean = paths.map((p) => p.trim()).filter(Boolean);

  // role num -> { num, title, slug, matched:Set, inherited:Set, specificity, weight }
  const owners = new Map();
  const matchedPaths = new Set();
  const seatOwner = (num, role) => {
    const n = Number(num);
    if (!owners.has(n)) {
      owners.set(n, {
        num: n,
        title: role.title,
        slug: role.slug,
        matched: new Set(),
        inherited: new Set(),
        specificity: 0,
        weight: 0,
      });
    }
    return owners.get(n);
  };

  for (const [num, role] of Object.entries(map.roles)) {
    const dirs = ownedDirs(role.patterns);
    for (const path of clean) {
      // The LONGEST matching pattern, not the first: a role owning both
      // `src/components/ui/` and `src/components/ui/DuotonePoster.tsx` is the specific
      // owner of that file, and the map is stored alphabetically (dir first).
      const hit = role.patterns
        .filter((pat) => matches(path, pat))
        .reduce((best, pat) => (best == null || pat.length > best.length ? pat : best), null);
      if (hit) {
        const o = seatOwner(num, role);
        o.matched.add(path);
        o.specificity = Math.max(o.specificity, hit.length); // longer pattern = more specific owner
        matchedPaths.add(path);
        continue;
      }
      // Directory inheritance — only for code paths (BIN-788).
      const dir = dirOf(path);
      if (!dir || !isCodePath(path) || !dirs.has(dir)) continue;
      const o = seatOwner(num, role);
      o.matched.add(path);
      o.inherited.add(path);
      o.specificity = Math.max(o.specificity, dir.length); // a directory is less specific than a file
      o.weight = Math.max(o.weight, dirs.get(dir));
      matchedPaths.add(path);
    }
  }

  const highStakes = clean.filter((path) => HIGH_STAKES.some((hs) => matches(path, hs)));
  const ownerList = [...owners.values()].map((o) => ({ ...o, matched: [...o.matched], inherited: [...o.inherited] }));
  const unmapped = clean.filter((path) => !matchedPaths.has(path));
  const unmappedCode = unmapped.filter(isCodePath);

  // Tier decision (DESIGN §1.3, + the unmapped/trivial split from BIN-788)
  let tier;
  let reason;
  let reasonCode;
  const codeOwners = ownerList.filter((o) => o.num !== TECH_WRITER);
  const ownedOnlyByWriter = ownerList.length === 1 && ownerList[0].num === TECH_WRITER;

  // Code with NO code-owning role: either nothing matched it at all (`unmappedCode`), or
  // the only role that matched is the Technical Writer — who is never the sole reviewer of
  // a code change. `docs/org/route.mjs` used to land in that second case, since #21 owns
  // all of `docs/` (BIN-805); BIN-834 gave it #25, so the live example of the
  // writer-only branch is now any NEW code file under `docs/` that #25's patterns and
  // directory inheritance do not reach. Both cases get the same answer: seat the
  // architect and name the path so the map gets fixed.
  const pathsOwnedByCodeRole = new Set(codeOwners.flatMap((o) => o.matched));
  const unownedCode = clean.filter((path) => isCodePath(path) && !pathsOwnedByCodeRole.has(path));
  if (highStakes.length > 0) {
    tier = 'top';
    reasonCode = 'high-stakes';
    reason = `high-stakes path(s) ${highStakes.join(', ')} → full panel`;
  } else if (codeOwners.length > 0) {
    tier = 'medium';
    reasonCode = 'owned';
    reason = 'single medium-impact area → one owning role';
  } else if (unownedCode.length > 0) {
    // NOT a skip: nobody reviews this code, which is an unknown blast radius, not a
    // cleared one. Seat the architect and say the map needs the path added.
    tier = 'medium';
    reasonCode = 'unmapped-code';
    reason = `code path(s) with no owning role: ${unownedCode.join(', ')} — nothing in docs/org/ownership-map.json reviews them (Technical Writer #${TECH_WRITER} does not count for code); seating #${UNMAPPED_FALLBACK_ROLE} Software Architect. Add the path to docs/role-responsibilities.md and regenerate the map.`;
  } else if (ownedOnlyByWriter) {
    tier = 'skip';
    reasonCode = 'doc-only';
    reason = 'doc-only (Technical Writer #21 only)';
  } else {
    tier = 'skip';
    reasonCode = 'no-code-paths';
    reason = 'no code paths (docs / plans / scratch) — deliberately trivial, not unmapped';
  }
  if (tier !== 'skip' && reasonCode !== 'unmapped-code' && unownedCode.length > 0) {
    reason += `; also ${unownedCode.length} code path(s) with no owning role: ${unownedCode.join(', ')}`;
  }

  // Panel selection
  let panel = [];
  if (tier === 'top') {
    // seat high-stakes-owning roles first, then by specificity, then match count, then num
    panel = [...ownerList]
      .sort((a, b) => {
        const ha = HIGH_STAKES_ROLES.has(a.num) ? 1 : 0;
        const hb = HIGH_STAKES_ROLES.has(b.num) ? 1 : 0;
        if (ha !== hb) return hb - ha;
        if (a.specificity !== b.specificity) return b.specificity - a.specificity;
        if (a.weight !== b.weight) return b.weight - a.weight;
        if (a.matched.length !== b.matched.length) return b.matched.length - a.matched.length;
        return a.num - b.num;
      })
      .slice(0, PANEL_CAP)
      .map((o) => o.num);
  } else if (reasonCode === 'unmapped-code') {
    panel = [UNMAPPED_FALLBACK_ROLE];
  } else if (tier === 'medium') {
    // the single most-specific owner, preferring a code role over Technical Writer
    const pick = (codeOwners.length ? codeOwners : ownerList).sort(
      (a, b) =>
        b.specificity - a.specificity ||
        b.weight - a.weight ||
        b.matched.length - a.matched.length ||
        a.num - b.num,
    )[0];
    panel = pick ? [pick.num] : [];
  }

  const seated = new Set(panel);
  const dropped = ownerList.filter((o) => !seated.has(o.num)).map((o) => `${o.num} ${o.title}`);

  return {
    tier,
    reason,
    reasonCode,
    highStakes,
    panel,
    roles: ownerList.sort((a, b) => a.num - b.num).map(({ specificity, weight, ...r }) => r),
    dropped,
    unmapped,
    unmappedCode,
    unownedCode,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const ROLE_TITLES = { [UNMAPPED_FALLBACK_ROLE]: 'Software Architect' };

function mdBlock(r) {
  if (r.tier === 'skip') return '## Stakeholders\n\n_None — trivial / doc-only change (no review tier)._';
  const names = r.panel.map((n) => {
    const role = r.roles.find((x) => x.num === n);
    return role ? `#${n} ${role.title}` : `#${n}${ROLE_TITLES[n] ? ` ${ROLE_TITLES[n]}` : ''}`;
  });
  const gap = r.unownedCode?.length
    ? `\n\n_⚠ Unowned code path(s): ${r.unownedCode.join(', ')} — add them to \`docs/role-responsibilities.md\` and regenerate \`docs/org/ownership-map.json\`._`
    : '';
  return `## Stakeholders\n\nTier **${r.tier}** · ${names.join(', ')}\n\n_Routed via \`docs/org/route.mjs\` (${r.reason}). Run \`/stakeholder-review\` before building if this is a plan._${gap}`;
}

function selftest() {
  const cases = [
    { paths: ['firestore.rules'], tier: 'top', mustSeat: 4 },
    { paths: ['src/lib/firebase/userData.ts'], tier: 'top', mustSeat: 6 },
    { paths: ['src/components/ui/DuotonePoster.tsx'], tier: 'medium', mustSeat: 1 },
    { paths: ['public/llms.txt'], tier: 'skip', reasonCode: 'doc-only' }, // owned only by #21
    { paths: ['README-does-not-exist.xyz'], tier: 'skip', reasonCode: 'no-code-paths' },
    // a real runbook change DOES have an owner (#20 Manual/Release QA) — not a skip:
    { paths: ['docs/RUNBOOK.md'], tier: 'medium', mustSeat: 20 },

    // ── BIN-788 ──────────────────────────────────────────────────────────────────────
    // The doc-id contract behind BIN-569/608/624/766 is explicitly #27's now.
    { paths: ['src/lib/mediaTypeDocId.ts'], tier: 'medium', mustSeat: 27, reasonCode: 'owned' },
    { paths: ['src/lib/watchlist/addedAt.ts'], tier: 'medium', mustSeat: 27, reasonCode: 'owned' },
    // A file NOT in the map, in a directory whose siblings are owned → inherited, not skip.
    { paths: ['src/lib/tmdb/prefetch.ts'], tier: 'medium', reasonCode: 'owned' },
    { paths: ['src/components/pages/MoviePageClient.tsx'], tier: 'medium', mustSeat: 26, reasonCode: 'owned' },
    // Code nobody owns at all is an UNKNOWN blast radius, not a cleared one.
    { paths: ['src/lib/no-such-dir/brandNew.ts'], tier: 'medium', mustSeat: 14, reasonCode: 'unmapped-code' },
    // …but ordinary repo tooling and prose still route skip — inheritance never fires
    // off code.
    { paths: ['scripts/gen-app-icons.mjs'], tier: 'skip', reasonCode: 'no-code-paths' },
    { paths: ['tasks/todo.md'], tier: 'skip', reasonCode: 'no-code-paths' },

    // ── BIN-805 ──────────────────────────────────────────────────────────────────────
    // The router and the gate scripts review everything else, so they can no longer
    // clear themselves as doc-only.
    // BIN-834 gave the router and the map generator a real owner (#25) — they decide who
    // reviews everything else, and until then the router permanently printed "add the path
    // and regenerate the map" about ITSELF, an instruction nobody was assigned to follow.
    // These two pins moved with that change; `check-workflow-map.mjs` is still unowned and
    // still pins the fallback, so both branches stay covered.
    { paths: ['docs/org/route.mjs'], tier: 'medium', mustSeat: 25, reasonCode: 'owned' },
    { paths: ['docs/org/route.test.mjs'], tier: 'medium', mustSeat: 25, reasonCode: 'owned' },
    { paths: ['scripts/check-workflow-map.mjs'], tier: 'medium', mustSeat: 14, reasonCode: 'unmapped-code' },

    // ── BIN-864 / BIN-873 ────────────────────────────────────────────────────────────
    // Same class, two more files — and as of BIN-869 they no longer answer the same way,
    // so they are pinned differently on purpose.
    //
    // `gen-ownership-map.mjs` got a REAL owner in this commit (#25, alongside route.mjs
    // and route.test.mjs — it computes the map this router reads), so its case is now
    // pinned as specifically as the BIN-805 ones above. Leaving it at bare `tier` would
    // have been the looser pin outliving the reason for looseness: docs/org/route.test.mjs
    // already asserts `owned` / `[25]` for this exact path, and a golden case that stayed
    // vague while the gating test was specific is how one file ends up with two answers.
    //
    // `check-public-env.mjs` is still unowned, so ITS case keeps only `tier`. That is the
    // original BIN-864/873 reasoning and it still applies to this one file: naming an
    // owner in docs/role-responsibilities.md is an INTENDED improvement, and a case that
    // pinned `unmapped-code` would report that improvement as a failure. What must never
    // change is that it stops being `skip`. Measured at these bytes: all four files under
    // docs/org/ are `owned` / [25]; all four under scripts/ are `unmapped-code` / [14] —
    // the deliberate #14-fallback seat §25 says the check scripts keep.
    //
    // `--selftest` is invoked by NOTHING — not package.json, not ci.yml, not deploy.yml,
    // not a hook — so a stale pin here cannot fail a deploy. That is a reason to keep it
    // honest by hand, not a licence to ship it red: the Usage line advertises "exit
    // non-zero on fail", and a documented command that is knowingly broken teaches the
    // next reader to ignore it. Wiring this block into a gate, or folding it into
    // route.test.mjs, is its own job (BIN-880).
    { paths: ['docs/org/gen-ownership-map.mjs'], tier: 'medium', mustSeat: 25, reasonCode: 'owned' },
    { paths: ['scripts/check-public-env.mjs'], tier: 'medium' },
    // A high-stakes path outranks everything, even when nothing else in the set is owned.
    { paths: ['firestore.rules', 'src/lib/no-such-dir/brandNew.ts'], tier: 'top', mustSeat: 4 },
  ];
  let failed = 0;
  for (const c of cases) {
    const r = route(c.paths);
    const okTier = r.tier === c.tier;
    const okSeat = c.mustSeat == null || r.panel.includes(c.mustSeat);
    const okReason = c.reasonCode == null || r.reasonCode === c.reasonCode;
    if (!okTier || !okSeat || !okReason) {
      failed++;
      console.error(`FAIL ${JSON.stringify(c.paths)} → tier=${r.tier} reasonCode=${r.reasonCode} panel=${JSON.stringify(r.panel)} (wanted tier=${c.tier}${c.mustSeat != null ? `, seat ${c.mustSeat}` : ''}${c.reasonCode != null ? `, reasonCode ${c.reasonCode}` : ''})`);
    } else {
      console.log(`ok   ${JSON.stringify(c.paths)} → ${r.tier} ${r.reasonCode} ${JSON.stringify(r.panel)}`);
    }
  }
  if (failed) {
    console.error(`\n${failed} selftest case(s) failed.`);
    process.exit(1);
  }
  console.log('\nall selftest cases passed.');
}

function main(argv) {
  if (argv[0] === '--selftest') {
    selftest();
    return;
  }
  const wantMd = argv[0] === '--md';
  const args = wantMd ? argv.slice(1) : argv;
  let paths = args;
  if (paths.length === 0) paths = readStdin().split(/\r?\n/);
  paths = paths.map((p) => p.trim()).filter(Boolean);
  if (paths.length === 0) {
    console.error('usage: node docs/org/route.mjs <path> [<path> ...]   (or pipe `git diff --name-only`)');
    process.exit(1);
  }
  const r = route(paths);
  console.log(wantMd ? mdBlock(r) : JSON.stringify(r, null, 2));
}

// Run the CLI only when this file IS the entry point. Without the guard, merely
// importing `route` (which docs/org/route.test.mjs does) ran the CLI with the test
// runner's argv, printed a usage error and called process.exit(1) — i.e. the module
// was untestable, which is half of why it had no tests (BIN-802).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
