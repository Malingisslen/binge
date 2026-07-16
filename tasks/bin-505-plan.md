# BIN-505 — Close the public-profile + watchlist-notes PII leak

**Class:** Firestore rules + schema migration + GDPR data-flow. Router tier = `top`
(full panel: Security #4, Legal/GDPR #5, DPO #6, DBA #27). Written plan + panel + Malin
go-ahead required before any Edit/Write. Malin gave intent go-ahead ("fix 505 now")
2026-07-14.

## The leak (confirmed against firestore.rules @ HEAD 78d2995 + read-path map)

1. **Profile doc `users/{uid}` (rules L178–186)** — readable UNAUTHENTICATED when
   `defaultVisibility=='public'` or `isPublic==true`, and always by confirmed friends.
   Firestore reads are whole-doc. `usePublicProfile.ts` `getDoc`s the entire doc and
   client-blanks a DENY-LIST (email, providerCosts, providerTiers, providerPauses,
   calibrationGenres) — but the following ride the wire RAW today: `hemkommun`,
   `providerCampaigns`, `providerRenewalDays`, `notificationSettings`, `rotationSchedule`,
   `termsAcceptedAt`, `ageConfirmedAt`, `isAdmin`, etc. The doc has **no `hasOnly`
   write-whitelist**, so it accretes fields and the client-blank deny-list keeps missing new ones.
2. **Watchlist doc `users/{uid}/watchlist/{itemId}` (rules L204–223)** — public/friends
   readable; `notes` (free-text) is on the doc (contract L93). `usePublicProfile.mapWatchlistDoc`
   blanks it client-side (L93) but the raw text crosses the wire. Free-text notes capture
   third-party personal data — same DPO reasoning that made tags owner-only (BIN-164).

Client-side redaction is not a security boundary; a raw SDK/REST read bypasses it. Rules
cannot field-filter a read — the data must leave the readable doc.

## Fix — two tracks (different because the parent docs differ)

### TRACK A · Profile → positive whitelist (lock the doc, serve a public projection)
The deny-list model already fails. Flip to default-deny:
- **New public-projection doc `publicProfiles/{uid}`** — contains ONLY public-safe fields:
  `displayName`, `username`, `photoURL`, `bio`, `defaultVisibility`, `isPublic`, `createdAt`,
  and the display-only prefs the profile page actually renders. **Public/friends read; owner-only write.**
  (Panel Q: is `myProviders` — which services, not costs — public-safe enough to include?
  The profile page renders it today. Costs/campaigns NEVER go in the projection.)
- **`users/{uid}` read → OWNER-ONLY.** Remove the public / defaultVisibility / friends read
  branches (L179–186). Sensitive fields simply STAY on this now-private doc — no field-move.
  - Privileged `get(users/{uid}).isPublic` lookups in OTHER rules (following L304/308, watchlist
    friends-fallback L222, friends-branch) keep working — rules `get()`/`exists()` are
    privileged reads that do NOT re-check the target's read rules. **Verify each such get()
    still resolves after the read-lock (DBA #27 check).**
- **Read switch:** `usePublicProfile.ts` reads `publicProfiles/{uid}` instead of `users/{uid}`.
- **Write sync:** every mutator of a public-safe field (displayName, bio, photoURL, username,
  isPublic, defaultVisibility) ALSO writes `publicProfiles/{uid}` (denormalization). Funnel
  through one helper so no writer forgets. displayName/username already denormalize onto
  reviews/comments — this is a third mirror; accept the sync cost for the security win.
- **Backfill (lazy):** on the owner's authenticated load, if `publicProfiles/{uid}` is missing
  or stale, the owner writes it from their own `users/{uid}` (self-write, no extra permission).
  Eager on first load is fine — the leak is live, favor closing it fast.

### TRACK B · Watchlist notes → owner-only subcollection (BIN-164 mirror)
- **New `users/{uid}/watchlistNotes/{tmdbId}`**, shape `{ note: string }` (bounded), owner-only
  read/write, NO public/friends read clause. Rules helper `isValidNoteDoc` (hasOnly `['note']`,
  string, length cap).
- **`notes` STAYS in `isValidWatchlistItem` hasOnly (L93) permanently** — one-way-ratchet: a
  prod doc still carrying `notes` must keep passing merge-writes, and the migration write
  deletes the field via `FieldValue.delete()` (requires the key stay whitelisted). Nothing
  writes `notes` to the watchlist doc after this ships.
- **Write:** `WatchlistContext.updateNotes` writes `watchlistNotes/{tmdbId}` (full-replace
  setDoc, mirror `updateTags` L481-489); on the same touch, `FieldValue.delete()` the legacy
  `notes` on the watchlist doc ("the migration IS the delete", mirror updateProviderTier).
- **Read (owner):** `WatchlistContext` subscribes to `watchlistNotes` (mirror the `watchlistTags`
  onSnapshot L186-197) and joins in-memory; `docToItem` falls back to legacy inline `notes`
  until migrated.
- **Read (public):** `usePublicProfile.mapWatchlistDoc` already sets `notes:null` — after the
  field is gone from the doc there's nothing to blank. No change needed beyond removing the wire exposure.
- **Cascade delete:** `removeItem` best-effort deletes the sibling `watchlistNotes` doc (mirror tags L467-476).

## Lazy migration (mirror migrateStatus / effectiveVisibility lazy-on-write)
- Read-time shim in BOTH owner (`WatchlistContext.docToItem`) and public
  (`usePublicProfile`) readers so owner + viewer never diverge.
- Write-back on next real mutation (notes edit, profile edit) — no admin sweep, no forced rewrite.
- Note: the LEAK closes per-doc only once that doc is migrated (field deleted). Eager
  owner-load migration (Track A backfill + a one-pass notes sweep on library load) is the
  fastest safe path — **panel to confirm the cost/urgency trade-off.**

## GDPR (Legal #5 / DPO #6 — BINDING)
- `collectUserDataSnapshots` (userData.ts) + `KNOWN_USER_SUBCOLLECTIONS` (L118, compile-time
  guard) MUST add `watchlistNotes`. `publicProfiles/{uid}` is a top-level collection, not a
  user subcollection — add it to BOTH export (Art. 20) and deletion (Art. 17) cascades
  explicitly (deleteAccount + buildUserExport). Miss it → notes linger post-deletion (Art. 17
  breach) or drop from export (Art. 20 breach).
- `docs/data-export-format.md` updated for the new shape.

## Rules changes (Security #4 / DBA #27)
- `users/{uid}` read → owner-only + friends? **DECISION:** friends read the PROJECTION, not
  the private doc → users/{uid} is pure owner-only read. (Confirm no client path needs a
  foreign `users/{uid}` read other than via projection.)
- New `match /publicProfiles/{uid}`: read if public/defaultVisibility=='public' OR friend
  (mirror the OLD users read branches) ; write owner-only + `hasOnly` public-safe whitelist
  (POSITIVE contract — the anti-recurrence core).
- New `match /users/{uid}/watchlistNotes/{tmdbId}`: owner-only + `isValidNoteDoc`.
- Keep the watchlist public/friends READ clauses unchanged (they no longer expose notes).

## Deploy (Tier-D — manual, per reference_deploy_scope + standing grant)
1. `firebase deploy --only firestore:rules` FIRST (new collections need allow-rules before the
   client writes to them; the read-lock on users/{uid} must land WITH the projection read + the
   client read-switch — sequence so no window where the owner can't read their own profile).
2. Ship client (migration + read/write switch) via `gh workflow run deploy.yml` (workflow_dispatch
   skips the rules/functions guard).
3. **Sequencing risk (DBA #27):** if rules lock `users/{uid}` read before the client switches to
   the projection, existing sessions on the OLD bundle lose their own profile read? No — owner
   read stays allowed (isOwner branch kept). Only FOREIGN reads of users/{uid} break, and those
   move to the projection in the same client ship. Confirm old-bundle foreign-profile views
   degrade gracefully (projection missing → show minimal card, not a crash) during rollout.

## Acceptance criteria (panel conditions fold in below before build)
- [ ] Raw unauthenticated `getDoc(users/{uid})` for a public user is DENIED (owner-only).
- [ ] `publicProfiles/{uid}` exposes ONLY the whitelisted public-safe fields; costs/campaigns/
      hemkommun/email absent by construction (hasOnly write contract).
- [ ] Raw public/friends read of a watchlist doc returns NO notes (field gone post-migration).
- [ ] Owner still sees their own notes + costs + hemkommun + profile (read-paths migrated).
- [ ] Lazy migration backfills projection + moves notes off + deletes legacy fields.
- [ ] `collectUserDataSnapshots`/export/deletion cover watchlistNotes + publicProfiles.
- [ ] test:rules (Java/JBR) — copy firestore-rules.test.ts:244-279 shape: stranger + friend
      DENIED on users/{uid} private read and on watchlistNotes; projection read ALLOWED for
      public/friend; write contracts reject junk/extra fields.
- [ ] Panel conditions folded (below).

## MALIN DECISIONS (2026-07-14) + refined design — BINDING
- **Sequencing = ONE FULL PUSH now.** Build the full projection architecture + migrate all ~9
  foreign-read sites in lockstep with the rules lock. No staging.
- **`myProviders` (which services) = HIDE FROM EVERYONE.** Excluded from `publicProfiles` entirely.
  Search result cards + public profile lose the services chip for all viewers.
- **Refined projection design (resolves Security conds 2+3 + DBA drift, drops the Cloud Function):**
  - `publicProfiles/{uid}` stores DISPLAY fields ONLY: `{ displayName, username, photoURL, bio,
    createdAt }`. It does NOT store isPublic/defaultVisibility.
  - READ rule gates visibility LIVE off the source via privileged get():
    `isOwner(uid) || get(users/{uid}).isPublic==true || get(users/{uid}).defaultVisibility=='public'
    || exists(users/{uid}/friends/{requester})`. Flipping private → instant deny, ZERO window.
  - WRITE rule: owner-only + value-bound hasOnly (displayName≤80, bio≤160, username format,
    photoURL string bound, createdAt timestamp). Client writes it (no function).
  - SYNC: best-effort via the `updateUserField` funnel (AuthContext) on display-field changes. Drift
    is now COSMETIC ONLY (stale name), never a leak (visibility is live-gated) → funnel discipline is
    adequate; no self-healing trigger needed.
  - BACKFILL: lazy on OWNER load — owner writes their own `publicProfiles/{uid}` if missing (owner-only
    write allows this). No admin sweep.
  - COST: foreign-profile view = 2 reads (projection + visibility get) vs 1 today. Profile views are
    not a hot path; negligible vs the 25 SEK cap.
- **Notes read — REVERSED at implementation (2026-07-14, recorded per code+security review):** the
  plan first chose a LAZY per-title `getDoc`. Shipped instead a sparse owner-only `watchlistNotes`
  onSnapshot listener that mirrors the EXISTING `watchlistTags` listener. Rationale for the reversal:
  (a) it's consistent with the established tags pattern (one less bespoke path); (b) the collection is
  SPARSE — only note-bearing titles have a doc — so the listener's read cost scales with the number of
  NOTES, not library size (cheap for the typical handful of notes); (c) it keeps `item.notes` populated
  uniformly so the title-page NotesBlock needs no change AND the re-mark flows read a consistent value.
  Cost delta vs lazy is small and bounded; accepted. (If notes ever become non-sparse, revisit.)
- **addItem must NOT write `notes` to the watchlist doc** (found in review): addItem is the re-mark path
  (QuickAddButton/StatusButton/useMarkSeen pass `current?.notes`), and the new rules reject a non-null
  inline note → a re-mark of a noted title would be permission-denied. Fixed: addItem strips notes;
  test-locked (`addItem never writes a non-null inline note`).

## POST-PANEL CONSOLIDATION (all 4 convened 2026-07-14, blind + parallel)

Verdicts: Security #4 = **block (as scoped)**, DPO #6 = **block**, Legal #5 = approve-with-conditions,
DBA #27 = approve-with-conditions. Core design APPROVED by all four; blocks are about scope + two
structural gaps, not the shape.

### HARD BLOCKER 1 — Track A's real blast radius is ~9 client read sites, not 1 (Security #4 + DBA #27)
Locking `users/{uid}` read to owner-only breaks EVERY client `getDoc`/`onSnapshot` of a FOREIGN
profile doc. Security #4 grepped and found ~9; two are UNGUARDED crash sites that fail the instant
`firebase deploy --only firestore:rules` runs, BEFORE the client ship:
- `src/app/feed/page.tsx` (~L68) — unguarded `Promise.all` over followed users' profiles → **/feed
  full outage** for anyone who follows anyone.
- `src/lib/firebase/friends.ts:listFriends` (~L139) — unguarded `Promise.all` over friends' profiles
  → **friends list outage**.
- Guarded-but-regressed (silently return empty/fallback): `userSearch.ts` (also renders `myProviders`),
  `useFollowList.ts`, `TopbarActions.tsx`, `FriendsPageClient.tsx`, `ListPageClient.tsx`,
  `grupper/page.tsx`.
→ ALL ~9 must migrate to `publicProfiles/{uid}` in the SAME client ship as the rules lock. Full
`getDoc(doc(db,'users',<foreign>))` + `onSnapshot` audit required before build.

### HARD BLOCKER 2 — notes migration must be eager + atomic (DPO #6 + DBA #27)
- DPO: purely-lazy leaves a KNOWN third-party-PII leak open indefinitely for inactive users. Require
  an eager per-session sweep on first authenticated load post-ship (same standard as the Track A backfill).
- DBA: the plan self-contradicts (lazy vs eager). Pick ONE. Eager sweep must be BOUNDED (explicit
  doc-count cap + chunked + rate-limited) or a user with hundreds of noted titles triggers an
  unbatched write-burst on open. Migration write MUST be an atomic `writeBatch` (new-doc write +
  legacy `FieldValue.delete()` committed together) — never delete without the replacement committed.

### DECISION FOR MALIN A — stage it, or one big push?
Post-panel, the full Track A is a multi-step migration (9 read-site switches + write-sync + eager
bounded backfill + GDPR wiring + tests). RECOMMENDED staging:
- **Stage 1 (fast, small blast radius): close the acute leak.** Move the genuinely-sensitive fields
  (`email?`, `hemkommun`, `providerCosts`, `providerCampaigns`, + financial ride-alongs
  `providerRenewalDays`/`rotationSchedule`) OFF `users/{uid}` into an owner-only `users/{uid}/private/self`
  sub-doc; `users/{uid}` STAYS public-readable (so feed/friends/search/9-sites are UNTOUCHED). Migrate
  the handful of OWNER-side reads (settings/providers/advisor). Do Track B (notes → owner-only
  subcollection, eager+atomic) alongside. This closes the financial + location + notes exposure with
  far less risk and no 9-site migration.
- **Stage 2 (durable, no time pressure): positive-whitelist projection.** Build `publicProfiles/{uid}`,
  lock `users/{uid}` read to owner-only, migrate all ~9 foreign-read sites, add the sync trigger. This
  is the anti-recurrence architecture (future fields private by default). Done carefully, not under the gun.
- Alternative: do the full projection now in one bigger push (Security's "fast-and-correct = all 9").

### DECISION FOR MALIN B — `myProviders` (WHICH services you subscribe to) on a public card?
DPO + Legal + Security all flag it. It is rendered TODAY on the public profile AND on user-search
result cards (userSearch.ts). Options: **exclude** (simplest, safest — search/profile lose the
services chip for everyone), **friends-only** (keep it for confirmed friends, hide from internet
strangers — needs a friends-tier field on the projection), or **keep public** (needs a privacy-policy
sentence disclosing provider-name visibility + arguably distinct consent). DPO/Legal default = no public
exposure absent distinct consent → lean **friends-only or exclude**. (`providerCosts`/`campaigns` NEVER
go in the projection — not in question.) Only bites in Stage 2 if staged.

### CONDITIONS folded into acceptance criteria (all roles)
- [ ] (Sec1/DBA) Full foreign-`users/{uid}` read audit; ALL sites migrated to projection in the rules-lock ship. [Stage 2]
- [ ] (Sec2) `publicProfiles` write rule has VALUE-bound validation (bio≤160, displayName≤80, username format), not just `hasOnly`.
- [ ] (Sec3/DBA) isPublic/defaultVisibility change writes the projection in the SAME batch — no window where a flipped-private user has a stale public projection. Rules-test: toggle private → immediate deny on projection read.
- [ ] (DBA cond) Projection sync SHOULD be a Cloud Function `onWrite` trigger on `users/{uid}` (self-healing) rather than client "remember to sync" — this codebase has had denormalization drift before. (Adds a small function → Tier-C/D deploy. Malin FYI.)
- [ ] (DBA) `watchlistNotes` — challenge the 3rd always-on onSnapshot; if notes are sparse, prefer lazy `getDoc` when the note editor opens, not a full-collection listener. Backfill uses a `syncedAt`/version marker, not a per-load field-diff.
- [ ] (Legal1/Sec6) `publicProfiles` (TOP-LEVEL → outside KNOWN_USER_SUBCOLLECTIONS guard) explicitly wired into `buildUserExport` (Art.20) AND `deleteAccount` (Art.17) with a DEDICATED test each (collectUserDataSnapshots swallows errors → don't rely on it). Same dedicated cascade-delete test for `watchlistNotes`.
- [ ] (Legal2) Dated internal breach-assessment record written (discovery 2026-07-14; scope = all public/`isPublic` profiles + all friend-pairs since the fields shipped; categories = financial+location+email+notes; remediation timeline). Legal's read: LIKELY below IMY/Art.34 data-subject notification threshold (small non-scraped base, same-day fix) — but the conclusion must be WRITTEN, not assumed. Parallel; does NOT gate the rules deploy. Location: incident-record convention (check docs/RUNBOOK.md) or docs/org/adr/.
- [ ] (DPO2/Legal cond) `isValidNoteDoc` explicit length cap (mirror watchlistTags); confirm `bio` cap parity in projection.
- [ ] (DPO3) Rules constraint that `notes` written to the watchlist doc going forward can only be null/absent (don't rely on unenforced "nothing writes it" — an old cached bundle could re-leak). Enforce in `isValidWatchlistItem`.
- [ ] (DPO5) `docs/data-retention-policy.md` + `docs/data-export-format.md` updated for `publicProfiles` + `watchlistNotes` (explicit checklist items, not prose).
- [ ] (Legal Q/minimization) Evaluate dropping `email` from Firestore entirely (Firebase Auth holds it) — check `/insikter` resolvers; defer if not cheap. Not a blocker (owner-lock removes exposure regardless).
- [ ] (Sec/DBA) Rules-test asserts the privileged-get() sites (isAdmin, matchesOwnIdentity, following L304/308, watchlist L220-222) still resolve after the read-lock — all four roles confirmed by inspection they DO (rules get()/exists() bypass target read rules), but pin it with a test.
- [ ] (DBA) Confirm no new composite index needed (both new collections are doc-id keyed — confirmed; re-confirm if a "list all my notes" feature is ever planned).
- [ ] (Sec/DBA) Rollout: static-export + Cloudflare can serve a stale JS chunk reading foreign `users/{uid}` post-deploy — sequence + confirm graceful degradation (Stage 2 only).
