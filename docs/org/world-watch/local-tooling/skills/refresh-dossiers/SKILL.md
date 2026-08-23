---
name: refresh-dossiers
description: Re-auditerar bara de roller vars dossier flaggats inaktuell (av freshness-hooken) mot nuvarande kod och uppdaterar deras avsnitt i role-responsibilities.md. Använd när användaren säger /refresh-dossiers, "uppdatera rolldossierna", "refresh role dossiers", eller när en SessionStart/notis säger att dossierer är inaktuella. Re-auditerar ALDRIG alla 28 roller — bara de flaggade.
---

# /refresh-dossiers — re-audit only the roles whose code changed

The freshness hook (`.claude/hooks/freshness.mjs`, `stampDossier`) drops a marker for a
role whenever a file it owns is edited. This skill re-audits **only those flagged
roles** against the current code, updates their sections of the role map, and clears
the markers. It **only ever edits documentation** — never app code.

State: markers in `.claude/state/dossier-stale/<roleNumber>.marker` (gitignored; each
line is `<editedPath>\t<timestamp>`). Role map: `docs/role-responsibilities.md`.
Ownership map: `docs/org/ownership-map.json` (generated, see step 5).

## Flow

### 1. Read the flags
```bash
ls .claude/state/dossier-stale/ 2>/dev/null && echo "---" && \
  for f in .claude/state/dossier-stale/*.marker; do echo "== $f =="; cat "$f"; done 2>/dev/null
```
- No markers → nothing drifted. Say so and stop. **Never** audit unflagged roles.
- Otherwise you have a small set of `<roleNumber>` → list of edited files.

### 2. Re-audit each flagged role (only those)
For each flagged role number:
- Read its section in `docs/role-responsibilities.md` (`## N. <Title>`).
- Read the **edited files** named in its marker + the role's `patterns` in
  `ownership-map.json` to see current reality.
- Ask: does the dossier still describe these files accurately? Look for:
  - A file the role's prose names that was renamed/moved/deleted.
  - A new sibling file under an owned dir that's a material new responsibility.
  - A described behavior/contract that the edit changed (e.g. a new Firestore field,
    a changed status-model rule, a removed guard test).
  - For the 3 MVP world-watch roles (4 Security, 5 Legal, 6 DPO), also reconcile the
    `ownedPaths`/`watchItems` in `docs/org/world-watch/state.json` if they drifted.

### 3. Update only the drifted sections
- Edit just the affected role's section(s) of `role-responsibilities.md` (and, if an
  MVP role's owned paths changed, its `state.json` block).
- Keep the doc's style: paths in backticks, line-numbers omitted, grounded in real
  files. If nothing actually drifted, make no edit — re-auditing and finding it still
  accurate is a valid outcome.
- **Do not touch app code, tests, rules, or functions.** This skill is documentation-only.

### 4. Clear the markers for audited roles
```bash
rm .claude/state/dossier-stale/<roleNumber>.marker
```
Delete only the markers you actually re-audited. Leave any you didn't reach.

### 5. If owned paths themselves changed, regenerate the map
If the edits added/removed/renamed files such that the **patterns** are now wrong
(not just the prose), update the role doc first, then regenerate the committed map so
it stays honest to source:
```bash
node docs/org/gen-ownership-map.mjs
```
Never hand-edit `ownership-map.json` — it's generated.

**It may exit 1, and that is a real finding, not a crash** (BIN-803). Besides writing the
map, it checks whether any tracked code file sits in a directory the map enumerates
file-by-file without a role naming it, ratcheted against the committed baseline
`docs/org/ownership-gaps.json` (299 entries today). The map is written BEFORE the check, so
nothing is lost — but the exit code is telling you a NEW unowned sibling appeared. Name it
under its owning role in the doc and re-run. Only if genuinely no role should own it:
`node docs/org/gen-ownership-map.mjs --update-gaps` to re-baseline, deliberately. The same
check runs in `npm test`, which gates CI and the deploy, so ignoring it here just moves the
failure to the deploy.

### 6. Commit the doc changes
Commit `docs/role-responsibilities.md` (+ `ownership-map.json`/`state.json` if changed,
and `docs/org/ownership-gaps.json` if step 5 re-baselined it — an uncommitted re-baseline
does not stay quiet, it fails `npm test` on the deploy path)
with a message like `docs(org): refresh dossiers for roles N, M after <change>`.
(Markers live under gitignored `.claude/state/` and are never committed.)

## Hard rules
- Re-audit ONLY flagged roles — never all 28 (that's the whole point: targeted, cheap).
- Documentation-only: this skill must never modify `src/`, `functions/`,
  `firestore.rules`, tests, or config — only `docs/` (+ the generated map).
- Runs only when invoked interactively (the $0 model). The hook just flags; the audit
  is a human-triggered session.
- If a marker names a file you can't find, note it (the dossier likely references a
  deleted path) and update the prose accordingly.

## Gotchas
- A single edit can flag several roles (shared surfaces, e.g. `firestore.rules` →
  Security + DBA + DPO). Audit each; they describe the same file from different intents.
- Don't widen scope: finding drift in role N doesn't license re-auditing role M unless
  M was also flagged.
