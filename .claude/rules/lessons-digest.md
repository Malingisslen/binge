# Lessons Digest — core (auto-loaded)

Short rules; the full lesson for each id is in `tasks/lessons.md`, the pre-2026-09-19 long form in
`tasks/archive/lessons-digest-long-form.md`. **Sync contract:** a new lesson gets its line in the same
edit, here if it binds any session, in `lessons-digest-delivery.md` for sprint, review-gate, routing
and workflow-map lessons, in `lessons-digest-testing.md` for lessons that bind only in tests.

## Claims in prose (comments, docs, plans, commit messages)

- [Workflow] A number, "the only", "all" or a superlative in prose is an unverified claim: run a command first, or leave it out (BIN-905/918, BIN-766/941, BIN-1088).
- [Workflow] Stryk hellre än att formulera om: a wrong sentence is STRUCK, not reworded. Quote it, say it is struck, name one command, explain nothing (2026-08-21, BIN-979, BIN-1165, BIN-1207). Carve-outs: a decision record gets a dated successor, `*.knowledge.md` follows its archive convention, and the record of unresolved work is never struck.
- [Workflow] Strike it everywhere in the same batch, searching multi-line and whitespace-normalised, with several wordings (BIN-1112, BIN-1088).
- [Workflow] Mostly-prose batches do not converge: nearly every review finding was my own prose, not code. Prefer striking (BIN-1028, BIN-1059/1060/1061/1064, BIN-1063).
- [Workflow] The correction of a finding is the riskiest prose: point at the ticket, name parameters instead of counting them (BIN-1077/826/790, BIN-1085).
- [Workflow] A published command must be able to CONTRADICT its sentence, and its OUTPUT must be read: running is not enough (BIN-1134, BIN-929/935/938).
- [Workflow] Write commands without pipes or escapes, and extract them from the committed file (BIN-929/935/938, BIN-1207).
- [Workflow] A count whose truth rests on an unstated premise cannot be re-derived: strike it (2026-08-26).
- [Workflow] A line number in a plan is false the moment it is committed: name the function, test or symbol (BIN-954, BIN-1203).
- [Workflow] A residual gap is measured against a clock: name which clock first (BIN-909).
- [Workflow] A CONSEQUENCE in a comment is a claim: provoke it against a copy (BIN-1140/1134).
- [Workflow] After a strike, reread the paragraph for a word that rested on it (BIN-1154); removing a quantifier can change what a sentence points at (BIN-1152).
- [Workflow] Sweep on the CONSEQUENCE, not the mechanism, across the whole tree (BIN-1152).
- [Workflow] An unsound `awk` derivation can still print the right answer: anchor on the real line and its brace (BIN-1165/1177).
- [Workflow] A date is a claim: read today's date from the session (BIN-1203).
- [Workflow] Commit messages cannot be corrected (`--amend` is forbidden): no counts, "the only" or superlatives there (BIN-1193).
- [Workflow] "There is no test file for X" is a claim that dismisses work: `ls` first (BIN-1127).

## Measuring before acting

- [Workflow] "I read very little of what you reply" is a config bug first; long answers become an HTML page (2026-07-25).
- [Workflow] An ADR's `Status: Accepted` beats an older comment thread: read the status field first (BIN-816).
- [Workflow] Measure the cause, and run the ticket's own derivation commands, before putting a question to Malin (BIN-1080, BIN-1139).
- [Workflow] "It needs a real run" is not "I cannot run it": try to build the instrument, a throwaway PR included (BIN-1050, BIN-999).
- [Workflow] An inherited derivation is unmeasured: `git grep -n "function <name>"` each name (BIN-1203).
- [Workflow] A derivation that fits the cases you imagined is not one: run it against the actual diff (BIN-1120).
- [Workflow] A fix that reads a MARK must check who SETS it; mark the difference where it is thrown (BIN-1118).
- [Workflow] Never run `log_event.mjs ... --help`: it writes a row to the append-only `events.jsonl` (BIN-1247).

## Editing files safely

- [Workflow] A multi-file script with an assert per edit crashes midway and silently skips the rest: one file at a time, grep each change (BIN-1028).
- [Workflow] Files can have mixed line endings: normalise both sides or anchor on one line (BIN-990).
- [Workflow] An Admin-SDK script must name its project and print it before the first read; `--dry-run --apply` writes (BIN-1063).
- [Workflow] A probe against live data is a live run: never pipe a writing command to `head`; record a deviation dated, not reworded (BIN-1063).

## Design

- [Data] A legacy-to-namespaced doc-id migration merges per VALUE, not per document (BIN-569).
- [Design] A keep-union-cap ratchet only retains anything when the cap exceeds the input: test by forcing one id out (BIN-823).
- [Design] A ratchet counted as a SHARE needs an absolute floor for small bases (BIN-816).
- [Design] A new "document exists" cache must follow every deletion; bump a generation counter synchronously before the first await (BIN-954).
- [Design] When a shared write path may REFUSE, list the callers that confirm unconditionally first (BIN-1025).
- [Design] A lock that matures over time must not rewrite its own memory on each check; name the quantity its clock measures (BIN-1023).
- [Security] A comparator that lets null through on CREATE is a deletion hole on UPDATE: require `!= null`, test `deleteField()` (BIN-1155).
- [Workflow] Everything after the load-bearing write is best-effort and reported separately (BIN-1166).
- [Design] A shared helper carries its TOLERANCES into every branch it joins: put the clause on the widened branch (BIN-1207).
- [Design] Narrowing a catch to the measured error code silences everything else: keep reporting under its own `kind` (BIN-1251).
- [Design] A condition for a CLASS of paths: list the paths from the file first, test each both ways (BIN-1118).
