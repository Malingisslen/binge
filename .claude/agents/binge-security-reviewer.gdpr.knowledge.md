# binge-security-reviewer — gdpr chapter

Read only when the staged diff touches this chapter's paths (see .claude/shared-plugin.json → knowledge.tiers).

## GDPR export/delete completeness
- `collectUserDataSnapshots` auto-covers ONLY `users/{uid}/**` + a fixed collectionGroup list; every NEW
  top-level uid-keyed collection is wired manually. A doc-id that merely STARTS with uid is swept by
  NEITHER — restructure or add a queryable `uid`.
- **A THIRD shape escapes the subcollection-vs-admin-doc binary: a uid-keyed leaf under a NON-user parent** —
  `releaseNotifyState/{tmdbId}/notified/{uid}`, `reviews/{id}/likes/{uid}`, `usernames/{name}.uid`. Ask "does
  ANY doc identify a specific user, directly or by doc-id?" If yes: `uid` FIELD + CG sweep, or if retained,
  Art. 17(3) comment + policy entry + reaper.
- **A duplicated, structurally-identical type declaration split across an admin/non-admin module pair hides a
  GDPR-erasure category from the compiler.** Two independently-declared shapes for the same erasure payload
  (e.g. a local mirror of `TraceErasure`) are mutually assignable, so a category the pure decider COLLECTS can
  go silently unwritten by the Admin-SDK executor — no type error, no test failure, just a field that never
  reaches `memberTraceWrites` (BIN-1109/1110, caught before shipping). Fix: one declaration; the other side takes it via `import type`, which the compiler
  erases, so no runtime cycle and no admin import leaks into the testable-without-firebase side. Which module
  holds it is not the point and is not stated here — in BIN-1109 both are admin-free, and the Admin-SDK
  import lives in a third file.
- **When a change turns "delete the whole parent" into "the parent SURVIVES", every uid-bearing field in the
  surviving subtree becomes a new retention — re-derive the field list from the RULES' match blocks and the
  writer's payloads, never from the diff's own enumeration.** The commonest miss is a SECOND uid field on the
  SAME document as the one that was found, and it is usually LIST-shaped, so a grep for the scalar idiom
  (`*Uid`) skips it. The FIXTURE hid it — the emulator seed wrote only `pickedByUid`, so a passing
  suite proves nothing about a field the seed omits; seed every field the rules' `hasOnly` names. Walk
  `sed -n <start>,<end>p firestore.rules | grep -n "match /"` for the subtree, then read each block's
  `hasOnly` list as the field inventory.
- A new TOP-LEVEL GDPR-cascaded doc needs its own seeded live-emulator assertion in `account-deletion.test.ts`
  — the `KNOWN_USER_SUBCOLLECTIONS` loop misses it, and a mocked test proves wiring, not live erasure. The
  three-way set-equality guard (rules paths == const == helper `collection()` reads == `keyof
  UserDataSnapshots`, locked by `dataExport.coverage.test.ts`) is the structural defense (BIN-347) — and it is
  also what makes `snaps.profileSnap.ref` the right way to queue the profile delete, since a hand-built path
  is invisible to it.
- CG export queries need (a) a `uid` FIELD per doc — doc-id alone is unqueryable — and (b) an owner-scoped
  recursive-wildcard read rule (`match /{path=**}/likes/{id}`); nested per-doc rules don't cover CG.
  **Collector change needed?** New subcollection → yes; new field/doc-ID scheme on a covered subcollection →
  no; tab-local ephemeral state isn't a collection.
- A TTL reaper as sole erasure path needs a SYMBOLIC test (`MARKER_MAX_AGE_MS > functionalWindowMs`), not a
  hardcoded number. Plaintext join tokens get two layers: client cascade + Admin-SDK CG reaper (Art.17
  backstop for abandoned joins/Console-deleted accounts).
- **A read rule conditioned on more than plain membership (reciprocity `exists()`, roles, `isAdmin()`) can break
  the OWNER's own export/delete.** Split `read` into `get` + `list`: `get` gets an unconditional same-uid
  carve-out; `list` keeps the strict gate. Suites that always seed the actor's own doc MASK this (BIN-184).
- **Consent honesty:** `termsAcceptedAt`/`termsVersion`/`ageConfirmedAt` write only in `ensureUserProfile`'s
  `!snap.exists()` branch, justified by a comment naming ONE screen — **any sign-in call site outside it mints
  consent from a page that showed neither** (BIN-668), and an attestation is only as wide as its grep pattern
  (a handler passed by REFERENCE never matches `grep 'signIn()'`). Never backfill; enumerate ALL orderings on
  a write race. **An ABORTED erasure hits the same branch**, dating a consent record today for someone leaving.
