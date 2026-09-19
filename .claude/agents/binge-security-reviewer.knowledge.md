# binge-security-reviewer — knowledge (principles)

**Edited IN PLACE.** Fold each lesson into the bullet it belongs; merge duplicates, supersede
contradictions, never append at the bottom. A bullet earns its place only by changing what a review does.
Dated record → `…archive.md` (append-only).

## Seed checklist
- **Ownership:** every per-user read/write enforces `request.auth.uid` (`blocked`=hygiene). `NEXT_PUBLIC_`
  secret = finding.

## How to prove a finding
- **A test title is not coverage** — an `it()` naming "rejects 0 → 1" actually asserted `5`. A mock with FEWER
  FIELDS than the real hook can't exercise what the missing one gates (a `useAuth` mock lacking `user` encodes
  ABSENT, not null). Deny tests whose rule `get()`s the writer's own profile must seed via
  `withSecurityRulesDisabled`, else they pass vacuously. A test reading its subject back through a SECOND
  validator proves nothing — assert the STORED bytes. **A DEFAULTED parameter added to a shared helper needs
  its own pin:** BIN-875's `extract` default went in while every fixture used `disabled:false`, under which
  both candidates agree — swapping the default stays green. Pin it with the ONE fixture that tells them apart.

## Anon/session identity and caller binding
- **Confirm a flag is genuinely cosmetic before rating its immutability gap** — grep whether any rule/function
  reads it for access. Cross-account write is structurally impossible when the target uid comes from the
  closed-over auth context or the doc PATH, never a parameter.

## Review scope, premises and attestations
- **Challenge a dispatching prompt's premise, and scope a RE-review by SHA.** "NEVER had a security review",
  "everything else is as you last saw it" and "only file X moved" have each been false; the brief's file list
  is a hint, never the boundary. **Sha equality proves the BYTES held, not that their CLAIMS do** — a
  byte-identical module's doc comment is falsifiable by a change elsewhere in the diff. An unchanged file the
  diff depends on is exempt from re-reading, never from re-derivation.
  **THIS FILE is the worst place to write a finding in the present tense, and the only place no gate
  re-reads.** A finding describes bytes that exist because they are WRONG; the fix deletes them, and the
  sentence becomes a standing instruction that is false — handed to the next review of the same surface as
  if it were the code. It is outside every `reviewGates` pattern and in `claimLint.exemptPaths`, so nothing
  will catch it: BIN-1063 steg 3 bunt 2 shipped with two such bullets, one of them quoting an attestation
  the same round had struck, both found by the INTEGRATION reviewer rather than by me. So: write the
  TRANSFERABLE SHAPE plus the durable fix, attribute the instance to the review round in the PAST tense
  ("found in review, fixed before it shipped"), and point at the dated archive entry for the verbatim
  finding. Supersede in place, never a bare strike — that carve-out is what the archive exists for. Sweep
  this file for the ticket id after every round whose findings were accepted.
- **When a diff's ticket matches a gap NAMED in a prior entry, re-grep to confirm FULL closure** — a targeted
  fix routinely leaves an identical-pattern sibling unfixed. A ticket AC promising 'a new test proves X' with
  no test file in the diff is itself the finding; same for an ADR's Consequences saying a field 'will be
  added to `hasOnly()`'. **On a RE-review, MUTATE each accepted fix — never grep for it.** BIN-816 r3: a
  one-line re-read sat among 64 passing tests, sixteen named for that ticket, and neutering it left 64/64
  green — a named test block is not a pin. Mutate the WIRING too. **Reproduce the author's mutation count —
  it is a claim** (r4: 'exactly 1 of 66' was 2). One shared staged blob means no per-round diff: mtime-sort
  `git diff --cached --name-only` for the real delta (r4's brief named five files, eight moved).
- **Reviewing a FORWARD-REVERT:** prove exactness (`git diff <base> -- <files>` EMPTY); baseline = DEPLOYED.
