---
paths:
  - "src/**"
  - "functions/**"
  - "firestore.rules"
---

# Accepted Deviations

Deliberate, decided deviations from otherwise-applicable rules. **Review agents
(binge-code-reviewer, binge-security-reviewer, binge-test-reviewer) MUST read this before
filing a finding** — the commit gate names this file when it blocks, and each agent's
definition points here. Do not re-flag anything listed below.

Append-only. Supersede an entry with a newer dated entry; never silently delete — retire it
verbatim to `.claude/accepted-deviations.archive.md` instead; the archive file, not a diff, is
the readable history of what was retired and when.

**Correction (2026-08-12, BIN-803):** an earlier version of this paragraph said "`.claude/` is
gitignored, so there is no git history to fall back on". That is false and is now load-bearing:
this file, `.claude/shared-plugin.json` and the agent knowledge/archive files are all TRACKED —
`.gitignore` excludes only per-run state: `.claude/state/`, `worktrees/`, `cache/`,
`hooks/sessions/`, `hooks/__pycache__/`, `linear-tracker.json`, `scheduled_tasks.lock` and
`*.doctor-backup`. Since BIN-803 a pattern's survival in `docs/org/ownership-map.json`
depends on whether git tracks it, so a maintainer acting on the old sentence would wrongly add
these paths to `UNTRACKED_OWNED` or drop them from the map.

Format: **what it deviates from** — the deviation — **Why:** rationale — date.

---

### [Security] Blocking is hygiene-level, not a security boundary
`users/{uid}/blocked/{targetUid}` is enforced by CLIENT-side filtering in reviews/feed/
comments. A security review will notice it's bypassable — that is accepted. **Why:** blocking
here is a comfort feature (hide content), not access control; the data it "hides" is public
UGC anyway. Do not file "blocking must be enforced in rules". — 2026-06

### [Moderation] Reports are client-create-only with no in-app admin surface
`reports/{reportId}`: clients can only create, never read; the admin flow is the Firebase
Console per `docs/moderation.md`. **Why:** solo-founder moderation at pre-launch scale does
not need an in-app admin panel; Console + runbook is the decided flow. Do not file "missing
admin UI / missing read rules for reports". — Sprint 5

### [Security] Anonymous Tillsammans votes are link-trust only
One link-holder can forge another ANONYMOUS participant's single vote or corrupt an anon
slot's display fields. Signed-in participants are NOT forgeable (BIN-509 bound writes to the
caller). **Why:** Malin's call 2026-07-16 against the full panel — ephemeral 7-day data and an
unlisted-link trust model beat requiring login to vote (product regression) or Anonymous Auth
(new GDPR identifier). Rationale in full: ADR 0015. Do not file "anon session votes are
forgeable", and do not "fix" it with a token stored on a public-read doc — that is not a
secret. — 2026-07-16

### [Security/Cost] Tillsammans write rules have NO session-expiry gate — twice decided
Writes to expired-but-unreaped sessions stay possible until retentionCleanup reaps them
(~30d). Omitted in BIN-24 for per-write read cost; BIN-509's panel proposed adding it and
Malin RE-AFFIRMED the omission 2026-07-16. Rationale in full: ADR 0015. Do not re-propose the
expiry gate absent new facts (e.g. observed zombie-session abuse). — 2026-07-16

### [Security] groups.ts membership-add rollback can strand a late compensating write
`joinGroupViaToken`/`acceptGroupInvite`'s compensating `arrayRemove` rollback (BIN-532) has no
re-check before firing, so a STALLED call's late rollback can strip a different, independently
completed re-establishment of the same membership. Effect is self-locking the SAME account out
of their own group content, and leave-and-rejoin self-heals — never a cross-user leak.
**Why:** fixing it needs a `getDoc` immediately before the rollback; not worth the extra read
for a self-limiting, same-account-only edge case. Do not file without new facts (e.g. observed
stalled-call collisions). — 2026-07-19

### [Data] groups.ts's myGroupsCache write-after-await race — third iteration, self-healing
The per-uid TTL cache of "my group ids" still carries a theoretical race between a concurrent
membership-add invalidation and an in-flight stale scan's cache write, but self-heals within
the 5-minute TTL instead of poisoning permanently (unlike the two prior, reverted attempts —
see BIN-510's history). **Why:** this exact race class has independently reached "low severity,
acceptable" across three review passes on a fire-and-forget best-effort sync where the worst
case is a delayed, not lost or corrupted, progress sync. Do not file without new facts.
— 2026-07-19

### [Security/Cost] The watchlist read rule stays fail-OPEN on `effectiveVisibility`
`firestore.rules`' public branch trusts the denormalized `effectiveVisibility` field and never
consults the owning profile. If the public→private cascade fails AND `markVisibilitySyncPending`
also fails (one network drop can kill both), items keep serving as public with no flag, warning
or retry. BIN-587's Option 1 (pending flag + settings warning + manual retry + one auto-retry per
app load) is the accepted mitigation. **Why:** Malin's call 2026-07-30 — the fail-closed rule
needs a cross-document `get()` billed on every read of the app's highest-traffic surface, against
the 25 SEK/mån cap, to close a residual that requires two simultaneous failures with no real users
yet. BIN-609 is CANCELED, rationale on the ticket. Do not re-file "the visibility read rule fails
open" or re-propose the profile lookup absent new facts (real traffic on public libraries, an
observed leak, or `markVisibilitySyncPending` failing in practice). — 2026-07-30

### [Testing] tmdbTosSweep — coverage is NOT what gates the mutating mode
The orchestrator IS emulator-tested (BIN-566): the loop lives in `runSweep.ts` behind an
injected `SweepIo` port, and `src/test/rules/tmdb-sweep-orchestrator.test.ts` drives it against
a live Firestore emulator via `npm run test:rules` — dry-run count-only, thrown scan and thrown
clear-commit each writing the `lastRun` audit before re-throwing, cursor resume in both modes,
and mutating clears sparing fresh sibling groups. So do not file "add tests before flipping
`mutateEnabled`" — that precondition is discharged. The remaining gates are BIN-454/BIN-468
(stamp propagation needs real traffic, prod dry-run cost recorded, missed-run alert), the flip
is Malin's Firebase Console action, traffic-gated to ~Nov, and **a sprint may never do it**.
This entry supersedes the 2026-07-20 one (kept verbatim in `.claude/accepted-deviations.archive.md`);
the in-code stop-sign comment was removed, so this file is its only home. — 2026-07-24
