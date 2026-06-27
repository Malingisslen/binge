# local-tooling — committed mirror of the gitignored world-watch glue

`.claude/` is gitignored in this repo (all Claude harness config is local-only), so the
world-watch system's **executable glue** — two hooks and two skills — would not survive a
fresh checkout. This directory is the **committed source of truth** for that glue, so the
loop can be rebuilt from committed docs alone.

| File here (tracked) | Deploys to (gitignored) |
|---|---|
| `hooks/world-watch-due.ps1` | `.claude/hooks/world-watch-due.ps1` |
| `hooks/dossier-freshness.ps1` | `.claude/hooks/dossier-freshness.ps1` |
| `hooks/exit-plan-suggest-review.ps1` | `.claude/hooks/exit-plan-suggest-review.ps1` |
| `hooks/org-retro-due-check.mjs` | `.claude/hooks/org-retro-due-check.mjs` |
| `skills/world-watch/SKILL.md` | `.claude/skills/world-watch/SKILL.md` |
| `skills/refresh-dossiers/SKILL.md` | `.claude/skills/refresh-dossiers/SKILL.md` |
| `skills/stakeholder-review/SKILL.md` | `.claude/skills/stakeholder-review/SKILL.md` |
| `settings.hooks.json` | merge into `.claude/settings.json` → `hooks` |

**Canonical direction:** edit the copy *here*, then redeploy into `.claude/` (the copy
command is in [`../DESIGN.md`](../DESIGN.md) → "Rebuild local tooling"). The `.claude/`
copies are what actually run; these are what survive git.

Everything that is **state or data** (the world-model, `state.json`, `ownership-map.json`,
`DESIGN.md`, the role map) already lives committed under `docs/` — only this executable
glue needed mirroring.
