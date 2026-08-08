# Code Style

## Documentation Files — the self-explanatory-code principle

Docs that explain what code does are debt: **delete them, and spend the saved tokens
making the code self-explanatory** (names, structure, targeted WHY comments). A committed
doc earns its place ONLY as one of six classes: **decision record** (ADR — alternatives,
why X over Y, dated), **glossary** (meaning the code cannot express), **navigation
pointer** (a THIN link-chain — thin is load-bearing; a nav doc that re-explains the code
gets condensed), **operating instructions** (CLAUDE.md, `.claude/rules/`, skills,
runbooks), **machine-consumed data** (read by CI, hooks, scripts), or a **for-Malin doc**
(plain language, explicitly for the founder).

- **Default to no new doc file.** Before writing a `.md`/`.html`, name its class AND its
  reachability (what rule/skill/comment points at it, or that it's for Malin). Neither →
  don't create it. Write-only analysis reports rot and get deleted later.
- Scratch for the current task lives in `tasks/` and is disposable — delete plans once
  implemented.
- Prefer updating an existing doc of the same class over creating a new one. No V1/V2
  copies; no per-directory READMEs.
- `/docs-sweep` (workflow-guards plugin) audits the whole repo against this taxonomy.

## Test-extraction pattern

Pure-logic helpers get extracted out of hooks/components into their own file so they're
testable without a Firebase import in the test environment (pattern: `useX.helpers.ts`,
`sessionTiming.ts`). `src/lib/` root is reserved for these pure helpers; domain code lives
in `src/lib/<domain>/` (e.g. `tmdb/`, `firebase/`, `calendar/`).
