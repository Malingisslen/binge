# binge-security-reviewer — client chapter

Read only when the staged diff touches this chapter's paths (see .claude/shared-plugin.json → knowledge.tiers).

## Cross-account and cross-session leak classes
- **Invalidate a per-account cache/ref/mirror on the OWNER IDENTITY, never on the owned VALUE.** A value-keyed
  dep degrades to "never invalidates" on the empty/default state — the NEW-user state (BIN-592: an effect
  keyed `[source]` never re-ran between two users both at `undefined`). Tell: a hook whose doc-comment names
  an account scope but whose dep array holds only payload. Verify the key is the RIGHT identifier (`uid`, not
  the lagging `user.uid`) and CURRENT; SIGN-OUT resets A→null; SIBLINGS carry the class.
- **When a sign-out handler clears per-session refs, audit the reset SET — what it clears AND what it keeps.**
  A per-login retry latch MUST clear (BIN-617); a MONOTONIC epoch must NOT (a pre-sign-out run could
  re-qualify as `isCurrent()`); a per-TAB counter must not either, but key it `Map<uid,n>`. A uid-scoped
  DELETION marker must survive sign-out and only its render mirror reset (BIN-816).
- **A bare `await` on a client write against `persistentLocalCache` can HANG forever, not just fail.**
  `setDoc`/`updateDoc`/`deleteDoc` resolve only on server ACK; offline they never settle (BIN-844). Fix with
  `Promise.race` vs a short timeout, honest only if the abandoned write is truly DISCARDED (`terminate()`
  alone does not cancel pending writes; `clearIndexedDbPersistence()` after it does). READS differ:
  `getDocs`/`getDoc` fall back to CACHE, so a `catch` fallback on a query is near-unreachable offline.
- **'A surface that is never rendered cannot write' is false for a tab that already rendered it.** BIN-816's
  limbo screen swaps `AppShell` off a React flag; a SECOND tab never re-runs the profile load, and the
  auto-writing providers (`WatchlistProvider` migrations) sit ABOVE the swapped shell anyway. `isOwner` never
  requires `users/{uid}` to exist, so those writes outlive the profile and no 'account without a profile'
  sweep sees them. When a render-level gate replaces write-site gates check (a) it re-reads its SOURCE (the
  localStorage marker) not a state snapshot — a `storage` listener fires only in OTHER tabs, and an in-flight
  load's late `.then` writes a stale `false` unless it re-reads too — and (b) the WHOLE provider stack above
  it, effect by effect. The cross-device gap is NOT bounded by the server sweep whatever the policy doc says
  (ADR 0022/BIN-879 accepted it); a Console-only MANUAL erasure (RUNBOOK §5f) needs the same completeness bar.
- **Per-uid listener state that resets only inside `if (!uid)` leaks across a truthy→truthy uid switch**
  (shared device, no sign-out). Reset unconditionally at the effect's TOP — and guard a cross-account
  MIGRATION effect with a ref set INSIDE the same synchronous snapshot callback that sets the state it reads.
  **The guard doesn't travel with the ref — check every call site sharing it** (BIN-598).
- **A deny-list redaction on a doc with no `hasOnly` write-whitelist eventually leaks a newly-accreted field**
  (whole-doc reads; client redaction never stops a raw SDK/REST read). Fix: source → `allow read: if
  isOwner(uid)`; a top-level positive-whitelist projection (`publicProfiles/{uid}`) with `hasOnly` + per-field
  binds; visibility gated LIVE by a privileged `get()` on the SOURCE doc, never a mirrored flag; `isSignedIn()
  &&` before the friend-branch `exists()`; **audit EVERY client call site reading a FOREIGN `users/{uid}`
  BEFORE tightening** — rules-only is an outage.
- **A shared helper collapsing a three-way distinction into a two-way return re-opens the ghost-vs-private
  class** (`getPublicProfileCard` mapped both `!exists()` and permission-denied to `null`). Check
  `error.code === 'permission-denied'`; no error = "not opted in".

## Social-graph mirror-write trust boundaries
- **A compensating/rollback write needs its own TOCTOU check — UNLESS the doc is provably unreachable by
  anyone else yet.** Could the mutated state have been VALIDLY re-established before the delayed rollback
  fires (a stalled join's late `arrayRemove` stripping a uid a completed rejoin added)? Then re-`getDoc`
  first. Not needed for a rollback DELETING a doc `addDoc`-minted in the SAME call (BIN-555) — and delete the
  whole doc, never `arrayRemove` the lone member (that orphans it from the owner's `array-contains` query).

## Server-only collections, public rollups, external input
- **Post-sign-in return path (BIN-645/669): the parse is never the residual — CARRIER + WRITE SITE are.**
  Parse guard: first char `/`, second neither `/` nor `\`, plus a control-char scan. `?next=` LEAVES the
  origin; `sessionStorage` fixes that, but the write site can still express a query — `RETURN_QUERY_KEYS`
  allowlist on BOTH legs. Remembering the DEPARTING user's page across `signOut()` needs an `isSigningOut()`
  ref PREDICATE, not consume-once. **Consume-on-read makes the consuming effect NON-IDEMPOTENT** — StrictMode's
  second run reads null and falls back to default; latch inside the success branch, and nothing between latch
  and navigate may throw. Read only AFTER auth resolves — gate on `uid` AND the loading flag, since
  AuthContext nulls `user` on a profile-read reject.
- Third-party `href`: reject unless `startsWith('https://')` (`safeHref`, `rel=noopener`). Prose renders as
  plain-text React children, never `dangerouslySetInnerHTML`; JSON-LD needs `.replace(/</g,'\\u003c')`. Free
  text with no `hasOnly` cap gets length-capped in the CONSUMING function before the FCM body.
