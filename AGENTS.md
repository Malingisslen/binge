# AGENTS.md

Guidance for Codex and other non-Claude coding agents working in this repository.

**Read `CLAUDE.md` — it is the single source of truth** for the working agreement,
tech stack, architecture, data model, design constraints, commands, and deployment.
This file used to duplicate that content and drifted (it claimed Next.js 14 while the
app runs Next.js 16); the stack description now lives in exactly one place.

Codex-specific notes:
- The commit gates described in CLAUDE.md ("Commit gates" section) are enforced by
  Claude Code hooks and will not fire for other agents — apply the same discipline
  manually: run `npm run lint && npm run typecheck && npm test` before committing.
- Review the decided-calls list in `.claude/rules/accepted-deviations.md` (if present
  on this machine) before proposing changes to things that look like mistakes.
