# Archived knowledge — relocated from binge-security-reviewer.knowledge.md.
Append-only historical record. Entries are verbatim, original order.


## Relocated 2026-07-04 — consolidation batch (2026-06-14 → 2026-06-26; lessons distilled into the active file's principles; thread-linked entries 2026-06-20 kept raw)

### 2026-06-14 — friends-doc forgery via isOwner(targetUid) (BIN-20)
The old `allow create: if isOwner(uid) || isOwner(targetUid)` pattern on a
mirrored subcollection is a classic trust-boundary error: the second branch lets
the *subject of the doc* (`targetUid`) write on the *victim's* namespace (`uid`),
granting themselves access without victim consent.  Applies to any symmetric
mirror pattern (followers, friends, etc.) — the mirror write must be gated on
post-commit proof (`existsAfter`) or pre-commit proof (`exists`) that the
underlying relationship was legitimately established.

The `exists()` (not `existsAfter`) choice is correct here because
`acceptFriendRequest` is a batch that writes both friends docs AND deletes the
request in the same commit; the request exists in pre-commit state so `exists()`
sees it, and it is absent post-commit so `existsAfter` would falsely deny.
Contrast with the followers mirror which uses `existsAfter` because the
following doc and followers doc are created together with no prior proof doc.

### 2026-06-14 — self-serving friendRequest bypass check
An attacker could try to create `users/{victim}/friendRequests/{attacker}` to
satisfy the new exists() gate. This is blocked: the `friendRequests` create rule
enforces `fromUid == request.auth.uid`, so an attacker can only write their own
uid as the doc-id on the *victim's* path — but the friends create rule reads
`exists(users/{uid}/friendRequests/{targetUid})` where uid=victim and
targetUid=attacker, i.e. the request must live under the *acceptor's*
(victim's) namespace with doc-id = requester (attacker). An attacker can write
exactly that doc (they are isSignedIn() and fromUid==attacker). This means the
gate is NOT self-closing against a determined attacker who is willing to send an
actual friend request first. However, this is the intended legitimate flow — a
real pending request IS required, and the victim must not have declined it.
Accept flow works correctly.

Residual risk: attacker sends a real friend request to victim; if victim ignores
it (never declines), attacker can then forge the friends doc. Mitigation path:
add a "self-block" check (not `exists(users/{uid}/blocked/{targetUid})`) or
require the accept to also prove *victim* authored the delete. Out of scope for
BIN-20 but worth a follow-up ticket.

### 2026-06-14 — rules deploy is always manual (re-confirmed)
deploy.yml deploys hosting only. Any rules fix is inert until
`firebase deploy --only firestore:rules` is run manually. This is a hard
process step, not just a note — the vulnerability stays open in production
until that command is run even after the working-tree change is committed.

### 2026-06-14 — GitHub Actions SHA interpolation into shell (BIN-26)
`${{ github.event.before }}` and `${{ github.sha }}` interpolated into a
`run:` shell block are NOT injection vectors when the source is GitHub's own
event metadata (not user-controlled input like PR titles or branch names).
GitHub-generated SHAs are always 40-char hex or the zero SHA; they cannot
contain shell metacharacters. The pattern is safe. The injection risk
materialises when user-controlled strings (issue titles, branch names,
commit messages) are interpolated directly into `run:` — those require
`${{ env.VAR }}` indirection via `env:` block. Assess each interpolation
site by whether its source is GitHub-controlled or user-controlled.

### 2026-06-14 — unversioned emulator cache key (BIN-26)
Caching the Firestore emulator binary under a key of only `firebase-emulators-${{ runner.os }}`
with no version segment means a bump to `firebase-tools` version in the
workflow does NOT bust the cached emulator. The old emulator JAR can persist
and be used against the new CLI, causing silent version skew. Low severity
(emulator version mismatch rarely causes false-green rules tests), but the
correct key should include the pinned CLI version:
`firebase-emulators-${{ runner.os }}-14.27.0` (update the literal when the
pin changes). The same pattern exists in ci.yml and should be fixed there too.

### 2026-06-14 — BIN-21 tombstone/lazy-filter pattern: ghost vs private distinction is safe
The `useFollowList` ghost-filter relies on `!snap.exists()` to detect deleted
accounts. A private profile is still a readable doc under the Firestore rule
`resource.data.get('defaultVisibility','') == 'public' || resource.data.get('isPublic',false) == true`,
BUT the client calls `getDoc` on `users/{uid}` — a private profile is NOT
readable by a third party because the rule only grants owner-read and public-read.
The fetch will throw a permission-denied exception, which falls into the `catch`
branch → cached as `null` → rendered as fallback row "Privat användare". This is
the CORRECT outcome. `!snap.exists()` is only reached when the doc genuinely
does not exist (deleted account), never for a private-but-existing profile —
the sdk throws on denied reads, it does NOT return an empty snapshot. The ghost
vs private distinction is therefore reliable and cannot misclassify a private
profile as a deleted account.

### 2026-06-14 — followers subcollection read in collectUserDataSnapshots is owner-gated
`getDocs(collection(db, 'users', uid, 'followers'))` is called with the
authenticated user's own uid (passed from deleteAccount/buildUserExport where
`id = currentUser.uid`). The Firestore rule for `users/{uid}/followers/{followerUid}`
grants `allow read: if isOwner(uid)`. Because uid == auth.uid at call time, this
read is owner-gated and correct. The export correctly includes follower uids as
the user's own social graph data — these are doc-ids under the user's own
subcollection, not another user's private data.

### 2026-06-14 — BIN-25 server-side rate-limit via reportMeta/throttle: design verified
The `getAfter(throttle).lastReportAt == request.time` + `exists()/get()` pattern is
sound against the four bypass vectors:
- **Report-without-throttle:** `getAfter` checks the post-commit state of the throttle
  doc; if the batch omits the throttle write, `getAfter` returns a non-existent doc and
  the check fails. Correctly blocked.
- **Forged `lastReportAt` value:** the throttle write rule enforces
  `lastReportAt == request.time` (server-supplied Timestamp, not client-supplied).
  A client cannot pass an arbitrary Timestamp as `serverTimestamp()` — the SDK
  substitutes the server time at commit. Correctly blocked.
- **First-report exists()-gate:** `!exists(throttle)` is true on the very first report
  (no prior doc). The OR short-circuits; the cooldown branch is not evaluated. The
  `getAfter` check still fires and requires the batch to stamp the throttle.
  Correctly structured; the first report is not a free-pass loophole.
- **Rapid-second-report:** the second batch within 10 s hits `get(throttle).lastReportAt
  < request.time - duration.value(10,'s')` which is false; the OR resolves to false;
  the whole create condition is false. Correctly blocked (covered by rules test).

One medium-severity API note: `batch.set(doc(collection(db, 'reports')), {...})` passes
a collection reference to `doc()` without an explicit ID. The Firebase JS SDK v9+
`doc(collectionRef)` overload generates a random client-side ID — the call is
semantically equivalent to the old `addDoc()`. This is correct behavior, but it is
non-obvious: a reader might assume `doc(collection(...))` without an ID argument would
throw or be a no-op. The actual report write is atomic with the throttle stamp and
cannot succeed without it; the ID-generation is client-side and precedes the commit, so
the rules check on `reports/{reportId}` fires against the correct new document. No
security impact, but worth a clarifying comment in reports.ts.

GDPR: `reportMetaSnap` is collected by `collectUserDataSnapshots` and cascaded in
`deleteAccount`, but intentionally omitted from `buildUserExport` (operationell
metadata, analogous to fcmTokens). Confirmed correct.

### 2026-06-14 — orphaned inbound follow docs after deletion: residual risk is low
When account A is deleted, outbound A→B following docs are cleaned up and their
B followers/{A} mirrors are also deleted (deleteAccount step 2). Inbound B→A
following docs (users/{B}/following/{A}) and their mirrors (users/{A}/followers/{B})
are NOT deleted — they are owned by B and cannot be deleted by A's deletion flow
under current rules. These orphan docs are unreachable: users/{A} is deleted so
no profile is returned; useFollowList on B's side will ghost-filter A from B's
following list. The only residual risk is that users/{A}/followers/{B} lingers —
it is owner-read-only (isOwner(A)) and A's Firebase Auth account is deleted so
no token can authenticate as A. Therefore these docs are effectively sealed garbage
that a future cleanup job (Cloud Function or TTL) could sweep. No live privacy
exposure exists because the auth principal is gone.

### 2026-06-20 — grace-window trust on client-written followedAt (BIN-50)
The reclaimOrphanFollows sweep's 24h grace window uses the `followedAt` field
written by the client (useFollow.ts) via serverTimestamp(). The grace window is
therefore only as strong as Firestore's server-timestamp guarantee: clients cannot
forge a future timestamp because serverTimestamp() is substituted server-side at
commit, but they CAN omit followedAt entirely on doc creation. If a client writes
a follow doc without followedAt (bug, direct SDK call outside useFollow, future
code path), the sweep treats followedAtMs:null as "old" and marks it reclaimable
immediately. For orphan docs (deleted endpoint) null→reclaimable is acceptable.
For a valid follow where one endpoint is transiently absent from the alive snapshot
(read-skew), null→reclaimable becomes a data-loss risk. The Firestore rule does NOT
enforce followedAt presence on follow creates (rules only gate allow write, not
field completeness). Mitigation: add `followedAt != null` to the follow create rule,
or accept the residual risk given the 24h window already covers normal read-skew.

### 2026-06-21 — Firestore Timestamp vs number mismatch silently breaks rate-limit (titleRatings M2)
When a Firestore field is written as `FieldValue.serverTimestamp()`, the Admin SDK reads
it back as a `Timestamp` object (with `.toMillis()`, `.seconds`, `.nanoseconds`), NOT as
a plain `number`. Casting the document data as `{ windowStart?: number }` and then doing
`now - windowStart` yields `NaN` because `Date.now() - Timestamp_object === NaN`.
`NaN < RATE_LIMIT_WINDOW_MS` is `false`, so the rate-limit condition `count >= CAP &&
elapsed < WINDOW` can NEVER be true — the cap is silently bypassed on every request.

Fix: store `windowStart` as epoch-millis (`Date.now()` not `FieldValue.serverTimestamp()`)
so arithmetic works, OR read it as `Timestamp` and call `.toMillis()` before comparing.
The type cast must agree with the stored type; a TypeScript `number` cast of an object
does not coerce the runtime value.

Pattern to watch: any rate-limit or TTL window stored as `serverTimestamp()` and later
compared with `Date.now()` arithmetic without `.toMillis()` conversion is broken.
The Admin SDK does NOT auto-coerce Timestamps to milliseconds on read — `snap.data()` returns
the raw Timestamp object.

### 2026-06-21 — top-level per-uid collections are NOT auto-collected by collectUserDataSnapshots

`collectUserDataSnapshots` (userData.ts) only collects subcollections under `users/{uid}/` plus
a small set of top-level collectionGroup queries keyed on uid. Any NEW top-level collection
that uses uid as the doc-id (e.g. `rateLimit/{uid}`, `foo/{uid}`) is NOT automatically
included — it must be added manually to both the interface and the Promise.all() array.

The GDPR/deletion impact depends on content:
- If the doc contains personal data: must be added to export AND delete cascade.
- If the doc is pure operational metadata (counters, timestamps, no PII fields): only
  the delete cascade is required; export can omit it (same precedent as fcmTokens, reportMeta).

Current known gap: `titleRatingsRateLimit/{uid}` — contains only { count, windowStart }
numbers, no PII. Firebase Auth does not recycle UIDs, and the Firestore rule is
"allow read, write: if false", so the orphaned doc is sealed after account deletion.
Severity: LOW. But the delete cascade should still sweep it for hygiene.

Pattern to watch: whenever a Cloud Function writes `db.collection('anything').doc(uid)`,
check whether that collection is in collectUserDataSnapshots. If not, assess content and
add to delete cascade (and export if PII).

### 2026-06-21 — L6a/L6b: external-API id injection + open-redirect/XSS via pageUrl (wiki-bio)

**L6a — wikidata_id format guard (useSwedishWikiBio.ts)**
`wikidata_id` is returned by TMDB and used both as a URL path segment in the
Wikidata API request and as the entity key in `svwikiTitleFromEntities`. Without
a format guard, a malformed or attacker-manipulated id (e.g. containing `&`,
`/`, or JS metacharacters) could corrupt the Wikidata API URL or cause the
entity lookup to hit an unexpected key.
Fix: `/^Q\d+$/` regex guard before use + `encodeURIComponent(wd)` in the URL.
The guard is correct and sufficient: Wikidata entity ids are always `Q` followed
by digits; anything else is invalid and should be treated as a missing id.

**L6b — open-redirect / XSS via pageUrl (bio.ts cleanWikiExtract)**
`pageUrl` from the Wikipedia REST API (`content_urls.desktop.page`) is rendered
directly as an `<a href={wikiBio.pageUrl}>` in PersonPageClient.tsx. Without a
scheme check, a compromised CDN response or MITM could return a
`javascript:alert(1)` payload that browsers execute on click — a stored-XSS
vector against the Binge user who clicks the attribution link.
The fix `!pageUrl.startsWith('https://')` → return null is correct: it rejects
`javascript:`, `http:`, `data:`, and any other non-https scheme before the value
reaches the DOM. It also rejects an `http://` URL that would be a mixed-content
open redirect.
Pattern to watch: any field from a third-party API that is rendered as `href`
without a scheme guard is a potential open-redirect/XSS vector. Apply
`startsWith('https://')` (or a stricter URL constructor check) before use.

### 2026-06-24 — App Check OR auth gate on callables: sound design, with one lifetime note

`request.app !== undefined` is the correct v2 SDK idiom for "was a valid App Check
token present?" (the SDK sets `request.app` only when the token passes; it is
`undefined` otherwise, even if the client sends a token that fails verification).
The OR-auth fallback (`isAuthed = request.auth?.uid !== undefined`) is intentional
and safe for telemetry callables: until App Check is configured in the Firebase
console the function still records events from authenticated users, and rejects
pure-anonymous callers. No open flood vector exists before App Check is configured,
because unauthenticated + no App Check throws `failed-precondition`.

One lifetime note: once App Check IS enforced in the console (policy set to
"Require App Check"), the SDK will reject tokens that fail attestation before
the handler runs at all — so the `!hasAppCheck && !isAuthed` guard becomes
defence-in-depth rather than the primary gate. The code handles both eras correctly.

No `consumeAppCheckToken` call is needed here because the callable does not
produce a resource the attacker gains value from holding (it only increments
aggregate counters). `consumeAppCheckToken` (replay-protection) matters on
callables that issue something scarce (e.g., a signed URL, a promo code).

### 2026-06-24 — top-level aggregate collection with `read, write: if false` is NOT a GDPR surface

`askBingeStats/{YYYY-MM-DD}` stores only bucketed counters keyed by date, with
no per-uid field anywhere in the document. It is not a user-owned subcollection
and contains no PII. It does NOT need to appear in `collectUserDataSnapshots`
(export or delete cascade). Contrast with `titleRatingsRateLimit/{uid}` (2026-06-21
entry) where the doc-id IS the uid — that pattern requires a cascade check even
for non-PII operational docs. Date-keyed aggregate docs with no uid reference are
safely outside GDPR scope.

### 2026-06-24 — Admin-SDK recursiveDelete vs deleteAccount cascade: benign race, not a conflict (BIN-65)
retentionCleanup deletes sessions/{id} via `db.recursiveDelete(ref)` which wipes the
session doc + all participants/* + swipes/* subcollection docs atomically. deleteAccount
also deletes the same documents for host-owned sessions (it fetches sessions where
hostUid==uid and manually enqueues participants + swipes + session doc for batch deletion).
If a user deletes their account AND the daily retention job runs in the same window:
- retentionCleanup only targets sessions past expiresAt; a user can delete their account
  for a non-expired session, in which case deleteAccount runs first and retentionCleanup
  will find the doc already gone — recursiveDelete on a missing ref is a no-op, not an error.
- If retentionCleanup runs first on an expired host-session, deleteAccount's subsequent
  batch.delete on already-deleted docs is also a no-op in Firestore batch semantics.
Neither direction causes data corruption or unexpected survivors. The race is benign.
The only cosmetic issue: the deleteAccount comment "defensiv radering lämnar inga
zombie-subcollections" is now partially redundant for expired sessions — the retention
cleanup handles those. Not a security finding.

### 2026-06-24 — BIN-176 askBingeParse: cache-before-rate-limit is an intentional design, not a bypass (LOW)

`askBingeParse` checks the 24h `askBingeCache` hit BEFORE incrementing either the
per-user (`askBingeMeta/throttle`) or global (`askBingeBudget`) counter. A cache hit
returns immediately and neither counter is touched. This means:

1. A user who repeats an identical query (same normalized string) burns 0 of their
   25 daily slots regardless of how many times they call it — cache dedup is free.
2. After the global `DAILY_CAP` (2000) is hit, cached queries still serve — the
   budget doc only gates NEW Gemini API calls.

The RISK: an attacker who first causes a query to be cached (costs 1 budget slot),
then floods identical queries from many accounts, pays 0 budget per flood call.
Impact is bounded: the per-user limit is bypassed for cached queries, so one account
can call N times for free on a cached key. However, because the cached result is the
SAME sanitized AskFilter every time, and all reads go to `askBingeCache` (sealed
`read: false` from clients, Admin SDK only), there is no data exfiltration or
privilege escalation — only potential function invocation cost from the Cloud Functions
billing side. Cloud Functions calls are cheap ($0.40/million at volume); 25-slot-per-user
limit fully applies to NEW queries. Severity: LOW. Accepted design trade-off
(cache dedup is a cost SAVING; the anti-abuse concern is per-slot API cost not invocation cost).

Fix if tightened: move cache-check inside the per-user transaction so cache hits also
consume a user slot. Not recommended — removes the cost benefit.

### 2026-06-24 — BIN-176: per-user limit runs before global budget, creating a slot-consumed-then-budget-full window

Order of operations in `askBingeParse`: (1) cache check, (2) per-user transaction
(increments count), (3) global budget transaction (returns false if full). If global
budget is exactly at cap when step 3 runs, the per-user count has already been
incremented (step 2 committed) but no API call is made. The user effectively lost 1
slot for a call that returned `resource-exhausted`. This is a minor UX issue (not a
security issue) — the user is not overcharged (no Gemini call was made) but their
daily quota is decremented. Severity: LOW/UX. Fix: reverse order (check global budget
first), or refund the user slot on budget-full by wrapping both in a single transaction
(complex — two Firestore docs cannot be transacted atomically with the global budget doc
in a single transaction unless they are in the same document group).

### 2026-06-24 — BIN-176: AskSort 'popularity.desc' in schema/type but silently dropped by validator (INFO, benign)

`parseLogic.ts` defines `AskSort = 'popularity.desc' | 'vote_average.desc'` and the
`RESPONSE_SCHEMA` enum allows both values, but `validateAndClampFilter` (line 136) only
passes through `'vote_average.desc'`. If the model returns `sortBy: 'popularity.desc'`,
the field is silently dropped and the downstream `toDiscoverParams.ts:46` uses
`filter.sortBy ?? 'popularity.desc'` as the default — functionally identical outcome.
Not a security issue (validator is correctly strict); not even a functional bug
(default fills the gap). But the type and schema are misleading: `popularity.desc`
appears to be supported but is never actually set by the function. A clean fix would
either remove `popularity.desc` from the schema enum or add it to the validator whitelist.

### 2026-06-24 — CSP connect-src for Cloud Functions v2 callables: *.run.app is necessary and acceptable

Firebase Functions v2 callables (onCall) are deployed on Cloud Run. The Firebase JS SDK
issues an HTTPS POST to the `cloudfunctions.net` host, which returns a 308 redirect to a
per-function Cloud Run URL of the form `https://<hash>-<project>-<random>-<region>.a.run.app`.
The browser follows this redirect and the actual callable response comes from the run.app host.
Both hops must be in `connect-src` or the callable fails with "Failed to fetch" (no network
request leaves the browser).

The per-function Cloud Run URL contains an unpredictable content-hash segment that changes
between deployments. It cannot be pinned to a specific subdomain. `https://*.run.app` is
therefore the only viable CSP token short of dropping the wildcard, which is not possible
for v2 callables.

Risk assessment of `https://*.run.app`:
- Allows the browser to CONNECT to any Cloud Run service hosted by any GCP customer.
- This is a connect-src expansion only — it does not allow script execution (script-src
  is unchanged), frame embedding (frame-src is unchanged), or resource loading.
- An XSS attacker who already has script execution could use *.run.app as an exfiltration
  channel. However: (a) there is no existing XSS vector in this codebase (no dangerouslySetInnerHTML,
  no href injection beyond the already-fixed L6b wiki pageUrl); (b) `*.googleapis.com` was
  already in connect-src and covers a comparably large surface (all Google APIs); the
  incremental risk from adding run.app is marginal.
- There is no tighter option. Cloud Run custom domains are possible in principle but would
  require a manual DNS + TLS setup per function and is out of scope for a solo founder stack.

The pinned host `https://europe-west1-binge-nu.cloudfunctions.net` is correct and minimal
for the first hop. It is strictly better than the alternative `https://*.cloudfunctions.net`
(which would allow any GCP project's callable host). The project + region pin is the tightest
feasible option for the v1-style callable URL.

Verdict: both additions are necessary for callable functionality, the pinned host is optimal,
and the *.run.app wildcard is an accepted and documented trade-off with LOW residual risk
given the absence of XSS vectors in the current codebase. No other CSP directive requires
change for callables (callables use HTTPS POST, not scripts or frames).

### 2026-06-26 — top-level uid-composite dedup collections (rotationReminderState) are GDPR orphans after deletion

`rotationReminderState/{uid}_{providerId}_{kind}_{date}` uses the uid as a *prefix* in a
composite doc-id, not as the doc-id itself. `collectUserDataSnapshots` has no collectionGroup
or top-level query for this collection. After account deletion the docs remain sealed
(Firestore default-deny; no auth principal can authenticate as the deleted uid) — no live
privacy exposure. However, they contain a `notifiedAt` server-timestamp and the composite key
encodes providerId + notification kind, which could in principle be read as behavioural metadata
about the deleted user if the collection were ever made readable.

Hygiene ruling: add a `db.collection('rotationReminderState').where('uid', '==', uid)` to
the delete cascade (requires either storing `uid` as a top-level field on the doc, or keying
the doc as `{uid}/{pid}_{kind}_{date}` under a subcollection). Alternatively, accept the
sealed-garbage residual risk on the same precedent as `titleRatingsRateLimit/{uid}` (2026-06-21
entry). The latter is pragmatic if the function always checks for the marker rather than relying
on its absence for privacy.

Pattern: any composite doc-id that STARTS WITH uid (so a prefix-range query like
`where doc-id >= uid + '_' && doc-id < uid + '`'`) is not automatically swept by the
existing user-doc or subcollection logic. Either key it as a subcollection or add a uid
top-level field for collection-group querying in the delete cascade.

### 2026-06-26 — client-written shortName in rotationSchedule reaches FCM push body without length cap

`parseSchedule` (rotationReminderNotify/index.ts) passes through `x.shortName` with only a
string-type check and a fallback to 'en tjänst'. The shortName is then used verbatim in
`body: \`Dags att pausa ${ev.shortName}\`` inside the FCM push payload. A user who directly
writes a crafted `rotationSchedule` array to their own user-doc (valid under the rules
`allow update: if isOwner(uid)` — users/{uid} has no hasOnly whitelist) could set a
shortName of arbitrary length. FCM push bodies are silently truncated by Android (~240 chars)
and iOS (~178 chars on lock-screen), so no injection risk, but a ~10 KB shortName in the
body is wasteful and could inflate Functions billing on the FCM path.

Fix: cap shortName to a reasonable length in parseSchedule (e.g. `x.shortName.slice(0, 64)`).
The users/{uid} update rule does not have a hasOnly whitelist (by design — it must accept many
fields via merge-writes), so field-level length bounds must live in the function, not the rules.

### 2026-06-26 — priceDropNotify: per-recipient user-doc read inside hot loop (N owners * M titles)

`readPriceDropSettings(uid)` does `getFirestore().collection('users').doc(uid).get()` for
EVERY (uid, title) pair inside `Promise.allSettled(items.map(...))`. If 100 users have
the same film in vill_se, that's 100 user-doc reads for that title alone. Across many unique
film-owners this is a fan-out read amplification: the total reads are O(unique_owners *
avg_titles_per_owner) in the worst case. At the 25 SEK/mån Blaze cap this matters.

Mitigation: de-duplicate uid reads. Collect all unique uids from the byTitle map before
processing, read their settings in one parallel batch (Promise.all), store in a Map<uid,
settings>, and pass the prefetched value into processTitle. This reduces user-doc reads to
O(unique_owners) regardless of how many titles they share.

The existing `sendPushToUser` already accepts `prefetched?: { pushEnabled }` to avoid the
double-read — but `readPriceDropSettings` issues a SEPARATE user-doc read before calling
sendPushToUser, so the de-dup optimization inside sendPushToUser is bypassed here.

### 2026-06-26 — FCM send before dedup marker write: at-most-once guarantee weaker than intended

In `rotationReminderNotify/index.ts` the order is:
  1. `await sendPushToUser(...)` — FCM send
  2. `await markerRef.set(...)` — dedup marker

If sendPushToUser succeeds but markerRef.set times out or the function instance is killed
(Cloud Functions 300s timeout, OOM), the next daily run will NOT see the marker and will
send the same push again. The user gets a duplicate rotation reminder. The severity is low
(at most one extra reminder per day, the event itself is genuinely due) but the code comment
says "at-most-once". True at-most-once would require writing the marker BEFORE the FCM call
(accept-once-deliver-maybe) or using FCM's idempotency key (tag is set, which means
Android/iOS collapse duplicates at the OS level — partial mitigation). The dual-concern of
correctness and cost is already bounded by the 24h window between runs.

Same ordering is acceptable in the existing `availableNotify` pattern; the risk is documented
as intentional GDPR/cost trade-off. No action required but the comment should not claim
"at-most-once" if the guarantee is actually "at-most-twice in a failure window".

--- relocated 2026-07-16 ---

### 2026-07-05 — BIN-184 xhigh catch: "rules aren't filters" — a reciprocity/ownership READ gate can break the OWNER's OWN GDPR export/delete, not just deny attackers

MISSED by both my first-pass review and the coordinator's: the share-to-see
`allow read` rule (member AND `exists(own household doc)`) was written as ONE
`read` grant, which Firestore applies identically to both `get` (single-doc)
and `list` (collection query) operations. Two legitimate, non-adversarial
client code paths broke as a result, for the exact population most likely to
trigger them (a founder/owner who has never opted in to their own feature):
1. `buildUserExport`: a per-group `getDoc` of **the caller's own doc** to
   populate the GDPR export. If the caller isn't opted in anywhere, they still
   don't have "their own household doc" to satisfy the `exists()` conjunct —
   but the flaw is subtler: the get target IS their own doc, and a
   same-uid `get` should never need the reciprocity check at all. The
   original single `read` rule applied the full membership+reciprocity gate
   even to a self-get, denying it whenever the caller wasn't a sharer.
2. `accountDeletion`'s owner branch and `deleteGroup`: both used a `list`
   query (`getDocs(collection(...,'household'))`) to enumerate ALL members'
   docs so the whole subcollection could be cascaded when the group/account
   dies. An owner who hasn't opted in fails the reciprocity `exists()` check
   on `list` just like anyone else — so the ENTIRE deletion/export operation
   threw, not just the household portion. **The emulator test suite did not
   catch this** because every seed helper (`seedFullAccount`, rules-test
   `seedGroup`+`seedContribution`) always seeded the acting user's OWN
   household doc before exercising the cascade — accidentally satisfying the
   reciprocity check every test relied on and masking that the code path
   fails for the (unseeded, realistic) common case of a non-opted-in owner.

**Fix pattern (verified correct): split `read` into `get` and `list`.**
`get` gets an unconditional same-uid carve-out
(`request.auth.uid == householdUid || (member && exists(own-doc))`) — a
document read of literally your own doc-id never needs a reciprocity proof,
because there is no third party being disclosed. `list` keeps the ORIGINAL
strict reciprocity gate unchanged (member AND exists-own-doc, no carve-out) —
list operations return an unbounded/unknown set of OTHER people's docs by
nature, so the self-uid shortcut does not apply and must not be added there.
Confirmed this is not a weakening: every branch that could disclose a THIRD
PARTY's data (get-of-others, list) is untouched; the only new permission is
"read a document whose id is your own auth uid," which is uid-pinned by
construction and was already grantable in every other per-user collection in
this codebase (`users/{uid}`, `users/{uid}/blocked`, etc.) — this brings
`household` in line with that norm for the self-case only, while keeping the
novel reciprocity gate exclusively for reads of OTHERS.

**Companion fix: never `list` a shared-collection to build a GDPR cascade —
derive the doc ids from a source you already legitimately hold** (here:
the `members` subcollection, which the deleting/owner code path already reads
for its own cascade, unioned with the actor's own uid). `batch.delete` on a
non-existent doc ref is a no-op, so over-including candidate ids (e.g. a
uid that never opted in) is free and safe — this sidesteps the reciprocity
gate entirely for the deletion path without weakening the READ gate for
live client queries.

**Generalizable check for future reviews:** whenever a new collection's read
rule conditions on something OTHER than plain membership (a reciprocity
`exists()`, an `isAdmin()` call, a role check, etc.), ask separately: (a) does
any GDPR export/delete code path do a `getDoc` of **the current user's own
doc** under this rule, and (b) does any cascade/admin code path do a `list`/
collectionGroup query expecting to enumerate docs regardless of the
condition? If either exists, the extra condition MUST have a same-uid `get`
carve-out (for case a) or the enumeration MUST be redesigned to derive ids
from an already-authorized source rather than a `list` under the gated rule
(for case b). A rules-emulator test suite that always seeds the acting
user's own qualifying doc before testing the cascade will NOT catch this —
add a test that seeds a cascade scenario where the acting/owning user
specifically has NOT met the extra condition (mirrors "the exact masked
scenario" fix applied here: `ME` owns a group but has NOT opted into
household, `OTHER` has).

### 2026-07-05 — BIN-184: "Hushåll" share-to-see reciprocity — new pattern, APPROVED-WITH-NOTES

First feature where group membership alone is NOT the read access-line for a
subcollection — an extra `exists()` reciprocity check gates reads on the reader
having their OWN sibling doc (`groups/{gid}/household/{uid}`). Pattern verified
sound: `isOwner(householdUid)` (== `request.auth.uid == uid` doc-id) blocks
forged writes to another member's doc; `hasAll`+`hasOnly` on the same 5-key
list blocks both extra-field bloat and partial-shape writes; `updatedAt ==
request.time` blocks timestamp forgery; delete is self (opt-out, no membership
required — lets a departed member self-clean a leftover doc) OR group owner
(removeMember/deleteGroup cascade). Reciprocity read-gate costs one extra
`exists()` get per read; acceptable at household (few-doc) scale. Confirmed via
full read of firestore.rules + 13 new rules tests (all attack angles from the
scrutiny list had a paired test: forged write, non-member read/write, hasOnly/
hasAll, forged updatedAt, oversized list, share-to-see both directions,
departed-member read AND self-delete-of-leftover, non-owner can't delete
another's doc).

GDPR dual-flow: this is the second precedent (after joinAttempts) of a
**group-scoped, non-`users/{uid}`-shaped** collection that `collectUserDataSnapshots`
correctly does NOT enumerate — instead both `buildUserExport` (dynamic
`import('./db')`, guarded on `groupsSnap.docs.length > 0` so the module graph
stays Firebase-free for mocked test environments — see BIN-328 guard) and
`collectDeletionRefs` (owner branch enumerates the WHOLE household subcollection
when the group itself is being deleted; member branch pushes only the caller's
own doc ref) handle it inline. The account-deletion emulator test explicitly
asserts the cross-member boundary: MY contribution in another member's group is
erased, but THEIR contribution in that same group survives my account
deletion — this is the specific assertion class to look for whenever a
group/shared-collection GDPR cascade is reviewed (a same-collection cascade
that's too broad, e.g. deleting the whole subcollection on a mere member's
departure instead of just their own doc, is the failure mode this test catches).

Data minimization at source confirmed by reading `buildHouseholdContribution`
(not just the rules): tier NAMES are resolved to a plain kr figure before the
payload is built (never leave the device); unknown-cost providers are OMITTED
from the map, not zeroed (readers must treat missing key as "unknown", never
silently free); campaigns copied raw only for the ids already in providerIds
(no cross-provider leak); `activeProviderIds` is provider-level only (no
title/genre leak) and usage-derived (not self-reported, so it can't be spoofed
into false modesty/inflation of "backlog" the way a self-reported field could).

Two LOW, non-blocking residuals:
1. `subscribeToGroupHousehold`'s `onSnapshot` error callback (groups.ts) treats
   ANY error as `onDenied` (maps to the UI's 'gated' state), not just
   `permission-denied`. A transient outage or index-building error would show
   the "dela för att se"/not-opted-in gate to an already-opted-in user instead
   of a distinguishable error state. No data loss (opt-in is idempotent —
   re-clicking "Dela" just re-writes the same content) but is an honesty gap:
   check error.code === 'permission-denied' specifically before treating a
   snapshot failure as "you haven't shared" in any future gate-by-permission-
   denied UI pattern.
2. The create/update rule validates key whitelist + list/map TYPES + size caps
   but not value shape inside the maps (e.g. `providerCosts` values aren't
   type-checked as numbers, `providerCampaigns` entries aren't checked for
   `monthlyCost`/`endDate` shape). This matches the binding AC exactly (AC-R1
   only requires list/map types, not deep value validation) and is bounded to
   the writer's OWN doc — a malicious/compromised member can only garbage their
   own contribution (self-inflicted or seen only by consenting group members),
   not forge another's. Acceptable; note for any future review of a similarly
   "open-map" rule shape that this is a deliberate scope limit, not an oversight.

Verdict: APPROVED-WITH-NOTES. No blocking findings.


### 2026-06-20 — collectionGroup + orderBy(__name__) without explicit index (BIN-50)
`collectionGroup('following').select('followedAt').orderBy('__name__').limit(PAGE_SIZE)`
and the matching 'followers' query run in the Admin SDK (bypasses rules, does NOT
bypass index requirements). Firestore auto-indexes `__name__` for single-collection
queries but collectionGroup queries on `__name__` alone typically require an explicit
collection-group index entry in firestore.indexes.json. The current indexes.json has
no entry for following or followers collection groups. In practice the Admin SDK may
fall back to a full scan rather than throw, but the absence of a declared index risks
either a runtime error on first page or a very expensive sequential scan — both
undesirable in a scheduled function with a 300s timeout and a 25 SEK/mån cap.

### 2026-06-20 — collectionGroup pagination index requirement applies to ALL new sweep functions (BIN-65)
Confirmed again with retentionCleanup/index.ts: `collectionGroup('notifications')
.select('createdAt').orderBy('__name__').limit(PAGE_SIZE)` is a collectionGroup query
and requires an explicit collection-group index on `__name__` in firestore.indexes.json.
Single-collection queries (e.g. `db.collection('sessions').orderBy('__name__')`) do NOT
need an explicit index — Firestore auto-indexes __name__ for single-collection queries.
The pattern to add to indexes.json for any new collectionGroup-with-pagination sweep:
  { "collectionGroup": "<name>", "queryScope": "COLLECTION_GROUP",
    "fields": [{ "fieldPath": "__name__", "order": "ASCENDING" }] }
Check firestore.indexes.json for a matching COLLECTION_GROUP entry before approving
any new scheduled function that paginates a collectionGroup via orderBy('__name__').

### 2026-06-20 — BIN-49: callable replaces rules-gated writeBatch for report creation

The BIN-25 rules-based throttle gated per *batch*, not per *report*: one
writeBatch could carry N report-creates plus a single throttle stamp and all N
would pass because Firestore rules cannot count sibling writes within a batch.
The fix (BIN-49) moves report creation to a server-authoritative onCall function
(Admin SDK, bypasses rules) and locks the `reports` create rule to `if false`.
The per-uid cooldown lives inside `db.runTransaction` on
`users/{uid}/reportMeta/throttle` — concurrent calls from the same uid
serialise on the throttle doc's optimistic lock and the cooldown check fires
inside the transaction, so a race cannot create two reports.

Key design properties verified:
- `reports` create is `if false` — no client path to Firestore.
- `reportMeta` create/update is `if false` — client cannot zero their own
  cooldown. Delete is `if isOwner(uid)` — required for the deleteAccount cascade
  which collects and batch-deletes the throttle doc. The cascade uses the client
  SDK (isOwner rule) not Admin SDK, so the delete rule must remain open to owner.
- `reporterUid` is derived from `request.auth.uid` inside the callable and never
  taken from the client payload. validateReportInput explicitly strips it.
- Auth guard is the first line: `if (!uid) throw HttpsError('unauthenticated')`.
- GDPR: reportMeta is in collectUserDataSnapshots (delete cascade). Intentionally
  omitted from buildUserExport (operational metadata, like fcmTokens). Correct.

Residual findings (low, not blocking):
1. `targetId` and `targetOwnerUid` have no upper-length bound in validateReportInput.
   A malicious caller can store arbitrarily large strings in the report doc.
   Low impact (reports are admin-read-only, never client-read), but worth adding
   e.g. `d.targetId.length <= 128 && d.targetOwnerUid.length <= 128`.
2. `HttpsError` thrown inside `db.runTransaction` propagates out as an
   HttpsError (it extends Error, so Firestore's transaction runner will not
   retry it — only generic Errors from aborted/contention are retried). The
   comment in the code is correct; confirmed safe.
3. Client-side `createReport` passes `params.note` untrimmed to the callable.
   The server trims it in validateReportInput, so storage is correct. Minor:
   the client could send a multi-MB note payload before the server validates it.
   Low risk given Firebase callable request size limit (~10 MB), but a
   client-side trim to REPORT_COOLDOWN_MS chars before the call would add defence.

### 2026-06-20 — BIN-49 re-review: all three low findings confirmed resolved
(1) `REPORT_ID_MAX = 256` added to `functions/src/submitReport/logic.ts` and enforced in
`validateReportInput` for both `targetId` and `targetOwnerUid`; unit test in `logic.test.ts`
covers exactly-at-cap acceptance and over-cap rejection.
(2) `src/lib/firebase/reports.ts`: `setLastReportAt` now called AFTER a successful callable
return, not before — a rejected/cooldown call no longer penalizes the client UI timer.
Client trims/slices note to 500 chars before the callable call (defense-in-depth).
(3) New rules test: `non-owner cannot delete another user throttle` — seeds via
`withSecurityRulesDisabled` then asserts `deleteDoc` as `otherDb()` fails.
All five security invariants re-confirmed: batch-bypass closed (create=if false),
cooldown serialized in `db.runTransaction`, reporterUid derived from `request.auth.uid`
only, auth guard is first line, GDPR delete cascade includes `reportMetaSnap` at
`AuthContext.tsx:598`.

### 2026-06-27 — BIN-178: public-read catalog rollup collection: confirmed safe pattern

`streamingLeaving/{doc}` with `allow read: if true; allow write: if false` mirrors the
already-approved `streamingOffers`, `priceHistory`, `titleRatingsAggregate`, and
`cineasternaCatalog` pattern exactly. It is correctly inserted inside the top-level
`match /databases/{database}/documents { }` block at the same level as those peers —
it does NOT widen any enclosing match block.

Content stored is `{ byProvider: { [pid]: [{ tmdbId, mediaType, leaving }] }, today, generatedAt }`.
No uid, no email, no display name, no PII of any kind. Not a GDPR surface. No entry
required in `collectUserDataSnapshots`.

The leavingRollup function reads `streamingOffers` with a single-collection paginated
query (`db.collection('streamingOffers').orderBy('__name__').limit(2000)`). Single-collection
`orderBy('__name__')` does NOT require an explicit index in firestore.indexes.json (Firestore
auto-indexes __name__ for single-collection queries; only COLLECTION_GROUP queries need an
explicit entry — per the 2026-06-20 entry above). Cost: O(streamingOffers docs / PAGE_SIZE)
reads per day; one write. Bounded and cheap at the 25 SEK/mån cap.

The `.replace(/</g, '\\u003c')` injection guard in both new route pages matches the
provider/[id]/page.tsx canonical pattern exactly. All inputs to jsonLd() are static
catalog data (franchise name from `FRANCHISES` const, provider name from `getProvider()`
keyed on a validated numeric id) — no user-supplied string ever reaches jsonLd().

dangerouslySetInnerHTML trust boundary: the only external data that enters the JSON-LD
objects is TMDB title strings (movie/collection titles). These are HTML-escaped by
JSON.stringify and the `<` escape guard removes the only HTML-breakout vector from
JSON embedded in a `<script>` block. No further sanitization is needed.

Deploy-order note (not a blocking finding): the `streamingLeaving` rules block must be
deployed (`firebase deploy --only firestore:rules`) before `leavingRollup` is deployed
as a Function. The leavingRollup writes via Admin SDK (bypasses rules), so the write
works regardless — but the client-side `useStreamingLeaving` reads via the JS SDK and
needs `allow read: if true` to be live before users hit the /forsvinner pages. If
functions are deployed first and rules lag, the client read returns permission-denied
and ForsvinnerListClient shows a loading state or empty list until rules are deployed.
Not a security exposure, but a UX gap. Recommended order: rules → functions → hosting.

### 2026-06-27 — BIN-178 motnChanges rewire: external API cursor + shows map trust model

**cursor from nextCursor (external string → URLSearchParams):** `json.nextCursor` from
MOTN's response is set as a URLSearchParams value via `params.set('cursor', cursor)`.
`URLSearchParams.set()` percent-encodes the value at insertion time, so no raw string
can break out of the query-string position. Not an injection vector. Pattern safe: any
external pagination cursor going into URLSearchParams is auto-escaped; only template
literal URL construction (`https://...?cursor=${cursor}`) would be dangerous.

**shows map from MOTN (external object → Firestore doc):** `Object.assign(shows, json.shows ?? {})`
accumulates the raw MOTN `shows` map across pages. The only field consumed downstream
is `shows[showId].tmdbId` (a string like "movie/597"). This string is parsed by
`parseTmdbRef()`, which enforces the format `(movie|tv)/<positive integer>` and rejects
anything else — the parsed result is a constrained `{ mediaType: 'movie'|'tv', id: number }`.
No raw external string flows from the shows map into Firestore or the DOM. The `leaving`
date is derived from `isoFromUnix(c.timestamp)` where timestamp is already type-checked
as `typeof ch.timestamp === 'number'` before admission — `isoFromUnix` produces a
well-formed YYYY-MM-DD via `Date.toISOString().slice(0,10)`. All three fields in
LeavingEntry are structurally sanitized before Firestore write and before client render.

**Low observation — shows map key collisions across pages:** `Object.assign(shows, json.shows ?? {})`
means a later page's entry for the same showId overwrites an earlier page's entry.
If MOTN returns different tmdbId values for the same showId across pages (a server-side
data inconsistency), the last page wins. Impact is bounded: worst case is a wrong TMDB
id for a title, which either resolves to the wrong title (cosmetic) or parseTmdbRef
rejects it (entry dropped). Not a security issue; low functional risk.

**Low observation — MAX_PAGES=20 soft cap:** at 25 changes/page this is 500 max entries
for SE/31d, which is ample. However, if MOTN increases page size or SE has an
exceptional churn event, some expiring titles could be silently dropped (partial list).
Not a security issue; the cap is intentional and documented.

**Secret handling verified:** key is read from `process.env.MOTN_API_KEY` (bound via
`defineSecret` + `secrets:[MOTN_API_KEY]`); placed only in the `X-RapidAPI-Key` header;
never interpolated into URL path or query string; never logged (the logger.warn on
non-ok status logs only the HTTP status code, not the key). Identical pattern to
`functions/src/streamingOffers/motn.ts`. AbortSignal.timeout(10_000) present. On
failure the function returns null early and does NOT overwrite the Firestore doc —
the previous rollup remains intact. All checks pass.

### 2026-06-28 — BIN-275/348: browse-wrap consent + age-confirmation on Google-SSO path

**Firestore rules — no hasOnly whitelist on users/{uid}:** confirmed that the
`allow create` rule (`if isOwner(uid) && !('isAdmin' in request.resource.data)`) and
`allow update` rule (isAdmin-immutability + bio/displayName length checks) contain NO
`hasOnly` field whitelist. The new fields `termsAcceptedAt`, `termsVersion`, and
`ageConfirmedAt` are accepted transparently — no rules change is required and no
permission-denied risk exists. This is correct architecture for a profile doc that
accumulates fields over time.

**Consent honesty — notice IS rendered at the Google entry point:** the browse-wrap
`<p>` block is rendered unconditionally in LoginPage, positioned between the Google
button and the email/password divider. It is visible on both 'login' and 'register'
modes. The `handleGoogle` function calls `signIn()` which calls `signInWithPopup` —
no consent write happens at that call site. The write occurs in `ensureUserProfile`
inside the `onAuthStateChanged` callback, gated on `!snap.exists()` (new-doc branch
only). The consent record is therefore: (1) only for new accounts, (2) timestamped
server-side via `serverTimestamp()`, (3) structurally tied to a visible notice.

**No backfill of existing-doc consent:** the existing-doc branch (`snap.exists()`)
in `ensureUserProfile` reads and returns the stored profile with `data.termsAcceptedAt?.toDate()`
and `data.ageConfirmedAt?.toDate()` — it does NOT write anything. A returning Google
user who already had a profile doc gets their existing timestamps (or undefined if they
predate this change), never a fresh overwrite. Correct.

**GDPR completeness:** `termsAcceptedAt`, `termsVersion`, `ageConfirmedAt` are fields
on `users/{uid}` (the profile doc), which is already collected as `profileSnap` by
`collectUserDataSnapshots`. No new subcollection; no GDPR gap.

**No secrets/PII leak:** `src/lib/legal.ts` exports only `CURRENT_TERMS_VERSION`
(a date string) and `MIN_AGE` (integer 13). Both are intended client-visible constants.
No keys, tokens, or PII.

**Low observation — returning-Google-user has no consent record:** a user who signed in
via Google before this change was deployed has no `termsAcceptedAt` or `ageConfirmedAt`
on their doc (the existing-doc branch never writes these). Their `UserProfile` will have
`termsAcceptedAt: undefined` and `ageConfirmedAt: undefined`. This is by design — you
cannot retroactively record consent that was never shown. The risk is that the app has
no way to distinguish "pre-consent-feature Google user" from "email/password user who
just registered but consent write failed". Low severity: the population of pre-feature
Google users is bounded and known, and the absence of a timestamp is the correct
signal (don't backfill phantom consent). No action needed unless a legal re-acceptance
prompt for pre-feature users is ever required — that would be a separate feature.

**Low observation — `signIn()` is also called from non-login surfaces:** if any other
component in the codebase calls `useAuth().signIn()` (the Google popup trigger) from a
surface that does NOT show the browse-wrap notice, a new Google account created from
that surface would have `ensureUserProfile` write consent timestamps without the user
having seen the notice. Current audit: `signIn` is only wired to `handleGoogle` in
`src/app/login/page.tsx`. Enforce this invariant: if `signIn()` is ever added to a
second entry point (e.g., a "Connect Google" button elsewhere), that surface must also
render the browse-wrap notice, or `ensureUserProfile` must not write consent fields
for surfaces that haven't shown it.

### 2026-06-29 — BIN-320: motnBudget/{utcDay} — server-only collection, clean design (CLEAN)

`motnBudget/{utcDay}` is written exclusively by the `streamingOffersRefresh` scheduled
function via Admin SDK (Cloud Functions v2 onSchedule). The Firestore rules file has NO
`match /motnBudget/{doc}` block. Firestore's default-deny applies: any path with no
matching rule block in the rules file is implicitly denied to ALL clients. Confirmed by
inspection of `firestore.rules` lines 1–795: no wildcard catch-all (`match /{document=**}`)
exists at the top level that would grant broad access — the top-level match is
`match /databases/{database}/documents { }` with only explicit named collections inside.
Client read AND write of motnBudget is impossible.

Content of stored documents: `{ count: number, updatedAt: serverTimestamp }`. No uid, no
email, no display name, no PII. Not a GDPR surface; no entry needed in
`collectUserDataSnapshots`. Analogous to the approved `omdbBudget/{day}` pattern
(firestore.rules line 447) and `askBingeBudget/{day}` (line 453) — consistent with
established codebase precedent.

Secret handling (MOTN_API_KEY): verified in `functions/src/streamingOffers/motn.ts`.
The key is read from `process.env.MOTN_API_KEY` (bound via `defineSecret`). It is placed
only in the `X-RapidAPI-Key` request header. The 429 `logger.warn` call (line 42) logs
only `mediaType` and `tmdbId` — the key string is never interpolated into any log message,
URL path, or query string. The non-ok path (line 43) also logs only the HTTP status code.
No secret leakage in any new code path.

Transaction + bucket-burn logic: the `db.runTransaction` in `index.ts` runs entirely
server-side inside a Cloud Function. No client can invoke it. The `reserveSlot` pure
function (budget.ts) is exercised by unit tests covering cap-exactly, over-cap, and
crash-retry scenarios. The 429 bucket-burn (`budgetRef.set({ count: HARD_DAILY_CAP })`)
is a direct Admin SDK write from within the function — not callable or triggerable by
any client path. The transaction serialises concurrent retries correctly.

No new user-owned subcollection was introduced. `collectUserDataSnapshots` requires no
update. No rules change is in the diff. No manual `firebase deploy --only firestore:rules`
is needed for this change to be safe.

Verdict: CLEAN. All four BIN-320 review points pass.

### 2026-06-29 — BIN-292: server-side targetOwnerUid derivation closes report-framing vector (CLEAN)

The `validateReportInput` function in `functions/src/submitReport/logic.ts` no longer
reads or validates `targetOwnerUid` from the client payload. The `ValidReport` interface
omits the field entirely. The client-sent value is silently dropped by the validator's
allowlist construction (only `targetType`, `targetId`, `reason`, `note` survive).

`resolveTargetRef(targetType, targetId)` maps the validated `targetType` to a fixed
collection name (`reviews`, `lists`) or parses a comment path with a strict regex
`^reviews\/([^/]+)\/comments\/([^/]+)$`. The `targetId` is only ever used as a doc-id
(scalar Firestore path segment), never as a collection name or path prefix — no path
traversal or collection-redirection is possible. All three non-user ref kinds (`review`,
`list`, `comment`) land at exactly one pre-specified collection.

The owner-derivation reads (`tx.get(...)`) live INSIDE `db.runTransaction`, after the
cooldown check throws if within cooldown. The endpoint is not a free ownership-lookup
oracle: you must not be in cooldown to trigger the reads.

The `invalid` kind (malformed comment path) falls through both `if` branches and stores
`targetOwnerUid=null + ownerResolved=false` — it does not name any uid, so no framing
is possible via malformed paths. Same treatment for a genuinely missing/deleted target.

One LOW observation: `createReport` in `src/lib/firebase/reports.ts` (lines 83, 115)
still accepts and forwards `targetOwnerUid` in the client-to-callable payload. The
server strips it (validateReportInput ignores it), so no framing is possible. But the
stale signature is misleading — a future reader might assume the field matters server-
side. Recommendation: remove `targetOwnerUid` from the `createReport` params signature
and the `submitReport({...})` call object in a follow-up cleanup (no security urgency;
the server-side strip is the definitive gate).

The Firestore `allow update` rule (firestore.rules line 421) still pins
`request.resource.data.targetOwnerUid == resource.data.targetOwnerUid`, ensuring an
admin cannot change a server-derived owner uid after the fact. This constraint is now
even more valuable: the stored value was set by the server and cannot be overwritten by
an admin update. No rules change is needed.

### 2026-06-29 — BIN-334: client-written actionedByUid in reports update — acceptable LOW risk

`updateReportStatus` (reports.ts) now writes `actionedByUid` as a string sourced from
`useAuth().uid` in the admin dashboard (admin/reports/page.tsx). The Firestore rule
`match /reports/{reportId} allow update: if isAdmin()` gates all updates on the
`isAdmin()` function call — which in turn does a server-side `get()` on
`users/$(request.auth.uid).data.isAdmin`. A non-admin caller is blocked at the rule
level before the write is attempted; they cannot write `actionedByUid` or any other
field. Finding (1) is CLEAN.

The spoofing surface: the rule does NOT enforce
`request.resource.data.actionedByUid == request.auth.uid`. A malicious admin could
therefore write a DIFFERENT uid as `actionedByUid`, attributing an action to another
admin (or any uid string). This is a trust-boundary note rather than a live exploit
vector, because:
- Binge is single-admin (the solo founder). There is no second admin uid to impersonate.
- Even with multiple admins, the attack surface is limited to mis-attributing admin
  actions in the admin-only dashboard (no public exposure; no privilege escalation).
- The existing `allow update` rule already pins `reporterUid`, `targetType`,
  `targetId`, `targetOwnerUid`, `reason`, and `createdAt` to their pre-commit values,
  so only `status`, `actionedByUid`, and `updatedAt` are writable. Core report history
  cannot be tampered with. Finding (2) severity: LOW.

Rule-enforcement follow-up: adding
`&& request.resource.data.actionedByUid == request.auth.uid`
to the `allow update` condition in `firestore.rules` would close the spoofing
surface entirely. Worth filing if Binge ever moves to multiple admins; not urgent
for a solo founder setup.

### 2026-07-02 — BIN-349: ratedAt whitelist + type-bound field — clean pattern, confirms test-vacuity check method

`ratedAt` (serverTimestamp of when a user set/changed their watchlist rating,
read by rec-recency/taste-stats to replace the noisier `updatedAt` — which any
edit bumps) was added to `isValidWatchlistItem`'s `hasOnly` whitelist plus a
new type-bound line `d.ratedAt is timestamp`. Confirmed clean on all four axes:

1. **Whitelist necessity**: without it, `updateRating`'s merge-write
   `{ rating, ratedAt: serverTimestamp(), ...visFields, updatedAt }` would be
   rejected wholesale by `hasOnly` (permission-denied on every rating change),
   not just the new field silently dropped — `hasOnly` fails the entire write
   if ANY key is unrecognized. Confirmed by reading the merge-write call site.
2. **Type-bound necessity**: `hasOnly` only checks key membership, never value
   type — exactly like the pre-existing `rating`/`nextAirDate`/etc. bounds this
   mirrors. Without `d.ratedAt is timestamp`, a client could merge-write
   `{ ratedAt: 'anything' }` and it would pass (key is whitelisted). The bound
   closes that.
3. **No public-aggregate leak**: `communityRatingMaintain`
   (`functions/src/communityRatings/index.ts`) — the only trigger that reads
   watchlist docs to feed a public collection (`titleRatingsAggregate`) —
   reads ONLY `before?.rating`/`after?.rating` via `ratingDelta()`. It never
   touches `ratedAt`. Confirmed by full read of the function body. `ratedAt`
   only feeds client-side, owner-scoped consumers (`seedAnalysis.ts`,
   `taste/stats.ts`) that read the user's own watchlist snapshot — no
   cross-user exposure.
4. **GDPR**: no new subcollection — `ratedAt` rides the existing `watchlist`
   subcollection doc, which `collectUserDataSnapshots` already whole-snapshots
   (`getDocs(collection(db, 'users', uid, 'watchlist'))`). No collector change
   needed. This is the "field added to an already-covered doc" case — contrast
   with the "new subcollection" case (2026-06-21 entry) which DOES need a
   collector change.

**Test-vacuity check method worth repeating**: for a positive
type-bound-satisfying test, verify the write shape matches the real caller's
merge-write exactly (here: `{ ratedAt: serverTimestamp() }` alone, matching
`updateRating`'s actual field, not a full valid doc — proving the whitelist
entry specifically, not just "a valid doc happens to include this field"). For
the negative test, verify the ONLY thing that could reject it is the new bound
(here: the key is whitelisted so a bare non-timestamp value isolates the type
check) — if the negative test could also fail via an unrelated existing rule,
it wouldn't prove what it claims to.

PII/visibility: `actionedByUid` is an internal admin uid (not a username or email),
displayed only on the admin-only `/admin/reports/` page, truncated to 8 chars in the
UI. Not a PII leak. Finding (3) is CLEAN.

Core-field tamper: the existing `allow update` rule pins `reporterUid`, `targetType`,
`targetId`, `targetOwnerUid`, `reason`, and `createdAt` via equality checks against
`resource.data.*`. These checks fire even when a new field (`actionedByUid`) is
written alongside them — Firestore evaluates ALL conditions in the rule expression.
No rule gap is introduced by adding `actionedByUid` to the write payload. Finding (4)
is CLEAN.

Deploy-order note: no rules change accompanies this diff. The write goes via the JS
SDK with the existing `allow update: if isAdmin()` rule already in production. No
manual `firebase deploy --only firestore:rules` is needed for this change — the
existing deployed rules already permit the updated write payload because they do not
use a hasOnly whitelist that would block the new field.

Verdict: ACCEPTABLE. No blocking findings. One LOW follow-up (rule does not enforce
`actionedByUid == request.auth.uid`); recommend filing as a minor hardening ticket
if the admin population ever grows beyond one.

### 2026-06-29 — BIN-329: joinAttempts erasure — two-layer backstop design verified

**Threat:** `groups/{id}/joinAttempts/{uid}` stores the **plaintext** invite token the
joiner submitted. A successful join self-deletes within seconds (groups.ts). Three
gap scenarios leave the plaintext token orphaned: (a) abandoned join (user never
completed step 2), (b) failed best-effort cleanup after step 2, (c) account deleted
via Firebase Console (runs no client cascade).

**Design: two independent erasure layers, each sufficient alone:**

1. **Client cascade (AuthContext.tsx deleteAccount):** `refs.push(doc(db, 'groups', groupDoc.id, 'joinAttempts', id))` is queued for every group the deleting user is currently a member of. The rule `allow delete: if isSignedIn() && uid == request.auth.uid` permits this; deleting a non-existent doc is a Firestore no-op, so it is safe when the doc was already cleaned up by the successful join. Scope: groups the user is a current member of.

2. **Server reaper (retentionCleanup/index.ts + logic.ts):** `collectionGroup('joinAttempts').select('createdAt').orderBy('__name__').limit(PAGE_SIZE)` sweep via Admin SDK deletes any attempt older than 1 hour. Admin SDK bypasses Firestore rules; the 1h TTL is orders of magnitude larger than any legitimate in-flight two-step window (the window is sub-second in the happy path). Covers: abandoned joins (never became a member), groups the deleting user was NOT a member of, Console-deleted accounts. This is the Art. 17 backstop regardless of deletion pathway.

**Check (a): can the reaper delete a legitimate in-flight joinAttempt?**
No. The two-step flow is: write attempt → immediately run batch.commit() for step 2. Both happen synchronously within the same JS call stack tick (no user-observable gap). A 1-hour TTL cannot fire on a sub-second window. If step 2 fails, a retry calls `deleteDoc(attemptRef)` (best-effort cleanup) then `setDoc(attemptRef, ...)` — rewriting a fresh `createdAt`. So any attempt older than 1 hour is definitionally an orphan. Confirmed safe.

**Check (b): no firestore.rules change introduced?**
Confirmed. The diff contains zero changes to `firestore.rules`. The client-delete uses the existing `allow delete: if isSignedIn() && uid == request.auth.uid` rule (line 717). The Admin SDK reaper bypasses rules entirely. No manual `firebase deploy --only firestore:rules` needed.

**Check (c): plaintext token correctly excluded from GDPR export?**
Confirmed. `userData.ts` comment explicitly documents this: the token payload is a **shared group secret**, not personal data of the joining user — analogous to `fcmTokens`. `collectUserDataSnapshots` has no key for `joinAttempts`, and neither `UserDataSnapshots` interface nor the `Promise.all` array in `collectUserDataSnapshots` includes a joinAttempts fetch. `buildUserExport` therefore cannot accidentally include it. Reasoning is correct: the plaintext token should never appear in a GDPR export regardless of Art. 20 scope.

**Check (d): no new client-read surface opened?**
Confirmed. The `collectionGroup('joinAttempts')` query runs Admin-SDK-only inside the scheduled function. The Firestore rule `allow read: if false` on `joinAttempts` remains unchanged — clients can NEVER read any joinAttempt doc. No collectionGroup index was added to `firestore.indexes.json` (the sweep uses `__name__` ordering only, same as the notifications sweep).

**Residual gap the fix does NOT close:**
The client cascade only covers groups where `memberUids array-contains uid` at deletion time. An abandoned join (user tried to join group X, failed step 2, was never added to memberUids) leaves a joinAttempt in group X outside the cascade scope. The retentionCleanup reaper is the designed backstop for exactly this case — it sweeps ALL groups via collectionGroup, membership-agnostic. This gap is acknowledged and intentionally closed by layer 2. No additional change needed.

**LOW finding — collectionGroup(__name__) index for joinAttempts has same risk as notifications:**
`db.collectionGroup('joinAttempts').select('createdAt').orderBy('__name__').limit(PAGE_SIZE)` follows the exact same pattern as the existing `collectionGroup('notifications')` sweep that has been in production. Neither `notifications` nor `joinAttempts` has an explicit `COLLECTION_GROUP` index entry in `firestore.indexes.json`. Per the 2026-06-20 entry: collectionGroup queries on `__name__` alone typically require an explicit collection-group index. In practice this pattern appears to work (notifications sweep is live), but the absence of a declared index risks either a runtime error or a full scan. Severity: LOW, accepted precedent (notifications has same gap). If either sweep ever fails in production logs with "index required", add `{ "collectionGroup": "joinAttempts", "queryScope": "COLLECTION_GROUP", "fields": [{ "fieldPath": "__name__", "order": "ASCENDING" }] }` to `firestore.indexes.json`.

**Verdict: APPROVED. No blocking findings.**

### 2026-06-29 — BIN-279: matchesOwnIdentity deny-path tests — correct seeding pattern

`matchesOwnIdentity(d)` short-circuits to true when `displayName` and `username` are both
null or absent (the guard's OR branch resolves immediately). This means a test that writes
a doc with null identity fields against an un-seeded user profile would pass `matchesOwnIdentity`
and therefore CANNOT test the identity-mismatch denial path.

The complementary problem: if the user profile doc does NOT exist and the written doc has a
non-null displayName/username, the Firestore Rules emulator treats the `get()` call on the
missing doc as returning no data, making `.data.get(...)` return null, which makes the rule
expression evaluate as false (the rule expression errors). This means the deny test WOULD fail
without the seed, but for the WRONG reason — the rejection comes from "user profile not found"
rather than "displayName doesn't match". The test is therefore vacuously correct.

The fix: seed the writer's OWN profile (OWNER) with known displayName + username via
`withSecurityRulesDisabled` BEFORE the deny tests. Now the `get()` finds the profile, the
comparison `'Någon Annan' == 'Äkta Ägaren'` returns false for the right reason (value mismatch),
and the paired positive control passes with matching values. This seeding pattern is required
for any test of `matchesOwnIdentity` or any similar guard that reads the user's own profile
doc to validate a field value.

Coverage gap (minor, not a rules issue): the reaction deny tests only cover `displayName` forgery.
`username` forgery on reactions shares the same `matchesOwnIdentity` code path and is covered
by the review tests. Since the guard is identical for both document types, the omission is a
test completeness note, not a security gap. If `matchesOwnIdentity` is ever split between
document types, add a username-forgery deny test for reactions.

### 2026-06-30 — BIN-347: static subcollection-enumeration guard — accuracy note on privacy copy

The `KNOWN_USER_SUBCOLLECTIONS` const + three-way set-equality test is architecturally
sound and closes the BIN-277/joinAttempts whole-collection-miss failure mode. The guard
chain is:
  rules paths == KNOWN_USER_SUBCOLLECTIONS == helper collection() reads -> keyof UserDataSnapshots -> dataExport.coverage.test.ts

All three set equalities verified to be exact (16 names each, no duplicates). The
collectionGroup index gate (comments.uid and reactions.uid) also passes — both have
COLLECTION_GROUP fieldOverrides in firestore.indexes.json.

**One accuracy issue in the privacy-policy copy (non-blocking, needs a follow-up fix):**

`src/app/integritet/page.tsx` line 115 says:
  "Det är bara id:t som sparas — själva anmälningstexten är inte en personuppgift om dig som anmälare."

This is factually incorrect. The `reports/{reportId}` document stores:
  - `reporterUid` (the retained uid)
  - `reason` (a ReportReason enum string, e.g. "spam")
  - `note` (optional free-text written by the reporter — the "anmälningstexten")
  - `targetType`, `targetId`, `targetOwnerUid`, `createdAt`, `status`

The `note` field CAN contain free text about the reported content, and `reason` is
a structured string. Whether these constitute personal data OF THE REPORTER (rather
than data about the reported content) is a legal characterisation question, but the
factual premise of the sentence ("bara id:t") is wrong — more than the uid is stored.

The clause "anmälningstexten är inte en personuppgift om dig som anmälare" is a
legal assertion that may or may not hold (report text typically describes the content
being reported, not the reporter), but the preceding "bara id:t" statement is plainly
inaccurate as a factual description of what is stored.

**Fix:** rephrase to describe what is actually retained — e.g. "Rapporten i sin helhet
(ditt interna id, rapporteringsskäl och eventuell kommentar) kan sparas..." — and keep
the Art. 17(3) justification. Do NOT claim only the uid is retained when reason+note
are also stored. The Art. 17(3) citation itself is correct; only the factual summary
of what is retained is wrong.

No other security findings. No rules change, no new auth surface, no secrets committed.
This is a legal-copy accuracy issue only; it does not affect actual data behavior.

### 2026-06-30 — BIN-276/327: groups-rules hardening — pin asymmetry on inviteTokenRotatedAt is a LOW cosmetic gap, not a security bypass

The owner-update branch pins `inviteTokenHash` with an existence-check idiom:
  `!('inviteTokenHash' in request.resource.data) || request.resource.data.inviteTokenHash == resource.data.get('inviteTokenHash', null)`

But `inviteTokenRotatedAt` is pinned with a pre-existing-value idiom:
  `!('inviteTokenRotatedAt' in resource.data) || request.resource.data.inviteTokenRotatedAt == resource.data.inviteTokenRotatedAt`

The first guard fires if the REQUEST doc doesn't include the field (i.e., the client omitted it), OR if included, it must match. The second guard fires if the STORED doc doesn't include `inviteTokenRotatedAt` (e.g., a legacy group with no rotation timestamp), OR if stored, the written value must match. The asymmetry: if `inviteTokenRotatedAt` is absent from the stored doc, the second guard trivially passes regardless of what the client writes for `inviteTokenRotatedAt` (the short-circuit `!('inviteTokenRotatedAt' in resource.data)` is true). This means on groups where `inviteTokenRotatedAt` was never set, the owner-update branch does NOT pin the field — an owner doing a member-remove could simultaneously set `inviteTokenRotatedAt` to an arbitrary value.

**Severity: LOW.** The `inviteTokenRotatedAt` field is metadata about WHEN the token was last rotated — it has no effect on the security gate. The actual hash-verification gate lives entirely on `inviteTokenHash` (pinned correctly with the request-doc existence check). An attacker who could forge `inviteTokenRotatedAt` gains no privilege: token join uses `exists(joinAttempts/{uid})` not the rotation timestamp; token rotation is gated on `rotateInviteToken` (owner-only flow); and the token hash itself cannot be changed via this path. The `inviteTokenRotatedAt` is informational only. The same idiom appears consistently on all four branches (leave, token-join, invite-accept) — the pattern is internally consistent even if the two idioms differ.

**Not a blocking finding.** The symmetrically correct pin would be:
  `!('inviteTokenRotatedAt' in request.resource.data) || request.resource.data.inviteTokenRotatedAt == resource.data.get('inviteTokenRotatedAt', null)`
but changing it is a follow-up hardening, not a pre-deploy blocker.

**Verified client flows all pass:**
- `updateGroup` (patch name/defaults): sends only `name`/`defaults`/`updatedAt` → both token fields omitted from payload → both `!('x' in request.resource.data)` short-circuits pass. CLEAN.
- `rotateInviteToken`: sends `inviteTokenHash` + `inviteTokenRotatedAt` + `updatedAt`. The request is made AS OWNER. The inviteTokenHash pin fires: `inviteTokenHash` IS in the request AND it differs from stored — so the pin denies. This means `rotateInviteToken` does NOT go through the owner-update branch. It is an `updateDoc` on the group doc. The owner-update branch would block a simultaneous hash+rotatedAt write. Checking: `rotateInviteToken` calls `updateDoc` with `{inviteTokenHash, inviteTokenRotatedAt, updatedAt}` — the owner branch pin on inviteTokenHash DENIES this (new hash != stored hash). This would be a blocking break EXCEPT: the call is an `updateDoc` not a `setDoc`, and the owner branch also checks `request.resource.data.ownerUid == resource.data.ownerUid` (passes) and `resource.data.memberUids.hasAll(request.resource.data.memberUids)` (passes — memberUids unchanged). Wait — the inviteTokenHash pin blocks it: `!('inviteTokenHash' in request.resource.data)` is FALSE (it IS in the request), and `request.resource.data.inviteTokenHash == resource.data.get('inviteTokenHash', null)` is FALSE (new != old). So the owner branch DENIES `rotateInviteToken`. Is there another branch that allows it? None of the other branches (leave, join, accept) allow the owner. CONCLUSION: `rotateInviteToken` is blocked by ALL branches of the update rule when inviteTokenHash changes. This seems like it would break token rotation — but `npm run test:rules` passes 100 tests including groups tests. Checking test coverage: the test file does NOT include a test for `rotateInviteToken`. It is possible rotation is broken and just not tested. However — the original pre-BIN-276 rules did NOT pin inviteTokenHash at all in the owner branch, so rotation worked before. BIN-276 added the pin. This IS a potentially breaking change for the legitimate `rotateInviteToken` flow.

**ACTUAL FINDING — MEDIUM: `rotateInviteToken` and `disableInviteToken` are now blocked by the BIN-276 pin.**

`rotateInviteToken` calls `updateDoc(groupRef, { inviteTokenHash: newHash, inviteTokenRotatedAt: serverTimestamp(), updatedAt: serverTimestamp() })`. After BIN-276, the owner-update branch checks:
  `!('inviteTokenHash' in request.resource.data) || request.resource.data.inviteTokenHash == resource.data.get('inviteTokenHash', null)`
Since `inviteTokenHash` IS in the request AND the new hash differs from the stored hash, the second conjunct is FALSE and the first conjunct is FALSE → the pin denies the write. No other branch covers an owner writing a new `inviteTokenHash`. Result: permission-denied on every token rotation.

`disableInviteToken` calls `updateDoc(groupRef, { inviteTokenHash: null, updatedAt: ... })`. Same analysis: `inviteTokenHash` IS in the request, and `null != stored_hash` → denied.

The rules test suite does NOT test `rotateInviteToken` or `disableInviteToken`. The 100-test pass does not catch this.

**Fix:** add a dedicated token-rotation branch OR expand the owner branch to allow token-hash changes when the writer is the owner and the only change is `inviteTokenHash`/`inviteTokenRotatedAt`/`updatedAt`. The simplest correct expansion: permit the owner to change `inviteTokenHash` and `inviteTokenRotatedAt` freely when `ownerUid`, `memberUids`, `name`, and `defaults` are all unchanged. Example:
  ```
  // Token-rotation branch (rotateInviteToken / disableInviteToken)
  resource.data.ownerUid == request.auth.uid
  && request.resource.data.ownerUid == resource.data.ownerUid
  && request.resource.data.memberUids == resource.data.memberUids
  && request.resource.data.name == resource.data.name
  && request.resource.data.defaults == resource.data.defaults
  ```
This branch has no pin on `inviteTokenHash` or `inviteTokenRotatedAt` (that is the point — it is the legitimate mutation path for those fields). `disableInviteToken` sets hash to null; `rotateInviteToken` sets a new hash. Both pass.

Add tests: `owner can rotate invite token (hash changes)` and `owner can disable invite token (hash null)`.

Do NOT deploy the current diff to production until this is resolved — `rotateInviteToken` and `disableInviteToken` will throw permission-denied for all groups owners.

### 2026-06-30 — BIN-276 token-rotation fix: dedicated rotation branch — APPROVED

The fix (staged diff, re-review pass) adds a dedicated token-rotation branch immediately after the owner branch in `match /groups/{groupId} allow update`. All six verification points confirmed:

1. **`rotateInviteToken` passes:** payload is `{inviteTokenHash: newHash, inviteTokenRotatedAt: ts, updatedAt: ts}` as owner. Rotation branch: ownerUid check passes, memberUids `==` passes (inherited), name/defaults pass (inherited). Hash and rotatedAt are NOT pinned on this branch. ALLOWS.

2. **`disableInviteToken` passes:** payload is `{inviteTokenHash: null, updatedAt: ts}` as owner. Same analysis. inviteTokenRotatedAt inherited (absent from payload), equals stored. ALLOWS.

3. **Member-remove + hash-swap attack blocked:** A non-owner member cannot reach the rotation branch (first conjunct `resource.data.ownerUid == request.auth.uid` fails). An owner cannot use the rotation branch to also change memberUids (strictly pinned with `==`). An owner member-remove write goes through the owner branch, which pins inviteTokenHash — a simultaneous hash change is denied there.

4. **Rotation branch cannot be abused for ownership transfer / member injection / settings change:** `ownerUid`, `memberUids` (strict `==`), `name`, and `defaults` are all pinned. The strict `==` on `memberUids` (not `hasAll`) means zero membership change is permitted through this branch — both adds and removes are blocked.

5. **List equality `memberUids ==` for updateDoc omitting the field:** Firestore `request.resource.data` for an updateDoc inherits unchanged fields from `resource.data`. The inherited `memberUids` equals `resource.data.memberUids` trivially. The `==` operator on list types does element-by-element comparison in Firestore rules and is valid and correct here.

6. **`updateGroup` (name/defaults patch) still passes:** inviteTokenHash is absent from the payload so `!('inviteTokenHash' in request.resource.data)` short-circuits to true on the owner branch. Owner branch allows.

The LOW residual from the prior knowledge entry (asymmetric `inviteTokenRotatedAt` pin idiom on the owner branch — checked against request-doc vs stored-doc) remains. Impact: on groups where `inviteTokenRotatedAt` was never set, an owner doing a member-remove can freely set `inviteTokenRotatedAt` to any value. Since `inviteTokenRotatedAt` is purely informational metadata (the security gate uses `inviteTokenHash` exclusively), forging it grants no privilege. Not a blocker; follow-up hardening only.

Tests (103 total via `npm run test:rules`): three new rotation/disable tests in `describe('groups/{id} owner-update hardening (BIN-276)')` directly exercise the new branch against the actual rules. Non-owner rotate deny test confirms the owner-auth gate on the rotation branch is effective.

**Verdict: APPROVED-CLEAN. Safe to deploy.**

### 2026-06-30 — BIN-347 Part 2: collection-group READ rules for GDPR export path — APPROVED-WITH-NOTES

**Context:** `collectUserDataSnapshots` needed to enumerate a user's likes/comments/reactions across
all reviews/episodes via collection-group queries. Firestore rejects a CG query unless a recursive-
wildcard rule (`/{path=**}/collection/{id}`) or an ancestor rule explicitly permits the read.
The nested per-doc rules (e.g., `match /reviews/{reviewId}/likes/{uid} allow read: if true`) do NOT
cover CG queries — a separate recursive-wildcard rule is required.

**CG read rules — owner-scoping is correct.**
`match /{path=**}/likes/{likeId} { allow read: if isSignedIn() && resource.data.uid == request.auth.uid; }`
This grants a user read access to a like doc only when `resource.data.uid == request.auth.uid`. Since
the query always has `where('uid','==',myUid)` and the rule checks the same field, only the requesting
user's own docs pass. No cross-user enumeration is possible: another user's like doc has `uid != request.auth.uid`
and the rule denies it. The rule is correctly owner-scoped.

**Rules are additive — existing per-doc public reads unaffected.**
Firestore applies whichever matching rule GRANTS access — so the new CG rule `allow read: if owner-scoped`
coexists with the nested `allow read: if true` on individual like docs. A direct read of
`reviews/{id}/likes/{someUid}` is still public. The CG rule only helps CG QUERIES (where the user
owns the result set). No weakening of existing public surfaces.

**`reactions` CG rule path coverage verified.**
Episode reactions live at `episodeReactions/{episodeKey}/reactions/{reactionId}`. The rule
`match /{path=**}/reactions/{reactionId}` uses a recursive wildcard — `{path=**}` captures
`episodeReactions/{episodeKey}` — so the rule correctly matches the actual path. The CG query
`collectionGroup('reactions').where('uid','==',uid)` is served by this rule.

**likes create field-lock is sound.**
`request.resource.data.keys().hasOnly(['uid', 'createdAt'])` + `request.resource.data.uid == uid`
locks the doc schema on create: (1) no extra fields can be added (no bloating vector), (2) the uid
field is forced to match the doc-id (no uid forgery), (3) `isOwner(uid)` ensures the liker writes
their own doc only. The combination is tight.

**likes delete review-author branch cannot reach other reviews' likes.**
The rule lives inside `match /reviews/{reviewId}/likes/{uid}`. The variable `reviewId` in
`get(/databases/$(database)/documents/reviews/$(reviewId)).data.uid == request.auth.uid`
is bound by the parent match — it refers to the same review that contains the like being deleted.
An attacker who is author of review A cannot delete a like on review B; `reviewId` would be B's
id and they are not B's author.

**weeklyDigestState rule: implicit write-deny is correct but not explicit.**
`match /weeklyDigestState/{uid} { allow read, delete: if isOwner(uid); }` — no `allow create` or
`allow update` clause. Firestore default-deny makes client write impossible (correct). An explicit
`allow write: if false` would make the intent self-documenting; absence is not a security gap.
Content of docs (`{ lastSentDay }`) is a server-written dedup marker with no PII. Not a GDPR export
surface (deleted in the cascade for hygiene, not because it carries personal data).

**backfillLikeUids admin gate is correct.**
`isAdmin(callerUid)` reads `users/{uid}.isAdmin` from Firestore server-side (Admin SDK). The `isAdmin`
flag can only be set via Firebase Console (rules enforce this on the users/{uid} write path). The auth
check is the first line after the auth guard. The function is idempotent (skips docs that already have
`uid`). Uses Admin SDK so Firestore rules don't constrain the collectionGroup read or the batch.update.
The update sets `uid := d.id` (the doc-id, which is the liker's uid by schema convention) — correct
and harmless to re-run.

**backfillLikeUids collectionGroup('likes').orderBy('__name__') — no explicit index (LOW).**
Same standing gap as notifications/joinAttempts sweeps (per the 2026-06-20 and 2026-06-29 entries).
The Admin SDK may fall back to a full scan or throw on the first page if no COLLECTION_GROUP __name__
index exists. This is a one-shot function; if it fails, add the index entry and re-run.
Pattern: add `{ "collectionGroup": "likes", "queryScope": "COLLECTION_GROUP", "fields": [{ "fieldPath": "__name__", "order": "ASCENDING" }] }` to `firestore.indexes.json` if the function errors in production.

**GDPR completeness after this change.**
- Likes: now carry a `uid` field; CG query works; backfill covers pre-existing docs. COMPLETE.
- Comments/reactions: already had `uid` field; CG query was already in userData.ts but now has a
  matching recursive-wildcard rule. COMPLETE.
- weeklyDigestState: added to cascade in accountDeletion.ts line 183; emulator test seeds and asserts erasure. COMPLETE.

**Deploy order (mandatory process note).**
`deploy.yml` (push→main) deploys hosting only. The rules + index changes MUST be deployed with
`firebase deploy --only firestore:rules && firebase deploy --only firestore:indexes` BEFORE the
hosting deploy that ships the `where('uid','==',uid)` query. A reverse order leaves the CG query
rejected by the old rules in production, causing GDPR export and account deletion to throw for every user.

**Verdict: APPROVED-WITH-NOTES. No blocking findings. Safe to deploy (rules + indexes first).**

### 2026-07-01 — BIN-365: exact-self-leave size predicate + inviteTokenRotatedAt request-doc idiom

**Size predicate correctness (BIN-365 leave branch):**
`request.resource.data.memberUids.size() == resource.data.memberUids.size() - 1` added to the
leave branch only. This, combined with the prior `hasAll` (subset/shrink-only) and the self-absence
check `!(request.auth.uid in request.resource.data.memberUids)`, proves the single removed element
IS the caller and no bystander. The owner branch intentionally has NO size constraint (bulk-remove is
a legitimate owner operation). Size() is an in-payload check — no extra get()/exists() cost.

**GDPR deletion path compatibility confirmed:**
`accountDeletion.ts collectDeletionRefs` builds `newMemberUids = current.filter(u => u !== id)` and
`applyDeletionPlan` writes `{ memberUids: newMemberUids }` — a literal filtered array. This has
exactly size `old-1` for a member who was in the list, satisfies `hasAll` (filtered subset), and
satisfies the self-absence check (deleting user is not in the filtered list). The predicate passes.
Confirmed by emulator test: "exact self-leave with a bystander present succeeds (also the erasure write shape)".

**inviteTokenRotatedAt request-doc idiom:**
The stored-doc idiom `!('inviteTokenRotatedAt' in resource.data) || ...` short-circuits TRUE for any
group where `inviteTokenRotatedAt` was never stored — making the field freely forgeable on legacy groups.
The request-doc idiom `!('inviteTokenRotatedAt' in request.resource.data) || ...` checks whether the
PAYLOAD includes the field; if omitted (delta-write omitting the field), the inherited stored value
trivially equals itself. This must be applied to all branches that PIN the field (owner/leave/join/accept)
but must NOT be applied to the token-rotation branch which legitimately changes it.
Pattern: any "pin an existing field" guard should use the request-doc existence check, not the stored-doc
existence check, to prevent forgery on docs where the field was never set.

### 2026-07-01 — BIN-357: unguarded actionedByUid == request.auth.uid is correctly strict

The reports update rule adds `&& request.resource.data.actionedByUid == request.auth.uid` WITHOUT a
`!('actionedByUid' in request.resource.data) ||` guard. This is correct by design:

1. Every legitimate update goes through `updateReportStatus`, which always writes `actionedByUid`.
   There is no "update without attribution" code path.
2. `request.resource.data` for an `updateDoc` is the merged result. If `actionedByUid` is in the
   update payload, the merged value is the written value. The rule then enforces it equals the
   calling admin's uid.
3. If a future code path calls `updateDoc` WITHOUT `actionedByUid`, AND the stored doc also lacks
   the field, then `request.resource.data.actionedByUid` is a missing-field access in Firestore
   rules evaluation — this causes the rule expression to error and evaluate to DENY. This is
   the CORRECT protective outcome (an update without attribution should be blocked).
4. If the stored doc has `actionedByUid` from a prior action, and the update omits it, the
   inherited value is the prior admin's uid. The rule then requires that uid == current admin's uid.
   This means only the admin who last actioned the report can re-update without re-providing
   actionedByUid. This is acceptable behavior (and in practice updateReportStatus always provides it).

Pattern: an unguarded field-equality rule that would throw on a missing field is a STRICTER gate
than a guarded one. Use when you want to require the field to be present and correct on every write.
Use the `!('field' in ...) ||` guard only when omitting the field on update should be allowed
(i.e., "if you include it, it must be correct; if you omit it, pass through").

### 2026-07-01 — BIN-213: Next.js May-2026 App Router advisory batch — static-export mitigation

Next.js shipped a coordinated batch of ~13 security advisories on 2026-05-06/07 (7 High,
4 Moderate, 2 Low), patched in **16.2.6** (16.x line) and **15.5.18** (15.x line). The
headline issues — segment-prefetch middleware/proxy bypass (GHSA-267c-6grr-h53f + the
Turbopack-incomplete follow-up GHSA-26hh-7cqf-hhc6, both fully fixed only at 16.2.6),
dynamic-route-param middleware bypass (GHSA-492v-c6pp-mqqv), SSRF via WebSocket upgrades
(GHSA-c4j6-fc7j-m34r), RSC cache poisoning (GHSA-wfc6-r584-vfw7, GHSA-vfv6-92ff-j949),
CSP-nonce / beforeInteractive XSS, Image-Optimization + Cache-Components DoS — are **all
server-runtime code paths**.

**Why Binge's runtime blast radius is essentially nil.** Binge ships `output: 'export'`
(static HTML) to Firebase Hosting behind Cloudflare. **There is no Next.js server in
production** — no middleware executes, no RSC server responses are generated, the Image
Optimization API and WebSocket upgrade handler never run, Cache Components are not used.
Every advisory in this batch targets a runtime the static export does not have. Residual
exposure is **build-time only** (the export build runs Next on the CI host).

**Action taken.** Binge already resolved `next@16.2.9` (caret on `^16.2.4`); the floor in
`package.json` was bumped to `^16.2.9` for `next`, `eslint-config-next`, and
`@next/bundle-analyzer` so the patched version (≥ 16.2.6) is the documented minimum, not
just the incidental install. 16.2.9 > 16.2.6 → every advisory in the batch is included.
No code change was needed (no server runtime to harden); this is defense-in-depth on the
build host. **Pattern for future Next advisories:** assess whether the vector is a
server-runtime path; if so, the static-export posture neutralizes it at runtime and the
only obligation is keeping the build-host framework version at/above the patched floor.

### 2026-07-01 — "automatisk prisuppdatering": lazy field-migration via delete() is safe when the UI enforces mutual exclusivity (CLEAN)

`updateProviderTier` now `delete nextCosts[providerId]` instead of freezing `tier.cost`
into `providerCosts` on tier selection. This is a lazy migration that discards a
`providerCosts[id]` entry the instant a tier is chosen for that provider. The risk framed
by the requester (could this clobber a genuine custom cost the user still wants?) is
closed at the UI layer, not the write layer: `ProvidersSection.tsx` only renders the
cost `<input>` when `isCustom = hasTiers && !selectedTierId` is true, and the `<select>`
only calls `updateProviderTier` — `setProviderCost` is never reachable while a tier is
selected. Grep across `src/` confirms `updateProviderTier` and `setProviderCost` have
exactly one call site each (this component); no other write path exists that could
race the two fields. The delete is therefore always intentional — it fires exactly when
the user picks a tier, which is the one moment "clear the custom cost" is the correct
behavior. **Pattern to check on future migrate-via-delete diffs:** does the write
function's caller graph (grep for all call sites, not just the one under review) prove
the two fields are UI-gated as mutually exclusive, or could an unrelated code path write
one without clearing the other and silently resurrect stale data?

**Read-side consistency:** the new `resolveProviderMonthlyCost(id, {providerTiers,
providerCosts})` pure resolver (tier-first, live catalog price → custom cost → catalog
default → null) is the single source every consumer now goes through — verified all six
call sites (`resumeProvider`, `totalMonthlyCost`, `computeSpendSnapshot`,
`useServiceValue`, `useSubscriptionAdvisor` ×3, `ProvidersSection` total) were migrated
together in the same diff, so no surface can show a stale/disagreeing number after a
tier-select clears `providerCosts`. This closes what would otherwise be the disaster
case: `resumeProvider` freezing a resolved cost of `0` because `providerCosts[id]` was
just deleted and a naive caller read the raw field instead of the resolver.



## Relocated 2026-07-25 — consolidation batch (raw entries verbatim; lessons distilled into the active file's principles)

### 2026-07-20 — BIN-185 follow-up, RE-REVIEW: render-gate fix confirmed fail-closed + reachable; tier-change upload handling safe — APPROVED (closes the prior DOA finding)

Re-reviewed the same six files after the implementing session applied this file's own prescribed
fix: `RecapPanel.tsx`'s early return now reads `if (!hasBoundaryRecap && priorSeasons.length ===
0) return null;` (was gated on `loadedSeasons.length`, the post-open-only signal that made the
toggle button unreachable — see the entry immediately below). Verified, not just re-read:

1. **The exact regression is now covered by a real test that would have failed before the fix.**
   `RecapPanel.test.tsx`'s mock for `useSeasonRecaps` was extended to actually honor its third
   (`enabled`) argument (`if (!enabled) return { season, recap: null, isLoading: false }`) —
   closing the "mock drops the gating parameter" hole this same file's prior entry diagnosed as
   why the suite couldn't have caught the bug. A new test, `'renders the toggle BUTTON itself
   before the panel is ever opened'`, renders WITHOUT calling the file's `open()` helper (which
   renders+clicks in one step) and asserts the toggle text is present pre-click. Ran it: passes.
2. **Fail-closed conditions re-verified against the CURRENT code, not assumed carried over:**
   `priorSeasonNumbers(boundary)` is structurally `for (s=1; s<boundary.season; s++)` (read
   directly, `src/lib/recaps/boundary.ts:33-37`) — immune to any content of `seasonOnlySeasons`,
   so the current-season-leak-even-if-index-lies property holds by construction, re-confirmed by
   the (retained) test asserting season 4 excluded when `seasonOnlySeasons` wrongly lists it.
   `boundary == null → []` (short-circuit, no `priorSeasonNumbers` call at all) re-confirmed by a
   dedicated test render with `boundary={null}`. Traced the caller
   (`TVShowPageClient.tsx:137-140`): `recapBoundary = contiguousWatchedBoundary(recapInventory,
   isWatched)` — the SAME derivation used for the ordinary per-episode path, not a looser one for
   the fallback branch, so the comment's "boundary is already the contiguous watched frontier"
   claim is accurate, not just asserted.
3. **Ordinary (non-season-only) path confirmed byte-for-byte unchanged:** `coveredBoundary ?
   priorSeasonNumbers(coveredBoundary) : (...)` — the true branch is identical to pre-diff code;
   only the false branch (previously always `[]`) gained the season-only fallback.
4. **`seasonUploadDecision`'s new none↔full / full↔none tier-change handling introduces no new
   data-exposure or write-safety issue.** This is an Admin-SDK-only offline script (never a Cloud
   Function, never client-reachable, `firestore.rules` already denies all client writes to
   `recaps/**`) — the only "attacker" is a solo operator's own CLI typo, and both directions
   require an explicit `--force` to actually write (never silent — each prints a named
   upgraded/downgraded log line). Traced the two directions' actual client-visible effect: an
   upgrade (none→full, always paired with the SAME run's boundary-doc batch, so `missingCount:0`
   is only reachable when per-episode boundary docs for that season already exist) leaves a
   stale season number in the index's `seasonOnlySeasons` array (the upgrade branch doesn't prune
   it — same harmless-stale-entry conclusion the prior review reached, re-derived independently
   here rather than cited) — harmless because the client only ever CONSULTS `seasonOnlySeasons`
   when `coveredBoundary` is null for the user's CURRENT position, and an upgraded season having
   real boundary docs makes that null-check increasingly unlikely to hang on the stale entry, and
   even when it is consulted the fetched season doc is real/valid (client never reads
   `episodeCoverage` on read, confirmed unchanged). A forced full→none downgrade doesn't delete
   the season's existing per-episode boundary docs or their index entries either — so the
   ordinary path still resolves a real `coveredBoundary` within that season regardless of the
   season DOC's downgraded tier; `episodeCoverage` remains write-side metadata never consumed by
   any read path. The PARTIAL-mix invariant (`wouldBeCoverage` is `'full'`, `'none'`, or refused —
   never anything else) is unchanged, still enforced identically to the pre-follow-up version.
   New pure-function tests (`recap-upload.helpers.test.mjs`) directly exercise both tier-change
   directions with AND without `--force`, including one explicitly noting and fixing a prior test
   that claimed downgrade coverage but only exercised a `null`-existing-doc case — a real,
   substantive test correction, not cosmetic.
5. Ran the full targeted suite: `RecapPanel.test.tsx` + `useRecap.helpers.test.ts` +
   `coverage.test.ts` + `recap-upload.helpers.test.mjs` — 62/62 pass. `tsc --noEmit` clean
   repo-wide. No `firestore.rules`/`firestore.indexes.json` change in this diff (confirmed via
   `git diff --stat` — empty); `match /recaps/{recapId}` (`allow read: if true; allow write: if
   false;`) already covers the new `episodeCoverage`/`seasonOnlySeasons` fields, no deploy
   action needed beyond the standard offline-script usage. No new user-owned subcollection (GDPR
   `userData.ts` unaffected — `recaps/**` remains global/title-keyed). No secrets.

Verdict: **APPROVED, commit-ready.** No Critical/High/Medium finding. This closes the High
(blocking) finding from the entry immediately below — the feature is no longer dead on arrival.

### 2026-07-20 — BIN-185 follow-up "season-only-sourced recaps" (RecapPanel/useRecap/coverage.ts/recap-upload): all three panel conditions verified sound by trace, BUT the feature is DEAD ON ARRIVAL — the visibility gate checks post-open data instead of the always-fetched index signal, so the toggle button can never render for a pure season-only show; caught only by bypassing the test file's own over-simplified mock — the visibility gate checks post-open data instead of the always-fetched index signal, so the toggle button can never render for a pure season-only show; caught only by bypassing the test file's own over-simplified mock

Reviewed the unstaged working-tree diff for `src/lib/recaps/{types,coverage}.ts`, `src/hooks/useRecap.ts`,
`src/components/title/RecapPanel.tsx`, `functions/scripts/recap-upload.{mjs,helpers.mjs}` — a
BIN-185 follow-up letting shows with NO per-episode Wikipedia breakdown (so no boundary docs can
exist at all) still surface season-level "prior season" recap nodes, via a new `seasonOnlySeasons`
index field intersected with the ALREADY-real, ALREADY-tested `contiguousWatchedBoundary` +
`priorSeasonNumbers`.

**All three pre-implementation panel conditions verified TRUE by direct trace (not by re-reading
the dispatching summary):**
1. Single shared derivation, one call site (`RecapPanel.tsx`'s `priorSeasons` line), defaults to
   `[]`/hidden on any missing/invalid field (`parseSeasonOnlySeasons` returns `[]` on
   non-array/junk, `boundary == null` → `[]`).
2. **Current-in-progress-season leak is structurally impossible, confirmed even against a
   maliciously/buggily wrong index:** `priorSeasonNumbers(boundary)` returns only `s <
   boundary.season` regardless of what `seasonOnlySeasons` contains — the new
   `RecapPanel.test.tsx` case *"never offers the user's CURRENT season, even if it is (wrongly)
   listed as season-only"* (`seasonOnlySeasons:[1,2,3,4]`, boundary season 4) is a real,
   discriminating assertion, not a title/body mismatch (per the 2026-07-20 vetoRemaining entry's
   "verify the title matches the body" check) — confirmed season 4 is excluded even when the
   index itself falsely claims it. Also confirmed `contiguousWatchedBoundary` (pre-existing, not
   part of this diff, but load-bearing for the whole safety argument) really does require the
   ENTIRE aired-order prefix watched with no gaps — read its own pre-existing test file to verify
   this claim rather than trusting the new code comment's citation of it.
3. **No other consumer assumes "season doc exists ⇒ boundary docs exist for it":** grepped the
   whole `src/` tree for `SeasonRecapDoc`/`seasonRecapDocId` — the only client read site is
   `useSeasonRecaps` (`useRecap.ts`), whose one consumer is `RecapPanel.tsx`, and `RecapPanel`
   never even reads the new `episodeCoverage` field on a loaded season doc (it only gates on
   `sources.length>0` + `validateRecapText`) — so the field is write-side-only (upload script's
   one-way `'none'→'full'` upgrade ratchet, refused without `--force`, own reason string), never a
   client-side safety gate. This also means a WORKING-AS-DESIGNED nuance: after a genuine
   `--force` upgrade from `'none'`→`'full'`, the upload script never PRUNES that season number
   back out of the index's `seasonOnlySeasons` array — traced this is harmless, not a spoiler
   gap, because ANY season strictly before a real `coveredBoundary` is already provably
   fully-watched by the boundary's own contiguity guarantee, independent of which coverage tier
   its season doc carries; the stale array entry is at worst a wasted probe read in the ordinary
   (non-fallback) branch, never consulted there anyway since that branch doesn't filter by
   `seasonOnlySeasons` at all.

**The actual finding (High, functional not a security-boundary breach — but blocking): the
season-only entry point can never appear in production.** `RecapPanel`'s render-nothing gate is
`if (!hasBoundaryRecap && loadedSeasons.length === 0) return null;`. For a pure season-only show,
`hasBoundaryRecap` is ALWAYS false (structurally — no boundary doc ever exists to satisfy it), so
visibility depends entirely on `loadedSeasons`, which comes from `useSeasonRecaps(tmdbId,
priorSeasons, open)` — and that hook's queries are `enabled: ... && open`, i.e. deliberately
NEVER fetched until the collapsible panel is already open (the DBA "no default-view reads" rule,
correctly preserved). Result: before `open` is true, `loadedSeasons` is unconditionally `[]`, so
the component returns `null` and never renders the toggle button the user would need to click to
SET `open` to true — a permanent chicken-and-egg deadlock. The always-fetched signal that SHOULD
gate visibility (`priorSeasons.length`, derived from the cheap, always-on index read) is
computed but never consulted for the render decision.

**Caught only by refusing to trust the new `RecapPanel.test.tsx` describe block's own mock:** its
`vi.mock('@/hooks/useRecap')` stub for `useSeasonRecaps` has the signature
`(_tmdbId, seasons) => seasons.map(...)` — it silently DROPS the third `enabled`/`open` argument
the real hook takes, so the mock always returns loaded data regardless of whether the real `open`
state would have gated the fetch. All 5 new "season-only-sourced shows" tests call the file's own
`open(boundary)` helper (which renders THEN immediately `fireEvent.click`s the toggle button by
text) — meaning every test **assumes the button is already there to click**, so the suite can
never have caught this: it never exercises the pre-open, button-must-render-based-on-index-alone
window that is exactly where the bug lives. Wrote a throwaway PoC test
(`src/components/title/_poc-season-only-panel.test.tsx`, deleted immediately after, never
committed) using the REAL `useRecap`/`useSeasonRecaps` hooks against a real `QueryClientProvider`
+ a hand-rolled `fsdb`/`getDoc` mock seeded with `{ boundaries: [], seasonOnlySeasons: [1,2,3] }`
and a valid `1_season_1` doc — confirmed live: `screen.queryByText('Påminn mig var jag slutade')`
stays `null` even after `waitFor` (3s), i.e. the DOM never contains anything but an empty `<div/>`.
This is the exact "mock silently drops the real gating parameter, hiding a real regression" class
this file has flagged before (2026-07-18 BIN-544 entry: "verify the SPECIFIC mechanism, don't
trust that a mock/comment models it"), generalized to test *fixtures* rather than production
comments: **when a test file's own mock re-declares a function with FEWER parameters than the
real implementation, treat that as a signal the mock cannot exercise whatever behavior the
dropped parameter gates — re-verify that specific gated behavior against the real
implementation before trusting the suite's green result for it.**

**Calibration note — this does NOT violate the spoiler-safety invariant itself.** The failure
mode is fail-CLOSED (nothing ever renders for a season-only show, i.e. strictly MORE
conservative than intended, never a spoiler leak) — so it is a functional/product defect (the
whole follow-up ships as dead code) rather than a security-boundary breach. Recorded here anyway
per this project's correctness-critical-judgment standard and the "trace the real code paths,
don't take the summary's word for it" instruction — a review that only re-confirmed the three
named conditions and didn't independently exercise the render path would have missed that the
feature never activates at all.

**Fix direction (not applied by this review — flagging for the implementing session):** gate
`RecapPanel`'s early return on `priorSeasons.length` (the always-fetched, index-derived signal)
instead of / in addition to `loadedSeasons.length`, e.g.
`if (!hasBoundaryRecap && priorSeasons.length === 0) return null;` — this still respects "no
default-view fetch of season DOCS" (that stays gated on `open` inside `useSeasonRecaps`), it only
changes what decides whether the collapsed TOGGLE renders. Note a secondary, minor UX edge this
introduces: if `priorSeasons` is non-empty but every one of those season docs fails
`validateRecapText`/has no sources once fetched, the opened panel would show an empty list with
no "här" node to fall back on (season-only shows have none) — not a spoiler issue, just a
should-fix-alongside note.

No `firestore.rules` change in this diff (confirmed: `match /recaps/{recapId}` is an existing
wildcard, `allow read: if true; allow write: if false;`, unconditionally covers the new
`seasonOnlySeasons`/`episodeCoverage` fields — no rules deploy needed for this diff). No new
user-owned subcollection (`recaps/**` is global/title-keyed, not `users/{uid}/...` — no
`userData.ts`/GDPR impact, confirmed by grep). No secrets, no injection surface change (prose
still rendered as plain-text React children, `safeHref` unchanged). One additional Low,
non-blocking data-quality note: the pre-existing BIN-544 `logRecapMiss` effect in `useRecap.ts`
checks `covered.length === 0` (boundaries only) to decide "genuine miss," and was not updated for
this diff's new state — a pure season-only show will report a coverage gap indefinitely even once
season-only content exists, since that effect never looks at `seasonOnlySeasons`. Not a security
finding (write path is the already-reviewed sealed callable), just noise that would undermine the
gap-collection's own "prioritize by real demand" purpose once/if the render bug above is fixed.

Verdict: **CHANGES REQUESTED (High, blocking on functionality — not a Critical/security-boundary
finding).** Ship the render-gate fix (and ideally the `logRecapMiss` update) before this reaches
users; nothing here needs a rules/functions deploy beyond the standard scripted upload tool usage
(admin-SDK offline script, not a Cloud Function).

### 2026-07-20 — BIN-540 isHost immutability: `.get(k, default)` defends a MISSING field but NOT a present-but-mistyped one — a plain equality against a junk-typed stored value permanently bricks the slot (same DoS class as vetoRemaining) — three-way junk-heal APPROVED, incremental re-gate

Incremental re-gate of ONE follow-up landing since a same-day full gate (2nd `/code-review xhigh`
found it, 0 refuted): the `sessions/{id}/participants` isHost immutability clause went from plain
`request.resource.data.isHost == resource.data.get('isHost', false)` to a THREE-WAY:
`resource == null ? true : resource.data.get('isHost', false) is bool ? <equality> : request.resource.data.isHost == false`.

**The bug the delta closes (worth generalizing): `.get('isHost', false)` only substitutes the
default for an ABSENT key — a PRESENT-but-wrong-typed value (`'yes'`) is returned as-is.** So the
old plain-equality, against a pre-BIN-540-planted junk `isHost:'yes'`, evaluated `false == 'yes'`
(mismatched-type compare → false / whole allow-expr fails) on EVERY future write, permanently
bricking the victim's slot for the session's 7-day life and silently defeating the client-side
junk-heal in `sessions.joinPayload.ts`. This is the EXACT twin of the vetoRemaining plantable-brick
class the prior pass filed — one field got the junk-tolerant guard, its sibling didn't (the same
"one field ratcheted, adjacent field with identical narrative not" asymmetry the 2026-07-20
vetoRemaining entry says to check for). **General check: a `.get(k, default)`-based
immutability/ratchet guard defends only the MISSING-key case; if a mistyped value could ALREADY be
stored (i.e. the field predates any type validation, or another writer can plant junk), a bare
equality against `.get(...)` is itself a plantable permanent-denial — the guard must branch on
`resource.data.get(k, default) is <type>` and define a safe heal target for the junk case.**

**Verified the heal is one-way and non-gameable, by source trace (four points):** (1) junk branch
forces new `== false` AND the pre-existing `request.resource.data.isHost is bool` gate forces a real
bool, so `isHost:true` is structurally unreachable on the junk path — `false` is the only reachable
healed value (pinned by the new `'may only heal to false, never true (no self-promotion)'` assertFails
test); (2) the bool-stored branch (and absent→default-false) is byte-identical to the old equality —
host(true) can't be demoted, non-host/absent(false) can't self-promote; (3) client/rule consistency:
`planJoinFields` heals `isHost:false` ONLY when `typeof existing.isHost !== 'boolean'`, else omits the
field, so a valid-slot rejoin's merged `request.resource.data.isHost` inherits the stored bool and
passes `is bool` + equality; (4) the three-way NEWLY allows nothing beyond heal-to-false — create
(`resource==null → true`) unchanged, and post-deploy the `is bool` gate blocks any fresh junk write,
so junk is only a legacy artifact and healing CONVERGES to a permanently-valid bool (can't re-plant).

**Also confirmed isHost is NOT an authz input** — participant `delete` gates on
`get(sessions/{id}).data.hostUid == request.auth.uid`, not on `participant.isHost` — so the
pre-existing create-time `isHost:true` self-set (resource==null branch, unchanged) is inert cosmetic
(a star on one's own anon slot), not a privilege path. **General check for any "immutable cosmetic
flag" finding: confirm the flag is genuinely cosmetic by grepping whether ANY rule/function reads it
for an access decision before rating the immutability gap's severity — an immutable-but-unread flag's
worst case is a wrong star, not a privilege escalation.**

Accepted the dispatch's isolated-port-8091 214/214 run + the mutation proof (reverting the junk
branch to `== resource.data.isHost` fails ONLY the heal-to-false test) as sound; no live PoC re-run
for a one-branch, well-bounded delta with a discriminating mutation-proven test already supplied —
proportionate to the incremental scope, not a lowering of the standing live-PoC method for novel
holes. Verdict: **APPROVED.** No Critical/High/Medium in the delta. Standing manual-deploy order
unchanged: push hosting → `firebase deploy --only firestore:rules` (AFTER hosting; this rules deploy
now also carries the isHost junk-heal) → targeted functions.

### 2026-07-20 — BIN-540 vetoRemaining value-validation is a RANGE bound, not a RATCHET: live-confirmed 0→1 re-grant bypasses the intended one-veto-per-session budget — CHANGES REQUESTED (High), new reusable check class

Reviewed the working-tree `firestore.rules` diff (BIN-540: value-validate `vetoRemaining`/
`isHost` on `sessions/{id}/participants/{pid}`, closing the follow-up ADR 0015 flagged as
"the one-veto cap is UI-only") + its new tests in `src/test/rules/firestore-rules.test.ts`,
alongside a same-diff `GroupPageClient.tsx` (BIN-557 join-retry cap) and `groups.test.ts`
(BIN-556 no-batch tests) — those two traced clean, no finding.

**The vetoRemaining fix only bounds the WRITTEN value to `0 <= v <= 1` (`is int`,
`>= 0`, `<= 1`) — it has no clause comparing against `resource.data.vetoRemaining`, unlike
the adjacent `isHost` check in the SAME diff which correctly adds `(resource == null ||
request.resource.data.isHost == resource.data.isHost)`.** Result: any participant (anon or
signed-in, writing their own doc — no cross-uid forgery needed) can `updateDoc` their own
already-spent (`vetoRemaining: 0`) slot back to `vetoRemaining: 1` and cast another veto,
repeat indefinitely. `recordSwipe` (`sessions.ts`) never does this (only ever writes 1 on
join, 0 on veto-spend) — but the client's convention is not the enforcement boundary; rules
are, and this one has a hole.

**Verified LIVE, not just by rule-trace, per this file's own standing method (2026-07-16
entry: "don't stop at rules-trace, write a live PoC").** Temporarily inserted one throwaway
`it(...)` into the ALREADY-STAGED `firestore-rules.test.ts` (not a separate `_poc-*.ts` file
this time — same effect, same convention) asserting `setDoc(vetoRemaining:0)` then
`updateDoc(vetoRemaining:1)` against the CURRENT rule; ran via
`FIRESTORE_EMULATOR_HOST=localhost:8080 npx vitest run --config vitest.rules.config.ts`
(the standard `npm run test:rules` wrapper failed with "port 8080 taken" — a stray emulator
was already listening from an earlier session-parallel review; bypassing `firebase
emulators:exec` and pointing vitest straight at the already-running emulator via the env var
is a valid, faster workaround when this happens). Both writes `assertSucceeds`ed — confirms
the bypass is real, not theoretical. Reverted the PoC via `Edit` immediately after (matched
`git diff --cached` against the pre-PoC state to confirm byte-identical), then re-ran the
full suite clean (208/208) to confirm no residual mutation — never left in the diff.

**The genuinely new, reusable check this surfaces: when a diff adds VALUE validation
(`is int && >= N && <= M`) to a field that represents a spendable BUDGET/counter (as opposed
to a free-standing attribute), a bounded RANGE is not the same guarantee as a monotonic
RATCHET, and a reviewer must check for the latter explicitly — range-checking alone only
stops "set it to something absurd," not "reset it to the top of the range after spending it
down."** The tell that should trigger this check: the fix's own commit comment/PR description
frames the goal as "budget"/"cap"/"once per X" language (here: "vetoRemaining: 1 vid join, 0
efter använt veto — inget annat" / ADR 0015's "the one-veto cap is UI-only") — that framing
promises monotonicity even though the code only implements ranging. Compare against the
sibling field in the SAME diff (`isHost`) that DID get the resource.data-comparison clause —
when one field in a diff gets a ratchet/immutability check and an adjacent field with an
identical "budget/once" narrative doesn't, that asymmetry itself is worth flagging even before
running the PoC.

**Second, related finding: the new deny-path test's TITLE claims coverage its BODY doesn't
provide.** `firestore-rules.test.ts:870`, `'rejects re-granting a spent veto (0 → 1) on
update'`, actually asserts `assertFails(updateDoc(..., { vetoRemaining: 5 }))` — 5 fails
purely because it's outside the `<=1` range, a completely different (and already-covered-by-
the-adjacent-test) property. A reviewer skimming test titles for coverage (a common review
shortcut) would be told this exploit is closed when it is not. **General check: for a
rules-test suite, when a test's `it(...)` title names a specific value transition (e.g. "0 →
1"), verify the ASSERTED VALUES in the body actually match that transition — a title can
accurately describe the INTENDED scenario while the body tests a different, already-covered
one, especially when the two look similar (both "large-ish invalid number" vs "the exact
boundary-adjacent legal-looking number that would prove the real property").**

Verdict: **CHANGES REQUESTED (High, blocking).** Fix: add a decrease-only clause mirroring
`isHost`'s pattern (`&& (resource == null || request.resource.data.vetoRemaining <=
resource.data.vetoRemaining)`) to the `participants` create/update rule, then replace/augment
the misleading test with one that actually asserts `0 → 1` fails. `GroupPageClient.tsx`
(BIN-557) and `groups.test.ts` (BIN-556) in the same diff are clean — no security-boundary
issue; confirmed `DynamicRouter.tsx` mounts `GroupPageClient` with `key={match.id}`, so the
new `joinAttemptsRef` (a plain `useRef`, not reset on prop change) cannot leak a spent retry
budget from one group to a different one on client-side navigation, since a `key` change
forces a full remount. No `firestore.rules` deploy should ship the current vetoRemaining state
as-is — this is the exact kind of gap `deploy.yml`'s hosting-only scope means a human has to
catch before the manual `firebase deploy --only firestore:rules` step, not after.

### 2026-07-20 — BIN-561 `useOptimisticMirrorField` extraction (AuthContext.tsx + new src/hooks/useOptimisticMirrorField.ts): behavior-equivalent, APPROVED; one Low architectural nuance worth tracking for future ref-indirection hooks

Scoped review of the staged working tree: a pure refactor extracting the three
duplicated optimistic-mirror-plus-rollback setters (`setProviderCost`,
`setProviderCampaign`, `setProviderRenewalDay` — the BIN-40/46 stale-render-snapshot
fix plus the BIN-516/531 write-failure rollback fix) into one shared hook. No
`firestore.rules` touch, no new user-owned subcollection, no secrets, no new public
surface — this diff's entire trust-boundary-relevant question is "does the extraction
preserve behavior," not "does it change a boundary."

**Verified behavior-equivalence by hand, not by trusting the refactor's own claim:**
traced all three call sites against their pre-refactor inline versions field-by-field
(mirror-ref sync trigger, `== null` delete-vs-set branch, synchronous pre-`await`
mirror write, identity-checked (`===`) rollback-on-catch, and — for campaigns — that
`canonicalProviderId()` still runs OUTSIDE the hook at the AuthContext call site,
matching the pre-refactor code and the new JSDoc's explicit claim). Ran
`npx vitest run src/contexts/AuthContext.test.tsx`: 10/10 pass, including the
pre-existing BIN-516/BIN-531 rollback tests (`describe('...rollback vid write-fel')`)
— these were NOT rewritten by this diff (`git diff` on the test file is empty) but
now exercise the new shared hook end-to-end, which is the strongest evidence of
equivalence available (real assertions, not just re-reading the diff). `tsc --noEmit`
and `eslint` both clean on both files.

**One Low, new-architecture nuance (not filed as blocking): the extraction adds a
`commitRef` (ref-updated-via-`useEffect`) indirection for the commit function that
did NOT exist in the pre-refactor code.** Pre-refactor, each setter was a plain
`useCallback(fn, [updateUserField])` — a NEW function every time `updateUserField`
(and thus `uid`) changed, so any caller of the LATEST render's setter always closed
over the current uid with zero indirection. Post-refactor, the returned setter's
identity is permanently stable (`useCallback(..., [])`) and instead reads
`commitRef.current`, updated by a separate `useEffect` — meaning there's a
theoretical window (after a render changes `uid`/`updateUserField` but before that
render's passive effects flush) where an in-flight call could read a stale
`commitRef.current` closing over the PREVIOUS uid. Traced the actual blast radius:
Firestore rules gate `users/{uid}` writes on `isOwner(uid)` derived from
`request.auth.uid` at write time, not from whatever uid the JS closure captured — so
a write through a stale closure targeting the OLD uid while `auth.currentUser` is
already the new identity (or null, post-signOut) fails at the rules layer, and the
hook's own catch→rollback path handles that failure gracefully (mirror reverts, no
silent corruption, no cross-account write survives). Also: this "stable wrapper via
ref+effect" idiom is already an established convention in this codebase (8 other
files use the same `xRef = useRef(x); useEffect(() => { xRef.current = x }, [x])`
shape — `WatchlistContext.tsx`, `useEpisodeProgressWithSync.ts`, etc.) — not a novel
risky pattern this diff invented. **General check for future review of any hook that
converts a `useCallback(fn, [deps])`-recreated setter into a permanently-stable
wrapper reading a ref-that-syncs-via-effect: identify what the ref closes over (here,
a Firestore write target/uid) and confirm the write-target boundary is ALSO enforced
one layer down (rules, not just JS timing) — if it is, the indirection's worst case
degrades to "harmless failed write + correct rollback" rather than "wrong-account
write succeeds."** Realistically unreachable here anyway: the Settings UI that
exposes these setters is gated on `user` being non-null, so surviving a live uid
swap in the SAME mounted component instance (rather than a full unmount/remount on
sign-out) isn't a real path in this app's UI structure.

Verdict: **APPROVED.** No Critical/High/Medium finding. No manual-deploy note needed
(no `firestore.rules`/`functions/**` in this diff's scope). Process note (not a
security finding, flagging for completeness): CLAUDE.md's "large change" trigger
list includes both "a new core module/service/hook/lib" and the auth domain
(`src/contexts/AuthContext.tsx`) explicitly — this diff is both — so plan+panel
casting (`docs/org/route.mjs`) should have preceded it per the working agreement;
this review has no visibility into whether that already happened upstream in the
session that produced the diff, so noting rather than blocking on it.

### 2026-07-20 — BIN-560 mediaTypeDocId consolidation (streamingOffers/weeklyDigest/communityRatings/availableNotify): closes the sibling-collection gap flagged 2026-07-16 — APPROVED

Reviewed the working-tree diff extracting `functions/src/shared/mediaTypeDocId.ts` (canonical
`${movie|tv}_${tmdbId}` doc-id + `normalizeMediaType`) and propagating it to `streamingOffers`
(governor `readWorkSet`/`readExisting`/write, `dedupeIntent`, `selectRefreshBatch` — BIN-523/545),
`weeklyDigest` (`readOffers` two-pass namespaced-then-legacy-fallback read, `digestOfferKey`),
`communityRatings` (`titleRatingsAggregate` doc id), and re-pointing `availableNotify`'s own
`normalizeMediaType`/`availableStateDocId` to the shared helper. This is the SAME bug class as the
2026-07-16 forward-revert entry above (`streamingOffers`/`priceHistory` bare-tmdbId collision left
unfixed when `availableNotifyState` was namespaced) — this diff is the propagation finally landing.

**Verified, not just trusted the comments:**
- No doc-id collision possible: `tmdbId` is always a JS `number` (never underscore-containing), and
  the two mediaType prefixes are fixed disjoint strings — `movie_${a}` can never equal `tv_${b}` or
  `movie_${b}` for `a≠b`.
- `firestore.rules` needs NO change for this diff: `match /streamingOffers/{tmdbId}`,
  `/priceHistory/{tmdbId}`, `/titleRatingsAggregate/{titleId}` all use a wildcard path segment
  (`allow read: if true; allow write: if false;`), so they transparently cover both the new
  namespaced ids and legacy bare ids with zero rule change — confirmed by reading the rule blocks
  directly, not assumed from "wildcard should work."
- `communityRatingMaintain`'s unknown-mediaType early-return (`if (mediaType !== 'movie' &&
  mediaType !== 'tv') { logger.warn(...); return; }`) runs BEFORE calling the shared
  `mediaTypeDocId`, so the helper's unknown→'tv' normalization default can structurally never fire
  at that call site — the in-code comment claiming this is accurate, verified by reading control
  flow, not trusted.
- `weeklyDigest`'s `readOffers` two-pass fallback (`wantBare: Map<bareId, DigestTitle[]>`) correctly
  handles the case where a movie AND a TV title with the same tmdbId both want the same legacy bare
  doc: it iterates ALL titles waiting on that bare id and only claims the doc for the one whose
  `mediaType` field matches, never both — traced the loop, not just the shape of the map.
- `priceHistory`'s identical bare-tmdbId collision is explicitly left UNFIXED with an honest
  in-code note ("PRE-EXISTING collision, deliberately left alone... Filed as BIN-562") rather than a
  false "fully closed" claim — this is exactly the honest-partial-fix documentation practice the
  2026-07-16 entry's point 7 calls for (a false completeness comment is worse than none).
- Ran the relevant root-vitest suite from repo root (functions has no test runner of its own, per
  the `reference_functions_test_import` lesson/`tmdbTosSweep`'s own new comment on the same
  convention): `functions/src/{streamingOffers,weeklyDigest,availableNotify}/logic.test.ts` — 60/60
  pass, including new discriminating-oracle cases for both the doc-id collision AND the
  freshest-of-legacy-vs-namespaced dedup in `selectRefreshBatch`. `functions/` `tsc --noEmit` clean.

No `firestore.rules` change needed for the reviewed files (rules WERE touched in the same staged
commit, but for an unrelated Tillsammans BIN-540/542 fix — out of this review's file scope, flagged
separately for its own pass + manual-deploy note). No new user-owned subcollection, no GDPR/
`userData.ts` impact (all touched collections are global/title-keyed, not `users/{uid}/...`), no
secrets. Verdict: **APPROVED.** No Critical/High/Medium finding.

### 2026-07-19 — availableNotify `readLastFlatrate` legacy-fallback fix (post-xhigh-catch): safe, self-heals, one Low nuance on the "one run" claim — APPROVED WITH NOTES

Re-reviewed `functions/src/availableNotify/{index.ts,logic.ts}` working-tree diff, a same-night
follow-up fix to a same-night APPROVED cluster (BIN-523 availability half + BIN-529), after an
xhigh `/code-review` pass found the original BIN-523 namespacing meant EVERY title's first
post-deploy run read `last === null` (not just colliding movie/TV-same-id titles), silently
swallowing any real first-run "now streaming" transition library-wide. Fix:
`readLastFlatrate(stateId, legacyTmdbId)` falls back to the OLD bare-tmdbId doc's `lastFlatrate`
ONLY when the new namespaced doc doesn't exist yet.

**Fallback-read safety confirmed by direct trace, not assumption:** `availableNotifyState` has
no `firestore.rules` entry at all (grepped — zero matches), so it is Admin-SDK-only, default-
denied to any client read/write; the field read (`lastFlatrate`, an array of TMDB provider ids)
carries no PII and is not user-owned (no `uid` in the doc), so no GDPR (`userData.ts`) scope and
no cross-user leak vector — this matches the same collection's classification in the 2026-07-16
forward-revert entry above. Grepped the whole `functions/src` tree for `availableNotifyState`:
exactly ONE write site remains (`db.collection('availableNotifyState').doc(stateId)...`, always
the namespaced id) — confirms the diff's "writeMarker always writes forward to the namespaced
doc" claim by exhaustive grep, not by re-reading the one hunk that changed it.

**Self-heal timing confirmed correct, with one real nuance the doc comment doesn't state:**
Phase-2 grouping loop (`for (const [stateId, items] of byTitle) { try { await processTitle(...) }
catch ... }`) is SEQUENTIAL `await`, not `Promise.all`/`allSettled` — confirmed by reading the
loop body directly — so within a single run, a colliding `movie_N`/`tv_N` pair's two
`processTitle` calls cannot race each other; the second one to run reads the SAME still-untouched
legacy doc the first one read (first `processTitle` only ever writes to its OWN namespaced stateId,
never touches the legacy doc), exactly matching the documented "both title's first run share the
stale/possibly-mixed baseline, once" tradeoff — not a wilder race than what's described.

**The one Low finding:** the doc comment claims self-heal happens "for one run only," but that's
actually "one SUCCESSFUL run" — `processTitle` returns early without calling `writeMarker` when
`fetchSeFlatrate` returns `null` (TMDB fetch failure), so a title hitting transient TMDB
flakiness on its first post-deploy run keeps falling back to the legacy doc on every subsequent
run until a fetch finally succeeds, not strictly "one run." Not a security defect (still the same
accepted-risk shape — extra push or swallowed push, never a leak — just potentially spanning more
than one calendar run under retry), but worth a one-word comment tweak ("one run" → "one
successful run") since this file's own convention (per CLAUDE.md testing-honesty + this log's
prior "false safety comment" entries) is that self-correction claims should be exactly accurate.

**General check reused, not new:** when a fix's safety argument depends on "the compensating/
fallback write happens exactly once," verify the EARLY-RETURN paths of the function that performs
the compensating write (here: the fetch-failure `return 0` before `writeMarker`) — an early return
that skips the write silently extends the "once" window into "until it eventually succeeds,"
which is the same class of gap the groups.ts rollback-TOCTOU entry (2026-07-19, above) generalizes
for compensating writes.

Ran `npx vitest run functions/src/availableNotify/logic.test.ts` — 17/17 pass, including new
`availableStateDocId`/`normalizeMediaType`/`inboxNotifId` cases. `readLastFlatrate` itself (lives
in `index.ts`, Admin-SDK-dependent via `getFirestore()`) has no dedicated unit test — consistent
with the pre-existing "admin-free helpers only in `logic.ts` are root-vitest-testable" convention
(`reference_functions_test_import` lesson), not a new gap this diff introduced.

Verdict: **APPROVED WITH NOTES.** No Critical/High finding. One Low (doc-comment slightly
overstates the self-heal bound under fetch-failure retries — cosmetic, not a defect). No
`firestore.rules` change in this diff, no new user-owned subcollection, no secrets. Standard
reminder: `deploy.yml` deploys hosting only — this is a Cloud Functions-only change needing a
manual `firebase deploy --only functions:availableNotify` before the fallback fix takes effect
(the previously-deployed pre-fix version, if already live, is currently swallowing first-run
transitions per the bug this diff closes).

### 2026-07-19 — AuthContext.tsx re-review #3 (BIN-531/535/536): content confirmed unchanged; self-correction of a factual error in the 2026-07-18 log entry; new marker-scoping process note

Re-dispatched to re-confirm a marker-staleness flag. Independently re-diffed
`src/contexts/AuthContext.tsx` + `AuthContext.test.tsx` against HEAD (`6bc0a0a`) rather than
trusting the dispatching prompt's claim that content was unchanged — it was: the runTransaction
create-race wrap (BIN-535), the `setProviderRenewalDay` rollback (BIN-531), and the
`updateProviders` bounded query via `MY_GROUPS_LIMIT` (BIN-536) all match the two 2026-07-18
APPROVED entries below (lines ~92, ~169) hunk-for-hunk. Third independent confirmation of the
same diff, now across three separate review passes on three different days/framings — no drift.

**Self-correction (the actual finding worth recording): my own 2026-07-18 "sibling-gap closure"
entry mis-described BIN-536.** It says "caps `updateProviders`'s array-contains group query with
`limit(500)`, matching `FOLLOWING_LIMIT` in `useFollow.ts`" and later "the 500-cap silently
truncates propagation past the 500th group." Both are wrong: the actual code imports and applies
groups.ts's own `MY_GROUPS_LIMIT` constant (`= 100`, `src/lib/firebase/groups.ts:27`), not a
locally-invented 500, and `FOLLOWING_LIMIT` (`src/hooks/useFollow.ts:11`, also `= 500`) is an
unrelated constant in a different file the code never references. Confirmed by reading both
constants directly, not by re-trusting either past summary. **Not a code defect** — sharing the
exact constant groups.ts already uses for its four equivalent queries is the BETTER design (can't
drift apart, matches the "sibling-pattern" convention this file's own 2026-07-16 entry asks
reviewers to check for) — this is purely a wrong number/wrong-constant-name in my own prose
summary, not evidence the code ever behaved as I described it. **General check: when re-affirming
a prior APPROVED verdict, re-derive concrete numeric/named claims (constant values, limits, magic
numbers) from the CURRENT source directly instead of citing the earlier knowledge entry's prose —
a summary can misstate a detail even when the underlying review and verdict were sound; the verdict
survives, the detail doesn't automatically.**

**New process note (confirms/extends the existing lessons-digest marker-scoping lesson): the
single shared `.claude/state/security-done.marker` file only ever holds the LAST review's content
— a later review of a completely unrelated file (here, a same-morning `groups.ts` re-review,
timestamped `2026-07-19T10:18:32Z`) silently overwrites it, advancing the marker's mtime with zero
relationship to the previously-reviewed file's own mtime.** Diagnosed by comparing the marker's
mtime (2026-07-19 12:19) against both target files' mtimes (2026-07-18 22:54/23:57, unchanged) —
the files were NOT touched by any background process; the marker was simply repurposed for a
different surface. A "marker looks stale" report should always be root-caused by reading the
marker's CONTENT scope against the target file, never assumed to mean the target file itself
changed — don't accept a plausible-sounding "background process touched the mtime" explanation
without checking it, per this same session's own instruction to verify independently.

Verdict: **APPROVED** (re-affirmed, third confirmation). No Critical/High finding. No
`firestore.rules` change in this diff, no new user-owned subcollection (GDPR `userData.ts`
unaffected), no secrets. Two additional non-blocking notes surfaced by a parallel `/code-review`
pass since the last approval — both already recorded here (runTransaction's offline-signup
trade-off, entry at line ~151; the truncation-past-Nth-group note, corrected above) — carried no
code change and required no new analysis.

### 2026-07-19 — groups.ts re-review: rollback-on-partial-write-failure fix is sound in the common case, but has a real (narrow) TOCTOU that can strand a DIFFERENT, later-completed valid membership of the SAME uid — APPROVED WITH NOTES (one Low)

Re-reviewed `joinGroupViaToken`/`acceptGroupInvite` (`src/lib/firebase/groups.ts:184-267,304-348`)
after a dedicated high-effort `/code-review` added a compensating `updateDoc(ref, {memberUids:
arrayRemove(uid)})` when the member-doc `setDoc` fails after the `memberUids` `arrayUnion`
already committed (closing the pre-existing permanent-ghost-member class this same file's
2026-07-16 entry above flagged as a Low). Confirmed: (1) `arrayRemove(params.uid)` can never
touch ANOTHER user's uid — it's a scalar-value removal scoped to the exact string this call's
own `params.uid` is bound to, so cross-account membership forgery/removal is structurally
impossible; (2) a naive concurrent-double-call race (double-click, two tabs on the same invite
link — confirmed both are real via `GroupPageClient.tsx`'s join-effect, gated only by a local
`joining` state that doesn't protect against a second tab) is closed by the RULES themselves,
not by application code: `firestore.rules:973-991`'s join/accept branches require
`!(request.auth.uid in resource.data.memberUids)`, so once one concurrent call's `arrayUnion`
commits, the LOSING call's own `updateDoc` is rules-denied outright and returns/throws before
ever reaching the `setDoc`/rollback code — it never fires a spurious rollback. Ran
`npx vitest run src/lib/firebase/groups.test.ts` — 11/11 green, and the two new rollback tests
correctly assert the SECOND `updateDoc` call against the same group ref carries the
`arrayRemove` payload (would fail if the rollback call were removed, per the mutation-testing
note in the dispatching prompt — didn't re-run the mutation myself but the assertion shape is
airtight against a removed call: `toHaveLength(2)`).

**The one real gap (Low, not blocking): the rollback has no re-verification, so a slow/stalled
call's late-firing rollback can undo a DIFFERENT, independently-completed valid establishment
of the SAME membership.** Traced a genuine (if narrow) interleaving: Call A's `updateDoc`
(arrayUnion) commits, but A stalls before its `setDoc`. Meanwhile the SAME uid leaves the group
via `removeMember` (rules-legal self-leave, shrinks `memberUids`) and rejoins via a fresh call D
— D's `updateDoc` + `setDoc` both succeed fully (valid membership, member doc exists). THEN A's
stalled `setDoc` finally fails and A's catch fires `arrayRemove(uid)` — this write IS
rules-legal (the "leave" branch can't distinguish "which join event" added the uid, only that
it's currently present), so it silently strips the uid A never actually finished adding for
itself, from a NOW-VALID membership D just established. Net effect: `members/{uid}` doc exists
but `uid` is missing from `memberUids` — and `firestore.rules:1042-1056`'s `members/{memberUid}`
create/update/delete/read rule gates on `request.auth.uid in get(groups/{groupId}).data.
memberUids`, so this self-locks the SAME user out of their own (materially valid) group content
until they notice and leave+rejoin again (`removeMember`'s `batch.delete` on a doc that may not
exist is a no-op, so self-heal via "leave" always works). **Not a cross-user leak or forgery —
impact is confined to the acting user's own availability, and requires two independent
join-attempts for the same uid racing across a stalled original call, a plausible but narrow
window (multi-tab/multi-device invite-link opens, or an offline-persistence-queued retry that
resolves long after the user already re-joined through another path).** Filed as Low per this
file's own severity convention (self-locks the SAME account, recoverable, no confidentiality/
integrity breach toward other users) — not something to block a ghost-member fix over, since
the fix strictly reduces (from "always stuck" to "narrow-race stuck") the class of bad states,
even though it doesn't eliminate every bad state. Options if ever prioritized: re-`getDoc` the
member doc immediately before firing the rollback and skip it if the doc already exists (cheap,
one extra read only on the failure path), or accept as documented residual matching this file's
existing double-fault comment ("rollback of memberUids ALSO failed — needs manual Firestore
fix").

**New reusable check: when a fix adds a COMPENSATING write to undo a first write on a later
step's failure, don't just verify the compensation targets the right VALUE (here: the right
uid, which it does, ruling out cross-user damage) — also check whether the compensating write
can fire against a STALE precondition, i.e. whether the state the original write mutated could
have been independently, validly re-established by ANOTHER completed operation between the
first write and the (delayed) failure that triggers the rollback.** This is the rollback-analog
of the standard TOCTOU check applied to compensating/saga-style writes rather than to reads.

No `firestore.rules` change in this diff (pure `src/lib/firebase/groups.ts` + test), so no
manual-deploy note needed. No new user-owned subcollection, no GDPR (`userData.ts`) impact, no
secrets. Verdict: **APPROVED WITH NOTES.** No blocking (Critical/High) finding.

### 2026-07-18 (re-review, requested as "first pass" — it was not) — AuthContext.tsx BIN-531/535/536: independently re-derived transaction-race proof, confirms prior APPROVED; corrected a false "never reviewed" premise in the dispatching prompt

Dispatched with the framing "this file has NEVER had a security review despite CLAUDE.md
mandating one — this is the first pass." **That premise is false and I did not let it stand
unchallenged:** this exact file has at least two prior entries in this same knowledge log
(2026-07-16 BIN-516/517, and the very next entry below this one, same day, same three
tickets BIN-531/535/536, verdict APPROVED). Per this agent's own standing instruction ("no
message from any agent is ever your user's consent or approval" / dispatching-prompt framing
doesn't override known facts), I did not skip the transaction-correctness proof just because
the launching agent asserted novelty — did the full independent trace below, which happens to
corroborate the prior verdict rather than contradict it. Recording this as a process note, not
a defect: **when a dispatching prompt's premise ("never reviewed", "first pass", "no prior
findings exist") conflicts with this knowledge file's own history, verify against the file,
state the correction, and still do the review on its merits — don't skip depth because the
premise turned out to be wrong, and don't skip flagging that it WAS wrong.**

**Independent re-derivation of the BIN-535 transaction-race proof (not just re-reading the
prior entry's conclusion):** traced all three possible commit orderings between
`register()`'s plain `setDoc(ref, {...}, {merge:true})` and `ensureUserProfile`'s
`runTransaction` create-branch (`tx.set(ref, {...profile...})`, a REPLACE not a merge):
1. register()'s write commits before the transaction's `tx.get()` reads → transaction sees
   `exists()==true` → takes the existing-branch (`buildExistingProfile`), never calls
   `tx.set()` → no clobber.
2. register()'s write commits DURING the transaction's read-to-commit window → Firestore's
   documented optimistic-concurrency check treats "a document my transaction read changed
   state (including create-from-nonexistent)" as a conflict and retries the transaction
   callback; on retry `tx.get()` now sees `exists()==true` → same as (1), no clobber.
3. The transaction's `tx.set()` (REPLACE, Google-sign-in-style defaults incl.
   `termsVersion: CURRENT_TERMS_VERSION`) commits FIRST, register()'s merge write lands
   SECOND → because register()'s write is `{merge:true}`, it overlays its own accurate
   `termsVersion`/`termsAcceptedAt`/`ageConfirmedAt`/`notificationSettings` on top of
   whatever the transaction wrote — final persisted state still ends up with register()'s
   values, not the transaction's defaults.
**Conclusion: in all three orderings the final persisted doc reflects register()'s
legally-significant explicit-consent values — the fix is sound not just in the common case
but structurally, because it combines (a) transaction-detected conflict on the
not-yet-exists→exists transition with (b) register()'s own write always being a merge that
wins on overlay whenever it lands after.** This is a stronger proof than "traced both
interleavings correct" (the prior entry's phrasing) — worth keeping as the reusable proof
shape for any future review of a transaction-vs-merge-write race: enumerate all N! orderings
of the racing writes, not just the two the ticket's own comment calls out.

**Also independently confirmed (not just accepted the prior entry's claims):**
- `fsdb()` (`src/lib/firebase/db.ts`) spreads the REAL `firebase/firestore` module
  (`{...mod, db}`), so `runTransaction` used in production is the genuine SDK function with
  its documented retry semantics — not a hand-rolled reimplementation the diff could have
  gotten subtly wrong.
- `users/{uid}` rules (`firestore.rules:218-226`): `allow create/update` both gate on
  `isOwner(uid)` and forbid `isAdmin` tampering; `ensureUserProfile`'s create payload never
  includes `isAdmin` — the transaction's `tx.set()` is rules-compliant, no new bypass.
- Ran `npx vitest run src/contexts/AuthContext.test.tsx` — 10/10 pass (not just trusted the
  diff's own claim that tests prove the race is closed).
- Test 2's mocked `runTransaction` correctly validates the APPLICATION code's conditional
  (don't call `tx.set()` when `txSnap.exists()`) via a throwing `set()` stub — this is the
  right scope for a unit test; it cannot and does not claim to prove the SDK's own optimistic-
  concurrency retry mechanic (that's Firestore's documented behavior, not application code,
  and this codebase's existing pattern is emulator-backed tests for THAT class of claim, e.g.
  `src/test/rules/account-deletion.test.ts` — AuthContext.tsx has no emulator harness, so this
  gap is pre-existing infra, not something this diff should have had to add).
- New Low/Info (not blocking, not previously recorded): `runTransaction` requires an online
  round-trip and does NOT queue offline the way a plain `setDoc` against
  `persistentLocalCache` does — so a first-time profile creation whose network drops between
  auth completing and the transaction call now fails outright (uid retained, profile stays
  null) instead of silently queuing for later sync. Realistically hard to hit (auth itself
  requires connectivity) and degrades gracefully (no corruption, just a transient "profile
  didn't load" the existing `.catch` already handles) — recorded for completeness, not
  actioned.
- Tangential, confirmed SAFE not a finding: `claimUsername`'s (`src/lib/firebase/username.ts`)
  client-side `findAvailableUsername` availability check is TOCTOU-racy on its own, but
  `usernames/{username}` rules (`firestore.rules:470-476`) have `allow create` with NO
  `allow update` — Firestore classifies a write against an already-existing doc as `update`,
  which is default-denied, so a double-claim race is closed at the rules layer regardless of
  the client-side race. Verified by reading the rule, not assumed.

Verdict: **APPROVED** (independently re-derived, corroborates prior same-day entry). No
Critical/High finding. One Low/Info (transaction offline-availability nuance, informational).

### 2026-07-18 — AuthContext.tsx (BIN-535/536/531): sibling-gap closure confirmed + transaction-based create-race fix verified sound, APPROVED

Reviewed the working-tree diff (`src/contexts/AuthContext.tsx` + `AuthContext.test.tsx`, HEAD
5d7d46c). Three fixes, none touching `firestore.rules` in this diff:

1. **BIN-535** wraps `ensureUserProfile`'s create-branch in `runTransaction` to close the
   pre-existing race where `register()`'s own `setDoc(merge:true)` landing AFTER a plain
   `setDoc` create would get silently overwritten back to Google-sign-in defaults — the exact
   Low flagged in the 2026-07-16 AuthContext entry. Traced both interleavings correct;
   confirmed the side-effecting `tryAutoClaimUsername` call stays OUTSIDE the transaction
   closure (not re-run on Firestore's optimistic-concurrency retry) — the right structural
   choice for a non-idempotent-under-retry op.
2. **BIN-536** caps `updateProviders`'s array-contains group query with `limit(500)`,
   matching `FOLLOWING_LIMIT` in `useFollow.ts`. Correctly scoped — comment explicitly defers
   the four equivalent unbounded queries in `groups.ts` to BIN-510, no false completeness claim.
3. **BIN-531** fixes `setProviderRenewalDay` with the identical rollback-on-write-failure
   pattern BIN-516 applied to its siblings — this is the EXACT sibling gap the 2026-07-16
   entry named. Grepped for any other `Ref.current = next` mirror sites post-diff: only the
   three provider-field refs exist, all now wrapped — gap fully closed.

**General check: when a diff's ticket matches a gap NAMED in a prior review-knowledge entry,
re-grep the pattern this session to confirm FULL closure (not just the one named call site) —
easy to verify only the named function without checking whether a fourth sibling was added
since.**

No security-boundary change (no rules diff, no new user-owned subcollection, no secrets). One
Low/Info: `updateProviders`'s 500-cap silently truncates propagation past the 500th group
with no completeness caveat in the comment — correctness note, not a security finding.

Verdict: **APPROVED.** No blocking (Critical/High) finding.

### 2026-07-18 — BIN-543 leavingRollup pacing fix (schedule 24h→96h, MAX_PAGES 20→18): APPROVED, no security-boundary change; two reusable review techniques

Reviewed the working-tree diff (`functions/src/leavingRollup/{index.ts,motnChanges.ts}` +
new `motnChanges.test.ts`) reducing the "vad försvinner" rollup's cadence from daily to
every 96h and MAX_PAGES from 20 to 18, per ADR 0016 (rejected the originally-proposed
resumable multi-day pagination cursor — window drift on MOTN's moving 31-day `/changes`
window would make a resumed pass silently WRONG, not just stale). No `firestore.rules`
change, no new collection, no auth/ownership surface touched — this is a pure vendor-quota-
pacing change in an Admin-SDK-only scheduled function.

**Verified all three of the founder's specific questions, not just traced the diff:**
1. Arithmetic proof is correct: `motnBillingCycleId`'s 21st-of-month rolling anchor produces
   a worst-case 31-calendar-day cycle (traced the month-length math directly, confirmed max
   is 31 not >31), and for a strictly-periodic 96h schedule the max number of runs landing in
   any window of length L is `floor(L/T)+1` regardless of phase alignment — `floor(744/96)+1
   = 8`, matching both the comment and the new test's pinned assertion. `18×8=144≤150` holds.
2. `complete` guard and `reserveMotnSlot`/`applyThrottleObservation` genuinely untouched:
   confirmed via `git diff --stat` that `functions/src/util/notifyOnce.ts` has zero lines
   changed (not even present in the diff), and the `motnChanges.ts` diff hunk only touches
   the top-of-file comment block and the `MAX_PAGES` constant/export line — the pagination
   for-loop body (lines ~83-142, where `complete` is actually set) is byte-identical.
3. `'every 96 hours'` is valid Cloud Scheduler/App-Engine-groc syntax: found two already-live
   precedents in the SAME codebase using the identical `every N hours` shorthand with N far
   above 24 — `cineasterna` (`every 168 hours` = 7d) and `tmdbTosSweep` (`every 720 hours` =
   30d) — strong evidence the syntax is accepted and correctly interpreted, not novel/untested.

**New reusable check #1 (safety-proof robustness): when a diff's safety claim is backed by
BOTH an arithmetic comment/test AND an independent hard runtime mechanism, identify which one
is the actual enforcement and which is just a design-intent justification.** Here, the real
hard bound on vendor spend is `reserveMotnSlot`'s Firestore transaction (gates every page,
including the first, against `cap=150`, atomically) — that holds regardless of how many
invocations actually occur in a cycle (scheduler catch-up bursts, retries beyond the 20h
idempotency window, etc. could in theory push actual run-count above the theoretical 8, and
the safety property still holds because the transaction — not the schedule cadence — is what
prevents overspend). The `18×8≤150` arithmetic only answers a DIFFERENT question ("will this
cadence actually keep the rollup fresh across the cycle instead of exhausting early") — a
freshness/UX justification, not the security/cost bound itself. Frame findings accordingly:
a wrong cadence-arithmetic comment would be a Low (misleading rationale, possible staleness),
never a cost-cap breach, because the breach-prevention lives one layer down in the reservation
transaction.

**New reusable check #2 (tooling hygiene): the Grep tool briefly returned a STALE value
(`MAX_PAGES = 20`) for a line that Read, `awk`, `sed`, and `git diff` all independently and
consistently showed as `MAX_PAGES = 18`.** Cross-checked with three independent read paths
before concluding it was a Grep-tool artifact (likely an internal index/cache lag), not a
real on-disk inconsistency, and did not file a false finding about it. **General check: if a
single tool's output about a security-relevant constant conflicts with everything else
(Read, git diff, a second shell command), re-verify with at least one independent tool before
treating the discrepancy as a real code defect — don't trust a lone outlier reading for a
number that gates a cost/safety cap.**

Verdict: **APPROVED.** No blocking (Critical/High) finding. `deploy.yml` deploys hosting
only — this Cloud Functions-only change needs a manual targeted
`firebase deploy --only functions:leavingRollup` before the new cadence/cap takes effect
(no `firestore.rules` touched, so no rules-deploy note needed here).

### 2026-07-18 — BIN-544 recapCoverageGaps: callable gate + rules seal correct; "closes the abuse/cost surface" claim in tasks/todo.md is FALSE — sealing a collection behind a callable closes forgery, not volume/cost — APPROVED WITH NOTES (one Medium)

Reviewed the working-tree diff adding `logRecapMiss` (a new sealed-collection callable
mirroring `recordAskBinge`'s pattern) plus the `useRecap.ts` miss-detection effect that
fires it. Two things traced CORRECT and worth recording as the confirmed-safe baseline for
future review of this same file class:

1. **App-Check-or-auth gate is byte-identical to `recordAskBinge`'s**, not just similar:
   `hasAppCheck = request.app !== undefined; isAuthed = request.auth?.uid !== undefined; if
   (!hasAppCheck && !isAuthed) throw HttpsError('failed-precondition', ...)` — same variable
   names, same error code, same message. No subtle divergence (e.g. no accidental `||`/`&&`
   flip, no missing branch).
2. **The false-negative-on-error class this project already documented (BIN-185
   `SeasonRecapResult.isLoading`) is correctly avoided here too.** `useRecap.ts`'s new
   `useEffect` gates both "genuine miss" branches on React Query's `.isSuccess`, never on a
   bare falsy check of `data`/`covered`. Traced `getDocWithTimeout`'s `Promise.race` against
   a 10s timeout: on timeout the raced promise REJECTS, so the `queryFn` throws, so RQ's
   `status` becomes `'error'` and `isSuccess` stays `false` — neither branch can fire. No
   live-PoC needed; this is provable by RQ's documented status-machine, and `parseRecapIndex`
   always returns `[]` (never `null`) on a missing/junk doc, so `covered!.length` can't throw
   either. Verified the ONE real call site (`TVShowPageClient.tsx`) memoizes the `boundary`
   object via `useMemo([recapInventory, isWatched])`, so the effect doesn't re-fire on every
   render — but this is an UNENFORCED contract (the hook's own type signature doesn't require
   a stable reference); flag it (Low) if a second call site is ever added with an inline
   object literal.

**New reusable check (the actual finding, Medium): sealing a client-writable counter
collection behind a Cloud Function callable closes the FORGERY/malformed-write vector, but
does NOT by itself bound COST or DOC-COUNT — conflating the two is a load-bearing false
attestation.** The diff's own `tasks/todo.md` note declares the panel's originally-flagged
"Moderate: abuse/cost surface" condition fully closed ("~~rate-limit-considered before real
launch~~ SUPERSEDED — moot, the write already goes through a callable Function... so there's
no separate rate-limiting follow-up to track"). That's wrong on the cost half. Compared
against the THREE other sealed-counter siblings in this exact codebase:
- `askBingeStats/{day}` — ONE doc per UTC day, storage bounded to ~365 docs/year regardless
  of call volume (only write-OP count scales with abuse, not doc count/storage).
- `omdbBudget/{day}` (`titleRatings`) — a real global `DAILY_CAP` (900) enforced via
  transaction, PLUS `enforceAppCheck: true` (hard platform-level rejection of unattested
  calls, not just `request.app !== undefined` soft-checking) — and its own comment names the
  EXACT attack this diff is exposed to: "the only way to stop an anonymous actor from
  draining the budget with many distinct uncached ids is to require App Check" (BIN-361).
- `titleRatingsRateLimit/{uid}` — a real per-caller rate-limit counter doc.

`recapCoverageGaps/{tmdbId}`, by contrast, is keyed on a CLIENT-SUPPLIED integer with only a
`Number.isInteger(tmdbId) && tmdbId > 0` bound — no upper ceiling, no global daily cap, no
per-uid/per-App-Check-instance throttle, and (unlike `askBingeStats`) ONE NEW DOC PER
DISTINCT VALUE. An App-Check-token-holder or any authenticated user (trivial self-serve
signup) can call it in a loop with sequential/random large integers and create an unbounded
number of docs. Quantified: at Firestore's ~$0.18/100k-write pricing this is a slow bleed
against the 25 SEK/month Blaze cap (needs high call volumes to matter financially), but the
sharper impact is DATA-QUALITY, not cost — this collection's entire purpose is "prioritize
backfill by real demand," and an unbounded, unvalidated-against-any-real-catalog-range
tmdbId namespace makes it trivially pollutable, which quietly defeats the feature even
without ever threatening the cost cap. **General check: when a diff's own commit note claims
"X collection now matches the sealed-callable pattern used by collections Y/Z/W, so the
panel's abuse/cost condition is closed," verify the SPECIFIC cost-bounding mechanism of each
sibling (daily cap? enforced App Check? per-uid limiter? single doc/day?), not just that all
of them share "goes through a callable" — the callable wrapper alone only ever closes the
write-SHAPE vector (arbitrary fields/paths), never the call-VOLUME vector, and a "same shape
as sibling X" claim is false if X has an extra cost-bounding mechanism this diff lacks.**

Filed as Medium, not blocking-Critical (App-Check-or-auth is real friction, not zero
gate; no PII/cross-account exposure; no forgery of arbitrary fields — `validateMissInput`'s
`hasAll`-equivalent shape lock is sound). But surfaced explicitly because `tasks/todo.md`
forecloses a decision (declares the panel condition closed) that should instead go back to
Malin/Product Manager #9 as an explicit accept-or-fix, matching this project's own
sensitive-domain plan-and-signoff norm — a review that let a false "condition closed" note
stand unchallenged would be the same failure class as the 2026-07-16 "revert's false safety
comment" entry above, just pre-emptive instead of retrospective.

Verdict: **APPROVED WITH NOTES.** No blocking (Critical/High) finding — rules sealing,
GDPR-scope (no user-owned subcollection, no uid captured, correctly excluded from
`userData.ts`), and the error/timeout false-negative class all verified sound. One Medium
(unbounded doc-count/cost-and-data-quality gap, mischaracterized as closed in `tasks/todo.md`
— recommend a static tmdbId ceiling + either a daily cap or per-caller throttle, or an
explicit informed accept from Malin before shipping as-is). Standard reminder: this diff
touches both `firestore.rules` and `functions/**` — `deploy.yml` deploys hosting only; ship
needs a manual `firebase deploy --only firestore:rules,functions:logRecapMiss` (targeted, per
the standing "never blanket `--only functions`" grant).

### 2026-07-16 (re-review) — BIN-509 pre-plant exploit CLOSED: `anonShapedPid` format gate verified live at both legs, APPROVED

Re-reviewed the working-tree fix for the blocking finding filed earlier the same day (below entry).
Fix: `anonShapedPid(p) = p.size() == 32 && p.matches('^[0-9a-f]+$')` (matches `generateSecureToken()`'s
exact output shape: 16 random bytes → 32 lowercase-hex chars; Firebase Auth uids are ~28-char base62,
structurally disjoint) is now required at BOTH legs: (1) the `participants/{pid}` anon-create/update
branch (`... && anonShapedPid(pid)`) — a ghost slot can no longer be planted at a real uid's path;
(2) `voteKeyIsAnonSlot(k)` (`anonShapedPid(k) && get(...).data.uid == null`) — the shape check
short-circuits BEFORE the `get()`, so a uid-shaped/garbage vote key costs no extra read (confirmed by
rule ordering, `&&` short-circuits left-to-right in Firestore rules).

**Re-ran the same live-PoC method from the original finding, inverted to prove closure, not just
re-traced statically.** Wrote a throwaway `src/test/rules/_poc-bin509.test.ts` reusing the project's
real `initializeTestEnvironment`/`unauthenticatedContext`/`withSecurityRulesDisabled` harness against
the live Firestore emulator (`npm run test:rules`, JAVA_HOME resolved per
`reference_emulator_java`): (a) unauthenticated create of `participants/{28-char-non-hex-uid-shaped-id}`
with `uid:null` → `assertFails` (was `assertSucceeds` before the fix, per the original PoC log); (b)
even bypassing rules to seed the ghost directly (`withSecurityRulesDisabled`, simulating the
counterfactual where leg (a) had failed), a swipe `votes:{[that uid]:'veto'}` → `assertFails` on its
own, independent of leg (a) — proves defense-in-depth, not just a single point of failure. Both
assertions passed (195/195 total, 193 pre-existing + 2 PoC). Deleted the PoC file immediately after
(`git status` confirmed clean of it) — never part of the diff, per the standing instruction not to
leave throwaway PoCs in the tree.

**Traced the legit-flow side to confirm no regression, not just the attack side:**
`src/lib/firebase/sessions.ts` `createSession` uses `params.hostUid ?? generateSecureToken()` as the
participant id (signed-in host → own uid; anon host → 32-hex token) and
`TillsammansSessionPageClient.tsx`'s join flow uses `existingUid ?? generateSecureToken()` identically
— every real code path either sets `pid == auth.uid` (signed-in branch) or emits an
`anonShapedPid`-passing token (anon branch); no client path can ever produce a pid that satisfies
neither, so the new gate has zero false-positive surface against real traffic. Also confirmed the new
gate can't collide with a LEGACY (pre-BIN-509) anon slot going stale/unwritable: anon pid generation
via `generateSecureToken()` predates this diff (already the established BIN-24-era "M4" idiom per its
own comment), so no production anon doc could exist at a non-token-shaped path in the first place.

**Residual attack surface after the fix, confirmed intentional/inert, not a new gap:** a random-token
(32-hex) ghost slot can still be pre-planted by anyone with the link (token-trust model) — but that
only ever forges an ANOTHER-anonymous-participant's vote, which is the already-accepted ADR 0015 /
Decision A residual (`.claude/rules/accepted-deviations.md`), not the signed-in-identity-collision
class this fix closes. No real uid can ever be 32-char lowercase-hex under Firebase Auth's fixed
28-char default uid generation, so the "collide with something meaningful" question in the re-review
brief resolves to: no, structurally impossible for the standard uid shape this app relies on (no
custom-uid user-creation path found in `AuthContext`/signup flow).

**New reusable check confirmed by this re-review (generalization of the original finding, not a new
class): when a format-guard fix closes a namespace-collision hole, verify the guard three ways, not
one — (1) live-PoC that the attack now fails (closure), (2) trace every legitimate writer to confirm
none can ever fail the new guard (no false-positive/regression), (3) confirm the guard's own format
assumption (here: `generateSecureToken()`'s exact byte-count → hex-char-count math, and Auth's uid
length being FIXED not just "usually" 28) by reading the actual generator/provider code, not by
trusting a rules comment's claim about it.**

Verdict: **APPROVED.** Blocking finding from the same-day entry below is closed at both legs, live-PoC
confirmed, no regression to the signed-in or anon legitimate flows, 195/195 rules tests green
(193 pre-existing + 2 throwaway PoC, PoC deleted before finishing). No new blocking finding.

### 2026-07-16 — BIN-509 Tillsammans caller-binding: a shared child-doc namespace (anon token vs. signed-in uid) lets an anon "identity" pre-claim a signed-in user's future path — CHANGES REQUESTED, live-PoC-confirmed, new check class

Reviewed the working-tree `firestore.rules` sessions rewrite that bound `participants/{pid}`
writes to `pid == auth.uid` for signed-in callers (closing a real BIN-24-era hole where a signed-in
user could hijack ANY existing slot, anon or not, by writing their own uid into the `uid` field
regardless of path) plus a matching `swipes/{tmdbId}` create/update split with an
`voteKeyIsAnonSlot()` get()-gated anon path. The diff's own comment claims "inloggades
röster/platser kan inte förfalskas av någon" (a signed-in user's votes/slots can never be forged
by anyone) — **this is false, and I proved it live, not just by trace.**

**Root cause, generalizable:** the anon-participant branch —
`request.resource.data.uid == null && (resource == null || resource.data.uid == null)` — binds
"is this an anon slot" to the DOCUMENT'S OWN uid field, and deliberately has NO `request.auth ==
null` gate (so a signed-in user can keep updating a slot they joined anonymously pre-login — the
intended mid-session-login case) and NO binding of `pid` to anything at all on that branch. The
combination means the anon branch can CREATE a doc at ANY pid, including a string that happens to
equal a real Firebase Auth uid — nothing in the rule reserves the uid-shaped portion of the pid
namespace for its actual owner. An attacker (need not even be authenticated — `unauthenticatedContext`
satisfies this branch fine) who knows a target's uid can pre-plant `participants/{victim_uid}`
with `uid: null` BEFORE the victim ever joins. That flips `voteKeyIsAnonSlot(victim_uid)` true, so
the same attacker can then create `swipes/{tmdbId}` with `votes: { [victim_uid]: 'veto' }` under
the anon-slot branch. When the victim genuinely joins later (client always writes
`participants/{their own uid}`, confirmed in `src/lib/firebase/sessions.ts`
createSession/joinSession), the signed-in branch lets them overwrite the participant doc
unconditionally (no dependency on prior `resource.data` state) — but the SEPARATE swipe doc is
untouched by that write, so the forged vote survives and now reads as the victim's own.
**Feasibility check, not just theoretical:** the uid needed for this attack is trivially
obtainable — `usernames/{username}` is `allow read: if true` with value `{uid}` (confirmed at
firestore.rules:470-476), so any username (routinely public — profile URLs, follow lists) resolves
to a raw uid with one anonymous read.

**Verification method used (record for reuse): don't stop at rules-trace, write a live PoC.**
Traced the exploit statically first, then wrote a standalone throwaway test file
(`src/test/rules/_poc-bin509.test.ts`, deleted before finishing — never part of the diff) reusing
the same `initializeTestEnvironment`/`unauthenticatedContext`/`authenticatedContext` harness as
the real suite, and ran it against the live Firestore emulator: (1) `unauthenticatedContext()`
creates `participants/{VICTIM}` with `uid:null` → `assertSucceeds`; (2) same anon context creates
`swipes/999` with `votes:{VICTIM:'veto'}` → `assertSucceeds`; (3) `authenticatedContext(VICTIM)`
genuinely joins via the real client shape (merge:true) → `assertSucceeds`; (4) re-read the swipe
doc → `votes.VICTIM` still `'veto'`. All three writes succeeded and the forged vote survived,
exactly as traced. **General check for any future review of a caller-binding rewrite that
introduces a caller-agnostic "anon" branch for continuity/reclaim reasons (the "signed-in user
picking up their own pre-login anon slot" pattern): verify whether the anon branch's identity
namespace (the pid/key values it's willing to accept) can COLLIDE with the signed-in identity
namespace it's supposed to be separate from. If the anon token format isn't format-constrained in
the rule itself, a real identity's key is just another string the anon branch will happily accept
— and any 191/191-green existing suite won't catch it unless a test specifically seeds an
anon-shaped doc AT a real identity's own path before that identity's first legitimate write.** The
cheap fix is a format guard: `generateSecureToken()` always emits a 32-char lowercase-hex string
while Firebase Auth uids are 28-char base62 — constraining the anon branch's accepted key shape
(`pid.size() == 32 && pid.matches('^[0-9a-f]+$')`) closes the collision at zero added read cost,
cheaper than gating on `!exists(/databases/.../users/$(pid))`.

**Distinguished from the already-accepted deviation (do not conflate):** the project's accepted
anon-vs-anon residual (ADR 0015, `.claude/rules/accepted-deviations.md`) is explicitly scoped to
one anonymous link-holder forging ANOTHER anonymous participant's single vote — an already-decided
trust-model acceptance. This finding is a DIFFERENT class: forging what becomes a SIGNED-IN
identity's vote, via a path the signed-in user doesn't own yet. A reviewer must check a new
"anon-shaped write to a not-yet-claimed identity path" attack independently of an existing
anon-vs-anon acceptance — the two are not the same risk just because both involve "an anon slot."

Verdict: **CHANGES REQUESTED** (Critical/High, blocking). All other verification points in the
commit (no diff()-on-create trap, signed-in vote paths short-circuit before paying the
`voteKeyIsAnonSlot` get(), legit client paths in `sessions.ts` all trace correctly, BIN-24 fixture
renames are contract updates not weakenings, 191/191 rules tests green) held up — this is the one
blocking gap.

### 2026-07-16 — Reviewing a FORWARD-REVERT: the honest-baseline method (new review shape, not a defect class)

Reviewed the staged revert backing BIN-523 (availableNotify media-type namespacing) + BIN-510
(bounded group fan-out) out of 84e7f4d, restoring 5 files to fd4b14e. Every prior entry in this
file reviews a change moving FORWARD; a revert inverts the question and needs its own method,
because the naive framing ("this diff deletes a bug fix → regression") is wrong here and would
have blocked a correct change.

**The method, in order:**
1. **Prove the revert is EXACT before reasoning about semantics.** `git diff --cached <base> --
   <files>` must be EMPTY. If it is, the diff carries zero novel code and the entire review
   reduces to "is `base` an acceptable state" — a much smaller question than reading hunks. Also
   diff working-tree vs index (nothing smuggled). A revert that is NOT byte-identical to its
   claimed base is a different, much larger review.
2. **Establish the HONEST BASELINE = what is DEPLOYED, not what is committed.** This is the whole
   game. `deploy.yml` deploys `--only hosting`, and its rules/functions drift guard is the FIRST
   step after checkout with no `continue-on-error` — so a commit touching `functions/**` fails the
   job BEFORE the hosting step, meaning **hosting doesn't deploy either**. A RED guard on a mixed
   functions+frontend commit ⇒ prod runs the PARENT commit for BOTH surfaces. Do not assume "src/
   changes are live because deploy.yml handles hosting" — check whether the same push also tripped
   the guard. Here that made BIN-510's `groups.ts` revert also a return-to-live, not just BIN-523's.
3. **"Returns to a known bug" ≠ "opens a hole."** If the reverted code never executed anywhere, the
   bug's user-facing rate is UNCHANGED — not one extra occurrence. State that plainly; a reviewer
   who flags the restored pre-existing bug as a finding against the revert is mis-attributing a
   pre-existing Medium to the diff that merely re-syncs source to reality.
4. **For "no docs exist under the new schema, since it never deployed" — verify, don't assume, AND
   check the failure mode if the assumption is wrong.** Verify by grepping for ALL writers of the
   collection (here `availableNotifyState` had exactly one: the function itself) — that reduces
   "did it deploy" to a single auditable path. Then ask the robustness question anyway: *if* it had
   deployed, what breaks on revert? Here: namespaced `movie_N`/`tv_N` docs would be orphaned
   (inert, non-PII, no uid, no rules block → default-deny, no GDPR duty) and the reverted code
   would read a bare doc frozen at deploy-time → a bounded extra-push over the deploy window.
   **Fails in the extra-push direction, never the leak direction.** A revert whose worst case under
   a FALSIFIED assumption is still non-security is much stronger evidence than the assumption
   itself — say so, because it makes the decision robust rather than conditional.
5. **Check the revert for vacuous questions.** The task asked whether group-membership docs written
   under "the BIN-510 schema" could be misread. Verified BIN-510 had NO write path at all (its
   diff adds/removes zero `setDoc`/`updateDoc`/`addDoc`/`deleteDoc`/`batch`/`serverTimestamp`
   lines; its cache was a module-level JS variable, never a Firestore doc). Answer the question by
   showing it's vacuous, don't manufacture an analysis.
6. **Testing honesty on a revert:** confirm deleted tests map 1:1 to deleted exports and that no
   SURVIVING assertion was weakened. Deleting tests for deleted code is correct; a revert is a
   natural place to sneak a weakened assertion past the gate.
7. **A revert can be a documentation-integrity IMPROVEMENT — check the comments it removes.**
   BIN-523 added a comment to `priceDropNotify` claiming "safe here (BIN-523 checked): the scan
   filters mediaType === 'movie', so a TV title with the same TMDB id can never reach this
   collection." Independently confirmed FALSE where it matters: the movie-only filter bounds
   priceDropNotify's OWN marker collection, but it consumes `priceHistory/{tmdbId}`, written by
   `streamingOffers` via `dedupeIntent` (logic.ts:20-26) keyed on BARE tmdbId, first-occurrence-
   wins → TV N can own `priceHistory/N` and feed a movie-N price-drop push. **General check: a
   "X checked, this is safe" attestation comment is a load-bearing claim — verify it like code.
   A false one is worse than no comment (it tells the next engineer the audit was done), so
   removing it is a net gain, and a partial fix that documents itself as complete is exactly how
   a known bug becomes an invisible one.**

**Generalizable partial-fix check surfaced here:** BIN-523 namespaced `availableNotifyState` by
(mediaType, tmdbId) but left the IDENTICAL bare-tmdbId collision live in `streamingOffers`
(`dedupeIntent`, `streamingOffers/{tmdbId}`, `priceHistory/{tmdbId}`). When a diff fixes a
keying/namespacing bug in one collection, grep for every OTHER collection keyed on the same bare
id and confirm the fix propagated or the ticket explicitly scopes it out — this is the same class
as the 2026-07-16 AuthContext "sibling-pattern-left-unfixed" entry, but across COLLECTIONS rather
than sibling functions, and it's what made BIN-523 fail verification.

Verdict recorded: APPROVED, no blocking finding. Revert is the correct call; both tickets go back
to Todo for rework.

### 2026-07-16 — BIN-522 watchlist-notes follow-up (WatchlistContext + useFollowList): APPROVED WITH NOTES, no security finding; new flaky-test class found

Scoped review (working-tree diff, unstaged, no rules changes) of
`WatchlistContext.tsx`'s `updateNotes` no-op-write skip, its new test block, and
the `useFollowList` ghost→null collapse's supporting tests. No trust-boundary
issue: no `firestore.rules` change, the BIN-505 `itemsUidRef` cross-account
migration guard re-traces sound (unchanged logic, just new test coverage),
`publicProfile.ts` itself is untouched (the new `publicProfile.test.ts` cases
pin behavior — displayName/bio clamp, photoURL >500 omit — that already shipped
in BIN-505; confirmed by reading the unmodified source, not just trusting the
tests). The `useFollowList` `'ghost'` variant removal (deleted-account vs.
private-non-friend now both render as the same anonymous fallback row instead
of the deleted one being silently dropped) is a privacy IMPROVEMENT, not a
regression — it removes the one bit of information ("this uid is a live private
account vs. a dead one") the old code leaked via row-presence-or-absence, at the
cost of the fallback row now also covering "deleted" (closed by the weekly
`reclaimOrphanFollows` sweep instead of on-read filtering — confirmed the sweep
function exists in `functions/src/reclaimOrphanFollows/index.ts`).

**New flaky-test class (Medium, not security):** ran the new
`WatchlistContext — updateNotes + eager notes migration (BIN-505/BIN-522)`
block ~31 times total (solo file, 3-file combo, cache-cleared cold runs); it
failed exactly once, with two assertions in adjacent tests each seeing ONE
EXTRA stray `setDoc` call that shouldn't have existed for that test's own
scenario. Root-caused (not just suspected) to the shape of the eager-migration
effect: it starts a fire-and-forget `void (async () => { const {...} = await
fsdb(); ...batch.commit()... })()` inside a `useEffect`, and the FIRST test in
the block (`updateNotes writes the note...`) seeds a legacy inline note THEN
immediately fires the `notesSnapshotCallback` for the same tmdbId in the SAME
`act()` block — this is right at the boundary where the migration effect's
`legacy` filter (`notesByTmdbId[i.tmdbId] === undefined`) can evaluate true or
false depending on effect/microtask ordering. When it evaluates true for one
extra tick, the effect's IIFE reaches its `fsdb()`-mocked first `await` (2
microtask ticks to the actual `setDoc` calls) and can still be in flight when
Vitest moves to the NEXT test's `beforeEach` → `setDoc.mockClear()`, so the
stray write's mock-call record lands AFTER the clear, inflating the next test's
count by exactly one. Only tests 4–5 in the block explicitly `vi.waitFor(...)`
before asserting; tests 1–3 (including both that failed) call `updateNotesRef`
inside a plain `await act(async () => {...})` with no explicit flush/wait for
ANY unrelated pending effect from the same or a prior test to settle — `act()`
only guarantees the passed callback's own promise chain resolves, not sibling
fire-and-forget effect chains. **General check for future review of any test
file exercising a component with a fire-and-forget `useEffect` async writer
(this codebase's established pattern: eager-migration effects, lazy backfills,
`nextAirReadRepair`-style silent denormalizers): a test earlier in the same
`describe` block that can trigger — even conditionally/rarely — the fire-and-
forget path without an explicit `vi.waitFor`/flush on that specific write
before the test ends is a LATENT flaky-CI risk for every test that runs after
it in the same file, not just an isolated concern in the triggering test
itself.** Fix options (not yet applied, filed as a follow-up not blocking):
(a) add `vi.waitFor` after every `mountSeeded`/snapshot call in this block that
could plausibly still leave a legacy note un-migrated at that point, even if
the test doesn't care about the migration's own effect; or (b) explicit
`cleanup()` + a flush (`await new Promise(process.nextTick)` twice, matching
the 2-tick `fsdb()`+`commit()` shape) in an `afterEach` scoped to this describe
block. Filed as Medium (CI-reliability, not a security or correctness-of-
shipped-code defect — the PRODUCTION code path is correct; only the TEST
harness's inter-test isolation is at risk) — not blocking this diff, since the
underlying app logic (traced statically + confirmed correct across 30+ clean
runs) is right.

**Low (comment-accuracy, not a bug):** `updateNotes`'s BIN-522 skip condition
(`if (current?.notes != null || Object.keys(visFields).length > 0)`) only
actually omits the item-doc write when the title's per-item `visibility` field
is explicitly non-null (an override) — because `effectiveVisibilityNow()`
unconditionally returns a 2-key object whenever `visibility` is null (the
pre-existing "lazy-on-write re-stamp" convention used by every other mutator in
this file), so `Object.keys(visFields).length > 0` is true and the write is
NOT skipped for any title that inherits its visibility from the account
default. The inline comment claims this covers "the common case (editing a
note on an already-migrated title)" — that's only true if most library titles
already carry an explicit per-item visibility override, which is unverified
and plausibly false (most users likely rely on the account-level default). Not
a functional bug — the condition correctly matches the codebase's own existing
definition of "nothing to re-stamp" — but worth flagging since BIN-522's own
premise (per its ticket number appearing in the comment) is a cost-reduction
claim, and CLAUDE.md's working agreement explicitly asks reviewers to flag
scope/cost claims that don't hold. **General check for future review of any
"skip write on no-op" optimization gated on a field being null vs. non-null:
verify which state (null or non-null) is the ACTUALLY common one in the real
data shape being optimized for, not just that the skip condition is logically
sound** — a logically-correct skip that rarely fires isn't wrong, just
possibly not the cost win its comment claims.

Verdict: **APPROVED WITH NOTES.** No blocking (Critical/High) security finding.
One Medium (flaky test, CI-reliability), one Low (comment overstates the
BIN-522 write-savings' actual coverage).

### 2026-07-16 — BIN-516/517 AuthContext diff: sibling-pattern-left-unfixed + ticket test-AC unmet with no test file to extend — two new non-security check classes

Reviewed the 3-hunk diff on `src/contexts/AuthContext.tsx` (BIN-517: drop `username: null`
from `register()`'s merge:true payload so it can't clobber `ensureUserProfile`'s concurrent
auto-claim back to null; BIN-516: add try/catch identity-checked ref-rollback to
`setProviderCost`/`setProviderCampaign` so a Firestore-rejected optimistic value doesn't
silently ride along in the next successful edit's payload). Both fixes independently traced
sound — no security/trust-boundary defect. Two new reusable check classes surfaced:

1. **A targeted bug-fix ticket can leave an identical-pattern sibling unfixed in the same
   file, same diff.** `setProviderRenewalDay` (line ~536) uses the EXACT same
   synchronous-mirror-ref idiom as `setProviderCost`/`setProviderCampaign` (its own comment
   even says "Samma synkrona-spegel-mönster som providerCosts (BIN-46)") but BIN-516's
   scope (confirmed via `tasks/todo.md`) named only the two Provider-cost siblings — the
   renewal-day function still has zero rollback on write failure, so the exact bug class
   BIN-516 fixed remains live there. **General check: whenever a diff fixes a
   named-pattern bug in one function, grep the same file for sibling functions sharing the
   same comment-cross-referenced pattern (`grep` the BIN-number or pattern-name comment)
   and verify the fix propagated everywhere the pattern occurs, not just the ticket's
   named call sites.**
2. **A ticket's own acceptance criteria can require a new test that never gets written,
   with no gate catching it, because no test file exists yet for that surface to extend.**
   Both BIN-516 and BIN-517's AC explicitly demand "a new test proves..." — grepped the
   whole `src/` tree and confirmed there is NO `AuthContext.test.tsx` (or any test file)
   covering ANY AuthContext logic, so the code-side AC shipped but the test-side AC for
   both tickets is silently unmet. This is a blind spot the mtime-based commit gates likely
   miss entirely: `require-review-before-commit`'s `binge-test-reviewer` trigger keys on
   staged TEST files matching the diff — if the diff touches zero test files, the
   test-reviewer gate may never fire at all, so a ticket that explicitly promises tests can
   ship with none and nothing blocks it. **General check: when a ticket's AC says "a new
   test proves X," verify a test file for that surface actually exists/was touched in the
   diff, don't just verify the production-code AC — the absence of a test-file diff on a
   test-mandating ticket is itself the finding, not merely quality debt.**

Also noted (Low, pre-existing, not introduced by this diff): BIN-517's fix closes only the
username-clobber sub-case of the acknowledged `register()`/`onAuthStateChanged`/
`ensureUserProfile` race. The broader race — `ensureUserProfile`'s NON-merge create-branch
`setDoc` (full profile overwrite) landing AFTER `register()`'s `merge:true` write — could
still discard `register()`-supplied fields (e.g. the caller-passed `termsVersion` vs.
`ensureUserProfile`'s hardcoded `CURRENT_TERMS_VERSION`) if ordering flips. Timing makes
this unlikely in practice (register()'s write is earlier in a sequential await chain of
similar-latency round-trips) but it's not structurally prevented, and pre-dates this diff.

Verdict: APPROVED WITH NOTES. No blocking (Critical/High) finding.

### 2026-07-16 — groups.ts scoped review (no diff, current committed state): two correctness bugs, no security-boundary crossing

Reviewed `src/lib/firebase/groups.ts` alone (not part of the staged diff at review
time — HEAD `fd4b14e`). All Firestore-rules-facing writes (`createGroup`,
`rotateInviteToken`/`disableInviteToken`, `joinGroupViaToken`, `inviteMemberByUid`/
`acceptGroupInvite`, `removeMember`/`leaveGroup`, `deleteGroup`, `setHouseholdContribution`/
`deleteHouseholdContribution`) were traced against the matching `firestore.rules` branches
(group update owner/leave/join/accept branches, `joinAttempts` hash-check, `members`,
`sessionHistory`, `watchlist`+`progress`, `household` get/list/create/delete) — all correctly
scoped to `request.auth.uid`, no forgeable identity or ownership field, matches the existing
distilled "social-graph mirror-write" and "household reciprocity" principles. No new leak.

**New Medium: `addToGroupWatchlist` (line ~390) uses a non-merge `setDoc`, silently
clobbering `memberRatings` (and other fields) if the doc already exists.** The only call
site, `AddToGroupButton.tsx`, guards on a `presence` map fetched once via `hasInGroupWatchlist`
when the dropdown OPENS, not immediately before the write — a second member (or a stale/slow
UI session) can add-then-rate the same title in the group between panel-open and click, and
the next re-add wholesale overwrites the doc, wiping every existing member's ratings with no
warning. Not a security boundary (the rule allows any member to create/update the doc, by
design — group watchlist is shared), but a real data-loss correctness bug. Fix: either check
existence immediately before write (`hasInGroupWatchlist` right before `setDoc`, accepting the
small remaining TOCTOU) or switch to `setDoc(ref, {...}, {merge: true})` and drop
`memberRatings: {}` from the payload — Firestore merge is a deep-merge on nested map fields
(a `{}` object at a key does not delete/replace existing nested keys not explicitly listed),
so an existing `memberRatings` survives a merge re-add naturally while a first-time create
still needs `memberRatings: {}` seeded (only matters if the field is completely absent, which
`hasAll`-style rules don't require here — confirm against the `watchlist` create/update rule,
which has no `hasOnly` on this collection so this is purely a client-code fix, no rules change
needed).

**New Low: `createGroup` (line ~48) writes the group doc (`addDoc`) and the owner's
`members/{ownerUid}` doc (`setDoc`) as two SEPARATE, non-atomic calls** — every other
multi-doc mutation in this same file (`joinGroupViaToken` step 2, `acceptGroupInvite`,
`removeMember`) uses `writeBatch` for the equivalent shape. A failure of the second write
(network drop, offline) leaves an orphaned `groups/{id}` doc with `memberUids: [ownerUid]`
but no `members/{ownerUid}` subdoc — the group shows up in `subscribeToMyGroups` (top-level
doc matches the array-contains query) but `GroupMembersPanel`/`subscribeToGroupMembers` and
any providers-based aggregation would render the owner as absent, with no client-facing retry
path (the thrown rejection surfaces as a generic create-group error; the leftover group doc is
never cleaned up). Confirmed the codebase is already aware of exactly this edge case:
`deleteGroup`'s household-ref derivation explicitly unions in `currentUid` on top of
`membersSnap.docs` "in case the member doc is missing" — i.e., defensive code elsewhere
compensates for a gap this function could avoid entirely by using `doc(collection(db,
'groups'))` to pre-generate the ref and committing both writes in one `writeBatch`, matching
the file's own established pattern.

**New Low (UX/observability, not exploitable):** `joinGroupViaToken`'s step-2 batch commit
(line ~193) catches ALL failures — including a transient network error or hitting the
rules' `memberUids.size() <= 100` cap — and maps every one of them to `reason:
'invalid_token'`. A user hitting the (real, rules-enforced) 100-member cap or a flaky
connection sees "ogiltig länk" instead of an accurate message; `console.error` does log the
real error for debugging, but the returned `reason` enum has no slot for "group full" or
"transient error" to surface to the UI.

Verdict: APPROVED (no security-boundary finding). Two correctness bugs (one Medium data-loss,
one Low reliability/orphan-doc) filed for the parent agent; not blocking on security grounds.



### 2026-07-19 — availableNotify (BIN-523 core + BIN-529 delta): "never reviewed" premise partly false; BIN-529 closes the last bare-tmdbId residual; APPROVED

Dispatched with "this has NEVER had a security review despite CLAUDE.md mandating one — this
is the first pass." **Verified against this file's own history before accepting that: false
for the BIN-523 core** (the 2026-07-16 entry immediately below already reviewed and APPROVED
byte-for-byte the same `normalizeMediaType`/`availableStateDocId` grouping fix — confirmed via
`git diff 84e7f4d -- functions/src/availableNotify/{index,logic,logic.test}.ts`, which shows
the ONLY delta between the already-shipped-then-reverted 84e7f4d commit and the current
working tree is the new `inboxNotifId` helper + its one call site + its two new tests). **True
for the BIN-529 delta** — that one function/call-site is genuinely new and unreviewed, and per
the sprint-block memory note (`project_sprint_2026-07-18b_blocked`) the whole functions/ diff
had in fact never passed a specialist gate before being blocked by the safety classifier. Per
this file's own standing instruction (2026-07-18 AuthContext entry): state the correction,
still review on the merits, don't skip depth because the premise turned out partly wrong.

**BIN-529 is a real, well-scoped fix for a gap the 2026-07-16 BIN-523 entry's own review left
unflagged:** BIN-523 namespaced the `availableNotifyState` doc id, the phase-2 grouping key,
and the FCM `tag` by `(mediaType, tmdbId)`, but left the INBOX notification doc id
(`users/{uid}/notifications/{tmdbId}-{providerId}`) on the bare-tmdbId scheme — so a user
tracking both movie N and TV N, both gaining the SAME provider in the same run, would still
merge-overwrite one inbox card (title/mediaType flip, read-state reset), even though the two
pushes themselves were already correctly distinct. `inboxNotifId(mediaType, tmdbId,
providerId)` = `${availableStateDocId(...)}-${providerId}` closes exactly this, rides the same
normalization, and is unit-tested for the distinct-id property + lockstep-with-state-key
property. Traced the write site (`processTitle`, `index.ts:239`) — writes only to
`users/{it.uid}/notifications/{notifId}`, `it.uid` sourced from the collectionGroup doc PATH
(`d.ref.parent.parent.id` in `readWatchlistTitles`), never from client-controlled document
content — no cross-user write is possible by construction, unchanged from the already-approved
baseline.

**GDPR check (both flows, per this file's seed checklist):** `notifications` is a PRE-EXISTING
subcollection, already present in `collectUserDataSnapshots`'s snapshot set (`userData.ts:59,
132,157,186,222`) and already iterated whole-collection (`getDocs(collection(db,'users',uid,
'notifications'))`) by BOTH `buildUserExport` and `deleteAccount`
(`accountDeletion.ts:65` pushes every `notificationsSnap` doc ref for delete) — the query is
doc-id-agnostic, so changing the ID SCHEME (bare → namespaced) needs no wiring change in
either flow. `availableNotifyState`/`releaseNotifyState` remain Admin-SDK-only, non-uid-keyed,
outside `firestore.rules` and outside the GDPR surface — unchanged from the 2026-07-16 finding.

**Cost/quota check:** `availableNotify` shares NO budget/reservation mechanism with
`streamingOffers`/`titleRatings`/`leavingRollup` (grepped `functions/src` for
`budget|Budget|reserveMotnSlot|DAILY_CAP|rateLimit` — zero hits in this function's files); its
TMDB calls are direct `watch/providers` fetches with only a 10s `AbortSignal.timeout`
(`tmdb.ts`), sequential per title (no concurrency burst). The finer-grained (mediaType,tmdbId)
grouping can only ever INCREASE call count for the rare case of one user tracking both a movie
and a TV show sharing a numeric id (previously 1 fetch, now 2) — negligible, not a quota
concern, and no shared-infra coupling to the HELD streamingOffers/priceDropNotify cluster this
review was explicitly scoped away from (confirmed via `git diff` that no line in the reviewed
files imports from or writes to `streamingOffers`/`motn.ts`).

`firestore.rules` has zero diff at review time (confirmed `git diff`/`git diff --cached` both
empty for that path) — no rules-deploy note needed for this surface. `sendPushToUser` (shared,
unchanged, `functions/src/push.ts`) still only ever sends to its `recipientUid` parameter —
re-confirmed by reading it fresh rather than trusting the 2026-07-16 entry's claim.

Verdict: **APPROVED.** No Critical/High finding. No blocking Medium. Process reminder (not a
defect): Cloud-Functions-only change, `deploy.yml` deploys hosting only — needs a manual
targeted `firebase deploy --only functions:availableNotify` before this ships, and per the
2026-07-16 revert-analysis entry, this is the SAME code that already reached production once
(84e7f4d) and was reverted for reasons UNRELATED to this file (the sibling groups.ts/
streamingOffers batch failing verification) — re-shipping it is not re-litigating a closed
question, it's finishing an interrupted rollout.

### 2026-07-16 (uncommitted diff) — BIN-523: availableNotify tmdbId/mediaType grouping fix — closes the Medium filed 2026-07-15, APPROVED

Reviewed the (uncommitted, working-tree) fix for the tmdbId-only-grouping collision Medium
flagged in the 2026-07-15 entry below. `availableStateDocId(mediaType, tmdbId)` →
`${normalizeMediaType(mediaType)}_${tmdbId}` is now used as BOTH the phase-2 grouping key
(`byTitle`, `index.ts` line ~393) and the `availableNotifyState` doc id (`readLastFlatrate`/
`writeMarker`), so a movie and a TV show sharing a numeric TMDB id can no longer merge into
one group, get one arbitrary `mediaType` for the TMDB fetch, or share one provider baseline —
exactly closes the bug traced in the prior entry. `processTitle`'s `mediaType` is derived via
`normalizeMediaType(items[0].mediaType)`, consistent with the group key's own normalization
(every item in a `byTitle` group was bucketed there BECAUSE its normalized mediaType+tmdbId
matched, so `items[0]` is now provably authoritative for the whole group — not just
convention as before). `actionUrl`/FCM `tag` both correctly ride the new `stateId`/normalized
`mediaType` too, so a movie-N push can no longer visually collapse an unrelated TV-N push in
the browser (shared notification tag) the way it silently could before. Pure-logic additions
(`normalizeMediaType`, `availableStateDocId`) are directly unit-tested including the
blank/unknown→'tv' fallback case. `priceDropNotify/index.ts`'s change in the same diff is
comment-only (documents why ITS bare-tmdbId doc ids stay safe: the `mediaType == 'movie'`
query filter already prevents any TV doc from ever reaching that collection) — no behavior
change there.

**Confirmed intentional, not a bug:** legacy bare-`${tmdbId}` `availableNotifyState` docs are
deliberately orphaned (not migrated to the new `movie_`/`tv_` ids) — every previously-tracked
title's `last` reads back `null` on the first run after this ships, so the very next scheduled
run re-baselines silently (no push) instead of comparing against the old (possibly
movie/TV-mixed) baseline. This is a one-time, documented, correctness-over-completeness
trade-off (a genuinely new provider that shows up in that exact run window goes unpushed
once) — not a regression to flag, since re-establishing a clean per-mediaType baseline is the
whole point of the fix and the alternative (reading the old mixed doc) would silently
reintroduce exactly the bug being fixed.

**No security-boundary change:** no rules diff (both state collections remain outside
`firestore.rules`, Admin-SDK-only, non-PII — matches the established `motnBudget`-class
pattern), no new user-owned subcollection (no GDPR wiring needed), `sendPushToUser(it.uid,
...)` call sites unchanged — still only ever pushes the item's own owner.

**Process note:** this is a Cloud Functions-only change (no `firestore.rules` touched) — per
`reference_deploy_scope`, `deploy.yml` on push-to-main deploys hosting only, so this fix needs
a manual `firebase deploy --only functions` (targeted to `availableNotify`/`priceDropNotify`,
never a blanket `--only functions`) before the corrected grouping takes effect in production;
flagging as a reminder for whoever ships this, not a defect in the diff itself.

Verdict: APPROVED. No blocking finding; the diff is a correct, well-tested closure of a
previously-filed Medium.

### 2026-07-16 — BIN-515: bounded collectionGroup pagination (availableNotify + priceDropNotify) — APPROVED, correct termination, no boundary change

Reviewed a scoped diff replacing a single unbounded `.get()` collectionGroup scan
with a paginated loop (`orderBy(FieldPath.documentId()).limit(PAGE_SIZE).startAfter(cursor)`,
terminate on `snap.empty` OR `snap.size < PAGE_SIZE`) in both `availableNotify/index.ts`
and `priceDropNotify/index.ts`. Confirmed correct on the two properties that matter for
a scheduled push function: (1) **no dropped final page** — the partial last page's docs
are pushed into the accumulator BEFORE the `size < PAGE_SIZE` break, not after, so the
short-page docs aren't discarded; (2) **no infinite loop** — `cursor` always advances to
`snap.docs[snap.docs.length - 1]` on every non-empty page, and orderBy(documentId()) with
an exclusive `startAfter` guarantees strict forward progress even in the boundary case
where total docs is an exact multiple of PAGE_SIZE (one extra now-empty query, then break).
No per-user scoping change (uid still derived the same way from `d.ref.parent.parent.id`),
no new fields selected, no change to who receives the resulting push
(`sendPushToUser(it.uid, ...)` call sites untouched, outside the diff hunk). Verified the
comment's index claim against `firestore.indexes.json`: Firestore auto-appends `__name__`
to both single-field (availableNotify's `status IN [...]`) and composite (priceDropNotify's
`mediaType==, status==`) indexes, so adding `orderBy(FieldPath.documentId())` needs no new
index entry — confirmed by reading the actual indexes.json rather than trusting the comment.
**Reusable check for any future collectionGroup-pagination diff:** verify the accumulator
push happens BEFORE the short-page-break check (order of operations, not just presence of
a break condition) — an easy mistake is to check `size < PAGE_SIZE` and `continue`/`break`
before appending the current page's docs, which silently drops the final (usually largest
partial) page and would starve the newest users out of every scheduled run.

Confirmed the pre-existing Medium (tmdbId-only grouping in `processTitle` collides
movie/TV titles sharing a numeric id — logged 2026-07-15 entry below) is untouched by this
diff (the collision is in code below the pagination hunk, not modified here) — still
tracked as a follow-up, not newly introduced or worsened. Same for the two pre-existing
Lows (implicit group-watchlist exclusion via `status`-field coincidence; unbounded title
string in FCM push body).

Verdict: APPROVED. No blocking finding.

### 2026-07-15 (re-review #2) — BIN-505 post-code-review delta: cross-account notes-migration guard verified sound; new Low finding — sibling per-uid listeners (`notesByTmdbId`/`tagsByTmdbId`) don't reset on a truthy→truthy uid switch, only on sign-out

Re-reviewed the delta added after `/code-review high`: `WatchlistContext.tsx`'s
`itemsUidRef` guard on the eager notes-migration effect, `isValidPublicProfile`'s
new `isPublic` bind, and `syncMyPublicProfile`'s photoURL oversize-omit.

**Guard traced sound, no residual WRITE-side cross-account window.** The key
correctness fact: `itemsUidRef.current = uid` is set INSIDE the watchlist
`onSnapshot` callback, in the SAME synchronous block that calls
`setItems(snap.docs...)` — so ref and state always update atomically together.
On a same-session A→B switch, the migration effect (deps `[uid, items,
notesByTmdbId]`) re-runs immediately when `uid` flips to B, but at that render
`items` is still A's array (React hasn't received B's snapshot yet) and
`itemsUidRef.current` is still `'A'` → `'A' !== 'B'` → guarded out. The effect
only proceeds once B's own `onSnapshot` fires, which sets BOTH `items` and
`itemsUidRef.current` to B in the same tick — so whenever the guard passes,
`items` (the migration's read source) and `uid` (the write destination) are
provably the same account. Confirmed the closure captures `uid` per-effect-
invocation (not a mutable ref), so even a hypothetical late-firing stale
listener callback would write under ITS OWN captured uid, not a newer one —
consistent with the Firestore Web SDK's documented synchronous-unsubscribe
guarantee this pattern already relies on elsewhere (mirrors the pre-existing
`items` listener). No blocking finding on the write path.

**New Low finding (not blocking, not unique to this diff):** `notesByTmdbId`
and `tagsByTmdbId` (their `useEffect`s) only reset to `{}` in the `if (!uid)`
branch — on a truthy-to-truthy uid switch (A→B without an intermediate
sign-out) the stale map from A persists in React state until B's own listener
delivers its first snapshot. Because `itemsWithTags` joins `notesByTmdbId[i.tmdbId]
?? i.notes` against whatever `items` currently holds, there is a narrow
client-render-only window where, if B's freshly-loaded items include a tmdbId
that also happened to be a key in A's stale notes map, B's UI could momentarily
display A's note text under that title. This is NOT a Firestore rules
violation (every read stays correctly scoped to its own owner-gated listener;
no cross-uid document access occurs) and is NOT introduced by this diff — the
identical pattern already existed for `tagsByTmdbId` before BIN-505 and was not
previously flagged. Flagging now because it's literally the same threat class
(shared-device session-switch cross-account content exposure) this diff just
closed on the write side. Cheap general fix if ever revisited: reset
`setNotesByTmdbId({})`/`setTagsByTmdbId({})` unconditionally at the top of
each uid-keyed listener effect (before the `if (!uid)` early return), not just
on sign-out.

**Also noted:** no dedicated component test exercises the `itemsUidRef` guard
itself (a mid-session uid-switch-with-stale-items scenario) — the 25 passing
`WatchlistContext.test.tsx` cases don't simulate this race, so today's proof is
static trace only, not test-locked. Worth a targeted test if this file is
touched again (switch `authState.uid` mid-test between two snapshot deliveries,
assert no `watchlistNotes` write lands under the new uid using the old uid's
item notes).

**`isValidPublicProfile` `isPublic` bind confirmed inert for access control:**
grepped the read rule — visibility is gated exclusively via
`get(users/{uid}).data.get('isPublic', false)`/`defaultVisibility` (the SOURCE
doc), never the projection's own `isPublic` field. The projection's `isPublic`
is client-documented (`publicProfile.ts` `PublicProfileCard.isPublic` docstring)
as "used ONLY to gate follower/following-count queries client-side... NOT an
access gate; a stale value is at worst transient noise" — matches the rule
reality. Positive whitelist (`hasOnly`) unweakened; value-bound to `is bool`;
a non-bool write is rules-test-locked to fail (`assertFails(... isPublic: 'yes')`).

**`photoURL` >500-char omission confirmed availability-only, no injection
surface.** `syncMyPublicProfile` nulls an over-long `photoURL` before the
atomic merge-write so the whole projection doc doesn't fail-and-vanish; this
doesn't change how `photoURL` is ever rendered downstream (still `<img src>`
sites unchanged by this diff, pre-existing since before BIN-505) and doesn't
introduce a new write path — a value that's still ≤500 chars flows through
exactly as it always did into the SAME field shape already whitelisted+bound
by the (unchanged) rule.

**GDPR live-emulator gap flagged in the 2026-07-15 (first re-verification)
entry is now CLOSED:** `account-deletion.test.ts` seeds `publicProfiles/{uid}`
and `users/{uid}/watchlistNotes/{id}` in `seedFullAccount()` and asserts both
gone post-deletion — the missing live seed+assert for a top-level
non-subcollection GDPR doc that entry called out is resolved.

Verdict: **APPROVED WITH NOTES.** No blocking (Critical/High) finding. One new
Low (sibling-listener stale-map render window, pre-existing pattern, not
unique to this diff) + one Low (missing dedicated test for the guard itself).
173/173 `npm run test:rules` re-run live and green.

### 2026-07-15 — availableNotify Phase 2: tmdbId-only grouping collides movie/TV ids sharing a numeric TMDB id — new correctness issue class, not a security boundary crossing

Scoped review of `functions/src/{availableNotify,priceDropNotify,tmdbTosSweep}/index.ts`
(no staged diff — reviewed the live committed state on request). Found that
`availableNotify/index.ts`'s Phase 2 (`byTitle = new Map<number, WatchlistTitleLite[]>()`,
line ~376) groups scanned watchlist rows by **raw numeric `tmdbId` only**, ignoring
`mediaType` — even though this same file's own `skipKey` comment (line ~172) explicitly
documents that "TMDB movie ids and TV ids are independent namespaces, so a user can hold
movie N and TV N." When a movie and a TV show happen to share a numeric id (structurally
possible/expected at library scale, since the two id spaces are independent — not a
theoretical edge case), `processTitle` derives `mediaType` from `items[0]` ONLY (line 179)
and reuses it for the entire group: `fetchSeFlatrate(tmdbId, mediaType)` hits the WRONG
TMDB endpoint (`/movie/{id}/watch/providers` vs `/tv/{id}/watch/providers` — genuinely
different resources, confirmed in `availableNotify/tmdb.ts`) for whichever item isn't
`items[0]`, the persisted notification doc's `mediaType` field (line 226) and `actionUrl`
(line 199) are wrong for that item (sends the user to `/movie/{id}/` for what's actually a
TV show or vice versa), and the shared `availableNotifyState/{tmdbId}` baseline doc
(read/written by `readLastFlatrate`/`writeMarker`, no mediaType in the doc id) mixes two
unrelated titles' provider baselines. **General check for future review of any
collectionGroup fan-out keyed by bare TMDB numeric id: verify the grouping key AND any
shared per-title state-doc id include `mediaType` (or the docs are pre-filtered to one
mediaType, as `priceDropNotify` correctly does via its `mediaType == 'movie'` query
filter, and `availableNotify`'s own release phase correctly does via its `mediaType ===
'movie'` continue-guard) — a fan-out keyed on tmdbId alone silently merges two unrelated
titles the instant their ids collide.** This is a functional/data-correctness bug (wrong
push copy/link, polluted baseline), not a privacy or auth boundary crossing — no cross-uid
data exposure, since `sendPushToUser(it.uid, ...)` still targets only that item's own
owner. Filed as Medium (not blocking) in this review's output; not yet ticketed.

**Confirmed non-issue, but flagged as a fragile implicit invariant:** neither
`availableNotify` nor `priceDropNotify` applies the `isUserWatchlistDocPath` scope-guard
that `tmdbTosSweep` added for BIN-504 (both scan `collectionGroup('watchlist')`, which also
matches `groups/{id}/watchlist/{tmdbId}` docs). This is currently safe ONLY because both
functions filter on `.where('status', ...)` and group watchlist docs never set a `status`
field (confirmed via `groups.ts`'s `addToGroupWatchlist` payload shape) — Firestore
excludes field-missing docs from equality/`in` filters, so group docs never match. This is
an implicit, undocumented safety property riding on a schema coincidence, not an explicit
guard — if a future feature ever added a `status`-shaped field to group watchlist docs,
both functions would silently start scanning group data with no compile-time or review
signal. Low severity now; worth adding the same explicit path-guard for defense-in-depth
and self-documentation the next time either file is touched.

**Also noted (Low, pre-existing, out of the 3 files' direct control):** `firestore.rules`
`isValidWatchlistItem` has no length bind on `title` (unlike `isValidList`'s `d.title.size()
<= 100`), and none of the three reviewed functions truncate `it.title`/`filmTitle` before
interpolating it into an FCM push `body`. Matches the existing distilled principle
("Client-writable free text on docs without hasOnly whitelists gets length-capped in the
CONSUMING function... before reaching an FCM push body") but the push target is always the
SAME uid that owns the watchlist doc (`sendPushToUser(it.uid, ...)`), so this is
self-inflicted at worst (a giant title could fail that user's own FCM send), not a
cross-user boundary issue — noted for defense-in-depth, not blocking.

Verdict: APPROVED WITH NOTES. No blocking (Critical/High) finding; one Medium
data-correctness bug, two Low notes.

### 2026-07-15 (re-verification) — BIN-505 follow-up diff closes findings #1 and #4; confirms JS-Date-auto-converts-to-Timestamp is a valid pattern for rules type-binds

Re-reviewed a scoped delta (rules type-bind, one new emulator-test seed pair, one
client write-path change) against the already-approved BIN-505 diff. Two prior
non-blocking findings closed correctly:
- **`is timestamp` type-bind added to `isValidPublicProfile`'s createdAt/updatedAt**
  does not reject the legitimate owner write, because the Firestore Web SDK
  auto-converts a native JS `Date` (what `AuthContext.tsx`'s `user.createdAt` is,
  via `data.createdAt?.toDate() ?? new Date()`) to a `Timestamp` at write time,
  before the rule ever evaluates it. **General check for future reviews: when
  adding an `is timestamp` bind to a field a client currently populates from a
  `Date`-typed app value (not a raw Firestore Timestamp object), confirm via the
  SDK's documented Date→Timestamp auto-conversion (or a live emulator test using
  the same value shape the real call site sends, not just `serverTimestamp()`)
  rather than assuming a JS Date fails the check** — it doesn't, but the two look
  different enough in code that it's a natural place to over-flag a false positive.
- **A new dedicated live-emulator seed+assert pair** in `account-deletion.test.ts`
  for a top-level (non-subcollection) GDPR-cascaded doc — exactly the gap class
  flagged in the 2026-07-15 (below) entry's point about `publicProfiles/{uid}` —
  is the correct closing move and was verified by an independent `npm run
  test:rules` run (173/173), not by reading the test file alone.

**New pattern worth flagging in any future notes/tags-style migration:** when a
mutator (`addItem`) strips a retired inline field via object destructuring before
a non-merge `setDoc` (full doc overwrite), the strip is airtight against
*re-leaking* the field onto the public doc, but a **full overwrite silently
drops any legacy value of that field that hadn't yet been migrated to its new
home** — this is a data-loss race (mount-timing dependent: does the eager
migration effect run before or after the next re-mark?), not a security
exposure (fails closed). Worth naming explicitly as "closes the leak, may lose
un-migrated data on a race" rather than treating a stripped-field mutator as a
strictly safe no-op change.

### 2026-07-15 — BIN-505: whole-doc-read leak fixed via positive-whitelist projection doc + live get()-gated visibility — APPROVED WITH NOTES, new reusable pattern

Reviewed the fix for a real, live PII leak: `users/{uid}` (email, hemkommun,
providerCosts/Campaigns, ...) was readable by any unauthenticated caller when
`isPublic`/`defaultVisibility=='public'`, and by any confirmed friend regardless of
tier — because Firestore reads are whole-doc and rules can't field-filter, so the
app's client-side redaction never protected a raw SDK/REST read. Root cause class:
**a deny-list redaction pattern on a document with no `hasOnly` write-whitelist will
always eventually leak a new field** (this doc had accreted `hemkommun`,
`providerCampaigns`, `notificationSettings`, etc. that the client blank-list never
caught). The fix pattern, confirmed sound and worth reusing whenever a doc mixing
private + display fields needs a public/friend read surface:
1. **Lock the source doc to owner-only read** (`allow read: if isOwner(uid)`), keep
   sensitive fields in place (no field-move needed).
2. **New top-level positive-whitelist projection doc** (`publicProfiles/{uid}`) —
   `isValidX` uses `hasOnly([...display fields only...])` PLUS a value-bound check
   per field (length caps, format regex) — a `hasOnly` alone only bounds the key
   set, never the value, so a missing per-field bound (here: `createdAt`/`updatedAt`
   have no type-bind) still lets a client write junk into those two keys; low
   severity here since they're cosmetic-only and the reader (`toDate()`) fails safe
   to `new Date()` rather than throwing, but flag it in any similar future review.
3. **Visibility gated LIVE via a privileged `get()` on the SOURCE doc inside the
   projection's own read rule** (`get(users/{uid}).data.get('isPublic',...)` etc.,
   OR an `exists()` friend check) rather than mirroring a visibility field onto the
   projection itself — this closes the classic "stale-public window" (flip private →
   an already-public projection doc keeps serving until some resync job catches up)
   with ZERO extra write-path complexity: there is no visibility field to keep in
   sync, so there's no window at all. Confirmed via a dedicated rules test that
   toggles the source private mid-test and asserts an immediate deny on the SAME
   already-existing projection doc (no re-write happened between the toggle and the
   assert) — this is the right test shape to demand for any "live-gated" claim,
   don't just trust the rule reads correctly.
4. **Guard the friend-branch `exists()` call with `isSignedIn() &&`** so an
   anonymous caller's `request.auth.uid` is never dereferenced — Firestore rules
   fail-closed on an evaluation error either way, but the explicit guard is cheap
   defense-in-depth and matches the established codebase idiom.
5. **Audit EVERY client call site that reads a FOREIGN `users/{uid}`** before
   locking the read rule — this diff correctly found and migrated ~9 sites
   (feed, grupper invites, TopbarActions, FriendsPageClient, ListPageClient,
   useFollowList, useFriendsWhoSaw, friends.ts, userSearch.ts, username.ts,
   usePublicProfile.ts) to the new projection module; two of the nine had
   UNGUARDED `Promise.all` calls that would have hard-crashed `/feed` and the
   friends list the instant the rules deploy landed, before any client-side fix
   shipped. **Grep for `doc(db, 'users', <non-literal-uid-var>)` and
   `collection(db,'users')`-adjacent foreign reads as a mandatory step whenever a
   `users/{uid}` (or any other public-read collection) read rule is being
   tightened** — a rules-only tightening with no client migration is a guaranteed
   outage, not just a latent one.

**Sibling pattern, same review: legacy-field-migration one-way-ratchet on a
STILL-public doc.** `watchlist.notes` (free text, third-party-PII risk, same
reasoning as BIN-164 tags) moved to an owner-only `watchlistNotes` subcollection,
but the `notes` KEY had to stay in the watchlist doc's `hasOnly` whitelist
permanently (a legacy doc's ordinary edit — rating change etc. — is a merge-write
evaluated against the WHOLE post-merge doc, so dropping the key from `hasOnly`
would `permission-denied` every future edit on any un-migrated doc). The rule
closes the actual leak with a narrower, cheaper guard: `create` requires
`notes` absent-or-null; `update` requires `notes` absent-or-null OR **unchanged
from `resource.data.get('notes', null)`** — i.e. any write that doesn't touch
`notes` passes untouched, but a write that tries to introduce a NEW or CHANGED
non-null note (e.g. a stale cached client bundle re-running the old
`setDoc({notes,...})` call) is denied. **General pattern for "retire a field but
can't drop it from hasOnly": don't just null-guard `create`; the `update` guard
needs the three-way OR (absent / null / unchanged-from-stored) or a legitimate
unrelated edit on a pre-migration doc breaks.** Verified via a dedicated test:
an unrelated `{rating, updatedAt}` merge-write on a doc that still carries a
legacy `notes` value succeeds (proves the ratchet doesn't collateral-damage
ordinary edits), while re-introducing a *different* note value on the same doc
fails and clearing it via `deleteField()` succeeds.

**GDPR wiring for a NEW TOP-LEVEL (non-subcollection) uid-keyed doc:** confirmed
`publicProfiles/{uid}` was wired into BOTH `collectUserDataSnapshots` (added
`publicProfileSnap` alongside the existing `profileSnap`) AND
`collectDeletionRefs` (`refs.push(snaps.publicProfileSnap.ref)`) by hand — it
can't ride `KNOWN_USER_SUBCOLLECTIONS` (that array/guard only enumerates
`users/{uid}/<sub>` paths) so there is no compile-time test that would catch a
forgotten top-level collection the way `userData.subcollections.test.ts` catches
a forgotten `users/{uid}/<sub>`. **Gap found: no dedicated LIVE-emulator test in
`account-deletion.test.ts` seeds a `publicProfiles/{uid}` doc and asserts it's
gone after `applyDeletionPlan` runs** — the only proof is (a) a manual code read
of the `refs.push` line and (b) a mocked-snapshot unit test in
`dataExport.coverage.test.ts` that only proves the export/delete-cascade
*wiring* exists structurally, not that the live rules+emulator actually delete
the doc end-to-end. `watchlistNotes` (a real subcollection) DOES get this live
proof for free via the existing `KNOWN_USER_SUBCOLLECTIONS` loop in
`account-deletion.test.ts`. **General check for future reviews: any new
top-level (non-subcollection) GDPR-cascaded collection needs its OWN seeded
live-emulator assertion in the account-deletion test — the subcollection-array
loop that covers everything else silently does NOT extend to it, and a mocked
unit test is not an equivalent substitute** (mirrors the existing "GDPR coverage
for new collections" distilled principle above, but specifically flags that the
*live cascade-delete* proof, not just the *export-field* proof, needs its own
seed+assert for anything outside the subcollection array).

**Non-security process deviation worth surfacing to the parent agent even though
outside strict security scope:** the plan (`tasks/bin-505-plan.md`) recorded a
BINDING DBA acceptance criterion — "notes read via LAZY `getDoc` when the note
editor opens ... NO third full-collection `onSnapshot`" — but the shipped
`WatchlistContext.tsx` adds exactly that: an always-on
`onSnapshot(collection(...,'watchlistNotes'))` for every signed-in user
regardless of whether any note editor is open. Not a security hole (still
owner-only read), but a binding, written, panel-derived cost condition was
silently not honored. Flag deviations from a project's OWN written binding
conditions even when they're cost/DBA rather than security-labeled — a
security reviewer is often the last full-diff read before commit and the
one place this kind of drift gets caught.

**Also found: `useFollowList.ts`'s BIN-505 migration collapses two previously-
distinguished cache states ("profile doc missing" vs "profile read denied") into
one `'ghost'` value**, because `getPublicProfileCard` swallows BOTH
`!snap.exists()` and a caught permission-error into a single `null` return. The
hook's own `FollowProfile` type documentation (unchanged in this diff) still
says `null` means "private / fetch errored → show fallback row" and `'ghost'`
means "deleted account → drop the row" — the new call site directly
contradicts its sibling type's documented contract by mapping BOTH cases to
`'ghost'`. Net effect: a followed user who is private (and not your friend)
now silently vanishes from your Följer-list instead of rendering as "Privat
användare". Fails closed (no data exposure), so not a security defect, but is
exactly the class of bug the existing "ghost-vs-private" distilled principle
(archived 2026-06-14 batch, BIN-21) warns about — re-verify this specific
collapse is intentional product behavior, not an oversight, whenever a shared
helper (`getPublicProfileCard`) is reused across call sites that used to
maintain a three-way distinction (exists-and-readable / exists-but-denied /
truly-gone) with only a two-way return type.

Verdict: **APPROVED WITH NOTES.** All rules reasoning, GDPR export+delete wiring
for the code paths I could directly verify, and 173/173 live rules-emulator
tests confirmed independently (ran `npm run test:rules` myself, not just taken
on the ticket's claim). No blocking security finding. Five non-blocking items
recorded above for follow-up.

### 2026-07-12 — BIN-185 recap story-so-far redesign (season docs + textFull): APPROVED, both conditions met

Reviewed the redesign adding `recaps/{tmdbId}_season_{n}` (whole-completed-season doc) + a
`textFull` field on boundary docs, plus `useSeasonRecaps`/RecapPanel "Visa tidigare säsonger".
The two panel-imposed conditions both hold:
- **Cond 1 (prior-seasons cap from the same boundary, test-locked):** the implementation derives
  `priorSeasons` from `coveredBoundary` (the id-derived, ≤-boundary value `useRecap` returns), NOT
  the raw `boundary` prop. This is a DEVIATION-FOR-THE-BETTER, not a violation: `coveredBoundary ≤
  boundary` is test-locked (`coverage.test.ts:56` "NEVER returns a boundary past the user
  boundary"), so `priorSeasonNumbers(coveredBoundary) ⊆ priorSeasonNumbers(boundary) ⊆ {seasons the
  user has fully watched}`. On a fallback hit raw `boundary.season` could offer a season doc the
  cached recap itself hasn't reached; `coveredBoundary` is the coherent stricter choice.
  `priorSeasonNumbers` is directly test-locked (never own season, never future, derived from
  season-only). General note: when an impl derives a disclosure cap from a *tighter* already-proven-
  bounded value than the condition's literal wording named, that SATISFIES the condition — verify
  the substitute is provably ≤ the named bound (here via an existing test), don't flag it as drift.
- **Cond 2 (season doc refused without full boundary coverage):** `missingEpisodesForSeason(covered,
  season, episodeCount)` checks episodes `1..episodeCount` are all in the covered key-set, sourced
  from the merged index built THIS run (`coveredByShow`) or, for a show with no boundaries in this
  batch, a fallback read of the persisted `{tmdbId}_index` doc. Season loop runs AFTER the index
  update so same-run boundaries count. Written once; `--force` to overwrite; `--index-only` never
  writes season/recap docs. Correct.

Independent pass all clean: (1) `recaps/{recapId}` single-segment wildcard (`read:if true;
write:if false`) already covers the new `_season_n` ids and `textFull`-bearing docs — no rules
change staged or needed, Admin-SDK writes bypass. (2) `textFull` + season `text` are re-validated on
READ via the shared `validateRecapText` (4000-char cap, HTML/URL/markdown/injection guards) and
rendered plain-text (`whitespace-pre-line`, never dangerouslySetInnerHTML); write side mirrors via
`invalidCommonReason`→`invalidTextReason`, reused by BOTH boundary and season entries. (3)
Attribution enforced both sides: script requires non-empty sources + http(s) url + `^CC BY-SA`
license per source; client filters `sources.length>0` and emits hrefs only via `safeHref`
(http(s)-only, `rel=noopener`). (4) No PII/uid — stays correctly outside `collectUserDataSnapshots`;
`data-retention-policy.md` updated to document the two new shapes as non-personal. (5) Cost:
`useSeasonRecaps` gated on `openSeasons` (lazy, no default-view reads), never persisted, 1h stale,
direct doc gets only (no `.where()` — DBA condition intact).

**Two LOW notes (non-blocking):** (a) the RecapPanel WIRING itself (that it passes `coveredBoundary`
not raw `boundary`, and gates the season fetch on `openSeasons`) has no component test — safety
rests on the one-line derivation + the pure-function tests; a single RecapPanel test asserting
`priorSeasons.every(s => s < coveredBoundary.season)` would lock the wiring. (b) Cond-2 completeness
keys off operator-supplied `episodeCount`; under-reporting it lets a partial season pass the guard —
but the operator IS the trusted local Admin-SDK writer, so this is a data-quality caveat, not a
client trust boundary.

### 2026-07-12 — BIN-185 recap fallback: spoiler-invariant via monotonic-decreasing cursor (APPROVED, no regression)

Re-reviewed the post-fix delta on the pre-approved recap fallback (useRecap walk-back +
coverage.ts + recap-upload.mjs index try/catch). The one property that mattered — "no
fetched recap can ever be past the user's boundary" (spoiler leak = the real trust boundary
here, not auth) — holds by a clean inductive argument worth recording as a review method:
`nearestCoveredBoundary(covered, cursor)` never returns a ref past `cursor`; the loop seeds
`cursor = boundary` then only ever moves it STRICTLY EARLIER (`episode-1`, or
`season-1`/MAX_SAFE_INTEGER when episode≤1). So every target ≤ cursor ≤ boundary at all
steps → every fetched doc-id is ≤ the user's watched frontier. The `season-1/MAXINT` branch
is safe because season is compared first and strictly decremented, so MAXINT episode can't
escape into a higher season. The UI surfaces `coveredBoundary` (the id-derived, ≤-boundary
value) not the doc's self-reported season/episode, so even a mismatched stored doc can't
render a later label. Read cost hard-bounded (1 index get + ≤3 recap gets). **General check
for any "fall back to nearest earlier X" loop guarding a disclosure boundary: prove the
cursor is monotonic-decreasing AND that the selector never overshoots the cursor — both, or
a single overshoot re-opens the leak.**

Non-findings confirmed: (1) recap-upload.mjs recovery-command `console.error` interpolates
operator-provided `inputPath` but only PRINTS it (no exec/shell) in a local Admin-SDK script
gated on GOOGLE_APPLICATION_CREDENTIALS — echoing back the arg the operator just typed is not
an injection vector. No new write path (index-only writes just the index doc). (2) The
`{tmdbId}_index` doc rides the existing `recaps/{recapId}` rule (`read: if true; write: if
false`) — non-PII (tmdbId + boundary keys), Admin-SDK-written; no rules change staged or
needed, not a GDPR surface. (3) coverage.ts `season<1||episode<1` reject is tightening only
(drops specials/junk from ever being a fallback target).

### 2026-07-11 — BIN-480: joinAttempts createdAt fix verified (closes prior MEDIUM)

Follow-up review of the fix for the MEDIUM finding filed in the BIN-476 entry below.
`firestore.rules` joinAttempts create rule now adds
`request.resource.data.createdAt is timestamp && request.resource.data.createdAt ==
request.time`, mirroring the household `updatedAt` idiom. Confirmed this closes both the
type-forgery AND the presence sub-gaps (accessing an unset field and calling `is timestamp`
on it evaluates false, not vacuously true — so `hasOnly` alone no longer being the sole
presence gate is fully resolved, not just narrowed). Verified against the actual client
call site (not just the rule text) that the legitimate write path already sends
`serverTimestamp()` so nothing breaks. Ran `npm run test:rules` end-to-end against the real
emulator (not just static reading) — 150/150 pass including the two new tests. This is the
first review in this file where a filed MEDIUM was re-verified closed via live emulator run
rather than static rule inspection alone — worth doing whenever feasible, since a rules
change that "reads correct" can still fail to compile/typecheck in the actual rules engine
(e.g. a stray operator precedence issue) and a static read wouldn't catch that.

**Process note for future reviews:** when a review scope is narrowly "just the fix for
ticket X," still spend one grep checking whether the *sibling* gap noted in the same prior
entry (here: `sessions` create rule, same missing-createdAt-enforcement shape) was also
addressed. It wasn't (intentionally, per the original entry's own priority call) — that's
fine, but re-confirm the reasoning still holds rather than silently carrying it forward
unexamined forever.

### 2026-07-11 — BIN-476: retentionCleanup full review — "undateable = kept forever" is only safe if the CREATE rule enforces the date field, not just the reaper's own restraint

Reviewed `functions/src/retentionCleanup/{index,logic,logic.test}.ts` in full (closing the
BIN-472 scope gap — prior marker explicitly excluded this directory). Collection-group name
uniqueness confirmed clean (`notified`/`joinAttempts`/`notifications` each resolve to exactly
one logical path; grepped functions/src, src/, firestore.rules, firestore.indexes.json — no
cross-boundary over-deletion risk). `tsToMillis` duck-typing is unforgeable by a client write
(Firestore has no function-valued field type, so a fake `{toMillis: () => ...}` object can
never be persisted) — that class of attack is structurally closed, not just defended.

**New issue class found:** every predicate in this file has a documented "conservative
stance" — an undateable doc (no createdAt/updatedAt) is NEVER reaped, by design, so a
legitimately-in-flight doc missing its timestamp for some transient reason is never
wrongly deleted. This is correct reasoning IF AND ONLY IF the doc's create rule makes the
date field structurally mandatory. Checked each of the four swept collections against
their firestore.rules create rule and found ONE gap: `joinAttempts`'s create rule uses
`hasOnly(['token','createdAt'])` — which restricts to a KEY SUBSET, it does not require
presence of either key, and has no `is timestamp` type-bind on `createdAt`. A client can
`setDoc` a joinAttempts doc with only `{token: '...'}`, permanently skipping the reaper's
30-day-headroom logic — undermining the doc's own comment claiming this sweep is "the
permanent erasure backstop... regardless of how the account was deleted" for exactly the
Console-deleted-account case it names. The shipped client code (groups.ts) always sets
createdAt today, so this isn't live-exploited, but the rule itself doesn't enforce it.

**Generalizable check for future reviews of any "keep undateable docs forever" reaper
predicate:** don't just verify the predicate's own boundary logic (that part is usually
correct and well-tested) — separately open the firestore.rules create rule for the SAME
collection and confirm the date field the predicate keys on is BOTH in a `hasOnly` (or
`hasAll`) requirement AND type/value-pinned (`is timestamp`, ideally `== request.time` to
also block backdating). `hasOnly` alone only bounds the key superset, never requires
presence — a classic "looks whitelisted, isn't mandatory" gap. This is a variant of the
2026-06-20 Timestamp-vs-number-NaN entry but at the RULES layer instead of the read-path
layer: the read-side duck-typing (`tsToMillis`) was already hardened against forgery, but
the write-side rule was not hardened against omission. Both layers need checking
independently — one closing doesn't imply the other does.

Fix pattern (not yet applied — filed as a follow-up, not blocking this commit since no
firestore.rules changes are in this diff): mirror the existing `updatedAt == request.time`
pin already used elsewhere in firestore.rules (line ~975) — add
`&& request.resource.data.createdAt is timestamp && request.resource.data.createdAt == request.time`
to the joinAttempts create rule. Lower-priority analog: `sessions`' create rule has the
same gap (no expiresAt/createdAt enforcement), but sessions aren't billed as a sole-erasure-
path collection (host can self-delete anytime, public-read, lower sensitivity) so it's
noted but not filed with the same urgency.

Verdict: APPROVED WITH ONE MEDIUM FINDING (see above). All other checks (batch sizing,
per-scan/per-batch failure isolation, pagination bounds, GDPR export exclusion of
admin-only operational collections, secret handling) confirmed clean.

### 2026-07-11 — BIN-472 releaseAction seed-guard: correct impl, but review-scope note

Reviewed `functions/src/releaseNotify/logic.ts` (`releaseAction`), its test file, and
the `availableNotify/index.ts` wiring (`legacyReleaseCardExists` + the skip/seed/push
branch). Logic is correct and matches the ticket spec exactly: `hasLegacyCard` is only
read when `notifiedDate === null` (steady-state pays no extra read), an existing older
marker always re-arms regardless of card presence (verified via the dedicated
`releaseAction('2026-07-11','2026-07-18', true) → 'push'` test — this is the one case
that would reveal a card-overrides-marker bug, and it's correctly covered). No rules
change, no new subcollection, no secret exposure. Approved.

**Naming nuance worth flagging in review (not a bug):** the docstring/comments call this
a "deploy-day guard," but the code actually runs on EVERY future occurrence of
"no marker yet in the fire window" — not just the literal BIN-464 cutover moment. This
matches the ticket's own wording ("on first encounter with no marker for a (tmdbId, uid)
inside the fire window") so it's intentional, not an oversight, but a future reader could
wrongly assume this is removable after the migration window passes. Worth a one-line
note in the docstring if touched again: this is a permanent first-encounter safety net,
not a time-boxed migration shim.

**Scope-boundary flag:** BIN-472's own ticket text (tasks/todo.md) lists acceptance
criterion #4 as "the staged diff carries a fresh binge-security-reviewer marker covering
BOTH retentionCleanup and this change (closes the ticket's gap #1 — the sweep's security
review that never happened)." The review invocation that produced this entry was scoped
by the orchestrator to exactly 3 files (`releaseNotify/logic.ts`, `logic.test.ts`,
`availableNotify/index.ts`) and did NOT include `functions/src/retentionCleanup/**`.
That AC is therefore NOT yet satisfied by this pass — flag this gap explicitly in the
review output rather than silently passing the ticket. General rule: when a ticket's own
acceptance criteria name a specific file/directory for security review, cross-check the
review invocation's actual scope against that before calling the AC met.

### 2026-07-10 — BIN-402 tmdbTosSweep: Admin-SDK-only sweep is CLEAN, but an ADR-committed rules whitelist entry was never shipped — new check for "plan says add to hasOnly()" items

`functions/src/tmdbTosSweep/{index,logic}.ts` (monthly `onSchedule`, clears
stale TMDB-derived fields off `users/{uid}/watchlist/{tmdbId}` per TMDB ToS
§1.C). Core safety properties all verified CLEAN and matching the approved
ADR 0009 + plan's binding acceptance criteria exactly:
- Hard field-allowlist (`buildClearedPayload`) + `logic.test.ts` asserting the
  update payload's key-set is EXACTLY `TMDB_DERIVED_FIELDS ∪
  {tmdbFieldsRefreshedAt}`, disjoint from `FORBIDDEN_FIELDS`, and — the
  specifically load-bearing one — never includes `updatedAt` (protects
  `continueWatching` sort; a silent bump would be an undetectable
  data-accuracy regression). This is a REGRESSION TEST, not just a comment —
  matches the plan's explicit "not just a comment" requirement.
- Dry-run-by-default gate (`sweepState/tmdbFieldsSweep.mutateEnabled ===
  true`, Console-only flip) — no writes possible until Malin reviews counts.
- Audit-trail write every run (`lastRun: {at, dryRun, docsScanned,
  docsCleared, docsWouldClear, docsSkipped, budgetAbort, fullPassCompleted}`)
  — satisfies Legal's "evidence the control runs monthly" hard requirement.
- `sweepState/tmdbFieldsSweep` is a new top-level collection with no uid/PII
  (cursor + audit record only) — correctly has NO `firestore.rules` block
  (confirmed no top-level wildcard `match /{document=**}` exists that would
  expose it — default-deny applies) and correctly NOT added to
  `collectUserDataSnapshots` — same accepted pattern as `motnBudget`/
  `askBingeBudget`.
- `watchlist` itself is NOT a new subcollection — no GDPR export/delete gap;
  clearing fields never deletes the doc.
- All writes are Admin SDK (`db.batch().update(...)`), which bypasses
  Firestore rules entirely — so v1 has NO live rules dependency and no
  rules-deploy is required to ship this diff.

**New finding class — a plan/ADR "add field X to firestore.rules hasOnly()"
consequence was not actually shipped in the same diff.** ADR 0009's
Consequences section states verbatim: "New `tmdbFieldsRefreshedAt` doc stamp
...; added to `firestore.rules` `hasOnly()` whitelist." The approved plan's
Kärnbeslut #2 is more precise about WHY: "so a future *client* refresh
button doesn't silently permission-denied" (Admin SDK bypasses rules; the
whitelist is for a FUTURE client write path, not this one). I confirmed by
reading `firestore.rules` `isValidWatchlistItem` (lines 92–131): the
`hasOnly([...])` array does NOT include `tmdbFieldsRefreshedAt`, and there is
no accompanying `!('tmdbFieldsRefreshedAt' in d) || d.tmdbFieldsRefreshedAt
is timestamp` type-bind either (the pattern used for `ratedAt`/
`nextAirUpdatedAt`). This is not a live bug for the current diff (nothing
client-side writes this field yet), but it is EXACTLY the bug class that has
bitten this codebase twice before (BIN-93 `runtime`, BIN-349 `ratedAt` — both
documented inline in firestore.rules as "utan denna nekades
merge-skrivningen... av hasOnly → permission-denied på varje..."): the
moment a future PR adds a client-side lazy-refresh write that includes
`tmdbFieldsRefreshedAt` in its merge payload, `hasOnly()` will reject the
ENTIRE write (not just drop the unrecognized key), throwing
permission-denied on every title-page view that tries to refresh. **Check to
add to future reviews:** when a plan/ADR's "Consequences"/"Kärnbeslut"
section says a new field will be added to a `hasOnly()` whitelist, verify
`firestore.rules` was actually touched in the diff — an Admin-SDK-only v1
can genuinely defer this (no live break), but flag it explicitly as an
outstanding commitment so it isn't silently forgotten before the next PR
that adds the corresponding client write path.

**Low/Info, accepted precedent:** `collectionGroup('watchlist').orderBy(FieldPath.documentId())`
has no explicit `COLLECTION_GROUP` `__name__` index entry in
`firestore.indexes.json` — same standing gap as the `notifications`/
`joinAttempts`/`likes` sweeps (2026-06-20/06-29/06-30 entries above), which
are reported to work in production without one. Not a new risk class; if
this sweep ever errors with "index required" on its first dry run, add
`{ "collectionGroup": "watchlist", "queryScope": "COLLECTION_GROUP", "fields": [{ "fieldPath": "__name__", "order": "ASCENDING" }] }`.

**Low/Info, cost-comment inconsistency (non-blocking):** the module doc's own
cost narrative anchors on "~50k docs" as the free-tier-aligned example, but
`MAX_DOCS_PER_RUN = 100_000` is 2x the daily free-tier read quota (50k
reads/day) — hitting the cap in one invocation would incur a small billed
overage (~$0.018 for 50k excess reads at $0.036/100k), trivial against the 25
SEK/mo cap but not literally "sub-cent" as framed. Non-blocking; the
dry-run-first gate is the actual safety net regardless of this constant's
exact value.

**Verdict: APPROVED-WITH-NOTES.** No blocking findings for this diff (Admin
SDK bypasses rules; no GDPR gap; hard allowlist + audit trail + dry-run gate
all correctly implemented and tested). One MEDIUM-flavored completeness gap
(rules whitelist commitment unshipped) tracked for the next PR that adds a
client write path for this field.

### 2026-07-11 — BIN-360 "släpps idag" push: consent/rules/GDPR all CLEAN, but a new issue class — unhandled exception mid-loop silently discards an ALREADY-BUILT accumulator, not just the failing item

`functions/src/availableNotify/index.ts` `runReleasePhase` (new, BIN-360) builds
a `Set<string>` (`skip`, the release-phase-owns-today keys `${uid}:${tmdbId}`)
incrementally across a `for (const [tmdbId, {title, uids}] of byMovie)` loop,
and `return skip;` only at the very end. Only the `fetchReleaseDates(tmdbId)`
call (lines 163-164) is wrapped in its own try/catch; everything after it for
that same tmdbId — `stateRef.get()`, the per-uid inbox-write + `sendPushToUser`
sub-loop, and `stateRef.set()` (lines 170-193) — is NOT. Firestore calls and
`sendPushToUser`'s `messaging.sendEach()` (push.ts, also unguarded) can throw.
If ANY of these throws while processing movie N of M, the exception propagates
out of the *entire* `runReleasePhase` async function — not just out of movie
N's iteration. Two consequences, both hitting the exact safety property this
feature is built around ("exactly one push"):

1. **Silent, permanent miss for movies N+1..M this run.** `releasesDigitallyToday`
   is an exact calendar-day match (`today`), not `<=`. A movie that never got
   checked this run because an earlier movie's push threw will be checked
   again tomorrow against *tomorrow's* date — its release-day match is gone
   forever. No retry, no backstop; the push for that title's owners never fires.
2. **Discarded already-earned dedup for movies 1..N-1.** Even though movies
   processed *before* the failure already had their Firestore state fully
   committed (marker `stateRef.set()`, inbox docs, pushes all persisted) — the
   in-memory `skip` Set built for them is thrown away, because `return skip`
   is never reached and the caller's `releaseSkip = await runReleasePhase(...)`
   assignment never executes (stays at its outer-scope initializer, `new
   Set()`). Phase 2 (availability) then runs with an EMPTY skip set for this
   entire invocation. Any of those already-release-pushed users whose movie
   *also* gained a newly-tracked flatrate provider the same day gets a SECOND,
   redundant push same day ("Nu på din X" on top of "Släpps idag") — the exact
   double-push the skip-set exists to prevent.

Contrast with the codebase's own established isolation pattern one function
below in the same file: phase 2's per-title loop wraps each `processTitle`
call individually — `try { totalNotified += await processTitle(...) } catch
(err) { logger.error(...) }` — so one title's failure cannot touch any other
title. `runReleasePhase`'s per-movie block does not have the equivalent
isolation; only the TMDB fetch sub-step does.

**Generalizable check for future reviews:** whenever a loop accumulates into
a shared result (`Set`/`Map`/array) across N independent units of work and
returns it only at the end, ask whether a thrown exception from unit K
(a) aborts remaining units K+1..N (may be an acceptable/logged partial-miss
depending on whether the work is retriable next cycle) AND (b) discards the
accumulator's contents for the ALREADY-completed units 1..K-1 whose side
effects (Firestore writes, sends) already landed. (b) is the more dangerous
failure mode — it turns a single transient error into inconsistent state
between what was actually done and what the caller believes was done. Fix
pattern: wrap each unit's full body (not just its first async call) in its
own try/catch-and-continue, exactly mirroring the phase-2 per-title isolation
already present in the same file — this preserves both forward progress
(remaining movies still get checked this run) and the accumulator's earned
entries for movies already processed.

**Everything else confirmed CLEAN for BIN-360:**
- **Consent gate**: `readUserData(uid).settings.pushEnabled` (defaults to
  `false`, must opt in) gates both the inbox-doc write and the `sendPushToUser`
  call inside `runReleasePhase`; `sendPushToUser`'s own `prefetched.pushEnabled`
  is the *same* freshly-read value passed straight through (not a stale or
  attacker-influenced flag) — no path reaches a push without a genuine current
  `pushEnabled === true` read. Matches the existing BIN-33 prefetch-optimization
  precedent.
- **No rules change needed/no rules change present**: all writes (`digitalReleaseState/{tmdbId}`,
  `users/{uid}/notifications/{tmdbId}-release`) are Admin SDK (bypasses rules).
  `digitalReleaseState` is a new top-level, non-uid-keyed, no-PII collection with
  no rules block — default-deny applies (same accepted pattern as `motnBudget`/
  `availableNotifyState`). `users/{uid}/notifications/{notifId}` rule
  (`allow read, write: if isOwner(uid)`) has no `hasOnly` whitelist, so the new
  `kind: 'digital_release'` shape (omitting `providerId`/`providerName`/
  `episodeCode`) is accepted without a rules edit — client already reads with
  `?? null` fallbacks.
- **No cross-user leak**: `byMovie` groups owner uids per tmdbId only to loop
  and write EACH owner's own inbox doc / push under their own uid; the push
  body carries only the film title (public TMDB data) + tmdbId. `skipKey`
  (`${uid}:${tmdbId}`) cannot collide across users — Firebase Auth uids never
  contain `:`, so no delimiter-injection ambiguity in the key space.
- **No doc-id collision**: `${tmdbId}-release` (movie) vs. availability's
  `${tmdbId}-${providerId}` (providerId always numeric) vs. episodeNotify's
  `episode-${tmdbId}-${episodeId}` — three disjoint id shapes, verified by
  grep across all three call sites.
- **GDPR**: no new subcollection. The new doc rides the ALREADY-covered
  `users/{uid}/notifications` subcollection (`collectUserDataSnapshots`,
  `src/lib/firebase/userData.ts` line ~124/174) — a whole-collection
  `getDocs` picks up the new `kind` automatically. `digitalReleaseState` is
  server-only shared state keyed by tmdbId (not uid), same non-GDPR-surface
  precedent as `availableNotifyState`/`motnBudget`.
- **Secrets**: `functions/src/releaseNotify/tmdb.ts` mirrors
  `availableNotify/tmdb.ts` exactly — `TMDB_API_KEY` only in the URL query
  string (TMDB's own auth convention), never logged; failure logs only HTTP
  status code or the generic caught `err` object (same accepted pattern as
  every other TMDB fetch helper in this codebase).

**Verdict: APPROVED-WITH-NOTES.** No blocking trust-boundary/consent/rules/GDPR
finding. One MEDIUM reliability finding (exception-cascade breaks the
documented "exactly one push" invariant) — recommend fixing before/shortly
after ship by wrapping the per-movie block in `runReleasePhase` in its own
try/catch, mirroring phase 2's existing per-title isolation.

**Firestore batch atomicity preserved:** `resumeProvider`'s `writeBatch` (pauseHistory
create + providerPauses merge) is unchanged in structure — only the `monthlyCost` value
source changed (from raw `user?.providerCosts?.[id]` to
`resolveProviderMonthlyCost(...) ?? 0`), and that value is read synchronously from
in-memory `user` state before the batch is built, not from a fresh Firestore read — no
new race window introduced.

**Scope confirmed:** `providerCosts`/`providerTiers` have no dedicated `firestore.rules`
block (fall under the generic `users/{uid}` self-write rule with no field whitelist) —
no rules change needed, matches the pre-existing pattern for merge-write profile fields
(BIN-275/348 entry above). `pauseHistory` is the only subcollection touched by
`resumeProvider` and was already present in `collectUserDataSnapshots` before this diff
(pre-existing, unmodified) — no GDPR gap. A stale/inert `providerCosts[id]` value that a
tier-user's export might have shown before this diff simply no longer exists after the
lazy migration touches that provider — export honesty improves, doesn't regress.

### 2026-07-11 — BIN-402 relaunch: first whole-DB-blast-radius scheduled writer — dry-run gate + forged-future-timestamp defense pattern (APPROVED-WITH-NOTES)

New pattern class: a scheduled Cloud Function (`tmdbFieldsSweep`) that walks
EVERY user's `watchlist` subcollection via `collectionGroup` and mutates docs
(clears stale TMDB-derived fields for ToS §1.C compliance) — the first sweep in
this codebase with genuinely whole-DB blast radius (prior sweeps were narrow:
`joinAttempts`, `notifications`, `reportMeta` TTLs). Verified defense-in-depth,
all sound:

1. **Dry-run-by-default gate is a plain data field, not a deploy flag.**
   `sweepState/tmdbFieldsSweep.mutateEnabled === true` is the only thing that
   turns on writes; the doc has **no matching `firestore.rules` block at all**
   (confirmed via full `match /` grep — no wildcard catch-all exists in this
   rules file), so it is Firestore-default-denied to every client and can only
   be flipped from the Firebase Console (Admin SDK / human, not code). This
   matches the established `motnBudget`/`omdbBudget`/`askBingeBudget` "no rule
   block = safe" precedent (2026-06-29 entries above) — extending that pattern
   to a *mutate gate* rather than just a *budget counter* is new but the safety
   argument (no rule = no client path, full stop) is identical and still holds.
   No rules-test precedent exists for asserting default-deny on these
   no-rule-block collections anywhere in the suite — consistent with prior
   review practice, not a gap introduced here.
2. **Forged-future-timestamp defense on a freshness stamp that gates a DELETE
   sweep, not just an ORDER.** `tmdbFieldsRefreshedAt` needed a `hasOnly`
   whitelist entry (else the sweep's own Admin-SDK stamp-write would break
   every subsequent unrelated client merge-write on that doc — the general
   "merge-write validates the FULL post-merge doc" hazard already documented
   for `ratedAt`, 2026-07-02 entry). But unlike `ratedAt` (which only affects
   sort order — a forged value only cosmetically reorders recommendations),
   this stamp gates whether the sweep clears the doc's TMDB-derived fields at
   all. A plain type-bind (`is timestamp`) is insufficient: a client can
   construct an arbitrary in-range `Timestamp` including one in the FUTURE,
   and `serverTimestamp()` is just a sentinel the client controls the *timing*
   of, not a value the client is prevented from spoofing directly via a raw
   `Timestamp.fromMillis(futureMs)` merge-write. Adding `d.tmdbFieldsRefreshedAt
   <= request.time` closes this: an honest `serverTimestamp()` write resolves
   to exactly `request.time` (passes, `<=` not `<`), while any client-forged
   future value fails. **Generalizable rule: any client-writable timestamp
   field that a server-side process reads to decide "is this fresh, skip
   action X" (not just "sort by this") needs a `<= request.time` bind, not
   just a type bind** — a bare `is timestamp` check only blocks type-confusion
   junk, not a strategically-future-dated forgery that defeats the consuming
   process indefinitely. Confirmed a paired rules test exists for exactly this
   (`rejects a future-dated tmdbFieldsRefreshedAt`).
3. **Fresh-object payload, not merge/RMW, closes the field-allowlist gap for
   Admin SDK writes.** Admin SDK bypasses `firestore.rules` entirely — the
   `hasOnly` whitelist provides ZERO protection against the sweep function
   itself writing something it shouldn't. The real backstop is at the code
   layer: `buildClearedPayload` constructs the update payload as a **fresh
   object** built only from `TMDB_DERIVED_FIELDS` (never spreading/echoing the
   existing doc), and this exact invariant is unit-tested (key-set-equality +
   disjointness from `FORBIDDEN_FIELDS`, including the load-bearing
   `updatedAt` check). For any future Admin-SDK whole-DB writer: the
   client-side rules whitelist is irrelevant to what the *server* can write —
   verify the allowlist-and-test-lock lives in the function's own pure logic
   module, not just in `firestore.rules`.
4. **One-way-ratchet correctly documented at the point of highest future-editor
   risk.** The `hasOnly` entry's in-rule comment explicitly says never remove
   it while any prod doc carries the stamp (removing it would make the FIRST
   ordinary write to any stamped doc permission-denied, not just future sweep
   writes) and specifies the correct rollback order (client stamp-writer first,
   then the rules entry) — this is the right place for the constraint (a rules
   comment survives independent of any planning doc/ticket a future editor
   might not read) and it is honest about the ordering that actually matters.
5. **Lazy-refresh write is scoped to the caller's own library title, no new
   fetch.** `refreshTmdbFields` early-returns unless `items.find(i => i.tmdbId
   === tmdbId)` — i.e. no-ops for any title not already in the *current user's*
   library — and reuses whatever TMDB detail the title page already fetched
   (no new TMDB request, no new external surface). The Firestore write target
   `doc(db,'users',uid,'watchlist',tmdbId)` uses `uid` from the closed-over
   auth context, never from a parameter, so cross-user write is structurally
   impossible regardless of what `tmdbId` is passed. Never writes `updatedAt`
   (confirmed by reading the payload construction — the key is never touched).
6. **GDPR:** `tmdbFieldsRefreshedAt` rides the existing `watchlist` subcollection
   doc, which `collectUserDataSnapshots` already whole-snapshots with no field
   selection — automatically included in export/delete with no collector change
   needed (same "field on an already-covered doc" case as `ratedAt`, 2026-07-02
   entry).

**One LOW documentation-accuracy nit (non-blocking):** the sweep's own
docstring/comments describe the operation as "rensar (nullar)" (clears/nulls)
the fields, but the implementation uses `FieldValue.delete()` (removes the keys
entirely), not a null-set. No functional or security difference to any
consumer (both read as absent via the existing `?? undefined`/optional-chain
patterns throughout the codebase) — flagging only so a future reader doesn't
assume the swept doc retains null-valued keys.

**Verdict: APPROVED-WITH-NOTES.** No blocking findings. Design matches the
4-role panel's must-haves (dry-run default, hard allowlist, cursor+budget,
audit record, `<= request.time` hardening, one-way-ratchet documentation,
strict rules-before-function-before-client deploy order — all present and
test-locked).

### 2026-07-11 — BIN-463/464 release-notify: a THIRD collection shape slips through the "user-owned subcollection vs top-level admin doc" binary — new check to add

**New issue class.** The GDPR dual-flow checklist (CLAUDE.md, this file's seed
checklist) has always been framed as a binary: either a doc lives under
`users/{uid}/**` (→ must be added to `collectUserDataSnapshots`) or it's a
top-level, non-uid-keyed admin/state doc (→ correctly exempt, no rules block
needed, default-deny covers it — `motnBudget`/`askBingeBudget`/`sweepState`
precedent). BIN-464's own ticket acceptance criterion literally encoded this
binary: "if a user-owned subcollection is chosen... update
`collectUserDataSnapshots`; if a top-level admin doc is chosen instead, this
criterion is N/A."

The shipped design (`releaseNotifyState/{tmdbId}/notified/{uid}`) is a THIRD
shape neither horn of that binary anticipates: a per-user subcollection
**nested under a title-keyed (non-user) top-level doc**. The parent doc
(`releaseNotifyState/{tmdbId}`) genuinely IS a top-level admin/cache doc with
no uid — but the LEAF (`notified/{uid}`, doc-id == uid, content =
`{notifiedDate, updatedAt}`) is exactly the shape this codebase already has
an established precedent for treating as a GDPR surface: `reviews/{id}/likes/{uid}`,
`episodeReactions/{ep}/reactions/{uid}` — both required (a) a `uid` field on
the doc (not just doc-id) so a `collectionGroup` query can find "my docs
across every unrelated parent", and (b) a recursive-wildcard CG *read* rule
plus explicit CG wiring in `collectUserDataSnapshots`/`accountDeletion.ts`
(2026-06-30 BIN-347 Part 2 entry above). The `notified/{uid}` leaf has
NEITHER: no `uid` field (only doc-id), no CG rule (fine, Admin-SDK-only —
no client read), and critically **no CG sweep in `accountDeletion.ts`** —
so it survives account deletion forever. The in-code comment even frames
"non-deletable by the user via inbox-clearing" as the intended *feature*,
without separately addressing that account deletion (Art. 17) is a different,
mandatory erasure trigger the marker was never wired to.

Compare to the codebase's one existing *intentional* retention exception,
`reports/{reportId}`: that one has an explicit inline comment citing Art.
17(3), `allow delete: if false` in rules, and a doc in
`docs/data-retention-policy.md`. `releaseNotifyState/{tmdbId}/notified/{uid}`
has none of that scaffolding — it reads as an oversight, not a considered
retention decision, because the review binary the ticket used to gate the
decision doesn't have a branch for "hybrid: top-level parent, uid-keyed leaf."

**Generalizable check to add to future reviews:** whenever a new collection
is a nested subcollection under a *non-user* parent (title id, group id,
review id, etc.) AND the leaf doc-id or a leaf field is a `uid`, treat it as
a GDPR surface requiring the SAME wiring as `users/{uid}/**` subcollections —
regardless of whether the parent doc is "top-level admin state." The
relevant question is never "is the PARENT doc user-owned" but "does ANY doc
in the collection identify a specific user, directly or via doc-id." If yes:
either (a) add a `uid` field + CG sweep in the deletion cascade (mirrors
likes/comments/reactions), or (b) if retention is genuinely intended
(operational necessity, abuse-prevention, etc.), document it explicitly with
an Art. 17(3)-or-equivalent justification comment + a policy doc entry +
ideally a bounded TTL reaper (mirrors `joinAttempts`/`notifications` sweeps)
— never leave it silently uncovered by a ticket's binary decision framing.

**Also flagged (non-blocking, correctness not security): a one-time deploy-day
double-push risk.** Because the new dedup marker collection starts empty,
any movie whose SE digital release date falls within the last
`RELEASE_CATCHUP_GRACE_DAYS` (3 days) *before* this diff deploys will look
"not yet notified" to every existing bevakad owner on the first post-deploy
run — even though many already received the old inbox-existence-keyed
"släpps idag" push. Small, one-time, bounded blast radius; worth a deploy
note (seed/backfill markers, or accept and document) rather than discovering
it as a support ticket.

**Verdict on this diff: APPROVED-WITH-NOTES.** No client-reachable trust-
boundary break (Admin SDK only, no rules change needed for the write path
itself). One HIGH completeness gap (GDPR erasure wiring for the new
uid-keyed leaf) and one MEDIUM correctness note (deploy-day migration
window) recommended before/shortly after ship.

### 2026-07-11 — BIN-472: pre-deploy re-review of the retentionCleanup releaseNotifyState reaper — prior HIGH confirmed closed; MEDIUM confirmed real but non-blocking

Follow-up to the 2026-07-11T17:30:55Z review (marker line 4) that flagged a HIGH
GDPR Art.17 gap on `releaseNotifyState/{tmdbId}/notified/{uid}` (the BIN-464
per-user "släpps idag" dedup marker — uid-keyed, admin-only, no
`firestore.rules` match, unreachable by the client `deleteAccount` cascade).
Commit ddeac3e ships the closing fix as a NEW `retentionCleanup` reaper
(`collectStaleReleaseMarkers` in `functions/src/retentionCleanup/index.ts` +
`isStaleReleaseMarker`/`RELEASE_MARKER_MAX_AGE_MS` in `logic.ts`) rather than
wiring the collection into `collectUserDataSnapshots` — correct choice, because
that helper only auto-covers `users/{uid}/**`; a collection nested under
`releaseNotifyState/{tmdbId}` (title-keyed at the top level, not uid-keyed at
top level) was never going to be picked up there and doesn't belong there
structurally. This is the same "scheduled-reaper-as-sole-erasure-path" shape
as the already-approved `joinAttempts` sweep (BIN-329).

**Verification method for "does the age threshold match the marker's actual
semantics" (the generalizable check for any new TTL reaper):** read what the
marker's SOLE functional purpose is (here: suppress a duplicate push across the
`RELEASE_CATCHUP_GRACE_DAYS` = 3-day catch-up window) and confirm the reap TTL
is comfortably larger than the window during which the marker could still be
"live" (needed to prevent a real duplicate). 30 days vs. a 3-day functional
window is generous headroom — confirmed via the dedicated test
`'TTL comfortably exceeds the 3-day catch-up fire window so a live marker is
never reaped'` in `logic.test.ts`, which asserts `RELEASE_MARKER_MAX_AGE_MS >
graceWindowMs` as an invariant, not just a fixed-value check. This is a
reusable pattern: any new dedup/idempotency marker's reaper TTL should have a
test that asserts TTL > functional-window symbolically, not just a hardcoded
number match, so a future change to the functional window can't silently
create an over-eager reaper without failing a test.

**Cutover/migration-gap check for dedup-mechanism swaps (new lesson):** when a
scheduled function's dedup mechanism is swapped from mechanism A (e.g. "does
inbox doc X exist") to mechanism B (e.g. "does marker doc Y exist"), and B's
backing collection is BRAND NEW (starts empty), the first run post-deploy will
treat every record as "never notified" even for cases A already notified —
unless the code explicitly checks A as a fallback/seed before trusting B's
absence. This is NOT a security vulnerability (no unauthorized data access) but
IS a real product-facing regression: confirmed here as a genuine one-time
double-push (inbox card `read` flag reset to false + a repeat FCM push) for any
record whose event fell inside whatever catch-up window the new mechanism
honors, bounded to the first scheduled run after deploy. Blast radius is
naturally self-limiting (one run only; mechanism B is self-consistent
thereafter) — classify as MEDIUM/non-blocking UX finding, not a deploy blocker,
but ALWAYS name it explicitly and let the product owner decide whether to
accept it, time the deploy around it, or add a legacy-mechanism fallback read
for the first run. Check this pattern on every future dedup-key migration
(`${id}-suffix` inbox-doc-existence → dedicated marker collection, or similar).

**Collection-group name collision check:** before trusting a
`collectionGroup('notified')`-style sweep, grep the whole `functions/src` tree
for other writers/readers of a subcollection with the same leaf name — a
generic name (`notified`, `state`, `meta`) could accidentally alias an
unrelated feature's subcollection under collection-group semantics (Firestore
collection-group queries match by leaf collection ID regardless of parent
path). Confirmed `notified` is unique to this feature (only 2 files reference
it) before approving.

Verdict: DEPLOY WITH STATED CAVEAT.

### 2026-07-12 — BIN-468: per-group freshness stamps as sweep gates — the desync/forge-window checklist

BIN-402 Stage 2 split the monolithic TMDB-ToS sweep stamp into THREE per-group gates
(`tmdbFieldsRefreshedAt`/static, `providersCheckedAt`/providers, `nextAirUpdatedAt`/nextair).
When a stamp becomes a sweep-TRUSTED freshness gate, the review checklist is:

1. **Ratchet on every gate stamp.** Each must be `is timestamp && <= request.time` in
   firestore.rules (type-bind alone is NOT enough — a future value makes the sweep skip
   the group forever). BIN-468: `providersCheckedAt` had ZERO validation pre-change (only a
   hasOnly key), `nextAirUpdatedAt` had type-bind-only; both got the full ratchet. Confirmed
   the hasOnly key set was unchanged (both keys already whitelisted) and the conditional
   `!('x' in d) || d.x == null || (...)` shape means writes omitting the field still pass —
   no other watchlist write path breaks.

2. **Every honest writer must write a gate stamp with serverTimestamp() (== request.time),
   never a client Date.** A `<= request.time` ratchet REJECTS a client-clock-skew-ahead
   `Timestamp.now()`/`new Date()` write. Verified all three writers (addItem, flushNextAirWrites,
   planTmdbFieldsRefresh, buildBackfillUpdate) use the Firestore `serverTimestamp()` sentinel.

3. **The dangerous desync is stamp-FRESH + data-STALE (retained past 6mo), NOT the reverse.**
   Data-fresh + stamp-stale just gets cleared early (safe/conservative direction). The only
   honest paths that write a stamp WITHOUT rewriting the group's data are legitimate
   RE-ATTESTATIONS: nextAir A3 re-stamp (`delta: {}`) fires only when the stored data was
   just recomputed from live TMDB and found unchanged; buildBackfillUpdate always stamps
   `providersCheckedAt` but only after `extractSEProviders(freshDetail)` matched the stored
   list. Both re-verify against a live TMDB fetch before re-stamping — honest, not a blind
   re-cert. **New generalizable check: for any "re-stamp without rewriting data" path, confirm
   the data was re-verified against the authoritative source in the SAME call; a blind
   re-stamp would be a real ToS/freshness forge on the honest path.**

4. **Residual (LOW, accepted, same as Stage 1):** a user can DELIBERATELY forge their OWN
   doc's stamp (`setDoc({providersCheckedAt: serverTimestamp()}, {merge:true})` in a loop)
   to retain stale TMDB data on their own private watchlist doc past 6mo. Self-owned, harms
   nobody, not the sweep's threat model (honest-client compliance backstop). Consistent with
   the accepted Stage-1 tmdbFieldsRefreshedAt residual.

5. **Migration residual (LOW):** promoting a previously-unvalidated field (`providersCheckedAt`)
   to a `<= request.time` ratchet means any legacy doc that somehow holds a FUTURE value would
   fail ALL subsequent merge-writes (even an unrelated rating change) → the item becomes
   read-only until deleted+re-added. Bounded: serverTimestamp() never produces future values,
   so only a prior self-forge could trigger it (self-inflicted, recoverable). Note this class
   whenever a one-way ratchet is added to a field that previously had NO write validation.

6. **buildClearedPayload per-group scope.** Verified the Admin-SDK clear still uses a fixed
   allowlist (`buildClearedPayload(groups, delete)` iterates only the passed groups'
   fields ∪ {stamp}) — never a read-modify-write, never updatedAt/user-authored fields.
   Test-locked per-group (each group's key set asserted set-equal to `fields ∪ {stamp}`, and
   the all-groups payload asserted disjoint from FORBIDDEN_FIELDS). No new subcollection → no
   GDPR collector change; cleared fields legitimately export as null (documented).

Verdict: APPROVED, no BLOCK. Pure-logic tests 79/79 green. Did NOT run the rules-emulator
suite this pass (Java/emulator not set up in-session) — the two new rules tests (reject
non-timestamp + reject-future for providersCheckedAt, reject-future for nextAirUpdatedAt) were
read and match the ratchet, but per the 2026-07-11 lesson a live emulator run would be the
stronger proof; recommend the deploy operator confirm `npm run test:rules` green before the
hard-gated `firebase deploy --only firestore:rules`.

### 2026-07-12 — BIN-185 P3 recap upload tooling: gitignore glob leading-dash gap (new issue class)

New credential-hygiene class: a `.gitignore` backstop for a service-account key can *look*
protective yet fail to match the exact filename the runbook tells the operator to use.
Here `.gitignore` added `*-recaps-writer*.json`, but the RUNBOOK's step-4 recommended key
name is `recaps-writer.json` — no leading `-`, so the leading-`-` in the glob makes it NOT
match. Verified empirically with `git check-ignore`: `recaps-writer.json` → NOT-IGNORED,
`binge-recaps-writer.json` → IGNORED. Fix: drop the leading dash (`*recaps-writer*.json`).
Also default GCP-console key download names (`{project}-{hash}.json`, e.g.
`binge-nu-1a2b3c4d.json`) match NONE of the `*service-account*`/`*serviceaccount*` patterns —
those strings don't appear in a real downloaded key name. **Generalizable check:** whenever a
diff adds a gitignore pattern to protect a secret, run `git check-ignore` against (a) the
literal filename the runbook/docs instruct the operator to create, and (b) the tool's default
download filename — a glob that "reads right" (`*-name*.json`) routinely fails the no-prefix
and default-name cases. Out-of-repo storage remains the primary control; the gitignore is
defense-in-depth, so this is MEDIUM not CRITICAL — but it's the exact filename most likely to
be dropped in-repo, so worth fixing.

Also confirmed clean on this review: Admin-SDK write path is confined to `recaps/{tmdbId}_{s}_{e}`
where all three id segments are `Number.isInteger`-validated (no `/`, no path traversal, cannot
escape the collection); output doc carries no uid/isAdmin/forgeable-trust field (`model` is
`String()`-coerced, `sources` re-mapped to a 3-key shape); `recaps/` is public-read catalog with
no PII → no `collectUserDataSnapshots` change (streamingLeaving/titleRatings precedent). Two-layer
poison gate holds: write-side `invalidTextReason` + client `validateRecapText` on read + plain-text
render (never dangerouslySetInnerHTML) + `safeHref` http(s)-only on source links. The write-side
validator is a MANUAL mirror of `sanitize.ts` with no sync test — acceptable ONLY because the
client re-validation on read is the authoritative user-facing gate (a drift that under-blocks on
write is still caught on render); recommend a sync test or a shared import if this is touched
again. LOW: the `outLicense` ternary has two identical branches (dead code, always 'CC BY-SA 4.0');
`--unsourced` NaN-tmdbId defeats the dedup `some()` (cosmetic, local-only file op, no cred/network).

### 2026-07-17 — BIN-541 MOTN monthly-quota rework: reservation transactions sound, but the new
leavingRollup staleness-notify condition checks the wrong exhaustion signal and is nearly dead
code — new "verify a notify condition actually fires on the realistic path, not just the
literal-described one" check

Reviewed `functions/src/{leavingRollup/{index,motnChanges}.ts,streamingOffers/{index,budget}.ts,
util/dayId.ts}` (+ tests): BIN-320's "MOTN 100/day" assumption replaced with the verified real
Basic-plan fact (500/month, hard limit, anchored to a 21st-of-month rolling cycle since the
renewal date isn't confirmed). Went through the full panel-conditioned plan in `tasks/todo.md`
first — all 8 acceptance criteria trace to real code, and the two-consecutive-429-before-burn
change (`reserveThrottleSignal`) is exactly the fix role #13's blind critique demanded (a single
transient hourly-rate-limit 429 no longer zeroes a whole MONTH's budget, only a day's, unlike the
old daily-cap code where burning-to-cap on one 429 was proportionate).

**Reservation logic is CORRECT, no double-spend, no race.** Both `streamingOffersRefresh`'s
per-title loop and `leavingRollup`'s new `canFetchPage` (threaded into `motnChanges.ts`'s
pagination, checked before EVERY page including the first) reserve via
`db.runTransaction(async tx => { const used = (await tx.get(budgetRef))...; if (granted) tx.set(...) })`
— Firestore's optimistic-concurrency transaction retry makes this safe against concurrent
invocations (e.g. a genuine Scheduler at-least-once double-fire): each transaction re-reads the
current count fresh, so two overlapping invocations serialize correctly and can never jointly
exceed the cap. Reservations are correctly never refunded on failure (matches "RapidAPI counts
the request, not the success" — 404/429/timeout all burn a call). The 429-confirmation delay
(`reserveThrottleSignal`, require 2 consecutive runs before burning the bucket) costs at most 2
reserved-but-wasted slots to detect real exhaustion — trivial against CAP=300/150 — not an
exploitable or costly gap; no external input controls a MOTN 429 response, so nothing forgeable
here. `leavingRollup` and `streamingOffers` use two INDEPENDENT counters
(`motnBudget`/`motnLeavingBudget`, own collections, own cycle-keyed docs) rather than the plan's
literal AC #1 wording ("one shared Firestore counter") — confirmed this is an intentional,
equally-safe evolution superseded by AC #3 ("explicit sub-allocation, not a free-for-all draw"):
two independently-capped counters summing to 450-of-500 give the identical safety property (never
starve each other, combined bounded well under the vendor cap) without a shared-doc contention
point. Not a finding.

**New Medium finding: `leavingRollup`'s admin staleness-notify (`notifyAdminLeavingStale`,
index.ts) is gated on a condition that is unreachable on the realistic exhaustion paths, making
the AC ("admin gets a staleness signal when its allocation is exhausted") effectively unmet.**
The notify call is `if (budgetExhaustedMidRun && result.changes.length === 0)` (index.ts ~L105).
Traced every way the budget can actually become exhausted:
1. **The far more common steady-state case — budget already at/over cap when THIS run starts —
   returns at the top-of-function guard (`if (usedThisCycle >= LEAVING_HARD_CYCLE_CAP) { ...;
   return; }`, ~L68-71) BEFORE `canFetchPage`/`budgetExhaustedMidRun` is ever touched.** Once the
   cap is first hit (any day in the cycle), EVERY subsequent day's run for the rest of the ~month
   hits this early return and skips silently — no notify call exists on this path at all. This is
   the path that will actually fire on most days of a stale month, and it never alerts.
2. **Confirmed-exhaustion via 2-consecutive-429s (the realistic "vendor says no more quota" signal)
   does not set `budgetExhaustedMidRun` either.** That flag is set ONLY inside `canFetchPage`'s
   `reserveSlot`-denial branch; a 429 sets `result.rateLimited`/drives `reserveThrottleSignal`
   through an entirely separate closure variable, never touching `budgetExhaustedMidRun`. So even
   the run where `throttle.confirmedExhausted` becomes true and the bucket gets burned to cap does
   NOT satisfy the notify condition unless it coincidentally also had zero pages fetched that run.
3. **The ONE way `budgetExhaustedMidRun && result.changes.length === 0` can be true is a narrow
   edge case**: the top-of-function guard didn't trip (so `usedThisCycle < cap` entering the run,
   meaning the first `canFetchPage()` call always grants), a full page's fetch returns genuinely
   ZERO new changes while `hasMore` is still true, THEN the next `canFetchPage()` call denies
   because that was the cap's last slot. Requires the exact last available page in the exact run
   that exhausts the cap to have an empty `changes` array — implausible as the reliable trigger for
   an "alert the admin the data is now stale" feature.
Net effect: the admin notification this PR explicitly adds (task item 5) is very unlikely to ever
fire in production; the rollup can go stale for the rest of a billing cycle with no signal, same
failure mode the plan's AC #5 was written to close. **Fix:** check exhaustion via the persisted
state, not a same-run-only flag — e.g. fire once per cycle when `usedThisCycle >= CAP` at the
top-of-function guard AND (throttle.confirmedExhausted this run OR a `staleNotifiedForCycle` guard
hasn't been set for this `motnCycle` yet), mirroring `streamingOffers`' own
`prev?.status !== health.status`-gated single-shot-per-transition pattern so it fires once per
cycle rather than every day or never.

**Secondary Low/observability note (pre-existing lines, semantics changed by the day→month cap
widening, not by any edited code in this diff):** `streamingOffersRefresh` has the identical
early-return-on-cap-reached shape (`if (usedThisCycle >= STREAMING_HARD_CYCLE_CAP) { ...; return; }`,
~L118-121) which ALSO skips the entire `computeHealth`/`streamingHealth` write/`notifyAdmin` block
at the bottom of the function on every subsequent day once hit. Under the OLD daily cap this
silent-skip window was at most ~1 day (UTC day rolled the counter over); under the new MONTHLY cap
the identical code now silently skips health-recomputation and freezes `streamingHealth/current`
(including `lastRunAt`) for up to ~a month once the cap is first reached mid-cycle. The code text
is unchanged by this diff, but the diff's own semantic change (day→month cap) is what turns a
1-day monitoring gap into a multi-week one. Not blocking (streamingOffers still gets SOME signal
via the health-status-change path on the exhausting run itself, unlike leavingRollup's dead-code
gap above) — flagged for symmetry, since the same class of "silent budget exhaustion, no repeat
signal" problem this PR sets out to fix for leavingRollup is present, worse now, in streamingOffers
itself.

**Cost/Blaze confirmed bounded, no runaway risk:** both jobs' per-run Firestore read/write count is
capped by small constants (`MAX_PAGES=20` reservation-transaction pairs for leavingRollup,
`PER_RUN_SELECT=20` for streamingOffers, plus O(1) health/budget doc reads/writes) — no new
unbounded loop, no new collectionGroup scan, matches the existing accepted "small/bounded per-run
cost" pattern. **Secrets/trust boundary confirmed clean:** `ADMIN_UID` newly bound in
`leavingRollup`'s `onSchedule({secrets:[MOTN_API_KEY, ADMIN_UID]})` is not a new secret — identical
`defineSecret('ADMIN_UID')` → `process.env.ADMIN_UID` → Firestore doc-path-segment-only usage
already established in `streamingOffers`, `cineasterna`, `titleRatings`; never logged, never
rendered, only used to address a `users/{adminUid}/notifications` write via the Admin SDK (bypasses
rules). No new top-level collection needs a `firestore.rules` entry — `motnBudget`/
`motnLeavingBudget` are non-uid, no-PII, Admin-SDK-only singleton-per-cycle docs, correctly matching
the established no-rule-block-is-default-deny precedent (re-verified: no `match
/{document=**}`-style top-level catch-all exists in `firestore.rules`, only nested
collectionGroup wildcards like `{path=**}/likes`). No GDPR wiring needed (no new user-owned
subcollection). No `firestore.rules`/`firestore.indexes.json` diff staged at all, correctly — this
PR needs zero manual rules deploy, only the normal Tier-D `firebase deploy --only functions`
(targeted, per `deploy.yml`'s hosting-only scope).

**Generalizable check surfaced here:** when a diff adds an admin-alert intended to fire "when X is
exhausted," don't just confirm the alert CODE EXISTS and reads plausibly — trace EVERY actual path
that can produce the exhausted state (here: pre-run-already-exhausted early return, and
confirmed-429-burn) against the specific boolean condition gating the alert, not just the one path
the PR's own description narrates ("exhausted before any data was fetched"). A notify condition
scoped to one specific narrated scenario can be accidentally close to dead code if the MORE COMMON
real-world trigger (steady-state "already out of budget every day for the rest of the cycle")
takes a different code path that never reaches the same check.

Verdict: **APPROVED WITH NOTES.** No blocking (Critical/High) security-boundary finding — this is
not an auth/rules/PII surface and the reservation/race-condition logic this review was asked to
focus on is sound. One Medium (product/observability correctness — staleness-notify effectively
unreachable on the realistic path), one Low (day→month cap widening ages a pre-existing
streamingOffers monitoring-freeze window from ~1 day to ~1 month, unchanged code, changed
blast radius). Recommend fixing the Medium before/shortly after ship, not blocking the commit gate.

### 2026-07-17 (re-review) — BIN-541 `markStaleOnce` fix: Medium (dead-code notify condition) and
the symmetric Low both CLOSED, no double-notify/never-notify bug introduced, RESOLVED

Re-reviewed the staged fix for the 2026-07-17 Medium above. `markStaleOnce(budgetRef,
alreadyNotified, extraFields = {})` (added independently to both `leavingRollup/index.ts` and
`streamingOffers/index.ts` — deliberately NOT shared, since `budget.ts` stays firebase-admin-free
for root-vitest per the "Functions test import gotcha" convention) checks a `staleNotified`
boolean persisted on the same cycle-keyed budget doc, fires the admin notification once, then
sets the flag in the same write — so a fresh cycle (new doc id from `motnBillingCycleId`) always
starts with an unset flag, and dedup is scoped correctly per-cycle, not per-run.

**All three `leavingRollup` exhaustion paths now call `markStaleOnce` with a correct
`alreadyNotified` value — traced each call site's value against what could have already happened
earlier in the SAME execution, not just read in isolation:**
1. Top-of-function early return (`usedThisCycle >= LEAVING_HARD_CYCLE_CAP`) — passes the
   run-start `staleNotified` read straight through. Nothing else can have fired before this
   (it's the first statement after the budget read), so this is trivially correct. **This is the
   exact path the Medium named as "the far more common steady-state case ... never alerts" — now
   fixed.**
2. Confirmed-429-across-2-runs (`throttle.confirmedExhausted`) — also passes the run-start
   `staleNotified` unmodified. Correct because this is the FIRST `markStaleOnce` call reachable in
   this execution path (path 1 would have already `return`ed if it applied), so no earlier event
   in this run could have changed the flag.
3. Mid-pagination exhaustion with zero pages fetched (`budgetExhaustedMidRun &&
   result.changes.length === 0`) — passes `staleNotified || throttle.confirmedExhausted`, correctly
   **OR-ing in whether call site 2 already fired earlier in this SAME run** (the exact
   stale-closure risk called out in the review brief: `staleNotified` is a `const` read once at
   the top of the run, so if site 2 already notified-and-persisted the flag moments earlier in
   this execution, the local `staleNotified` var alone would still read `false` and cause a
   double-notify without the OR). Verified this OR is necessary and sufficient by also proving the
   two flags are structurally exclusive-in-practice within one run: `fetchExpiringChanges`'s
   pagination loop calls `canFetchPage()` BEFORE each fetch and `break`s immediately on either a
   `canFetchPage` denial (sets `budgetExhaustedMidRun`) or a 429 (sets `rateLimited`) — once either
   fires the loop exits, so a single run can set at most one of the two flags, never both. That
   makes the OR a defense-in-depth belt-and-suspenders rather than a load-bearing fix for an
   actually-reachable double-fire — but it's exactly the right defensive form or a future change
   to the loop (e.g. retrying past a budget denial) would silently reopen the double-notify hole
   the OR currently forecloses.

**`streamingOffers/index.ts` symmetric fix verified correct and appropriately scoped to what was
actually flagged (the Low, not a re-litigation of the Medium's narrower 3rd path).** Same two call
sites (top-of-function, confirmed-429-after-loop) added, structurally mutually exclusive within one
run for the identical reason (top-of-function `return`s before the loop/throttle code is ever
reached) — no double-notify possible. Confirmed one intentionally-unclosed gap, NOT a regression:
the per-title loop's own mid-run `!granted` break (budget cap reached partway through a batch) has
no dedicated `markStaleOnce` call — unlike `leavingRollup`'s path 3. Traced the actual exposure
window this leaves: `count` is already at/near cap when this break fires (denial only happens when
`used >= cap`), so the VERY NEXT scheduled run's top-of-function check (`usedThisCycle >=
STREAMING_HARD_CYCLE_CAP`) will catch it and notify — worst case ~1 run interval (~24h, this job's
own schedule), not the "up to a month" class of gap the original Medium/Low were about. This
matches what the original Low actually asked for ("the already-exhausted early-return... skipped
any admin signal") — the original finding never asked for a third streamingOffers call site
mirroring `leavingRollup`'s narrow path-3 edge case, so this isn't a partially-applied fix, just a
correctly-scoped one. Flagging as a **Low, non-blocking** residual for a future touch of this file,
not a newly-introduced defect.

**No double-notification, no "flag never persists" regression, in either file.** `markStaleOnce`
always writes `staleNotified: true` in the SAME awaited call that sends the notification (no
intervening await where a "sent but not recorded" state could survive a clean run) — the only way
the flag could fail to persist after a real notify is an unhandled exception between the two
awaits, which would fail the whole scheduled invocation (Cloud Scheduler retry, not a silent
resume-without-persisting), an existing accepted class of behavior for every other write in these
two functions, not new here. Ran `npx vitest run functions/src/streamingOffers/budget.test.ts
functions/src/util/dayId.test.ts` live (20/20 green, including the new `reserveThrottleSignal` and
`motnBillingCycleId` cases — the latter's UTC-vs-Stockholm-anchor test is a real regression guard
given `stockholmDayId`'s adjacent doc comment explicitly warns vendor-quota windows must stay UTC).
`tsc --noEmit` on `functions/` clean. No `firestore.rules`/`firestore.indexes.json` in this diff
(confirmed via `git diff --cached --stat -- firestore.rules` empty) — matches the prior review's
note that this surface needs zero manual rules deploy, only the standing Tier-D `firebase deploy
--only functions` (targeted).

**Reusable check confirmed by this re-review:** when a fix adds a shared "fire once" flag read
once at the top of a function but potentially written at multiple call sites reachable in the SAME
execution, verify each LATER call site's "already fired" check ORs in every EARLIER call site's own
firing condition from this run, not just the flag's original top-of-run value — a `const` captured
before any writes is stale the instant an earlier branch in the same run performs the write it's
supposed to gate on.

Verdict: **RESOLVED.** Both the Medium (leavingRollup dead-code notify condition) and the Low
(streamingOffers symmetric gap) from the 2026-07-17 entry above are closed. No new blocking
finding; one new Low (streamingOffers still lacks a mid-run-batch-exhaustion call site, bounded to
a ~1-run/~24h delay, not the multi-week class of gap this ticket fixes) noted for a future touch,
not blocking this commit.

### 2026-07-17 (round 3, pre-commit) — BIN-541 `markStaleOnce` replaced by shared transactional
`notifyOnceForCycle` (functions/src/util/notifyOnce.ts, new file): reservation logic re-verified
sound; new Medium — two-phase claim/notify can leave a permanently-stuck "already notified" flag
under a timeout-kill, silencing the once-per-cycle admin alert for up to the rest of a billing cycle

Session-limit interrupted round 3's own review (per the task brief); this is the first full review
of the CURRENT staged shape. `markStaleOnce` (both prior 2026-07-17 entries above) no longer exists
anywhere in `functions/src` — round 3 replaced its two independent per-file implementations with one
shared helper, `notifyOnceForCycle(budgetRef, notify, extraFields)`, moved to a NEW file
(`util/notifyOnce.ts`, kept out of `budget.ts` deliberately — `budget.ts` stays firebase-admin-free
per the established "Functions test import gotcha" convention, since this helper needs
`firebase-admin/firestore` + `firebase-functions/v2` for the actual I/O).

**Reservation/cap logic unaffected by the notify rewrite, re-verified correct, no regression.**
`reserveSlot`'s transaction (`canFetchPage` in leavingRollup, the per-title loop in streamingOffers)
is untouched by this round's changes — same optimistic-concurrency correctness already established
in the first 2026-07-17 entry above. `motnChanges.ts`'s `complete` flag fix (true ONLY on a genuine
`!hasMore`, never on `hasMore:true && !nextCursor`) and `leavingRollup/index.ts`'s `lastRunAt` write
moved to AFTER `fetchExpiringChanges` resolves (not before) both verified correct by direct reading
against the task's own description — both are exactly as described, no discrepancy.

**The notify claim's transaction is genuinely race-safe against concurrent Scheduler retries.**
`notifyOnceForCycle` reads `staleNotified` and writes an optimistic claim (`staleNotified: true`) in
ONE Firestore transaction, returns `claimed = !alreadyNotified`; only the invocation that gets
`claimed = true` ever calls `notify()`. Firestore's optimistic-concurrency transaction retry means
two truly-concurrent invocations serialize on this document: whichever transaction commits first
wins the claim, the other's transaction is forced to retry (re-read → sees `staleNotified: true` →
returns `claimed: false`) — verified this holds regardless of which invocation's `notify()` call
takes longer, since the LOSING invocation never even attempts `notify()` at all (it returns before
reaching that code). No duplicate-send path found. `extraFields` (budget-burn writes) are written
inside the SAME transaction as the claim check, folded via `computeNotifyOnceFields` (pure,
directly unit-tested) — correctly survive regardless of `alreadyNotified`, matching the pure
helper's own documented contract; merge-semantics (`{merge:true}`) mean the release write (below)
can never clobber `count`/`consecutive429Runs` since it only ever specifies `{staleNotified,
updatedAt}` as its patch.

**New Medium (non-blocking): the "release the claim on notify() failure" step is a SEPARATE,
non-transactional write (`budgetRef.set({staleNotified:false}, merge)`) executed only if code
resumes after `notify()` — a hard function timeout between the claim committing and this release
running leaves `staleNotified: true` permanently stuck for the rest of the ~31-day billing cycle,
even though no notification was ever actually sent.** Traced concretely, not just theoretically:
both `onSchedule` functions declare `timeoutSeconds: 300`; `leavingRollup`'s own pagination loop can
consume up to `MAX_PAGES (20) × AbortSignal.timeout(10_000)` ≈ 200s of that budget on a
slow-response day BEFORE `notifyOnceForCycle`/`notify()` (a single Firestore `.add()` write, no
external call) even runs — leaving comparatively little margin before the container is forcibly
killed. GCP force-kills a timed-out Cloud Function; no `catch`/`finally` code executes on a hard
kill, so if `notify()`'s single Firestore write happens to stall (Firestore-side degradation, not
implausible given the run is already near its time budget) past the remaining margin, the function
dies with the claim (`staleNotified: true`) already committed but the release/retry path never
reached. The NEXT invocation (that day's retry, or the next scheduled day) reads `staleNotified:
true` and skips notifying for the rest of the cycle — the admin gets zero signal that MOTN's quota
is exhausted, silently, for up to ~a month, which is the exact failure mode this whole ticket (BIN-
541) was written to prevent (per its own AC #5). **Why this is Medium, not Critical/High:** no trust-
boundary crossing (Admin-SDK-only Firestore write to an admin-owned notifications subcollection, no
user data, no forgeable input), no cost/cap-integrity impact (the `reserveSlot` reservation logic
that actually bounds vendor spend is completely independent of this flag and stays correct either
way) — the blast radius is purely "one internal admin-observability channel can go dark," not data
exposure or runaway cost. **Why NOT simply "fold notify() into the same transaction" (the obvious
fix):** `notify()`'s side effect currently uses `.add()` (Firestore auto-generated doc id) — Admin
SDK transactions retry their ENTIRE callback body on write contention, so a non-idempotent `.add()`
called from inside a transaction risks writing MULTIPLE notification docs on a transaction retry,
reintroducing a duplicate-send bug worse than the one this design already correctly avoids by
keeping `notify()` outside the transaction. A clean fix needs BOTH changes together: (1) make
`notify()`'s write idempotent — a deterministic doc id (e.g. `motn-stale-${motnCycle}`) via
`.doc(id).set()` instead of `.add()`, so a transaction retry re-writing the same doc is a no-op, not
a duplicate; (2) only then is it safe to fold the write into the SAME transaction as the claim,
eliminating the two-phase claim/notify/release pattern (and its timeout-kill window) entirely — the
whole operation becomes one atomic Firestore transaction with no code path that can "claim and then
never resolve." Filed as a follow-up, not blocking this commit — it needs a real code change
(the deterministic-id migration touches `sendAdminSystemNotification`'s shared call sites, including
the untouched `notifyAdmin` health-status alert which does NOT go through `notifyOnceForCycle` at
all and would need its own audit before any shared refactor).

**Reusable check for any future review of a "claim via transaction, then do the real work outside
the transaction, release on failure" pattern:** verify the WHOLE window between the transactional
claim-commit and the release-write is bounded by something shorter than the platform's own
force-kill timeout, or that the claim carries a lease timestamp so a later invocation can tell "still
in progress" from "died holding the claim" and reclaim it. A claim with no expiry and no lease is
only as safe as "the releasing code always gets to run," which a hard serverless timeout does not
guarantee — this is a structurally different risk than the already-solved "two invocations racing"
problem the transaction correctly closes.

**Secrets/rules/GDPR confirmed clean, unchanged from the prior entries' analysis:** `git diff
--cached --stat -- firestore.rules firestore.indexes.json src/lib/firebase/userData.ts` empty; grep
of the full staged diff for key/secret/token literals found nothing beyond the existing
`defineSecret('MOTN_API_KEY')`/`defineSecret('ADMIN_UID')` → `process.env.*` pattern, unchanged
usage shape from the already-approved prior round.

Verdict: **APPROVED WITH NOTES.** No blocking (Critical/High) finding — no trust-boundary crossing,
no cost/cap-integrity defect, no secret exposure. One new Medium (admin-alert can go permanently
silent under a timeout-kill race, observability-only blast radius) filed as a follow-up, not
blocking this commit.

### 2026-07-17 — BIN-541 round 5 (final, narrow-scope): verifying a "moved a read inside a
transaction to fix a race" claim — new check for distinguishing a genuinely closed race from a
merely-relocated one

Scoped review of exactly two changes on a diff already through 4 prior review rounds:
`reserveMotnSlot` dedup extraction, and `applyThrottleObservation`'s `consecutive429Runs` read
moving from a plain caller-supplied parameter to a fresh in-transaction read
(`functions/src/util/notifyOnce.ts`).

**Extraction-preserves-semantics check, mechanical but worth stating as a method:** diffed the
new shared function's body byte-for-byte against BOTH pre-extraction inline copies (recovered via
`git diff --cached` hunks showing the removed inline `db.runTransaction` block in
`streamingOffers/index.ts`) rather than trusting the extraction comment's claim. Confirmed
identical read/decide/write shape, same field names, same merge semantics, and grepped for
orphaned references to the old inline pattern (`reserveSlot` direct calls, dead
`HARD_DAILY_CAP`/`DAILY_BUDGET` constants) to rule out a half-completed extraction leaving a stale
copy alongside the new shared one.

**The harder question — does moving a read inside `runTransaction` actually close the described
race, or just relocate where the stale read happens?** Traced it against Firestore's actual
transaction contract (serializable, automatic-retry-on-conflict for any transaction whose
read-set was modified before its commit), not just "it's in a transaction now, so it's fine."
The general failure mode to check for whenever a fix wraps a decision in `runTransaction`: **does
EVERY write that could invalidate the decision happen inside the SAME transaction, or does a
sibling transaction (here: `notifyOnceForCycle`, called AFTER `applyThrottleObservation`'s tx
commits) get to write the same field later, deferred?** Here the confirmed-exhaustion branch
deliberately skips writing `consecutive429Runs` itself (comment: burning-to-cap is
`notifyOnceForCycle`'s job) — meaning a second overlapping invocation landing in that gap reads
the SAME not-yet-bumped streak value and independently recomputes the confirmation. The check
that mattered: is the recomputed value **identical** (idempotent, safe) or **could it diverge**
from what the first invocation already decided (a genuinely reopened false-positive)? Traced it
value-by-value: both invocations' inputs to `reserveThrottleSignal` are deterministic functions of
the same unchanged document state, so both outputs are provably identical — a redundant write, not
a divergent one. **General rule: "a second reader in the gap sees the same stale value" is only
safe if that value, fed through the same pure decision function, produces the SAME output both
times — if the decision function is sensitive to anything besides the one field left unwritten in
the gap (e.g. wall-clock time, a counter incremented elsewhere, request-specific state), the same
relocate-the-read fix would NOT be sufficient and the gap would need closing (write everything the
decision depends on inside one transaction, or fold the sibling transaction in).**

Verdict: APPROVED. No blocking finding. Confirmed via `tsc --noEmit` (clean) and a targeted vitest
run (91/91 green, streamingOffers+leavingRollup+util) rather than reasoning about the diff alone.

### 2026-07-18 — BIN-510 retry (bounded fan-out + zero-groups cache) + BIN-532 (atomic createGroup, merge-preserving re-add): APPROVED, no security-boundary finding; new check class on module-scoped client caches

Scoped review of `src/lib/firebase/groups.ts` + new `groups.test.ts`, the retry of a same-file
change reverted 2026-07-16 for "failed correctness/intent, shipped with no tests." Verified
against this round's `tasks/todo.md` AC: all four `array-contains` "mina grupper" queries now
carry `limit(MY_GROUPS_LIMIT=100)`; `syncProgressToGroups` alone short-circuits on a per-uid
"confirmed empty" in-memory `Set` (no TTL, invalidated on every local membership mutation);
tests now exist and are green. Both prior Medium/Low findings from the 2026-07-16
committed-state review are closed: `addToGroupWatchlist` is now `merge:true` with
`memberRatings` omitted (no more silent re-add wipe), and `createGroup` now writes the group
doc + owner's member doc in one `writeBatch` via a client-pre-generated ref (no more
orphan-owner-less-group window). Verified the batch-visibility assumption (member-create
rule's `get()` seeing an earlier write in the SAME batch) against the already-shipped,
identical-shape `acceptGroupInvite` rather than trusting the new comment — not a novel risk.

**New reusable check class: a module-scoped, per-browser-tab JS cache's "invalidate on
mutation" call sites must be checked for WHOSE runtime they actually reach, not just whether
the call exists.** `GroupMembersPanel.tsx` lets the group owner kick a DIFFERENT member
(`removeMember(groupId, memberToRemove.uid)`, uid not self) — `removeMember`'s
`invalidateGroupsCache(uid)` then runs inside the OWNER's own tab's module instance, not the
kicked member's. Harmless here only because the cache's own invariant (tracks ONLY
"confirmed empty", so a stale/wrong entry can only ever cause an extra scan, never a missed
one) makes the wrong-runtime call a no-op — traced every invalidation call site against every
real caller (createGroup/joinGroupViaToken/acceptGroupInvite/leaveGroup/deleteGroup all pass
the ACTING user's own uid; only `removeMember`'s kick path passes someone else's) and
confirmed the safety property holds regardless. **General check for any future module/tab-
scoped cache keyed by uid: when a mutator's invalidation-target uid can be someone OTHER than
the calling session's own signed-in user, that invalidation is cosmetic/inert for the other
user — verify the cache's safety property holds even when a "wrong-runtime" invalidation is
effectively a no-op (e.g. a cache with a "confirmed NON-empty" or TTL-refresh branch would
NOT be safe here), don't assume the call site alone closes the gap.**

Cross-tab/cross-device staleness is disclosed in-code (fails safe: missed best-effort sync,
never a data-integrity problem) but not yet in `.claude/rules/accepted-deviations.md` — Low,
non-blocking, recommend a dated entry next time this file is touched so a future reviewer
doesn't re-derive the argument from a comment. No `firestore.rules` change, no new user-owned
subcollection (cache is transient JS memory, no GDPR wiring needed), no new public-read
surface. Client-only, ships via the normal `deploy.yml` hosting path.

Verdict: **APPROVED.** No blocking (Critical/High) or Medium security-boundary finding. One
Low (cross-tab staleness worth a dated accepted-deviations entry) — process note, not a defect.

### 2026-07-18 (second retry, working tree) — groups.ts/groups.test.ts: TTL-cache redesign replaces the "confirmed-empty Set + invalidation call sites" from the SAME-DAY entry above — APPROVED WITH NOTES, two new non-blocking check classes

Reviewed the working-tree (unstaged) diff on `src/lib/firebase/groups.ts` + new
`groups.test.ts` — a DIFFERENT cache design than the one reviewed earlier the same day
(previous entry: per-uid "confirmed empty" `Set` + scattered `invalidateGroupsCache` call
sites). That design was apparently the one reverted in `3644a22` ("failed sprint
verification"); this is a clean second attempt: `myGroupsCache` is now a `Map<uid, {groupIds,
at}>` TTL cache (5 min) with exactly ONE write path (`cacheMyGroups`, called by every
successful bounded query or live `subscribeToMyGroups` snapshot) and ONE read path
(`getFreshMyGroups`) — no manual invalidation surface to get wrong. Confirmed no
`firestore.rules` diff in this round (checked via `git status`; the rules file appearing
modified in an earlier gitStatus snapshot was stale/from session start, already resolved).
All four `array-contains` "mina grupper" queries (`syncProgressToGroups`,
`subscribeToMyGroups`, `getRecentSessionPicksAcrossGroups`, `refreshMyHouseholdContributions`)
now carry `limit(MY_GROUPS_LIMIT=100)`. Every caller of `syncProgressToGroups`/
`subscribeToMyGroups` passes only the caller's OWN uid (`WatchlistContext.updateProgress`,
`useGroups.useMyGroups`) — no cross-account read/write surface introduced. Verified the
`groups/{groupId}/members/{uid}` create rule's `get(group)` batch-visibility assumption
(now exercised by `createGroup`'s brand-new-group-created-in-the-same-batch case, not just
`acceptGroupInvite`'s update-existing-group case) is the same class already proven safe by
the prior entry's precedent-check — group `create` (resource==null) sets `ownerUid`/
`memberUids` in write 1, member `create`'s `get(group).data.ownerUid==auth.uid` branch reads
write 1's committed-within-batch state in write 2; no new risk, same mechanism.
`npx vitest run groups.test.ts` (8/8 green) and `tsc --noEmit` (clean) both independently
confirmed, not just traced.

**New check #1 (cost-claim precision, Low): the TTL cache has no in-flight-request
de-duplication, partially undercutting its own comment's claim ("en användare... betalar
bara EN bounded query per TTL-fönster istället för en per toggle").** Two back-to-back
`updateProgress` calls for the SAME uid before the first's query resolves (a real trigger:
`useEpisodeProgressWithSync.markEpisodeWatched`'s season-auto-advance path awaits
`updateProgress(season,episode)` then immediately calls `updateProgress(season+1,0)` — each
call's fire-and-forget `syncProgressToGroups` starts independently) both see
`getFreshMyGroups` return `null` and each fire their OWN "mina grupper" query, since
`cacheMyGroups` isn't called until the FIRST query's promise resolves. Not a security issue
(still bounded at `limit(100)` either write; Blaze-cap impact negligible — one extra bounded
read, only at season boundaries) and not blocking, but the same class of "does the cost
claim hold under the actual trigger, not just the idealized one" check as the 2026-07-18
`recapCoverageGaps` entry above. Cheap fix if ever revisited: cache the in-flight `Promise<string[]>`
per uid (not just the resolved value) so concurrent misses join one request.

**New check #2 (comment-accuracy, Low, matches the lessons-digest "false attestation" class):
`MY_GROUPS_LIMIT`'s justifying comment conflates two different axes.** It claims the 100 cap
"mirrors the already-sharp firestore.rules limit" — but the rules cap
(`memberUids.size() <= 100`, firestore.rules:983/1000) bounds MEMBERS PER GROUP, not GROUPS
PER USER; grepped the whole ruleset and confirmed there is no cap anywhere on how many
DIFFERENT groups one uid can create or join (`groups/{groupId}` create has no per-owner
rate limit). A hypothetical >100-group user (not rules-prevented, just practically unlikely
for a consumer app) would have `subscribeToMyGroups`/`syncProgressToGroups`/
`refreshMyHouseholdContributions`/`getRecentSessionPicksAcrossGroups` all silently truncate
to an arbitrary 100 of their groups (no `orderBy`, so the specific 100 returned isn't
contractually stable across calls). Not exploitable, not blocking — flagging only because a
"this mirrors an enforced limit, so it's safe" comment is a load-bearing safety claim per this
project's own standard (see the 2026-07-16 "false safety comment" entry and the
lessons-digest's attestation-comment lesson), and this one is checking the wrong invariant.

**Test-completeness gap (Info, not blocking):** the new `groups.test.ts` proves the cache
HIT path (no second query within the TTL window) but no test advances fake time past
`MY_GROUPS_TTL_MS` to prove the cache actually EXPIRES and triggers a fresh query — the
TTL's own boundary condition (`>=` comparison) is the one genuinely new piece of logic this
diff adds and it's the one piece untested. A regression there (off-by-one, wrong constant)
would ship silently green.

Verdict: **APPROVED WITH NOTES.** No blocking (Critical/High) or Medium security-boundary
finding — no rules change, no new user-owned subcollection (cache is transient JS memory,
no GDPR wiring needed), every query/write stays uid-scoped to the acting user, rules already
enforce group-membership server-side so client cache staleness can only ever cause a missed
best-effort sync (fails safe), never an unauthorized write. Three Low/Info notes (in-flight
dedup gap, wrong-axis comment on the 100 cap, untested TTL-expiry boundary) — none blocking.

### 2026-07-20 (re-review) — BIN-540 ratchet CLOSES the live-confirmed HIGH: mutation-proven, not just re-read; plus the correct scoping of what a spend-down ratchet can and cannot promise on an anon-writable path — APPROVED

Re-dispatched after the same-day CHANGES REQUESTED entry above (HIGH: `vetoRemaining` was
range-bounded but not ratcheted, so a spent slot could re-arm 0→1 forever). `firestore.rules`
was edited AFTER both the security and code-review verdicts and had been seen by no reviewer.

**The fix is real and I proved it by MUTATION, not by reading the clause.** New clause:
`&& request.resource.data.vetoRemaining <= (resource == null ? 1 : resource.data.get('vetoRemaining', 1))`.
Method: snapshotted `firestore.rules` to the scratchpad + recorded its md5, replaced ONLY the
ratchet clause with `&& true`, re-ran the BIN-540 block against the live emulator → exactly one
test failed, `'rejects re-granting a spent veto (0 → 1) on update'`, with
`Error: Expected request to fail, but it succeeded` — i.e. the 0→1 write SUCCEEDS without the
clause (re-confirming the original HIGH is a real exploit, not a rules-trace artifact) and is
DENIED with it. Restored via `Edit`, verified `diff` byte-identical + md5 match + `git diff HEAD
--stat` back to the original `31 ++++---` shape, then re-ran the full suite: 207/207 green.
**This is a strictly stronger verification than the original finding's PoC: a passing deny-test
only proves the write fails for SOME reason; the mutation proves WHICH clause is load-bearing.
Adopt this as the default for any rules fix whose deny-test could pass for an unrelated reason
(here the `<= 1` range check would have masked a broken ratchet for any value > 1) — the earlier
misleading test in this very ticket (title said 0→1, body wrote 5) is exactly the failure mode a
mutation run catches and a green suite does not.**
The misleading test was also fixed: the body now asserts the true `0 → 1` transition, keeps the
out-of-range `5` case as a separate assertion, AND adds two positive controls (rewriting the spent
`0` still succeeds — heartbeats re-send the field; join-with-1-then-spend-to-0 still succeeds), so
the ratchet can't regress into a blanket "no vetoRemaining writes" denial without a test failing.

**Traced every legitimate writer before accepting the ratchet — the check that mattered most here,
because the new clauses make `vetoRemaining` and `isHost` effectively REQUIRED on every participant
write (a missing field makes `is int`/`is bool` error → deny).** `sessions.ts`: `createSession`
and `joinSession` both write both fields explicitly; `updateParticipantActivity` and
`recordSwipe`'s veto-spend send partial updates, but on an update `request.resource.data` is the
MERGED doc, so both fields arrive from `resource` and the ratchet compares equal → passes.
The one genuine regression candidate: `joinSession` uses `setDoc(..., {merge:true})` with a
hardcoded `vetoRemaining: 1`, so a re-join against an already-spent (0) slot would be DENIED and
surface as "Kunde inte gå med". Chased it to ground in `TillsammansSessionPageClient.tsx`:
`JoinSessionForm` renders only when `!myParticipant`, i.e. only when no participant doc matches the
pid — signed-in users resolve pid to their uid and find the existing doc (form never shows), anon
users who lose their localStorage pid mint a FRESH token (new doc, `resource == null`, ratchet
allows 1). So no live path re-runs `joinSession` against an existing spent slot. **General check
this reinforces: when a rules fix adds `is <type>` validation to a field, it silently converts that
field from optional to MANDATORY on every write to the path — enumerate the partial-update writers
(heartbeats, single-field `updateDoc`s) and confirm each either sends the field or relies on
Firestore's merge semantics, and separately hunt for any `setDoc(merge:true)` that hardcodes the
field's INITIAL value, since that is the one shape a monotonic ratchet can turn into a hard lockout.**

**Honest scoping of what the ratchet actually buys (recorded so a future reviewer doesn't overclaim
it):** it hard-caps SIGNED-IN participants at one veto per session — they're pinned to `pid ==
auth.uid`, so they own exactly one slot and can only count it down. It does NOT cap an anonymous
link-holder in aggregate: nothing stops minting additional `anonShapedPid` slots, each arriving
with a fresh `vetoRemaining: 1`. That residual is the ALREADY-ACCEPTED ADR 0015 / accepted-deviations
link-trust model (rules cannot authenticate an unauthenticated caller), so it is deliberately NOT
filed as a finding — but the ratchet's guarantee should be stated as "per-slot, and per-identity
only for signed-in users," never as "one veto per human."

BIN-542 (`anonVoteAddOk` binding `diff()` once via `let d`) is a pure CSE refactor — same
`changedKeys()/removedKeys()` semantics, `added` correctly left as the List-form
`keys().removeAll(...)` since `addedKeys()` returns a non-indexable Set; the rules compile and the
pre-existing BIN-509 swipe tests pass, which is the real evidence. Re-verified the BIN-561
`useOptimisticMirrorField` extraction independently despite the dispatching prompt asserting "no
specialist reviewed this pair" — that premise was FALSE (this log already carries a same-day
APPROVED entry for it); per this file's own 2026-07-18 precedent I re-did the trace anyway rather
than skipping depth: all three setters preserve the synchronous pre-`await` mirror write, the
`== null` delete branch, the identity-checked rollback + rethrow, and `canonicalProviderId()` still
runs at the AuthContext call site. `AuthContext.test.tsx` 10/10 green through the new shared hook.
Also re-confirmed the `ci.yml` change is a gate STRENGTHENING, not a weakening: `continue-on-error`
was dropped from the coverage step and `npm test` folded into it, and `test:coverage` is
`vitest run --coverage` (non-watch, exits non-zero on a failing test) — so test failures remain
blocking while coverage stays threshold-free/report-only, exactly as its comment claims.

Verdict: **APPROVED.** The blocking HIGH from this morning is closed and mutation-proven. No new
Critical/High/Medium. No new user-owned subcollection (GDPR `userData.ts` unaffected), no secrets,
no new public-read surface. Standard reminder: `deploy.yml` deploys hosting only — this diff needs
a manual `firebase deploy --only firestore:rules` AND a targeted functions deploy
(`streamingOffers,weeklyDigest,communityRatingMaintain,availableNotify`) before the code relying on
either goes live.

### 2026-07-20 — REMEDIATION re-gate (BIN-540/542/562/557/561): ratchet + rejoin + priceHistory namespacing all PASS; new check class — a type-guard on a stored field closes the JUNK-VALUE brick but not the MISSING-FIELD brick

Re-gated the final staged state (HEAD 70a0815, 27 files) after `/code-review xhigh` + a top-tier
role panel. Verified each remediation independently rather than trusting the dispatch summary.

**1. `firestore.rules` vetoRemaining ratchet + isHost immutability — PASS.** The cap
`request.resource.data.vetoRemaining <= (resource == null || !(resource.data.get('vetoRemaining',1)
is int) ? 1 : resource.data.get('vetoRemaining',1))` short-circuits `resource == null` before any
`resource.data` access (create-safe) and treats a wrong-TYPED stored value as absent (cap 1), so the
`0 <= 'many'` type-error brick I filed on the previous pass is genuinely closed — a hostile
link-holder's planted junk no longer permanently denies the victim's slot. `resource.data.get('isHost',
false)` default is CORRECT and ungameable: an isHost-less slot can only ever be written with `false`
(test 'an isHost-less slot still cannot be promoted to host' pins it), so the gap can't be used for
self-promotion; the alternative default (true, or comparing to request) would have been the gameable
one.
**Residual (Low, non-blocking, NOT the same bug): the LEFT-hand presence checks are still RAW field
accesses** — `request.resource.data.vetoRemaining is int` / `.isHost is bool`. A merged write against
a doc that LACKS the field is a missing-key access -> whole allow expression errors -> deny. The
diff's own test 'a slot with NO isHost field is still writable by its owner' passes only because the
write EXPLICITLY supplies `isHost: false`; `updateParticipantActivity` (lastActiveAt only) and the new
rejoin path do not, so a field-less slot is still bricked for its lifetime. Reachability is narrow and
inside an already-accepted class: only ANON slots can be field-stripped by a third party (a full
non-merge `setDoc` under the currently-live pre-BIN-540 rules, which had no presence requirement);
signed-in slots are owner-only via the `pid == auth.uid` binding; sessions are 7-day ephemeral and the
user self-heals by clearing site data (new token pid). Covered in spirit by the accepted deviation
"link-holder can corrupt an anon slot". Cheap future hardening if ever revisited: use
`request.resource.data.get('vetoRemaining', 1) is int` / `.get('isHost', false) is bool` on the LEFT
side too and require presence only on the `resource == null` (create) branch.
**New reusable check class: when a fix adds a type-guard so a MALFORMED stored value can't brick a
document, check the mirror case — a MISSING field. A `.get(k, default)` on `resource.data` only
defends the comparison's right-hand side; the `request.resource.data.k is T` presence assertion on the
left is still a hard requirement that every future partial write carry the field. Verify against the
app's smallest real write (a heartbeat / single-field update), not against the test's write, which
usually supplies the field and hides the gap.**

**2. `sessions.ts` joinSession getDoc-then-conditional-merge — PASS.** Rejoin (existing doc) merges
only `{uid, displayName, providers, lastActiveAt}`; the merged `request.resource.data` inherits
`vetoRemaining`/`isHost` from `resource`, so the ratchet sees `0 <= 0` and the immutability check sees
equality — no denial on a spent slot (pinned by 'a rejoin that omits vetoRemaining is allowed on a
spent slot'). First join (no doc) still carries `vetoRemaining: 1`, `isHost: false`, satisfying the
create branch's `is int`/`is bool`; `resource == null` makes the cap 1, so `1 <= 1` holds. Two narrow,
non-security notes: the getDoc->setDoc window is TOCTOU (if the slot spends its veto between the read
and the write, the "first join" write is denied — a denial, never an escalation), and an offline
`getDoc` served from an empty cache can classify a rejoin as a first join, same denial-only outcome.

**3. `useOptimisticMirrorField` layout effect — PASS.** `useIsomorphicLayoutEffect` (module-level,
constant per environment, so no conditional-hook violation) sets both refs in the commit phase, before
the browser can dispatch the blur that used to run against the previous account's `commit`/snapshot.
The shared-device bleed window is closed. Confirmed no `eslint-disable` was added (the two in
AuthContext.tsx are pre-existing exhaustive-deps suppressions on unrelated effects). Second-order
check: an already-in-flight call that fails AFTER an account switch cannot roll back the new user's
mirror — the identity check `mirrorRef.current === next` fails because the layout effect already
replaced the ref.

**4. priceHistory `${mediaType}_${tmdbId}` namespacing — PASS, all readers covered.** Grepped the
whole tree: exactly one writer (`streamingOffers/index.ts`) and two readers
(`priceDropNotify/index.ts`, `usePriceHistory.ts`); the only client call path is
`PriceHistoryChart`, and both its call sites pass a literal correct mediaType
(`MoviePageClient` "movie", `TVShowPageClient` "tv"). No reader missed. The legacy fallback is
gated on `legacy.get('mediaType') === <this title's type>`, and legacy docs really do carry that field
(the unchanged `histRef.set({tmdbId, mediaType, ...})` line), so the gate is live code, not dead.
`firestore.rules match /priceHistory/{tmdbId}` is a wildcard with `read: true / write: false`, so it
covers both id shapes with no rule change and remains Admin-SDK-write-only.
**One honest residual (Low, pre-existing, not introduced here): for a genuinely COLLIDING pair (a
movie and a show with the same tmdbId), the legacy bare doc's `points` array is already an interleaved
mix of both titles' prices, and its `mediaType` field records only the last writer. The gate therefore
prevents serving a doc that is unambiguously the OTHER title's, but it can still serve a contaminated
mixed series to the title that happens to match — once, until the cron writes the namespaced doc.**
Also non-security: the namespaced priceHistory doc starts empty, so each title's chart restarts from
zero points and the (contaminated) legacy history is silently dropped once the namespaced doc exists.

**5. `groups.ts` permission-denied vs transient — no information leak.** The distinction is derived
from a Firestore error code the probing client already observes directly from the SDK; an attacker
enumerating invite links learns strictly less from the reason string than from the raw rejection (and
a VALID token produces an actual join, a far louder signal). Reason widening is a UX truthfulness fix,
not a boundary change.

**6. streamingOffers legacy bare-id DELETE — safe.** Gated on `legacySnap.get('mediaType') ===
mediaType`, and legacy docs always carried mediaType, so a movie's run can never delete the sibling
show's only data path; a mismatched legacy doc is left for its own owner's next run to retire.
Non-transactional write-then-delete, but a crash in between merely leaves the legacy doc (harmless —
`readExisting` now recovers mediaType from the doc-id prefix as well as the field).

**7. `tmdbTosSweep` — comment-only,** confirmed via diff: the only changed hunk is the header block;
no code below the imports moved. The corrected claims match reality (`vitest.config.ts` does include
`functions/src` tests; `@firebase/rules-unit-testing` IS a devDependency with a wired
`npm run test:rules`) and the standing decision now lives dated in accepted-deviations.md, which is
the right home.

**`ci.yml`:** collapsing `npm test` + `npm run test:coverage` into one `vitest run --coverage` step
and DROPPING `continue-on-error` strictly STRENGTHENS the gate (test failures now fail that step;
coverage still can't fail it — no `thresholds` in vitest.config.ts). No weakening, no secret exposure.

**GDPR/secrets:** no new `users/{uid}/...` subcollection anywhere in the diff (grepped), so
`collectUserDataSnapshots` needs no change; no secrets added (`MOTN_API_KEY`/`ADMIN_UID` remain
`defineSecret`).

**Deploy ORDER matters this time (new, worth remembering):** `deploy.yml` ships hosting only. For
BIN-540 the rules must go out AFTER the hosting deploy, not before — a browser still running the OLD
`joinSession` (unconditional `vetoRemaining: 1` merge) hits permission-denied on a spent slot the
moment the ratchet is live. Push first, then `firebase deploy --only firestore:rules`, then targeted
`firebase deploy --only functions:streamingOffersRefresh,functions:priceDropNotify` (BIN-562's client
reader is safe in either order thanks to the gated legacy fallback).

Verdict: **APPROVED.** Items 1, 2 and 4 all PASS. No Critical/High/Medium finding; three Lows recorded
above (missing-field rules brick, contaminated legacy priceHistory series for colliding pairs, join
TOCTOU) — none blocking.

### 2026-07-22 — media-type doc-id migration Phase 2 FINAL (resolveTmdbId hardening + 5 more Admin-SDK read sites): APPROVED, re-affirms an established pattern rather than a new issue class

Re-gated the staged 13-file diff after an 8-file version was already APPROVED same-HEAD
(16:09Z marker). Delta: `resolveTmdbId` (both mirrored `mediaTypeDocId.ts` copies) tightened
from a bare `field ?? parse(docId)` to `Number.isInteger(Number(field)) && field>0 ? field :
parseTmdbIdFromDocId(docId)`, and 5 more Admin-SDK scheduled functions (availableNotify,
insights/rollup, priceDropNotify, shared/followedSeries, weeklyDigest) adopted it alongside
the already-reviewed streamingOffers site.

**Two checks worth generalizing, though neither surfaced a finding here:**
1. **A `??`-based fallback idiom silently misses falsy-but-present junk** (`Number('')`,
   `Number(0)`, `Number('   ')` are all `0`/`NaN`-adjacent but not `null`/`undefined`, so `??`
   never routes them to the fallback). When a hardening diff switches a `??` idiom to an
   explicit type+range check, verify the NEW guard is a superset of what the old one already
   caught (never accidentally narrows what falls through) — confirmed here by reading both
   forms side by side, not just trusting the docstring's claim.
2. **For any "resolve an id from either a stored field or a doc id" pattern across multiple
   collectionGroup read sites, the load-bearing security fact is where `uid` comes from.**
   Grepped every adopting call site for `uid` derivation and confirmed all 6 use
   `d.ref.parent.parent?.id` (the doc PATH), never the resolved tmdbId — so hardening how the
   TITLE id degrades on malformed data has no reachable path to routing a push/notification to
   the wrong USER, regardless of how many sites replicate the pattern. This is the check to
   re-run any time a "shared resolver, N adopting sites" diff lands: confirm uid and the
   resolved value are sourced independently at every site, not just at the first one reviewed.

No `firestore.rules`/`firestore.indexes.json` change, no `userData.ts` touch, no secrets.
118/118 targeted tests pass, `tsc --noEmit` clean root + functions/. Verdict: **APPROVED.**
Standard reminder: 6 functions/ files need a manual `firebase deploy --only functions`
(deploy.yml is hosting-only) — behaviour-neutral, non-urgent.

### 2026-07-24 — BIN-592 cross-account price leak (useOptimisticMirrorField/AuthContext) + BIN-505 belt-and-braces + BIN-566 sweep audit: APPROVED; new check class — a per-account cache keyed on its VALUE is blind to an identity change whenever the value is empty on BOTH sides

Reviewed the 23-file working-tree diff (see `.claude/state/security-done.marker` for the full
file list and the deploy note). Three surfaces: the BIN-592 mirror fix, the BIN-505 notes
invariant, and the BIN-566 tmdbTosSweep orchestrator extraction + `lastRun` audit fix.

**The new, genuinely reusable check class (BIN-592).** `useOptimisticMirrorField` rebased its
per-account mirror ref in `useIsomorphicLayoutEffect(..., [source])` — i.e. keyed on the DATA,
not on the account that owns it. That works only while the data differs between accounts. Two
successive users who have both never saved a provider price both have `source === undefined`,
so the dep never changed across sign-out AND sign-in, the effect never re-ran, and user A's
price map survived into user B's first profile write (Streamingrådgivaren then billed B for a
subscription they never entered). **General check: when a ref/cache/mirror is described as
"belonging to the current user/tenant/session", verify its invalidation key is that OWNER
IDENTITY, not the owned value. A value-keyed dep silently degrades to "never invalidates" on
exactly the empty/default state — which is the NEW-user state, i.e. the case most likely to
matter and least likely to be tested.** The tell to grep for: a dep array on a hook whose
doc-comment names an account/session scope but whose deps contain only payload. My own
2026-07-20 entry on this same file APPROVED the extraction and reasoned specifically about the
`commitRef` (uid-bound write target) indirection while treating the mirror ref's rebasing as
behaviour-preserved-from-before — correct as far as it went (the extraction WAS faithful) but I
did not ask the separate question "is this ref's invalidation key adequate at all?". A faithful
refactor of an already-wrong invalidation key inherits the bug; re-derive the key's adequacy on
any diff that MOVES a per-account cache, even when the move itself is provably behaviour-neutral.

**Verifying such a fix (what I actually checked, as a template):** (1) is the key the RIGHT
identifier — here `uid` from `onAuthStateChanged`, not `user.uid` from the profile, which lags;
(2) is it CURRENT — layout (not passive) effect, so no user input can be handled in the gap;
(3) is the SIGN-OUT edge covered — uid A→null re-runs the effect and resets to `{}` before any
next session, so the shared-computer path is closed at sign-out, not merely at the next sign-in;
(4) do SIBLINGS carry the class — both other mirrors (providerCampaigns, providerRenewalDays)
had it and both are fixed, and the neighbouring `householdSyncArmed` ref already re-armed on
`[uid]`; (5) the ROLLBACK path — `if (mirrorRef.current === next) mirrorRef.current = prev` is
the load-bearing residual guard: after a switch the effect has installed a fresh object, so a
LATE-REJECTING write from the previous account cannot re-inject its map into the new account's
mirror. That identity check turns a compensating write into a no-op across an identity change —
the same shape as the groups.ts rollback-TOCTOU entry, but here it lands on the SAFE side.

**Mutation proof blocked — and stated as such rather than implied.** I mutated the dep array
back to `[source]` to prove the new test discriminates, but the Bash classifier denied the
`npx vitest` run. I restored the file, verified it byte-identical against a pre-mutation copy,
and derived the failure structurally instead (React compares deps with Object.is per element;
both rerenders keep `source === undefined`, so the effect body cannot re-run and the final
assertion would receive `{8:99,76:109}`). **Process rule: when a live PoC/mutation is blocked by
tooling, say so explicitly in the verdict and mark the conclusion as derived, not executed — do
not let a blocked run silently downgrade into an unlabelled "verified".**

**BIN-505 (notes): a removed TYPE is not a substitute for a runtime strip, and this diff keeps
both — plus a third layer worth naming.** The new `buildWatchlistAddPayload` never spreads
`current`; it copies a fixed whitelist. That is stronger than either guard, because the leak
vector was always "the existing row carries a note and the caller passes the row forward". Its
test pins it with a note-bearing fixture. **General check for a "we moved field X to an
owner-only subcollection" invariant: don't stop at the writer's strip — find every place the
OLD doc shape is read and re-passed, and prefer a whitelist-copy helper over a spread + delete.**

**BIN-566/BIN-507 (tmdbTosSweep):** `buildLastRunAudit` now writes `error:false` +
`errorMessage:null` unconditionally. The bug it fixes is a Firestore semantics trap worth
generalizing: **`lastRun` is merge-written and Firestore DEEP-merges nested maps, so an OMITTED
key is not a CLEARED key — a conditionally-written flag inside a merged map is sticky forever.
On any audit/health/status map written with `{merge:true}`, check that EVERY key is written on
EVERY path, not just the ones the current branch cares about.** I verified the sibling keys
(docsScanned/docsCleared/docsWouldClear/docsWouldClearByGroup/docsSkipped/budgetAbort/
fullPassCompleted/dryRun/at) are all unconditional, so no second field carries the class. Also
confirmed the extraction widened nothing: `resolveMutateEnabled` is still `=== true`
(dry-run default), the BIN-504 4-segment `users/{uid}/watchlist` guard is unchanged on the
port-supplied path, the clear payload is still the fixed allowlist, and `db.doc(path)`
reconstructs the same ref. `sweepState` has NO firestore.rules entry → Admin-SDK-only, so
`errorMessage` cannot reach a client; grepped that nothing outside the sweep reads `lastRun`.
The new emulator suite (`src/test/rules/tmdb-sweep-orchestrator.test.ts`) is real and
discriminating — per accepted-deviations 2026-07-24 it discharges the BIN-566 blocker on
`mutateEnabled`, which remains Malin's Console action gated on BIN-454/BIN-468.

Two Low doc-drift findings (both in `functions/src/tmdbTosSweep/logic.ts`): the
`buildLastRunAudit` JSDoc still promises the OLD omit-on-success shape — i.e. it now documents
the exact defect the change fixed, on the record BIN-454's runbook reads — and the file header
still says the loop lives in index.ts. Same "a false safety/shape comment is worse than none"
class this log has filed before; flagged, not blocking.

No `firestore.rules`/`firestore.indexes.json` change → no rules deploy for this diff. No new
user-owned subcollection (`watchlistNotes` already in `collectUserDataSnapshots`). No secrets.
Ran 18/18 (hook + payload builder) and 96/96 (WatchlistContext + AuthContext + sweep logic).
Verdict: **APPROVED**, no Critical/High/Medium. `functions/**` changed → manual
`firebase deploy --only functions:tmdbFieldsSweep` (deploy.yml is hosting-only); until then the
live sweep keeps the sticky-error audit behaviour.

**Process note (marker hygiene, matches the lessons-digest lesson):** a CONCURRENT recap-seeding
agent had both overwritten `.claude/state/security-done.marker` with a verdict about ITS files
AND left only its own files in the git INDEX — so `git diff --cached` did not show the diff I
was asked to review. Reviewed the WORKING TREE instead and said so in the marker. **When a
review's file set and `git diff --cached` disagree, do not silently review whichever one is
convenient: name the discrepancy in the marker so the committer re-checks the staged set.**

---

## 2026-07-24T23:22Z — RE-REVIEW of the staged 24-file diff (HEAD 72bf221) — APPROVED

Second pass over the same BIN-592 / BIN-505 / BIN-566+BIN-507 diff after (a) my two Low
doc-drift findings were fixed and (b) a second xhigh /code-review round fixed a bug the
FIRST round introduced. Marker rewritten from scratch, explicitly covering the
post-remediation state. Staged set matched `git diff --cached` this time (the previous pass
had to review the working tree because a concurrent agent held the index).

**The re-verified bug (the whole point of the re-review).** Round 1 moved chunk-committing
into the `SweepIo` port and advanced the mutate tally only from the `onCommitted` callback.
That made `docsWouldClear` report COMMITTED writes instead of the loop's verdict, so a
partially-failed run wrote a `lastRun` audit contradicting its own `docsWouldClearByGroup`
breakdown — on exactly the record BIN-454's enable-gate is read from. Round 2 split
`SweepRunTally` into `clearable` (verdict, bumped per classified doc) and `cleared` (durably
committed, bumped in the callback).

Verified, in current source, not from the prior marker's prose:
- `clearable += toClear.length` now sits BEFORE `commitClears`, in the same pass that fed
  `wouldClearByGroup` → the two cannot disagree. **The PRE-DIFF index.ts had the increment
  AFTER the commit loop, so the contradiction was a LATENT defect, not one this diff
  created and undid.** Saying so mattered for an honest verdict.
- `cleared` only advances in `onCommitted`, which both ports call after `batch.commit()`
  resolves → `cleared <= clearable`, divergence only on a real partial failure.
- Dry-run double-gated: `commitClears` unreachable when `!mutateEnabled`, and
  `buildLastRunAudit` hard-forces `docsCleared: 0` on that branch anyway.
- `budgetExhausted(scanned, clearable)` still takes the VERDICT count; on the success path
  the value at that point is identical to the old code, so the per-run write ceiling is
  unchanged; on a throw the check is unreachable (unwinds to the catch).
- Framing that made the verdict crisp: the audit now **brackets** the truth — actual durable
  writes ∈ [docsCleared, docsWouldClear] — instead of asserting one wrong number. Neither
  over- nor under-reporting is possible for an operator reading `lastRun`.
- Emulator case asserts docsCleared 4 / docsWouldClear 5 AND reads Firestore back (movie_1..4
  stripped, movie_5 intact) — a real durability assertion, not just tally arithmetic.

**Blast radius unchanged, re-derived:** `resolveMutateEnabled === true` default-false;
BIN-504 4-segment guard applied before classification; `buildClearedPayload` still a fresh
fixed-allowlist object; `ALL_SELECT_KEYS` DERIVED from `FIELD_GROUPS` so the `.select()` list
structurally cannot drift from the clearable set (the emulator harness explicitly cannot cover
`.select()` — the derivation is what closes that, not a test); `db.doc(path)` reconstructs a
Firestore-supplied path already through the guard; `sweepState` still has no rules block and
the file still has no `match /{document=**}` catch-all, so `errorMessage` is Admin-only.

**Survivals re-confirmed in the staged diff (not assumed from the prior verdict):** BIN-592
`ownerKey`/`[ownerKey, source]` + three AuthContext call sites passing the onAuthStateChanged
`uid`, layout-effect timing, rollback identity check; BIN-505 notes protection at three layers
(type exclusion, runtime strip via `as … & { notes?: unknown }`, whitelist-copy builder) with
firestore.rules' notes clauses untouched. Side check worth repeating: omitting `addedAt` /
`tmdbFieldsRefreshedAt` on a re-mark is rules-safe because both are presence-OPTIONAL in
`isValidWatchlistItem` AND a merge UPDATE inherits the stored value into
`request.resource.data` — an omission-gating change on a validated field is exactly where a
permission-denied class would hide.

**Deploy:** functions/** changed → manual `firebase deploy --only functions:tmdbFieldsSweep`.
Stated the ORDER, not just the need: deploy.yml's drift guard fails the whole job on a
functions/** push, so the hosting half (the BIN-592 client fix) does not ship either —
commit+push → targeted functions deploy → hosting via workflow_dispatch (which skips the guard).

Informational, not filed: `onCommitted` is a port contract the type system can't enforce
(read every port impl); a commit failing after server-apply leaves a durable-but-uncounted
write (bounded by the bracket + `error: true`); the emulator suite's permissive rules are
correct modelling because prod runs Admin SDK.

### 2026-07-28 — BIN-608 `indexSwipes` legacy/namespaced vote merge (uncommitted working tree): APPROVED WITH NOTES (two Low). New class — a document-level `??` fallback over a MULTI-WRITER map silently discards data, and the value-level merge that fixes it widens an unattributable key's blast radius

**Scope.** Working tree (nothing staged; `git diff --cached` empty — the dispatching prompt was correct
and I used `git diff`). Reviewed: `src/lib/firebase/sessions.ts`, `src/lib/together/matching.ts`,
`src/lib/together/matching.test.ts`, `tasks/todo.md`. `.claude/rules/data-model.md` sits inside the
gitignored `.claude/` tree (`git check-ignore -v` → `.gitignore:47`), so it carries no blob sha and can
never be part of a commit; I read its current content anyway and it accurately describes the new
per-participant merge. `firestore.rules` and `firestore.indexes.json` untouched — verified.

**Premise check on the gate-triggering file — CONFIRMED.** `sessions.ts`'s entire diff is three
comment lines inside `swipeDocToObject` (`-3/+4`, no executable token changed). The rest of the file
(`recordSwipe`'s `setDoc({votes:{[pid]:vote}}, {merge:true})` plus the veto's participant-doc
`vetoRemaining: 0` update, `subscribeToSwipes`'s plain `onSnapshot(collection(...))`) is byte-identical
to HEAD. No new query, no new field, no new collection.

**The bug being fixed is real and HOT, not theoretical.** `git log -1 0c83c45` → `2026-07-29
00:23:32 +0200` = ~26 minutes before this review. Sessions carry a 7-day TTL, so essentially every
live Tillsammans session right now straddles the BIN-569 cutover and holds a legacy bare-numeric
swipe doc. The pre-fix read path was `byKey.get(key)?.votes ?? legacy.get(tmdbId)?.votes ?? {}` — a
DOCUMENT-level pick over `votes`, which is a map every participant writes their own key into. The
first post-cutover vote creates a one-entry namespaced doc that then hides every pre-cutover vote on
that title. Data loss of user-authored votes, plus a spent veto (`vetoRemaining: 0`, ratcheted by
BIN-540 so it cannot be re-armed) that could no longer be re-cast. The fix — `{...legacy, ...current}`,
namespaced winning per key — is the right shape.

**Q1 (cross-attribution) — NO.** Object spread is key-preserving: `votes` is keyed by participant id
and every merged entry keeps its own participant's value. Verified with a throwaway PoC
(`src/lib/together/_poc-bin608.test.ts`, 4 cases, run green, deleted; `git status` back to the same
four modified files): `indexSwipes([swipe(7,{b:'no',c:'veto'},null), swipe(7,{a:'yes',b:'yes'},'movie')])`
→ `{b:'yes', c:'veto', a:'yes'}` — b's namespaced `yes` wins over b's legacy `no`, c survives, no key
is renamed. No participant can gain another's vote through the merge, and the rules still bound what
lands in either doc: create requires `votes.size()==1` with the key `== auth.uid` or a
`voteKeyIsAnonSlot`; update requires `affectedKeys().hasOnly([auth.uid])` or `anonVoteAddOk()`
(add-only, one key, anon-slot-verified). The merge is a pure read-side view over keys the write rules
already authorized — it cannot mint a key nobody wrote.

**LOW #1 — `matching.ts:50-56` — an unattributable legacy key now feeds BOTH media namespaces even
after each has its own doc.** A legacy doc id `42` yields `mediaType: null`, so it merges into the
`movie_42` AND the `tv_42` candidate. Pre-fix that only happened when the namespaced doc was ABSENT;
post-fix it happens always, for every participant key not present in the namespaced doc. PoC:
`[swipe(42,{b:'veto'},null), swipe(42,{a:'yes'},'tv')]` → `votesFor({42,'tv'}) === {b:'veto', a:'yes'}`,
where the document-pick path returned `{a:'yes'}`. Impact: in a `mediaType: 'both'` deck (confirmed
real — `candidates.ts:114-115` `wantMovies`/`wantTV`, and `libraryExclusionIds` was composite-keyed in
BIN-560 Phase 4 precisely because both can appear), a participant who vetoed movie 42 pre-cutover also
sinks serie 42 — a candidate they never saw — and because `nextCandidate` reads the same merged view
they are never re-asked, so the phantom vote is uncorrectable by the user. This is the BIN-569
collision surviving inside legacy data, is explicitly named in the code's WHY comment and in
`tasks/todo.md` under "Known, accepted ambiguity", and the alternatives are worse (dropping legacy
loses real votes; a write-side fold-forward would overwrite a newer namespaced vote with an older
legacy one and re-adds the read-modify-write clobber M4 removed). Self-clears when the session TTLs.
**Not a blocker** — but the comment should not be read as "no behaviour change": it IS a change
relative to the last hour's deployed code, and the honest scope is "legacy docs keep BIN-569's
collision, now unconditionally instead of only when the namespaced doc is missing."

**LOW #2 — `firestore.rules:917` `match /swipes/{tmdbId}` format-guards nothing, so a legacy-shaped
doc id can be planted TODAY.** "Legacy docs only exist from before the cutover" is therefore false as
a security assumption. Post-fix, `swipes/99` with `{votes:{<self>:'veto'}}` is a single authorized
write that sinks both movie 99 and tv 99 (PoC case 4 confirms both lookups return the planted key),
where pre-fix the same plant was inert whenever a namespaced doc existed. **No privilege is gained** —
the writer can only insert their OWN key (or an anon slot's, the ADR 0015 residual), and they could
achieve the identical result with two ordinary writes to `movie_99` and `tv_99`. So this is
convenience, not escalation, and I am NOT requesting a change. Recorded because the next reviewer of
this collection should not assume the legacy branch is a closing migration window.

**Q2 (ADR 0015 residuals) — NOT materially worsened; not re-flagged.** Read ADR 0015 and
`accepted-deviations.md` in full. (a) Anon-vs-anon forgery: unchanged. The merge cannot introduce a
key the write rules reject; `anonVoteAddOk` still requires `anonShapedPid` plus a participant doc with
`uid == null`, so an anon caller still cannot touch a signed-in uid's key, in a legacy doc or a
namespaced one. The BIN-509 pre-plant class is likewise untouched (that lives in
`participants/{pid}`, not in this read path). (b) Session-expiry gate: unchanged — the diff adds no
write path and no expiry-sensitive read. Both remain exactly as decided; no re-proposal.

**Q3 (veto regain / double-cast) — the fix REDUCES both.** The veto budget lives on
`participants/{pid}.vetoRemaining`, ratcheted in rules by BIN-540; nothing in this diff reads or
writes it. Pre-fix, a hidden legacy veto made `nextCandidate` re-offer the title, i.e. the buggy state
was the one that invited a second cast; post-fix `participantSwipeProgress`/`nextCandidate` see the
merged view and the participant is not re-asked (the new test in `matching.test.ts` covers exactly
this). The only widening is LOW #1's blast radius: one already-spent veto can sink two candidates in
the tmdbId-collision case. **Correction to this log's own 2026-07-20 BIN-540 entry:** it stated the
ratchet "hard-caps SIGNED-IN participants at one veto per session". That overclaims. The ratchet caps
the FIELD; the swipe rules never read `vetoRemaining`, and `validVote` accepts `'veto'` on any swipe
doc, so a hostile client can write `'veto'` into every candidate's own-uid key without ever touching
its participant doc. ADR 0015's own Consequences section already says "the one-veto cap is UI-only",
so this is a documented residual, out of this diff's scope, and I am not filing it — but the
principles file now carries the correction so no future review cites the stronger claim.

**Q4 (rules/indexes) — CONFIRMED no change needed.** The read shape is identical: `subscribeToSwipes`
still does `onSnapshot(collection(db,'sessions',sessionId,'swipes'))`, covered by the existing
`allow read: if true` on `match /swipes/{tmdbId}`. No `where`/`orderBy` was added, so no composite or
collection-group index is required and `firestore.indexes.json` is correctly untouched. `indexSwipes`
is a pure in-memory transform of an already-fetched snapshot. Consequently this diff needs NO
`firebase deploy --only firestore:rules` — hosting via `deploy.yml` on push is sufficient, and the
rules/functions drift guard will not trip.

**GDPR.** No new collection, subcollection, doc shape or field, so `collectUserDataSnapshots` needs no
change (rule: a new doc-ID SCHEME in a covered collection is a no-op for a doc-id-agnostic `getDocs`;
here not even that changed). For the record, sessions are exported host-side only
(`userData.ts:208`, `where('hostUid','==',uid)`); a signed-in participant's uid-keyed vote inside
another host's session is not individually exported — pre-existing, and covered by ADR 0015's
ephemeral 7-day plus retentionCleanup model. Nothing new here to file.

**Other checks.** No secrets; no client-trust of an admin operation; no public-read surface added; no
moderation/blocking surface touched. `npx vitest run src/lib/together/matching.test.ts` → 27/27 green
(includes the 5 new BIN-608 cases, which correctly seed DIFFERENT participants across the two docs —
the prior BIN-569 test could not distinguish document-pick from value-merge, and `tasks/todo.md` names
that flaw honestly). `npx tsc --noEmit` exit 0. One tiny doc inaccuracy, non-security:
`tasks/todo.md`'s Files section says `src/lib/firebase/sessions.ts` — **unchanged**, but its comment
was in fact updated (comment-only, and the update is accurate).

Verdict: **APPROVED WITH NOTES** (two Low, neither blocking). Ship as its own commit; hosting-only
deploy; no rules, indexes or functions deploy required.

---

### 2026-07-29 — BIN-608 RE-REVIEW #2: is a PLANTABLE legacy swipe doc materially worse than ADR 0015?

**Invocation.** Second re-review of the BIN-608 working-tree diff (nothing staged; `git diff` vs HEAD
`0c83c45`). The dispatcher stated my previous marker's pinned shas were stale for
`src/lib/together/matching.ts` and `src/lib/together/matching.test.ts`, and asked me to (a) confirm
`src/lib/firebase/sessions.ts` was unchanged rather than assume it, (b) confirm the new docstring + test name
Low finding #1 honestly, and (c) RE-EXAMINE the `firestore.rules:917` observation with the merge confirmed:
with a plantable legacy doc, can a link-holder reach a vote key they could not reach by writing the
namespaced doc directly — in particular sink BOTH media types with one write — and is that materially worse
than the ADR 0015 accepted anon-forgery residual?

**Premise check — all three of the dispatcher's factual claims verified, none taken on trust.**
- `sessions.ts` blob is `68475a95c0adc488f5c49a1ff5714b59325dc18b`, byte-identical to the sha pinned in the
  previous marker. `git diff` shows -3/+4, all inside the `swipeDocToObject` doc-comment. CONFIRMED unchanged.
- `matching.ts` moved `860e577b` -> `02642dee`. Diffed the two blobs directly
  (`git cat-file blob 860e577b > prev; git diff --no-index prev <file>`): the ONLY delta is five added
  docstring lines. `indexSwipes`'s executable body is byte-identical to what I reviewed. CONFIRMED
  docstring-only.
- `matching.test.ts` moved `d6646ca0` -> `951e6d63`, +25/-4 against the previously reviewed blob: one existing
  case widened (participant `c` added with a legacy-only vote, renamed to "namespaced votes stay apart per
  media type even when a legacy doc is merged in") and one NEW case added, "an unattributable legacy veto
  sinks BOTH media types — accepted tradeoff", asserting `m.vetoed`, `t.vetoed` and
  `t.votes == { b:'veto', a:'yes' }`. CONFIRMED: Low #1 is now pinned by an executable assertion, not only
  prose. `tasks/todo.md` gained AC 6 saying exactly that, and honestly records WHY (all three reviewers found
  the original criterion-5 test seeded no legacy doc at all and so tested nothing).

**Docstring honesty — the load-bearing claim verified against the commit it names.** The new comment says the
merge "is NOT unchanged versus the intermediate state in 0c83c45: there the legacy doc was silenced as soon
as a namespaced doc existed, which 'healed' the collision by throwing the vote away." I read 0c83c45's
`indexSwipes` at HEAD: `byKey.get(...)?.votes ?? legacyByTmdbId.get(...)?.votes ?? {}` — document-level
fallback, so a present namespaced doc does suppress the legacy doc for BOTH media types. The claim is
accurate. This is the "an attestation comment is a load-bearing claim" principle applied and PASSING.

**MID-REVIEW TREE MUTATION — recorded because it nearly produced a false finding.** During the pass, `Read`
on `matching.ts` returned the NEW docstring attached to the OLD `??` body — a state that has never existed in
git. `git hash-object` said `02642dee` (the merge). Minutes later a `vitest` run went 7 RED, including the
pre-existing BIN-569 legacy-only case, and `git hash-object` had moved to `5757480c`, whose body read
`const legacy = candidate.mediaType === 'tv' ? legacyByTmdbId.get(...)?.votes : undefined;` — a concurrent
session mutation-testing AC 7 in the SAME checkout. I did not file anything against those bytes; I polled
until the file returned to `02642dee`, then re-ran: 28/28 green, `npx tsc --noEmit` exit 0. Every sha in the
marker was re-derived AFTER that. Two principles updated: mutation-proofing a shared checkout must restore
fast, and a reviewer must re-hash immediately before writing the marker.

**THE QUESTION ASKED. Verdict: SAME CLASS as the ADR 0015 accepted residual. NOT materially worse. NOT
blocking.**

Derivation (labeled DERIVED, not emulator-executed — legitimate here because the argument is that a variable
is ABSENT from the allow-expression, which is a property of the rules text, not of runtime state):

1. **The doc id is not referenced anywhere in the swipes authorization.** `match /swipes/{tmdbId}` (rules
   917-943) binds `create` to `swipeShapeOk() && votes.size()==1 && validVote(...) && (auth != null &&
   votes.keys().hasOnly([auth.uid]) || voteKeyIsAnonSlot(votes.keys()[0]))`, and `update` to
   `swipeShapeOk() && (auth != null && votes.diff(resource.data.votes).affectedKeys().hasOnly([auth.uid]) &&
   validVote(...) || anonVoteAddOk())`. The wildcard `tmdbId` appears in NEITHER. Therefore the set of vote
   KEYS an actor may write is identical on `42`, on `movie_42`, and on any other id. A plantable legacy doc
   grants NO new key.
2. **The writable key set is exactly ADR 0015's residual.** Signed-in: own `auth.uid` only. Anyone
   (unauthenticated OR signed-in, via the OR): any 32-lowercase-hex key K whose `participants/K` exists with
   `uid == null` — `voteKeyIsAnonSlot` + `anonShapedPid` (rules 797-808) make a signed-in participant's key
   structurally unreachable, which is BIN-509's guarantee and is untouched by this diff.
3. **The only delta is write ECONOMY.** One write to `42` reaches both `movie_42` and `tv_42`; two writes to
   the namespaced ids reach the same two candidates, and both writes are equally permitted. Impact ceiling
   identical; attacker cost halved. That is not a new capability.
4. **Precedence runs in the DEFENDER's favour.** `{ ...legacy, ...current }` gives the namespaced entry the
   win per key, so a planted legacy vote can NEVER override a genuine namespaced vote. The reverse ordering
   WOULD have been materially worse, and is the thing to check on any future merge of this shape.
5. **Uncorrectability is not made worse.** `nextCandidate` skips any candidate for which the participant has
   any vote in the merged view, so a forged vote is un-re-askable on EITHER route. On the namespaced route the
   victim additionally cannot overwrite it (`anonVoteAddOk` is add-only, and `recordSwipe` only writes
   first-votes) — so the legacy route is if anything the SOFTER of the two.

So: same class. Named in the marker as re-examined-and-closed, not re-filed as a finding, per
`.claude/rules/accepted-deviations.md` (2026-07-16, Malin's call against the full panel) and ADR 0015
Decision A.

**NEW, GENUINELY SEPARATE OBSERVATION — doc-id ALIASES (pre-existing in HEAD, NOT introduced by this diff).**
Chasing the plantability question turned up a sharper consequence of the same missing format guard.
`parseTmdbIdFromDocId` (`src/lib/mediaTypeDocId.ts:42`) slices after the FIRST underscore and accepts
`/^[0-9]+$/`, so `'movie_042'` parses to `{ mediaType:'movie', tmdbId:42 }` — the SAME `candidateKey` as the
genuine `'movie_42'`. `indexSwipes` builds `byKey` with `byKey.set(candidateKey(s), s)`, last-write-wins, so
one of the two docs' vote maps is discarded WHOLESALE. Likewise `'zmovie_42'` fails
`parseMediaTypeFromDocId`'s `startsWith` test, so it lands in `legacyByTmdbId` and can displace the genuine
legacy `'42'`. That is a single anon-forged write suppressing many participants' votes — precisely what ADR
0015's Consequences claims is impossible ("wholesale votes-map replacement is impossible for everyone").

Why this is NOT filed as blocking on this diff:
- It is pre-existing: `byKey.set(...)` is byte-identical to 0c83c45; this diff only changes the returned
  closure. The alias hazard shipped with BIN-569's cutover.
- The attack currently FAILS on the namespaced side. `subscribeToSwipes` (`sessions.ts:212`) is a bare
  `onSnapshot(collection(...))` with no `orderBy`, so docs arrive in `__name__` order. Every digit-string
  that is numerically 42 other than `'42'` itself carries a leading zero, and `'movie_0...' < 'movie_42'`, so
  the CANONICAL doc always sorts LAST and always wins the `Map` race. Real, but an implicit and untested
  invariant — nothing in the code or tests states it.
- On the legacy side (`'zmovie_42'` sorts after `'42'`) the alias CAN displace, but what it displaces is
  pre-cutover votes, which the currently-deployed HEAD already discards entirely the moment any namespaced
  vote exists. Relative to the DEPLOYED baseline the merge is still strictly better, and the whole legacy
  population self-clears at the session's 7-day TTL.

Recommended as a follow-up ticket (format-guard the doc id in rules —
`tmdbId.matches('^(movie_|tv_)?[1-9][0-9]*$')` — and/or make `parseTmdbIdFromDocId` reject leading zeros so
it is the STRICT inverse of `mediaTypeDocId`), not as a gate on BIN-608. Folded into the principles file as
its own bullet, since "a loose parser converts a missing format guard into wholesale replacement" is a class
I had not written down.

**Other checks re-run on the CURRENT bytes.** No rules or index change in the diff (`firestore.rules` and
`firestore.indexes.json` untouched; read shape unchanged, still covered by `allow read: if true`) => NO
`firebase deploy --only firestore:rules` required, hosting-only deploy. No GDPR collector change (no new
collection, subcollection, doc shape or field). No secrets. No new public-read surface. No client-trust of an
admin operation. No moderation/blocking surface touched. Checked the merge's referential-identity risk: the
closure now returns a FRESH object when both docs exist, but the only consumer of `result.votes` is a direct
render read (`TillsammansSessionPageClient.tsx:548`, `r.votes[me.id]`) — no dep array, no memo, so no render
loop. `tasks/todo.md` still lists `.claude/rules/data-model.md` under Files; that path is gitignored and can
never be part of a commit — noted again, not a finding.

**Both prior Low findings stand as recorded and are NOT re-filed.** #1 is now additionally pinned by a test
and named in the docstring — honestly, including the fact that it is a WIDENING versus 0c83c45 rather than a
no-op. #2 is re-examined above and closed as same-class.

Verdict: **APPROVED — no blocking finding.** Ship as its own commit; hosting-only deploy.

## 2026-07-29 — BIN-609: watchlist visibility read made fail-closed against the live owner profile

**Scope.** firestore.rules, src/test/rules/firestore-rules.test.ts, docs/workflow-map.html (uncommitted
working-tree diff, not yet staged). BIN-609 = BIN-587 "Option 2": BIN-587 shipped a visibility cascade
(profile toggle → re-stamp every watchlist item's denormalised `effectiveVisibility`/`isPublic`) plus a
pending-flag repair for when the cascade dies mid-flight. That left a residual: if BOTH the cascade AND its
own pending-flag write die (same network failure kills both), items keep serving the OLD, more-open value
forever, with no flag and no retry to ever fix it. BIN-609 closes that at the rules layer instead of trying
to make the client-side repair more reliable.

**The fix.** Two new rule functions, `profileAllowsPublic(uid)` / `profileAllowsFriends(uid)`, each doing a
privileged `get()` on `users/{uid}` (bypassing that doc's own owner-lock, same pattern `publicProfiles/{uid}`
already established) and checking `defaultVisibility` OR the legacy `isPublic` mirror. ANDed into all four
non-owner read clauses on `users/{uid}/watchlist/{itemId}` (public-tier, friends-tier, legacy isPublic-only,
and the pre-existing bakåt-fallback that already did a bare profile get() — this fix brings the other three up
to the same standard the fallback already had). Owner's own read (`isOwner(uid)`, unconditional, evaluated
first) is untouched. Cost: rules dedupe `get()` calls to the same path within one request evaluation, and a
list query IS one request, so this is +1 doc read per non-owner READ REQUEST, not per item — verified this
is real Firestore rules behavior (not just a comment's claim), consistent with how `users/{uid}`'s own get()
is already relied on elsewhere in this file for admin/friends checks.

**Verification actually performed, not just read:**
1. Ran the real emulator suite: `firebase emulators:exec --only firestore --project demo-binge-rules --
   vitest run --config vitest.rules.config.ts -t BIN-609` → 13/13 passed on the unmutated rules.
2. Traced the `isPublic` OR-bypass hypothesis (profile `isPublic:true` while `defaultVisibility:'private'`
   would let profileAllowsPublic wrongly return true) against AuthContext.tsx: `updateDefaultVisibility`
   (~line 813-815) always writes `isPublic: isPublicMirror` in the SAME update call, `isPublicMirror` derived
   from the SAME `visibility` argument — no client write path can desync the two fields, so the OR-branch is
   dead weight for the legacy-migration case only, not a live bypass.
3. Cross-checked every prose claim the diff added to docs/workflow-map.html against current source rather
   than trusting it: cascadeVisibilityToItems's throw-on-failure and `visibility == null` override-skip and
   450-doc batch chunking (AuthContext.tsx ~209-235); the epoch/queue/in-flight-guard ordering mechanics
   (~344-390, confirmed the actual ref names `visibilityEpoch`/`visibilityQueue`/`visibilityWritesInFlight`
   match the prose); the unrelated same-diff doc catch-ups for already-shipped BIN-600 (feed.tsx's
   `getPublicProfileCard` + `orderBy('updatedAt'/'createdAt','desc')`) and BIN-608 (matching.ts's
   per-participant vote merge, `indexSwipes`) — both were real, already-committed fixes the map just hadn't
   caught up to yet, not vaporware.
4. `node scripts/check-workflow-map.mjs` → OK, 90 nodes/28 flows, coverage 61/61.
5. **Mutation-proof attempt, partially blocked.** Replaced both new `&& profileAllowsX(uid)` clauses with
   `&& true`, reran the emulator suite to prove the BIN-609 tests actually die without the new clause (not a
   vacuous pass). The SECOND `firebase emulators:exec` invocation in the same session was blocked by the
   auto-mode classifier (reason string: "Blocked by classifier", no further detail — plausibly a
   rate-limit/heuristic on repeated emulator spin-up, not something task-specific). Restored the two-line
   mutation immediately and re-diffed against HEAD to confirm byte-identical to the pre-mutation state before
   doing anything else. Did NOT retry a third time or route around the block. Labeled the kill-verification
   DERIVED rather than executed: read each of the 13 tests and confirmed they seed a DISTINCT profile state
   (public/friends/private/legacy-isPublic-only/missing-profile-doc) against a FIXED item shape and assert the
   opposite of the pre-fix behavior — e.g. "DENIES a stale-public item once the profile has gone private" seeds
   `defaultVisibility:'private'` against an item whose `effectiveVisibility` is `'public'`, and nothing else in
   the rule denies exactly that combination — so a no-op `&& true` would flip at minimum that one assertion.
   This satisfies the knowledge file's "if blocked by tooling, say so and label DERIVED" allowance rather than
   claiming an executed mutation-kill that didn't finish.
6. Read the BIN-595 interaction tests deliberately: a per-item `visibility` override can only NARROW access
   past the profile, never widen it, because `cascadeVisibilityToItems` skips override items entirely and
   rules cannot distinguish a deliberate override from a stale un-cascaded value without trusting the exact
   item-local field BIN-609 exists to distrust. This is a known, accepted, and now explicitly test-pinned
   asymmetry (erring toward hidden), not a new finding — no per-title public-sharing UI exists today
   (`updateVisibility` is the only writer of the override field). Flagged in the marker as a live tripwire for
   future reviewers if a per-title share feature ever ships.

**Findings: none.** No accepted-deviation re-flagged (checked against ADR 0015's Tillsammans anon-vote/
session-expiry entries, blocking-hygiene, create-only reports — none apply to this surface, which is a
straight ownership/visibility read-gate on a per-user subcollection). Rules change is uncommitted — the
"needs a manual `firebase deploy --only firestore:rules` note" obligation applies whenever this is committed
and is worth restating to whoever ships it, since `deploy.yml` still only deploys hosting.

**Folded into the principles file:** merged into the existing "How to prove a finding" mutation-proof bullet
— added the explicit escape hatch for a mutation attempt interrupted by the harness itself (not a code
problem), since the prior wording only covered "PoC blocked by tooling" for a live-attack PoC, not a
kill-verification of an EXISTING fix already covered by a passing suite.

---

### 2026-07-30 — Salvage commit (BIN-617 sign-out latch reset, BIN-618 strict client doc-id parser, BIN-598/601/611 refactors): PASS, no findings

**Scope.** Staged diff, 26 files. Security-relevant per the dispatch: `src/contexts/AuthContext.tsx`
(BIN-617), `src/lib/mediaTypeDocId.ts` + `src/lib/together/matching.ts` (BIN-618). Reviewed the whole staged
set anyway (I am the last full-diff read). **`firestore.rules`, `firestore.indexes.json` and `functions/`
are untouched in BOTH index and working tree** — confirmed by empty `git diff --cached --stat` and
`git diff --stat` on those paths. BIN-609's rules change was parked, as the dispatch said; premise verified,
not assumed. Consequence: **no manual `firebase deploy --only firestore:rules` or `--only functions` is
required for this commit** — `deploy.yml` (hosting-only) is sufficient. That is a real finding-shaped fact,
recorded so a later reviewer doesn't infer a missing deploy note from the ticket titles.

**Q1 — BIN-617: does clearing `visibilityRetriedFor` on sign-out open an abuse path?**

The diff adds exactly one statement to the `else` (signed-out) branch of `onAuthStateChanged`:
`visibilityRetriedFor.current = null;`

Trace of the repair effect (AuthContext.tsx:532-545) — it fires only when ALL hold:
`uid` truthy · `user.defaultVisibility` loaded · `visibilitySyncPending` true (read off the PROFILE by
`ensureUserProfile`) · `visibilityRetriedFor.current !== uid` · `visibilityWritesInFlight.current === 0`.
The cascade (`cascadeVisibilityToItems`, :209-235) is bounded: ONE `getDocs` of the caller's OWN
`users/{uid}/watchlist`, filtered to docs with no per-item override, chunked into 450-doc batches, all writes
to the actor's own docs with the actor's own credential. On success it clears the profile flag, so the
retry never fires again for that account.

Abuse budget of "sign out / sign in in a loop": one cascade per successful sign-in, each costing the attacker
a real credential round-trip, each writing only their own documents, and only while the flag is true — i.e.
only while a previous cascade FAILED, in which case the writes aren't landing anyway. **This is not a new
capability:** every ref in this provider is per-page-load, so an F5 already cleared the latch. BIN-617 makes
the quota honestly "per login" instead of "per tab". No cross-account reach: the effect's `uid` is React
state, null while signed out, and the new account's `pendingVisibilityTarget`/`visibilitySyncPending` both
come from the NEW profile (`setUser(null)` + `setVisibilitySyncPending(false)` run in the same else-branch,
and the in-flight `ensureUserProfile.then` for the old user is guarded by
`auth.currentUser?.uid !== firebaseUser.uid`). Verdict: no abuse.

**Q1b — is "epoch and in-flight counter deliberately NOT reset" correct?** Yes, and the epoch one is
load-bearing in the SAFE direction. `visibilityEpoch` is a monotonic ordering stamp; `runVisibilityCascade`
captures it and re-checks `visibilityEpoch.current === epoch` before AND after the read, aborting as
`'superseded'` otherwise. Leaving it monotonic means a cascade still queued from account A when A signs out
is superseded the moment B requests one. Had the diff ALSO reset the epoch to 0, the next bump would produce
epoch 1 — the same value a pre-sign-out run could be holding — so that stale run would re-qualify as
`isCurrent()` and write its old visibility value. (Blast radius would still be small: `targetUid` is closed
over as A's uid and A's credential is gone, so the write fails at the rules layer rather than crossing
accounts — but "fails at the rules layer" is not a design.) `visibilityWritesInFlight` is balanced in
`updateDefaultVisibility`'s `finally` (:842-844); zeroing it on sign-out would let a re-login's auto-retry
start while an explicit choice is still descending, which is exactly the race BIN-587 built the counter to
stop. Both omissions are right, and the in-code comment states both accurately (attestation verified, not
trusted).

**Kill-check (executed, not derived).** Deleted the single added line, ran
`npx vitest run src/contexts/AuthContext.test.tsx` → exactly 1 of 16 failed, and it was the new BIN-617 test
(`expected getDocs to be called 2 times, got 1`). Restored from a scratchpad copy;
`git diff --quiet src/contexts/AuthContext.tsx` clean. The test is not vacuous: it drives a failing cascade
in session 1, signs out, signs back in as the SAME uid, and asserts a second `getDocs` plus two batch writes.

**Q2 — BIN-618: is the client-strict / server-permissive parser divergence exploitable server-side?**

New client rule: `parseTmdbIdFromDocId` now requires a `movie`/`tv` prefix (or none) AND a canonical numeric
body `^(?:0|[1-9][0-9]*)$`. `functions/src/shared/mediaTypeDocId.ts` keeps `/^[0-9]+$/` with no prefix
allow-list. Differing inputs: `movie_042`, `tv_0000042`, `042`, `zmovie_42`, `season_42`, `_42`.

Server reach, enumerated. `parseTmdbIdFromDocId` is called server-side ONLY via `resolveTmdbId`, and only as
the FALLBACK when the stored `tmdbId` field is absent or not a positive integer. Its six consumers are all
`collectionGroup('watchlist')` scanners: `availableNotify`, `priceDropNotify`, `streamingOffers`,
`insights/rollup`, `weeklyDigest`, `shared/followedSeries`. In every one, `uid` comes from the doc PATH
(`d.ref.parent.parent?.id`), never from the resolved id — so a resolved id can never route another user's
push. **tmdbTosSweep does not use the parser at all** (it keys on `d.path` via `isUserWatchlistDocPath` and
clears fields); the dispatch's suspicion there is unfounded. No callable resolves a swipe or watchlist doc id
from client input.

The decisive argument is DOMINANCE: `firestore.rules`' `isValidWatchlistItem` (:91-158) whitelists `tmdbId`
in `hasOnly` but binds NO value to it, and `match /users/{uid}/watchlist/{itemId}` format-constrains the doc
id not at all. So a user who wants a watchlist doc to resolve to title 42 just writes `tmdbId: 42` in the
FIELD — the doc-id fallback isn't even consulted. The permissive server parse therefore buys an attacker
nothing the unvalidated field doesn't already give, against a scope (own watchlist) that is self-owned
anyway. Every shared artefact the resolved id can touch (`availableNotifyState/{movie_42}` + its
`notified/{uid}` leaf, `streamingOffers/{movie_42}`) is equally reachable by legitimately adding title 42.
Rated **Info, not a finding.**

**Q2b — is the named gap FULLY closed on the client?** The gap I filed on the BIN-608 review was:
`parseTmdbIdFromDocId('movie_042') === 42` makes an alias share genuine `movie_42`'s `byKey` slot in
`indexSwipes`, last-write-wins, saved only by Firestore's `__name__` ordering (an implicit, untested
invariant). Re-traced at HEAD+diff: `swipeDocToObject` (sessions.ts:178-189) derives tmdbId from the doc id
ALONE — no field fallback — so the strict parser fully governs this path. `movie_042` → mediaType `'movie'`,
tmdbId `NaN` → `candidateKey` `'movie_NaN'`, a key no real candidate can produce. Bare `042` → mediaType
null → `legacyByTmdbId.set(NaN, …)`, and no candidate has a NaN tmdbId. Both aliasing routes closed; the
`__name__`-ordering dependence is gone.

**Kill-check (executed).** Reverted `parseTmdbIdFromDocId` to the permissive body (dropped the prefix
allow-list, restored `/^[0-9]+$/`), ran `matching.test.ts` + `mediaTypeDocId.test.ts` → exactly the 6 tests of
the new `aliased swipe doc ids cannot occupy the namespaced key (BIN-618)` block failed, nothing else.
Restored; `git diff --quiet src/lib/mediaTypeDocId.ts` clean. Note the tests are honest: `swipeFromDocId`
builds its fixture through the SAME two functions `swipeDocToObject` uses, so they exercise the real read
path rather than a hand-rolled copy.

**Q2c — does the new strictness DROP any legitimate document?** Audited every client writer of a per-title
doc id (`grep 'mediaTypeDocId('` across `src/`): all pass a numeric `tmdbId` off a typed `WatchlistItem` /
`SessionCandidate` / TMDB response, so no leading-zero or odd-prefix id can be produced. The CSV importer
(`src/app/settings/import/page.tsx`) routes through `addItem` with `best.id` from a TMDB search — a number.
Legacy bare ids predate namespacing and are plain decimal integers. Nothing legitimate becomes NaN.

**Residual (named, not filed).** The same alias class survives on the FIELD side at
`groups.ts:watchlistDocToObject` → `useGroupMemberProgress`, whose inner `Map` is keyed by bare numeric
tmdbId: a group member can write `groups/{g}/watchlist/<anything>` with `tmdbId: 42` and collide with the
genuine `tv_42` row. Pre-existing, untouched by this diff, and the progress leaf is per-uid; BIN-618
explicitly scoped itself to the swipe read path. Recorded here so a future reviewer finds it rather than
re-deriving it.

**Q3 — cross-user-readable data and GDPR export/delete.** No new collection or subcollection anywhere in the
diff; `src/lib/firebase/userData.ts` untouched, so `collectUserDataSnapshots` needs no change (`watchedAt`
is a FIELD on an already-covered doc, and `getDocs` is doc-id-agnostic). The public surfaces in the diff all
move the SAFE way: `taste/stats.ts` (public profile counter), `UserProfilePageClient` (public page),
`stats/page.tsx`, `WatchlistPage`, `DiaryPageClient` and `useServiceValue` all replace hand-copied
`status === 'sedd' && watchedAt != null` idioms with the single `seenWatchedAt` helper, which is strictly
the same gate. `WatchlistContext`'s `findCurrent` moves six mutators off the render-closure `items` onto
`itemsRef` — a cross-account IMPROVEMENT, since `itemsRef` is cleared unconditionally at the top of the uid
effect while the `items` STATE is only cleared inside `if (!uid)`. `shouldStampVisibility(current)` is
byte-equivalent to the `current?.visibility == null` it replaces (verified against the helper's body), so no
visibility semantics moved.

**Not re-filed (already decided or already recorded):** ADR 0015's anon-vs-anon vote forgery and the missing
Tillsammans session-expiry gate (`accepted-deviations.md`, Malin 2026-07-16); `match /swipes/{id}` not
format-guarding its doc id (same accepted class); blocking-as-hygiene; create-only reports. Also NOT re-filed:
the `items`/`tagsByTmdbId`/`notesByTmdbId` truthy→truthy uid-switch reset gap, filed Low on 2026-07-15 in
this archive and unchanged here.

**Also found (non-security, flagged to the parent).** BIN-601 makes `loading` stay TRUE forever after an
`onSnapshot` error (deliberately, per its comment), and BIN-596 adds `disabled={watchlistLoading}` to
`StatusButton` and `QuickAddButton`. Composed, a single transient listener error permanently disables the
primary add CTA for the rest of the session, showing only "Laddar ditt bibliotek…". Self-scoped availability,
no trust boundary crossed — not a security finding, but the two tickets' interaction looks unintended.
Separately, `docs/workflow-map.html` is modified but UNSTAGED; per the lessons digest map edits belong in
their own commit, so leaving it unstaged is correct.

**Verdict: PASS.** No findings at any severity. Tests re-run green after both restorations
(104 passed across the 5 security-relevant files).

**Folded into the principles file (in place, both merges):**
1. Rewrote the "A LOOSE doc-id parser makes ALIASES…" bullet — recorded the BIN-618 closure and added the
   general test for rating a client-strict/server-permissive parser divergence: ask what the server's parse
   can REACH, and whether an equally-powerful UNVALIDATED FIELD already dominates it (if so, Info, not a
   finding) — plus the footgun that a "keep in sync" comment on the copy WITHOUT the divergence note invites
   a resync that reverts the hardening.
2. Added a bullet to "Cross-account and cross-session leak classes", next to the existing sign-out-edge
   verification bullet: when a sign-out handler clears per-session refs, audit the reset SET — a per-login
   retry latch MUST clear, a MONOTONIC epoch must NOT (resetting to 0 lets a pre-sign-out run re-qualify as
   current) — and price the loosened latch as an abuse budget.
   Compressed ~10 unrelated bullets to keep the file under the 30,000-char cap (29,984).

---

### 2026-07-30 — Re-review of the BIN-596/598/601/617/618 salvage commit after the AuthContext repairs

**Context.** Third pass over the same staged commit (HEAD c276ced). I had PASSED the previous revision
with no findings. Regressions found afterwards were repaired; the repairs touch `AuthContext.tsx`
(a `visibilityRetryAttempts` cap + a `uidRef`) and `StatusButton.tsx` (a new `signIn()` on tap).
No `firestore.rules` / `firestore.indexes.json` / `functions/**` change — BIN-609 stays parked, so the
watchlist read rule still trusts the item-level `effectiveVisibility` field without consulting the profile.
That parking is what makes the visibility-repair path a genuine privacy mechanism rather than belt-and-braces.

**PREMISE CORRECTION (the dispatching prompt was wrong).** The prompt said "everything else in the diff is
as you last saw it". Diffing every current staged blob sha against the shas my previous marker pinned showed
FIVE files had moved, two of them security-relevant:
  - `src/lib/mediaTypeDocId.ts`  9308d1c -> 1755ec7
  - `src/contexts/WatchlistContext.tsx`  df12966 -> 29531f6
  - `src/components/title/QuickAddButton.tsx`  643b898 -> 0a5e424
  - `src/components/title/QuickAddButton.test.tsx`  a48b839 -> 1b328ce
  - `src/contexts/WatchlistContext.test.tsx`  4b99ad3 -> 0f598d4
I reviewed all five deltas. `mediaTypeDocId.ts` was header-comment only — it now states that the READ side is
deliberately NOT byte-identical to the server copy, which is exactly the "which copy carries the divergence
note" hardening I asked for last round, so: good, and finding 5 of the previous archive entry is closed.
`WatchlistContext.tsx` was comments plus two real changes (below). QuickAddButton got the same
`signedOut`/`notReady` split as StatusButton. This is the second time a dispatching prompt's scope claim has
been materially false; the sha-diff check is now a principle.

---

#### FINDING 1 (Medium, NEW, legal/consent — for Malin, not a code defect to silently fix)

`src/components/title/StatusButton.tsx:134` — `void signIn().catch(...)`.

**Trust boundary:** account creation, and the consent record that legitimizes it.

**Trace.** `signIn()` = `signInWithPopup(auth, GoogleAuthProvider)`. On success `onAuthStateChanged` fires ->
`ensureUserProfile` -> for a first-time visitor the `!snap.exists()` transaction at AuthContext.tsx:309-320
writes `termsAcceptedAt: serverTimestamp()`, `termsVersion: CURRENT_TERMS_VERSION`,
`ageConfirmedAt: serverTimestamp()`. The comment at AuthContext.tsx:283-288 states the justification
verbatim: "first sign-in via Google is browse-wrap consent — THE LOGIN PAGE shows a terms + 13+-age notice
at the Google button, so creating the doc records acceptance + age confirmation". That notice is
`src/app/login/page.tsx:108-117` ("Genom att fortsätta godkänner du Binges användarvillkor och
integritetspolicy och intygar att du är minst 13 år").

`StatusButton` renders on `MoviePageClient` (:322) and `TVShowPageClient` (:298, :421) — i.e. `/movie/[id]`
and `/tv/[id]`, the ~25 000 pre-rendered public title pages a signed-out visitor lands on from Google.
Those pages render no terms link and no age statement anywhere near the button. So the flow is: anonymous
visitor taps the status button on a title page -> Google popup -> an account exists carrying a recorded 13+
age confirmation and an accepted terms version, from a screen that asserted neither.

**Exploit/impact.** Not an attacker exploit — a self-inflicted evidence problem. The consent record Binge
would produce in a dispute (GDPR Art. 8 age, and the terms as a contract) is unsupported for every account
created this way; and the code comment attesting that the notice was shown is now FALSE for two of the three
`signIn()` call sites. A false safety attestation is worse than none.

**Scope honesty.** A WIDENING, not an opening: `QuickAddButton.tsx:108` has had exactly this notice-free
`signIn()` since before this diff (the diff only changes its guard from `!user` to `signedOut`). Full
call-site inventory today: `login/page.tsx:37` (notice present), `QuickAddButton.tsx:108` (absent,
pre-existing), `StatusButton.tsx:134` (absent, NEW here).

**Fix options considered.**
 a) Route both button taps to `/login?next=...` instead of calling `signIn()` directly. Costs a page
    transition and some of the "one tap to track" feel this diff was built to deliver.
 b) Render the one-line browse-wrap notice (the same paragraph as the login page, `MIN_AGE` + both links)
    inline next to the button. Cheap, but it is UI copy on 25k pages and therefore Malin's call.
 c) A small pre-popup confirm sheet carrying the notice, shared by both buttons. Most honest, most work.
 d) Do nothing and stop writing the consent fields outside the login path — REJECTED: an account with no
    `termsAcceptedAt` is worse than one with a weak one, and `ageConfirmedAt` is the Art. 8 hook.
Recommended: (c) or (b), applied to BOTH buttons together, so the AuthContext comment becomes true again.

**Severity argument for Medium, not High.** No data leak, no cross-user access, no forgery; the harm is
evidentiary/regulatory and materializes only in a complaint or an audit. Not Low, because CLAUDE.md routes
anything legal/privacy/interpretive to Malin explicitly, and because the in-code attestation is now false.

---

#### FINDING 2 (Low, NEW) — the per-tab retry counter couples accounts on a shared device

`src/contexts/AuthContext.tsx:364` (`visibilityRetryAttempts`), enforced at :557, spent at :559.

**Answering the two questions I was asked, plainly.**

*Can the cap be bypassed?* Not in any unbounded way.
 - Sign-out/sign-in in the same tab: the latch (`visibilityRetriedFor`) clears at :492 but the counter does
   not, so the ceiling holds at 3 sweeps per tab. The new test in AuthContext.test.tsx asserts exactly this
   (5 login/logout cycles -> `getDocs` called 3 times).
 - Second tab / reload: a fresh `AuthProvider` -> a fresh counter. Inherent to a per-tab ref, and the code
   comment says so. The per-page-load ceiling therefore moved 1 -> 3 versus HEAD. Bounded, and each extra
   sweep still costs a real credential round-trip.
 - `updateDefaultVisibility` (the radio buttons and Settings' "Försök igen nu",
   `UsernameSection.tsx:46/104`) neither checks nor increments the counter. Correct and load-bearing — it is
   the escape hatch (below), it is user-gestured, one sweep per click, on the actor's own docs, and it was
   already unbounded before this diff.
 - Account switch: shares the tab's counter. That is FINDING 2 itself, not a bypass.

*Does exhausting the cap trade a cost risk for a PRIVACY risk?* **No — not against what is deployed.**
The stuck state is real: profile says `private`, `visibilitySyncPending: true`, watchlist docs still carry
the older, more-open `effectiveVisibility`/`isPublic`, and with BIN-609 parked the read rule believes the
item field. But (a) prod today allows ONE auto attempt per page load and never resets the latch, so this
revision is strictly MORE repair than what users run right now; (b) the pending flag is persisted on the
profile doc and re-read by `ensureUserProfile` on every sign-in, so it never silently disappears;
(c) `UsernameSection.tsx:117-130` renders a danger-styled warning naming the exact risk plus an unbounded
"Försök igen nu" button that bypasses the counter entirely; (d) a reload grants 3 more. So the cap is not
the dangerous direction. I checked this specifically, because a cap on a privacy-repair loop is exactly the
shape that usually IS the dangerous direction.

**The residual that IS new.** The counter is per-TAB and account-agnostic, and it is spent on SUCCESS as
well as failure (`:559` runs before the cascade resolves, unconditionally).
 - Shared device: user A signs in/out three times in one tab with a persistently failing cascade (offline,
   or a permission denial specific to A) and burns the tab's whole budget. User B then signs into the SAME
   tab carrying their own `visibilitySyncPending: true` from an earlier session. B's effect returns at :557
   and B gets ZERO auto-repair attempts — while B's items keep the older, more-open visibility. At HEAD, B
   WOULD have got an attempt (`visibilityRetriedFor.current === 'A' !== 'B'` -> passes). So this is a small
   regression versus deployed behaviour on that specific path.
 - Same-account variant: three SUCCESSFUL repairs in one tab also exhaust the budget, so a fourth, genuinely
   new failed cascade gets no auto-repair in that tab. Counting successes against a failure budget is the
   wrong meter.
**Fix (cheap, no extra reads):** `useRef<Map<string, number>>` keyed by uid, and move the `+= 1` into the
`.catch` branch of the cascade promise (or leave it where it is and decrement on the `'applied'` outcome).
Both halves keep the cost ceiling intact — an attacker still needs a real sign-in per attempt, and every
read/write stays inside their own subtree.
**Why Low:** requires a shared device, a persistent failure, three cycles, and a second user who already
carries a pending flag; and all four mitigations above still apply to B.

---

#### VERIFIED CLEAN (with the reasoning, so a later pass need not redo it)

**`uidRef` maintenance (AuthContext.tsx:344, :446, :480).** `setUid` is called in exactly two places
(:445, :479) and `uidRef.current` is assigned immediately after each, synchronously, inside the same
`onAuthStateChanged` callback and before any `await`. Initial value `null` matches `uid`'s. Nothing else
writes it. `deleteAccount` (:918) and `signOut` (:628) both terminate in `firebaseSignOut` -> the null
branch, so both are covered. The ref therefore always LEADS the `uid` state and can never lag it — which is
the direction that matters, because the guard at :865 is `if (uidRef.current === uid)`: it re-arms the latch
only on a positive identity match, so any staleness would have to be stale-EQUAL to skip a needed repair,
and no path produces that.

**The late-catch-clobbers-a-fresh-repair scenario is closed by the epoch, not by the ref.** Traced: a cascade
for uid U fails slowly -> user signs out (latch cleared) -> signs back in as U -> the effect fires a new
attempt, which does `++visibilityEpoch.current` -> the OLD run's `isCurrent()` is now false, so
`runVisibilityCascade` returns `'superseded'` instead of throwing and the catch at :851 is never entered.
So no stale `markVisibilitySyncPending(uid, true)` can re-raise a warning the new run just cleared. The
epoch's deliberate non-reset on sign-out (BIN-617) is what makes this hold.

**`StatusButton`'s `signIn()` cannot loop or leak.** Guarded by `signedOut = !authLoading && uid == null`,
fires only from an `onClick`, passes no title or user data into the auth call, and a rejected popup (cancel,
blocked) lands in `.catch` -> toast. No state it sets can re-trigger itself.

**`WatchlistContext` deltas.** (1) Removing `listenerFailedRef.current = false` on snapshot success makes the
addedAt suppression terminal for the subscription — correct, since `onSnapshot`'s error callback detaches the
listener so no snapshot can follow it; the rewritten test now pins the real recovery path (re-subscribe)
instead of an impossible one. The consequence is data quality: a doc written without `addedAt` reads as
"added now" forever via `toDate`'s fallback and keeps counting in `taste/stats`' 30-day counter on the PUBLIC
profile. That is inaccuracy about a title that is already public under its own visibility gate — no new
disclosure, no trust boundary crossed. BIN-640 is filed for the proper fix.
(2) Adding `items` to the `setRuntime`/`refreshTmdbFields` dep arrays makes their identity change on every
snapshot. Checked for a write-loop against the 25 SEK/mån cap: `setRuntime` bails on `current.runtime != null`
so it self-terminates after one write per title; `refreshTmdbFields` marks `refreshedThisSession` (a ref-held
Set keyed `uid:docId`) SYNCHRONOUSLY before its first await, so callback re-creation cannot re-open the gate.
Both bounded at one write per title per session.

**Everything else.** No new collection or subcollection anywhere in the diff -> `userData.ts` untouched is
correct, `collectUserDataSnapshots` needs no change and `deleteAccount` leaks nothing new. No rules/indexes/
functions change -> no manual `firebase deploy --only firestore:rules` note is required for this commit, and
nothing in the diff depends on an undeployed rule. Secret scan over the staged diff: clean.

**NOT re-filed** (per `.claude/rules/accepted-deviations.md` + ADR 0015): anon-vs-anon Tillsammans vote
forgery; the missing session-expiry gate; `match /swipes/{id}` not format-guarding its doc id; blocking as
hygiene; create-only reports. Also not re-filed, as instructed: BIN-640, BIN-641, BIN-642, BIN-643, BIN-644.

**Info, not filed.** `QuickAddButton` computes `signedOut` from `!user` while `StatusButton` uses
`uid == null`. `user` is the Firestore profile, which lands an RTT after `uid` and is set to `null` when the
profile read FAILS (AuthContext.tsx:472) — so a signed-in user whose profile fetch failed reads as "signed
out" to QuickAddButton and is offered a Google popup they do not need. Pre-existing basis (unchanged from
HEAD), UX rather than security, but re-prompting an already-authenticated user for credentials is a bad
habit to teach; `uid == null` is the better test and both components should use it.

**Knowledge file edits made this round (in place):**
1. Rewrote the sign-out reset-SET bullet to cover the per-tab counter: it must not reset, but it then couples
   accounts — key it `Map<uid,n>` and increment only on FAILURE; and price such a trade against what is
   DEPLOYED, not against the intermediate staged revision.
2. Rewrote the consent-honesty bullet: the browse-wrap justification lives in a comment naming ONE screen, so
   any new `signIn()` call site silently falsifies it — grep every caller whenever one is added.
3. Rewrote the premise-challenge bullet: diff every current staged sha against the shas the last marker
   pinned before believing a prompt's "nothing else changed".
Compressed ~12 unrelated bullets to stay under the 30,000-char cap (29,997).

### 2026-07-30 — BIN-645 open-redirect (safeNextPath) attacked and held + BIN-641 rewatch write; consent gap CLOSED

HEAD 6407df5. Staged diff = 11 files (login page, QuickAddButton, nextPath.{ts,test.ts},
WatchlistContext, useMarkSeen, watchlistWrites, 3 test files, tasks/todo.md). No
firestore.rules / firestore.indexes.json / functions change — verified by
`git diff --cached --name-only` AND `git diff --name-only` on those paths, both empty.
Verdict: PASS, 2 Low, no blocker. The prompt's claim "no rules change is owed" is CORRECT.

## 1. The consent gap I filed as a Medium on 2026-07-30T09:58Z is now FULLY CLOSED

`grep -rn "signIn()" src/` returns exactly ONE production call site: `src/app/login/page.tsx:49`.
- QuickAddButton's inline `signIn()` is gone (BIN-645, this diff) → `router.push(loginHrefFor(pathname))`.
- StatusButton has no `signIn` at all any more (read the file: `useAuth()` is destructured only
  for `uid`, used for episodeProgress ownership). Its signed-out tap is now a dead click —
  that is parked BIN-596, explicitly out of scope, NOT re-filed.

PREMISE QUESTION MALIN ASKED, ANSWERED: **yes, /login shows the notice before account
creation.** `login/page.tsx:120-129` renders the browse-wrap `<p>` — "Genom att fortsätta
godkänner du Binges användarvillkor och integritetspolicy och intygar att du är minst 13 år"
with both `<Link>`s — UNCONDITIONALLY, directly under the "Logga in med Google" button
(lines 112-118). It is NOT inside a `mode === 'register'` guard; those guards start at line 138
and cover the name field, the two checkboxes (170-196) and the strength meter, i.e. the
stricter email/password path. So the AuthContext.tsx `ensureUserProfile` comment that
justifies the `termsAcceptedAt`/`termsVersion`/`ageConfirmedAt` stamp by naming "the login
page's villkor + 13+ notice" is TRUE for every call site for the first time.

## 2. safeNextPath — attacked properly, no bypass found

Implementation under review (`src/lib/nextPath.ts@002dfed8`):

    if (!raw) return null;
    if (raw[0] !== '/') return null;
    if (raw[1] === '/' || raw[1] === '\\') return null;
    for each charCode: if (code < 0x20 || code === 0x7f) return null;
    return raw;

### PoC (EXECUTED, not derived)

Throwaway `src/lib/_poc-nextpath-fuzz.test.ts` importing the REAL module, run with
`npx vitest run` alongside the shipped `nextPath.test.ts` → 18/18 pass. Deleted afterwards.
The decisive oracle is not "is it rejected" but "does an ACCEPTED value resolve off-origin":

    new URL(safeNextPath(x), 'https://binge.nu/film/603/').origin !== 'https://binge.nu'

- **Exhaustive index-1/index-2 codepoint sweep.** Every codepoint 0x00–0x2FFF placed at
  position 1 and 2 in four shapes (`/<c>evil`, `/<c>/evil`, `/<c>\evil`, `/<c><c>evil`),
  plus the lookalike-solidus set U+FF0F FULLWIDTH SOLIDUS, U+FF3C, U+FF20, U+2044, U+2215,
  U+29F8, U+FE68. **36 819 accepted inputs, 0 off-origin escapes, 0 parser throws.**
  Root cause it holds: WHATWG relative-URL parsing with a SPECIAL base enters
  "special authority ignore slashes" state ONLY when the char after the leading `/` is `/`
  or `\`. Everything else falls to path state with host = base host. Unicode solidus is not
  a URL delimiter (IDNA mapping of U+FF0F→U+002F applies to a HOST, and we never reach host
  state). So the two-character check is COMPLETE, not merely a common-case filter.
- **`%2f` / double-encoding round trip.** Attacker-written params `%2F%2Fevil.example`,
  `%252F%252Fevil.example`, `/%252F%252Fevil.example`, `%2f%5cevil.example`, `/%255Cevil…`,
  `%09%2F%2Fevil…`, `/..%2F%2Fevil…`, `/%2e%2e//evil…`, `https%3A%2F%2Fevil…` — every one
  either rejected or resolves same-origin. Key fact: `URLSearchParams` decodes ONCE and the
  URL parser does NOT decode `%2F` inside a path, so `/%2F%2Fevil.example` stays
  `https://binge.nu/%2F%2Fevil.example`. There is no second decode anywhere downstream.
- **Our own round trip is symmetric.** `loginHrefFor` = `encodeURIComponent(safeNextPath(p))`;
  `searchParams.get('next')` decodes exactly once. Asserted byte-identical for
  `/film/603/`, `/my/all`, `/user/mal in`, `/a%2Fb`, `/x?y=1#z`.
- **Whitespace/tab.** Browsers strip ASCII tab/LF/CR from a URL BEFORE query parsing, which
  helps us: `/login/?next=/<TAB>/evil.example` becomes `next=//evil.example` → rejected by the
  `//` guard. Anything that survives with a literal control char is killed by the codepoint
  scan. U+0020 and U+00A0 at index 1 pass but resolve to a path (`/%20/evil.example`).
- **`/..` traversal / backslash-in-path.** Only ever collapses WITHIN the origin
  (`/../evil` → `https://binge.nu/evil`); for special URLs `\` in a path is normalised to `/`,
  still same-origin.
- **`raw === '/'`** → `raw[1]` undefined → accepted, correct.

### router.push vs window.location.assign — IDENTICAL here

Next 16.2.9. `node_modules/next/dist/client/components/app-router-instance.js:219`:
`const url = new URL(addBasePath(href), location.href)` then
`isExternalUrl: isExternalURL(url)`; `app-router-utils.js:25-27`:
`isExternalURL = url.origin !== window.location.origin`. Same parser, same origin test, and
`next.config.mjs` sets no `basePath` so `addBasePath` is identity. There is no branch where an
accepted value becomes a hard `window.location.href =` off-site. So the fuzz above covers
`router.push` too — no separate analysis needed (re-check if `basePath` is ever introduced).

### KILL-CHECK — EXECUTED

Replaced ONLY `if (raw[1] === '/' || raw[1] === '\\') return null;` with `if (false) return null;`.
Result: 6 tests failed — the 3 shipped ones ("rejects a protocol-relative URL", "rejects a
backslash variant", "falls back to a bare /login/") and all 3 of my PoC tests including the
exhaustive sweep, which reported live off-origin escapes. That proves the earlier green run was
NOT vacuous. Restored from a scratchpad copy; `git diff --quiet -- src/lib/nextPath.ts` clean and
`git rev-parse :src/lib/nextPath.ts` == `git hash-object src/lib/nextPath.ts` == `002dfed8…`
(unchanged before and after). PoC file deleted; `git status --porcelain` shows only the 11
intended staged entries.

## 3. FINDING — Low — the `?next=` value leaves the origin via Firebase's auth handler

`src/app/login/page.tsx:42` (and `src/lib/nextPath.ts:49`, which puts it in the URL).
Firebase Auth's `_openPopup` calls `_getRedirectUrl(auth, provider, authType, _getCurrentUrl(), …)`
(confirmed in `node_modules/firebase/firebase-auth.js`: `…_open(e,await _getRedirectUrl(e,t,r,
_getCurrentUrl(),n)…` and `const a={apiKey:…,authType:r,redirectUrl:n,…}`), which places the FULL
current page URL in a `redirectUrl` QUERY PARAM on `https://<authDomain>/__/auth/handler?…`.
`.env.local` has `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=binge-nu.firebaseapp.com` — a Google-hosted
origin, not binge.nu.

Before BIN-645 the login URL was a bare `/login/`. Now it is `/login/?next=%2Ffilm%2F603%2F`, so
the title the visitor was reading at the moment of sign-in is newly disclosed cross-origin. It
rides in a QUERY STRING, which no `Referrer-Policy` constrains (unlike the Referer header, which
under the modern default `strict-origin-when-cross-origin` would send only the origin).

Impact: behavioural data (which title), to a processor already named in the privacy policy and
already performing the sign-in. No credential, no PII, no third party outside Google. LOW.
Fix options: (a) accept and note it; (b) carry the return path in `sessionStorage` instead of the
query — QuickAddButton writes it, the login page reads and clears it on mount — which keeps the
value entirely in-browser and also removes the whole open-redirect parse surface. Malin's call.

## 4. FINDING — Low — `next` may carry a query, and one internal route acts on load

`src/lib/nextPath.ts:24` accepts `?`-bearing paths (deliberately — the shipped test wants
`/my/all?status=sedd`). `src/components/pages/GroupPageClient.tsx:66-90`: `?invite=<token>`
triggers `joinGroupViaToken` from a `useEffect` on mount, with no confirmation.

So a hand-crafted `/login/?next=%2Fgrupper%2FX%3Finvite%3DT` joins a SIGNED-OUT visitor — or a
brand-new account created in that very flow — into a stranger's group immediately after sign-in,
exposing their library/progress to that group's members.

Honest severity accounting: a signed-IN victim can already be joined by the bare invite link
(that is the designed one-click behaviour, and leaving is in-app). What is NEW is the signed-out
/ new-account case: today `AuthGuard.tsx:19` pushes a bare `/login` with no `next`, so after
sign-in the victim lands on `/` and never joins. LOW, not Medium: the harm ceiling equals the
invite link's intended behaviour and it is reversible.

Nothing in THIS diff produces such a link — `loginHrefFor(pathname ?? '/')` is called with
`usePathname()`, which excludes the query. The exposure is that the login page accepts one.
Fix options: (a) accept; (b) confirm-before-join when the group page is reached in the same tick
as a sign-in; (c) strip the query in `safeNextPath` — but that also drops `/my/all?status=sedd`,
so it fights the feature.

## 5. BIN-641 — verified clean, no rules/index change owed

- `opts` is a SECOND PARAMETER. `setDoc` (WatchlistContext.tsx:409) spreads only `itemFields`,
  destructured from `item`; `opts` is never spread, never referenced in the payload except as the
  boolean gate at :450. So `countsAsViewing` provably cannot reach Firestore, and the new test
  proves it by KEY-SET DIFF (`withIntent.filter(k => k !== 'rewatchCount')` equals the no-intent
  key set) rather than by a single `not.toContain`.
- `rewatchCount` is already in `isValidWatchlistItem`'s `hasOnly` (firestore.rules:95) — the
  library status menu writes it today via `buildStatusUpdate`. Merge-write passes. No new query →
  no index. So NO rules change is owed; I agree with the prompt and would have blocked otherwise.
- Enumerated all 10 `addItem` call sites: settings/import/page.tsx:116, CompanionSection:157,
  OnboardingFlow:239, MoviePageClient:193, QuickRateModal:82, CollectionSection:112,
  QuickAddButton:57, StatusButton:60, useMarkSeen:65 and :91. ONLY the two `useMarkSeen` calls
  pass a second argument. The CSV importer and onboarding are clean, as required.
- No double count: each useMarkSeen branch writes once; the TV branch lands `status:'mina'`, so
  `isRewatchWrite('mina', …)` is false — the flag there is intentionally a no-op.
- Scope is slightly WIDER than "the film page": QuickAddButton's poster-grid "Sedd" also routes
  through markSeen, so a grid re-mark counts too. Consistent with the stated semantics ("did a
  human say they watched it"), just worth knowing. Not a defect.
- Info: `rewatchCount` has a `hasOnly` entry but NO value bind, unlike `rating` (0–5),
  `ratedAt`/`tmdbFieldsRefreshedAt`/`providersCheckedAt`/`nextAirUpdatedAt` (type + `<=
  request.time`). Pre-existing, not introduced here, self-owned doc — but watchlist docs are
  publicly readable when public, and `(current.rewatchCount ?? 0) + 1` on a junk stored string
  yields junk. Fold `(!('rewatchCount' in d) || d.rewatchCount == null || (d.rewatchCount is int
  && d.rewatchCount >= 0))` into the NEXT rules edit; not owed by this commit.
- Info: the BIN-641 comments at useMarkSeen.ts:77-81 and :98-100 sit INSIDE the
  `buildWatchlistAddPayload({…})` object literal while describing the second argument, so they
  read as if `countsAsViewing` were a payload field — the exact confusion the design avoids.

## 6. GDPR / secrets / deploy

No new collection or subcollection anywhere; `src/lib/firebase/userData.ts` untouched is
CORRECT — `rewatchCount` is a field on an already-covered doc and `getDocs` is doc-id-agnostic,
so `collectUserDataSnapshots` needs no change and `deleteAccount` leaks nothing new.
Secret scan over the staged diff (AIza…, BEGIN …, api_key/secret literals): clean.
Deploy: hosting-only, i.e. `deploy.yml` suffices. No `firebase deploy --only firestore:rules`
required or implied by this commit.

## 7. NOT re-filed

Per `.claude/rules/accepted-deviations.md` + ADR 0015: anon-vs-anon Tillsammans vote forgery;
the missing session-expiry gate; blocking-as-hygiene; create-only reports; `match /swipes/{id}`
not format-guarding its doc id. Per the invocation: BIN-640, BIN-642, BIN-643, BIN-644, BIN-646;
and BIN-596/598/601/617 as parked, including StatusButton's signed-out dead-click.

## 8. Also found (not security, for whoever ships this)

- `<Suspense fallback={null}>` wraps the ENTIRE login page (login/page.tsx:222-228). Under
  `output: 'export'` a `useSearchParams` page bails out to client rendering, so the exported
  `/login/index.html` body is effectively empty — the villkor notice, the Google button and the
  form all appear only after hydration. Fail-CLOSED (no button either, so no consent problem),
  but a first-paint regression on the auth page. `src/app/search/page.tsx:124` uses the same
  pattern with `<LoadingView label="Laddar sökningen…" />`, which is also what
  `.claude/rules/design-system.md` prescribes ("Laddning: LoadingView — inte en bar sträng").
- `loginHrefFor(pathname ?? '/')` drops the query string (`usePathname()` excludes it), so a
  signed-out tap on a poster in `/sok?q=…` or a filtered library grid returns the visitor to the
  unfiltered page. `loginHrefFor` already takes a `search` argument — but read finding 4 first.
- A brand-new Google account goes to `/onboarding/` and the `next` destination is discarded
  (login/page.tsx:43). Deliberate per the comment, and correct, but it means the ticket's
  "returns to the page they were reading" holds for RETURNING users only.

### 2026-07-30 — BIN-645 v2: the `?next=` carrier moved to sessionStorage (re-review of a PASS)

**Context.** Second security review of the same staged commit. My 2026-07-30T20:05Z marker
(HEAD=6407df5) passed it with two Lows, both against the `?next=` QUERY PARAM:
  Low 1 — the value leaves the origin. Firebase `_openPopup` -> `_getRedirectUrl(..., _getCurrentUrl())`
          puts the FULL current page URL in a `redirectUrl` QUERY on `<authDomain>/__/auth/handler`,
          and `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=binge-nu.firebaseapp.com` is Google-hosted. So
          `/login/?next=%2Ffilm%2F603%2F` disclosed which title she was reading, cross-origin.
          Referrer-Policy constrains the Referer header, not a query string.
  Low 2 — `/login/?next=%2Fgrupper%2FX%3Finvite%3DT` auto-joins a signed-out or brand-new account
          into a stranger's group (GroupPageClient auto-joins from a mount effect, no confirm).
Both were DESIGNED OUT rather than accepted. This entry records the re-review of the new shape.

**What actually changed (5 of 11 staged blobs moved; 6 byte-identical).**
  moved:  src/lib/nextPath.ts 002dfed->3b69b15 · src/lib/nextPath.test.ts 97a5881->6ffc528
          src/app/login/page.tsx 423c7f1->4c7c719 · QuickAddButton.tsx ab068aa->e9239fc
          QuickAddButton.test.tsx 351fe1c->7c3e03c
  same:   WatchlistContext.{tsx,test.tsx} · useMarkSeen.{ts,test.tsx} · watchlistWrites.ts ·
          tasks/todo.md  -> BIN-641 spot-check discharged by SHA EQUALITY, no re-read needed.
`git diff 002dfed 3b69b15` (blob-to-blob) showed `loginHrefFor` DELETED, `rememberNextPath` /
`takeNextPath` added, and the body of `safeNextPath` UNCHANGED byte-for-byte — so the exhaustive
fuzz (36 819 accepted inputs, every codepoint 0x00-0x2FFF at index 1 and 2, four shapes, the
lookalike-solidus set; 0 off-origin escapes) and the executed kill-check from the prior pass still
apply to the shipped bytes. Not re-run; carried forward by blob identity, which is stronger.

**The five questions I was asked, answered from the bytes.**

1. *Is sessionStorage genuinely unreachable cross-origin here, and does the popup return to the SAME
   document?* Yes and yes. sessionStorage is keyed on the DOCUMENT origin (`https://binge.nu`) —
   Cloudflare is a reverse proxy, so it does not change the origin, and unlike cookies storage never
   spans subdomains. `binge-nu.firebaseapp.com` is a distinct origin with its own bucket.
   `grep -rn "signInWithRedirect|getRedirectResult|browserPopupRedirectResolver" src/` -> NONE;
   AuthContext.tsx:541 is `signInWithPopup` only. A popup never navigates the OPENER, so the value
   is not merely "restored" — it is never disturbed. `router.push('/login/')` is a client-side nav
   in the same document. Even a hypothetical redirect flow would survive (sessionStorage is per
   top-level browsing context and persists across same-tab navigations), so the property does not
   depend on the popup choice. Residual, non-issue: a `target=_blank` child tab inherits a COPY of
   the opener's sessionStorage, so a duplicated tab can hold a stale return path — same-origin, the
   visitor's own path, strictly narrower than the back button.
2. *Is validating on both sides sufficient, or does consume-on-read introduce a new problem?*
   Sufficient for the security property. It does introduce a CORRECTNESS one:
   `takeNextPath()` is called unconditionally inside login/page.tsx's `useEffect(..., [user, router])`,
   so a SECOND run of that effect reads null and pushes `'/'`, silently overriding the first run's
   destination. React StrictMode double-invokes effects in dev and is on by default (Next 16.2.12,
   `reactStrictMode` not set in next.config.mjs) — so this is the DEV behaviour today. In production
   I traced setUser and found exactly one transition on this page (onAuthStateChanged -> uid/loading,
   `user` still null -> effect returns early; ensureUserProfile resolves -> setUser(profile) -> one
   run; LoginPage then unmounts). No other setUser fires while on /login. Filed as a Low,
   non-blocking. Fix: a `const redirected = useRef(false)` gate, or hoist the read into a lazy ref.
   Stranded-value: `takeNextPath` is reached ONLY after `user` is non-null, i.e. after a SUCCESSFUL
   sign-in — so a cancelled Google popup leaves the value intact and the subsequent email sign-in
   still lands correctly. That is Q5, answered: the retry is preserved by construction.
   Two tabs: sessionStorage is per-tab, so no cross-tab collision.
3. *Key collisions?* `grep -rn sessionStorage src/` -> exactly two owners: `binge:nextAfterLogin`
   (nextPath.ts) and `binge:lastReportAt` (reports.ts, the BIN-49 report cooldown). Disjoint.
   `binge:wasLoggedIn` is localStorage, a different area. nextPath.test.ts's `beforeEach` calls
   `sessionStorage.clear()` — file-scoped jsdom, no cross-suite effect.
4. *Can an `?invite=` path still be stored?* No. `rememberNextPath` has ONE call site
   (QuickAddButton.tsx:104) and its argument is `usePathname()`, which excludes the query by
   definition. `safeNextPath` still ACCEPTS a query (deliberately — `/my/all?status=sedd` is in the
   shipped test), so the closure is structural at the WRITE site, not at the filter. The only other
   writer would be an XSS on our own origin, which dominates the finding. Low 2 is closed.
5. *Does single-use `removeItem` break a legitimate retry?* No — see (2). It DOES discard the value
   in the onboarding branch (`const next = takeNextPath()` runs before the branch, and a brand-new
   account is sent to `/onboarding/`), which is the previously-noted, deliberate product call.

**Also confirmed.**
- The non-security note from the prior pass is RESOLVED: `useSearchParams` is gone from the login
  page, so the `<Suspense fallback={null}>` wrapper is gone too. Verified structurally (no bail-out
  -> no client-render fallback under `output:'export'`) and against the stale `out/login/index.html`
  from 2026-07-14, which is the same shape and DOES contain "Logga in med Google", the villkor and
  integritet links, "intygar att du är minst 13 år" and the mode toggle in static HTML.
- Consent attestation still holds: `grep -rn "signIn()" src/` -> ONE production call site,
  login/page.tsx:48. The notice (login/page.tsx:122-128) renders unconditionally, outside every
  `mode === 'register'` guard, directly under the Google button.
- No `firestore.rules` / `firestore.indexes.json` / `functions/**` change staged OR unstaged.
  `rewatchCount` is already in `isValidWatchlistItem`'s `hasOnly`. Hosting-only deploy is sufficient.
- No GDPR obligation: sessionStorage is ephemeral client-local state holding a path, not a Firestore
  collection; `userData.ts` correctly untouched.
- Not re-filed: the accepted-deviations entry added today (fail-open `effectiveVisibility` watchlist
  read rule, BIN-609 CANCELED, Malin's 2026-07-30 call) — read, not raised. Ditto ADR 0015's two
  Tillsammans residuals, blocking-as-hygiene, create-only reports, and BIN-640/642/643/644/646.

**Findings this round.**
- Low — src/app/login/page.tsx:41-43 — consume-on-read makes the redirect effect non-idempotent (2).
- Info — src/app/login/page.tsx:39-40 — ORPHANED COMMENT. It still reads "`safeNextPath` is what
  stops `?next=https://evil.example` turning a genuine sign-in on binge.nu into a hop onto someone
  else's site." Neither half is true of the shipped code: the function called there is
  `takeNextPath`, and there is no `?next=` param anywhere. Per this file's own principle, a false
  safety comment is worse than none — this one specifically invites the next author to re-add a
  query param believing it is already guarded. One-line rewrite.
- Info — src/lib/nextPath.ts:11-13, and the mirrored prose in nextPath.test.ts and
  QuickAddButton.test.tsx, assert "sessionStorage never travels" / "nothing can write another
  origin's sessionStorage". Both are TRUE — verified above, not taken on trust — and are the good
  kind of attestation: they name the mechanism and the reason.

**Verdict: PASS.** Both prior Lows are genuinely closed at the mechanism level rather than
filtered, which is the stronger fix. One new Low (dev-visible, non-security) and two Infos.

**Rejected alternatives, recorded.** (a) Keeping `?next=` and stripping the query in `safeNextPath`
— would have killed `/my/all?status=sedd` and still leaked the path cross-origin; rejected. (b)
Keeping `?next=` and adding a confirm-before-join on the group page — narrower blast radius but
leaves Low 1 open and adds a second UI surface; not taken. (c) localStorage instead of
sessionStorage — would persist the return path across browser restarts and across tabs, widening
the stranded-value window for no benefit; sessionStorage is the right scope.

**Lesson folded into the principles file (in place).** The `?next=` bullet in "Server-only
collections, public rollups, external input" was rewritten from "the residual risk is never the
parse" to "the parse is never the residual — the CARRIER is", now carrying the sessionStorage fix,
its per-tab / `target=_blank` semantics, the `usePathname()`-cannot-carry-a-query closure, the
`useSearchParams` -> Suspense -> empty-prerendered-consent-notice link, and the consume-on-read
non-idempotence trap. The attestation bullet gained "A REDESIGN orphans comments". The
premise-challenge bullet gained "scope a RE-review by SHA — equality IS the spot-check". The
consent bullet's stale "`/login/?next=`" was corrected to "`/login/`". Net: file trimmed from
30 170 to 29 965 chars (it arrived already over the 30 000 budget), by compressing the seed
checklist, the BIN-592/617/618 bullets, marker hygiene and the forward-revert bullet.

### 2026-07-31 — BIN-645 v3: the return path's carrier got widened back to a query, and the redirect latch

Third security pass on the same staged surface (HEAD 6407df5, 12 files staged). Verdict PASS,
1 Low + 2 Info, no blocker, no rules/functions/indexes change owed.

SCOPE, DERIVED BY SHA DIFF AGAINST MY 20:44Z MARKER
  MOVED  src/app/login/page.tsx 4c7c719->64c9374 · QuickAddButton.tsx e9239fc->288969f
         QuickAddButton.test.tsx 7c3e03c->f2dd25d · nextPath.test.ts 6ffc528->294e416
         WatchlistContext.tsx 57a1ecf->d5f2f69 · watchlistWrites.ts f6c3173->8f5ef42
  NEW    src/app/login/page.test.tsx (the 12th file; my last marker pinned 11)
  SAME   nextPath.ts 3b69b15 · WatchlistContext.test.tsx · useMarkSeen.ts + .test.tsx · todo.md
BIN-641's write logic (useMarkSeen.ts@56330ea) is byte-identical to what I verified at 20:05Z
and re-confirmed at 20:44Z — spot-check discharged by sha equality, as the invocation asked.
Blob-to-blob diffs proved WatchlistContext.tsx and watchlistWrites.ts are COMMENT-ONLY: the
latter is a pure relocation of the isRewatchWrite JSDoc back above its own function (it had been
wedged between planQuickRateWrite's doc block and planQuickRateWrite), body identical.

THE ATTACK I WAS ASKED TO MOUNT: CAN A CRAFTED LINK GET A DANGEROUS PATH STORED?
The write site changed from usePathname() to window.location.pathname + window.location.search
(QuickAddButton.tsx:108). That is a real widening of the trust boundary and I treated it as one:
the v2 argument I approved was "the writer CANNOT express a query", which is now false. The
stored value is whatever URL the visitor's address bar holds at tap time, and an attacker chooses
that URL by choosing the link the victim opens.

Attack shape: send victim https://binge.nu/grupper/X?invite=TOKEN; get them to tap a "+" badge
while signed out; the path is stored; after sign-in router.push() replays it; GroupPageClient's
mount effect auto-joins with no confirmation, on a brand-new account. The escalation is real
because the SAME url is inert while signed out and acts once signed in.

Why it does not work today, traced rather than assumed:
 1. Full enumeration of query consumers — grep -rn "useSearchParams|URLSearchParams|location.search"
    over src/app, src/components, src/hooks, src/lib — yields exactly: InsikterClient (token),
    useDateRange (range), useSelectedMetric (metric), recommendations (row), search (q),
    SeasonPageClient + TVShowPageClient (fromGroup), WatchlistPage (provider, status),
    GroupPageClient (invite), QuickAddButton itself. Exactly ONE has a mutating mount effect:
    invite.
 2. GroupPageClient is <AuthGuard>-wrapped (line 56). AuthGuard renders LoadingView while
    resolving and null when !uid — so a signed-out visitor on that URL sees NO group content and
    therefore no QuickAddButton. There is nothing to tap, so nothing to store.
 3. QuickAddButton stores ONLY in its signedOut branch. A signed-in visitor never writes the key
    at all — and for a signed-in visitor the invite would already have fired on its own.
 4. fromGroup is the only other query reaching Firestore and it is READ-only (useGroup,
    useGroupMemberProgress); a non-member's read is denied by rules. /tv/{id}?fromGroup=X IS
    storable (public route, renders TitleCard -> QuickAddButton), which is why I checked it.
 5. safeNextPath still blocks the URL-shaped escapes at BOTH ends: location.pathname CAN start
    with // (navigate to https://binge.nu//evil.example/), and that is rejected by the index-1
    test on write and again on read. The browser percent-encodes C0 controls in search, so the
    control-char scan has nothing left to catch there.

So: no reachable exploit. But the property that makes it safe is no longer the carrier — it is a
composition of AuthGuard placement, "mutating mount effects require auth", and "the badge stores
only when signed out", spread across four files with nothing asserting it. That is the finding.

FINDING — Low — src/lib/nextPath.ts:16-21 (blob UNCHANGED) + src/components/title/QuickAddButton.tsx:108
  risk: nextPath.ts still swears "A query param is attacker-supplied; this is not. … Nothing can
    write another origin's sessionStorage, so that whole class is gone rather than merely
    filtered." After v3 the second sentence is still true and the first is not: the value is
    derived from a URL the attacker can choose. A byte-identical file's ATTESTATION was falsified
    by a change in a different file of the same diff — which a sha-based spot-check cannot see.
  impact: no exploit today (see the five-step trace). The cost is future: the comment tells the
    next author the class is structurally closed, so adding a query-driven mount action to any
    PUBLIC route — or dropping AuthGuard from the group page — silently re-opens the one-click
    group-join, and the diff that does it will not look security-relevant.
  trust boundary: attacker-chosen input -> post-authentication navigation target.
  fix (either): (a) restore the structural property — allowlist the query KEYS at the write site
    (q, status, provider, row covers every legitimate return-to-context today), so invite cannot
    be expressed; or (b) keep the widening and rewrite the nextPath.ts paragraph to state the REAL
    invariant plus a test that fails if a public route gains a mutating query handler.
  I recommend (a): it is ~6 lines, it kills the class again instead of documenting it, and it
  costs the feature nothing — /sok?q= was the entire motivation.

INFO — src/app/login/page.tsx:29-31 — the latch comment says refs "survive the StrictMode remount,
  which is the whole reason it isn't state". Refs do survive — but so does state; the actual
  reason a ref is required is that a state update is not visible to a second SYNCHRONOUS effect
  run. Harmless today, mildly misleading if someone revisits it.

INFO — the login page's orphaned safeNextPath comment I filed at 20:44Z is FIXED; the new text
  points at nextPath.ts and names sessionStorage. Recorded so the next pass does not re-file it.

THE LATCH: CAN IT STRAND A USER? No, and the reasons are structural.
 - A FAILED sign-in cannot set it: redirectedRef.current = true sits inside the effect AFTER the
   `if (!user || redirectedRef.current) return;` guard, so it is reached only once user is
   non-null, i.e. only after a sign-in has SUCCEEDED. A cancelled Google popup or a rejected
   password leaves both the latch and the stored path untouched, and the retry lands correctly.
 - Nothing between latch and navigate can throw: takeNextPath() wraps get+remove in try/catch and
   returns null on SecurityError (nextPath.test.ts covers read-side AND write-side failure). Had
   it thrown, the latch would already be set and the redirect lost for that mount — that is the
   one shape that would have stranded a signed-in user on the login form.
 - A second account in the same tab needs LoginPage to still be mounted; the first redirect
   navigates away and a later return to /login/ is a fresh mount with a fresh ref. The only way
   to stay mounted is router.push('/login/') — reachable only if /login/ were ever the stored
   value, and rememberNextPath has exactly one caller which never renders on the login page.
   Worth knowing if a second caller is ever added.
 - Coverage gap is real and honestly declared in page.test.tsx:79-86 (deleting the latch leaves
   every case green) — BIN-652, not re-filed.

NOT RE-FILED: BIN-609 / the fail-open effectiveVisibility watchlist read rule (CANCELED, Malin's
call, accepted-deviations read in full); anon-vs-anon Tillsammans forgery; the missing
session-expiry gate; blocking-as-hygiene; create-only reports. Out of scope per the invocation:
BIN-640/642/643/644/646/652 and parked BIN-596/598/601/617.

ALSO CHECKED, ALL CLEAN: no firestore.rules / firestore.indexes.json / functions/** change staged
OR unstaged, so no manual `firebase deploy --only firestore:rules` is owed and hosting-only
deploy.yml suffices. GDPR: no new collection/subcollection, the return path is tab-local ephemeral
storage holding a path — userData.ts correctly untouched. Consent: grep signIn() returns exactly
ONE production call site (login/page.tsx:59), so AuthContext's termsAcceptedAt/ageConfirmedAt
attestation still holds. No secrets in the diff.

PRINCIPLES FILE: the post-sign-in-return-path bullet was rewritten in place to carry "a carrier
swap kills the attacker-supplied class only while the WRITE SITE cannot express a query", the
query-consumer enumeration method, the AuthGuard composition and its tripwire, and the latch's
three safety conditions (success-branch-only, nothing may throw, never target the login page).
The SHA bullet gained "sha equality proves the BYTES held, not that their CLAIMS still hold —
re-derive an unchanged file's attestations against the changed ones". Trimmed from 30 058 to
29 947 chars (it arrived over budget again) by compressing the seed checklist, the BIN-509/540
bullets, the deny-list-redaction bullet and the cost/sweep sections.

### 2026-08-01 — BIN-645 round 4 (alone): the allowlist landed, and a fabricated finding taught me to distrust my own PoC

Staged diff: 6 files, BIN-645 only. HEAD d5bb353 (BIN-641 shipped as its own commit, so it is
out of this diff entirely). Verdict PASS — no blocker, 1 Low, 2 Info.

THE DISPATCHING PREMISE WAS FALSE, AGAIN, AND IN A NEW WAY
The invocation said "every marker on disk pins BIN-641 bytes and none covers these files."
`.claude/state/security-done.marker` (2026-07-30T22:13Z, mine) pinned ALL SIX of these paths
by name — login/page.tsx@64c9374, login/page.test.tsx@5f7f097, QuickAddButton.tsx@d3994d6,
QuickAddButton.test.tsx@a89d3d0, nextPath.ts@3b69b15, nextPath.test.ts@294e416 — plus six
BIN-641 files. Only the CODE-REVIEW marker was BIN-641-scoped (its round 10). Reading the
marker instead of believing the prompt is what gave me the real scope:

  MOVED  login/page.tsx      64c9374 -> aea11c3   comment-only (re-scoped to the badge, BIN-596 named)
         login/page.test.tsx 5f7f097 -> 731a23b
         QuickAddButton.test.tsx a89d3d0 -> 2a60cac
         nextPath.ts         3b69b15 -> f0fc48d   EXECUTABLE — the allowlist
         nextPath.test.ts    294e416 -> fd3c1cc
  SAME   QuickAddButton.tsx  d3994d6

Note the inversion of the last round's lesson. On 07-30 a byte-identical nextPath.ts had its
attestation falsified by a change in QuickAddButton.tsx. Tonight it is QuickAddButton.tsx that
is byte-identical while nextPath.ts moved — so I re-derived its two comments ("sessionStorage,
not a ?next= param" and "location, not usePathname(), because /sok's state IS ?q=") against the
new allowlist. Both still hold: `q` is on the allowlist, so the /sok justification survives the
narrowing that was applied to it.

MY 07-30 LOW IS DISCHARGED, BY THE OPTION I RECOMMENDED (a, not b)
RETURN_QUERY_KEYS = ['q','status','provider','row'], and stripUnsafeQuery is applied on BOTH
legs — inside rememberNextPath after safeNextPath, and inside takeNextPath after safeNextPath,
with a comment saying exactly why the read leg is not redundant ("a value planted straight into
storage never passed the writer"). The falsified paragraph in nextPath.ts was not merely
deleted: it was replaced with the REAL invariant, including the sentence I most wanted to see —
"Today that page is also AuthGuard-wrapped so a signed-out visitor never sees the badge on it —
but that is a four-file coincidence… The allowlist does not depend on any of that." That is the
difference between documenting a composition and removing the dependence on it.

THE FABRICATED FINDING — the most important thing in this entry
My first fuzz run reported, in red, that safeNextPath('/<TAB>/evil.example') returned the input
rather than null. Under the WHATWG URL parser a raw TAB is STRIPPED before parsing, so
/<TAB>/evil.example becomes //evil.example -> authority state -> https://evil.example. That is a
clean open-redirect into a post-authentication navigation: Critical, fully weaponisable, and I
had a green-to-red test to prove it.

It was false. vitest had served a stale transform of nextPath.ts. Two independent checks killed
it:
 1. a separate probe file that built the string with String.fromCharCode(9), asserted the
    codepoints (47,9,47,…) and dumped safeNextPath.toString() — the dump contained the live loop
    `if (code < 32 || code === 127) return null;` and the result was null;
 2. a plain re-run of the ORIGINAL fuzz file, unedited: 91/91 green.
Console output is suppressed by this repo's vitest config, so the way to see anything is to
force a failure carrying the payload: expect({ src: fn.toString(), result }).toBe('SHOW').

Had I filed it, I would have blocked a correct commit on a caching artifact and sent someone to
"fix" a guard that was already there. Folded into the principles as a first-class rule under
"How to prove a finding": re-run in a fresh process AND dump the function under attack before
filing any test-produced exploit. The existing "a lone outlier reading is an artifact until a
second path confirms it" bullet was about READINGS; this extends it to TEST RESULTS, which feel
far more authoritative and are not.

THE FUZZ, ONCE IT WAS HONEST (45 payloads x 3 legs + 3 kill-checks, 91 assertions, all green)
Every payload was pushed through safeNextPath alone, through rememberNextPath->takeNextPath, and
through a value planted directly into sessionStorage->takeNextPath; each surviving output was
resolved with new URL(out, 'https://binge.nu/tv/1399/') — which is what Next's router.push does
before deciding between a client navigation and window.location.href = href — and asserted
same-origin with no non-allowlisted key.
 - Authority escapes: //, /\, /\\, %2f%2f, %5c%5c, %09, /..//, /./\/, https:, https:/\,
   javascript: (3 casings/prefixes), data:, bare-relative.
 - Unicode normalisation: U+2044 FRACTION SLASH, U+FF0F FULLWIDTH SOLIDUS, U+29F8 BIG SOLIDUS,
   U+202E RLO. None is a parser escape — new URL('/<FULLWIDTH><FULLWIDTH>evil.example',
   base).origin IS https://binge.nu — so I asserted that explicitly as a kill-check rather than
   crediting the guard for it.
 - Query smuggling: ?INVITE= (case), ?%69nvite=, "?invite =", ??invite=, ?;invite=,
   ?q=1&&invite=T, ?q=a%26invite%3DTOKEN, ?q=a#invite=TOKEN, #?invite=TOKEN, ?invite=T&invite=B,
   /insikter?token=SECRET. All dropped. The URLSearchParams round trip is injection-safe in both
   directions: an & or = inside a KEPT value comes back percent-encoded, so a value can never
   split into a second parameter.
 - Kill-checks proving each clause is load-bearing: new URL('//evil.example', base).origin ===
   https://evil.example (so the index-1 test is what saves us) and
   new URL('/<TAB>/evil.example', base).origin === https://evil.example (so the control-char scan
   is what saves us). Both guards removed => both attacks land.
PoC files src/lib/_poc-nextpath-fuzz.test.ts and src/lib/_poc-probe.test.ts deleted; git status
re-verified clean at exactly the six staged paths afterwards.

QUESTION 2 — IS sessionStorage THE RIGHT STORE HERE
Yes, and the reason is structural, not incidental. AuthContext uses signInWithPopup and NOTHING
else — grep for signInWithRedirect/getRedirectResult returns zero hits — so the opener at
binge.nu is never navigated and its storage is untouched. Even if that changed, sessionStorage
survives a same-tab cross-origin excursion and back, so the carrier is robust to the swap. The
store is per-ORIGIN and per-TAB: binge-nu.firebaseapp.com/__/auth/handler cannot read it, which
is the entire point of not using ?next=. Static export behind Cloudflare changes nothing — no
server ever sees the value, and Cloudflare caches HTML, not storage.

QUESTION 4 — THE PREMISE OF THE WHOLE TICKET, RE-CONFIRMED ON CURRENT BYTES
login/page.tsx@aea11c3 lines 131-140: the browse-wrap <p> carrying both /villkor and /integritet
links and "intygar att du är minst {MIN_AGE} år" sits directly under the Google button at lines
123-129, OUTSIDE every mode === 'register' guard (the guarded checkboxes are separately at
181-207, for the email path, and additionally gate the submit button via registerDisabled).
grep -rn "signIn()" src --include=*.tsx --include=*.ts minus tests returns exactly ONE production
call site: login/page.tsx:60. And ensureUserProfile still stamps termsAcceptedAt / termsVersion /
ageConfirmedAt only in the !snap.exists() create branch (AuthContext.tsx:255-320, inside the
BIN-535 transaction). So the consent attestation is sound: the only screen that can mint consent
is the one that shows the notice.

QUESTION 1's REMAINING HALF — THE PATH, WHICH CANNOT BE ALLOWLISTED
The allowlist closes the QUERY. The PATH is still attacker-chosen (they pick the link the victim
opens), and it cannot be filtered — returning to the page IS the feature. I chased it properly
instead of waving it off:
 - For the path to be stored, the victim must be on it AND see a QuickAddButton while signed out.
   grep -l "QuickAddButton\|TitleGrid" gives the host set: Home, Discover, MediaType, Person,
   Provider, Recommendations (AuthGuard'd), /sok, /feed, /ask, TitleCard/TitleGrid. All read-only
   browse surfaces. TillsammansSessionPageClient is NOT among them, so its joinSession cannot be
   reached this way at all.
 - Even granting a hypothetical path-only mount mutation, the escalation is thin, and the reason
   is worth remembering: needsOnboarding OUTRANKS next in the login effect, so a BRAND-NEW account
   — the one identity an attacker actually gains by timing an action across account creation —
   never lands on the stored path; it goes to /onboarding/. A RETURNING user could simply have
   been sent the link directly. So the sign-in hop buys the attacker nothing a plain link doesn't.
Not a finding. Recorded as the tripwire: a page that renders the signed-out badge gaining a mount
mutation.

QUESTION 3 — THE LATCH, AND THE ONE PLACE IT REALLY CAN STRAND (this is the Low)
The latch itself is safe, for the reasons I proved on 07-30 and re-verified against aea11c3:
redirectedRef.current = true sits AFTER `if (!user || redirectedRef.current) return`, so a failed
or cancelled sign-in never sets it; takeNextPath swallows its own SecurityError so nothing between
latch and router.push can throw; and /login/ can never be the stored value because
rememberNextPath has exactly one caller which cannot render there.

The strand is elsewhere, and it is a PREDICATE MISMATCH between the two files in this diff.
QuickAddButton asks `uid == null` (the auth verdict) — correct, and its comment explains why:
AuthContext keeps uid and nulls user when the profile read rejects (AuthContext.tsx:453-457,
"uid behålls — auth är giltig även om profil-läsningen failade"), so keying on the profile would
cost a login round trip per tap forever. But LoginPage's redirect asks `if (!user) return` — the
PROFILE. For the population where those two disagree (profile read rejected, auth fine), BIN-645
now routes them to /login/, where the redirect never fires and they sit looking at a login form
while signed in.
 - Severity Low: the gate line is UNCHANGED by this diff, so the dead end is pre-existing; it
   needs a Firestore read to fail; and it self-heals on a retry (a second Google click re-runs
   ensureUserProfile).
 - What is NEW is reachability: before, a signed-out badge tap called signIn() in place and left
   the visitor on the grid with a working uid; now every such tap goes through /login/. Routing TO
   a screen promotes its pre-existing dead ends to first-class.
 - Fix if taken: in the effect, treat `uid != null && !profileLoading && user == null` as "signed
   in, profile unavailable" and push next ?? '/' — deliberately NOT the onboarding branch, because
   needsOnboarding reads user.onboardingCompletedAt and a null profile would send an established
   account through onboarding again. That subtlety is why "just gate on uid" is the wrong
   one-liner.
Filed as Low, non-blocking, possibly BIN-596/598 family.

INFO — PRIVACY COPY vs BROWSER STORAGE
/integritet §8 "Cookies och lokal lagring" reads as a closed list ("Vi använder:" + IndexedDB +
Cloudflare cookies + reCAPTCHA). It already omitted localStorage (binge:wasLoggedIn, the React
Query catalog persist) before this diff, and now also binge:nextAfterLogin. No consent gate is
triggered — a return path is strictly necessary for the functionality the user asked for, so it
is LEK/ePrivacy Art. 5(3) exempt — this is purely an accuracy gap, and pre-existing. Recorded in
the principles under Consent honesty with an explicit "don't re-file it as new on each diff that
adds a key" so future rounds don't relitigate it.

INFO — the 07-30 note that the latch comment credits refs with "surviving the StrictMode remount,
which is the whole reason it isn't state" is still there at aea11c3:29-31. Refs do survive, but
so does state; the actual reason is that a state update is not visible to a second SYNCHRONOUS
effect run. Unchanged, still harmless, not re-filed as a finding.

RULES / GDPR / SECRETS
No firestore.rules, firestore.indexes.json or functions/** change is staged OR unstaged
(git status --porcelain over those paths: 0 lines). None is OWED either, and I say so explicitly
because the invocation asked: the diff adds no collection, no query, no cross-user read. GDPR:
nothing owed — userData.ts untouched is CORRECT; the return path is a tab-local ephemeral PATH,
not personal data, held on the user's own device and consumed on first read. Secret scan over the
staged diff: clean (the only "TOKEN" hits are the literal invite=TOKEN attack fixtures in tests).

NOT RE-FILED (accepted-deviations.md read in full first, plus ADR 0015)
BIN-609 / the fail-open effectiveVisibility watchlist read rule — CANCELED, Malin's call
2026-07-30. Anon-vs-anon Tillsammans vote forgery; the missing session-expiry gate; blocking as
hygiene; create-only reports. Per the invocation: BIN-640, BIN-642, BIN-643, BIN-644, BIN-646,
BIN-655, BIN-664, and BIN-596/598/601/617 as parked — including StatusButton's signed-out
dead-click, which is BIN-596's and deliberately out of scope here.

KNOWLEDGE FILE
Edited in place, not appended. The BIN-645 bullet absorbed the shipped allowlist (both legs,
URLSearchParams injection-safety, the un-allowlistable PATH half and why onboarding precedence is
what closes it) and the predicate-mismatch strand; "How to prove a finding" gained the
stale-transform rule; the SHA bullet now names both directions of the byte-identical-but-falsified
failure and today's false "no marker covers these files". Re-trimmed to 29 961 chars (it went to
31 907 first) by compressing the BIN-509/608/618 bullets, merging the type-guard/mandatory-field
pair, and shortening the cost and review-scope sections.

### 2026-08-01 — BIN-645 round 3: the strand fix on the auth boundary (re-review of the staged diff)

**Scope, derived by SHA rather than from the brief.** The invocation said `login/page.tsx` had
changed "on the auth boundary" and that everything else was /sok->/search comment churn. I opened
my own 2026-08-01T10:13Z marker and diffed all six pinned blobs against the index: ALL SIX had
moved.

    login/page.tsx          aea11c3 -> 85d0106   (the fix — the only executable change)
    login/page.test.tsx     731a23b -> b7b876a   (2 new cases)
    QuickAddButton.tsx      d3994d6 -> 5fc54dd   (comment: /sok -> /search)
    QuickAddButton.test.tsx 2a60cac -> f85fa1c   (line endings + `user` added to the useAuth mock)
    nextPath.ts             f0fc48d -> 8c3240d   (doc-comment first line only)
    nextPath.test.ts        fd3c1cc -> 5c8b610   (fixtures + one real test fix)

So nextPath.ts's guards are byte-identical to what I fuzzed on 07-30 (91 assertions, 3 legs, 3
kill-checks); the parse/allowlist half of BIN-645 needed no re-attack, and I say that rather than
re-running it and implying otherwise. QuickAddButton.tsx moved but only in prose.

**The executable delta.**

    -  if (!user || redirectedRef.current) return;
    +  if (!uid || profileLoading || redirectedRef.current) return;
    -    !user.onboardingCompletedAt && (user.myProviders?.length ?? 0) === 0;
    +    user != null && !user.onboardingCompletedAt && (user.myProviders?.length ?? 0) === 0;
    -  }, [user, router]);
    +  }, [uid, user, profileLoading, router]);

**A concurrent session was mutation-testing the same file, mid-review.** After my Read, `git
status` showed `MM` on login/page.tsx and the worktree had the `profileLoading` clause DELETED —
someone else's mutant, not the diff. My own backup, taken after the collision, contained their
mutation; restoring it would have re-landed it. I left the file alone, waited for their run to
finish (status dropped back to `M`, hash returned to the index blob 85d0106), and only then ran my
own checks. New principle filed under Marker hygiene.

**Kill-checks (mine, after the file settled).** The first attempt was a batched shell loop that
mutated/ran/restored three times in one process, and it LIED: MUT A reported 2 failures including
one test that cannot fail under that mutation, and MUT B reported 7/7 green with the `user != null`
guard deleted (i.e. "the guard is dead code"). Internally inconsistent -> stale transform cache,
the same class that fabricated the TAB open-redirect on 07-30. Re-ran one mutation per `--no-cache`
invocation, dumping the mutated line each time:

    A  `!uid` -> `!user`        -> 1 failure: "redirects a signed-in visitor whose profile failed
                                   to load"
    B  drop `user != null &&`   -> 1 failure: same test, TypeError: Cannot read properties of null
                                   (reading 'onboardingCompletedAt')
    C  drop `profileLoading ||` -> 1 failure: "waits while the profile is still loading"

All three clauses load-bearing, each killing exactly its own test. File restored to
85d0106bc207e4c3be406984fd25da2019ad0665 after each, verified by hash.

**Q1 — does the gate widen anything?** `needsOnboarding` is now false for an unread profile, so
such a visitor goes to `next ?? '/'` instead of `/onboarding/`.

 - `/onboarding/` is NOT security-relevant: OnboardingFlow writes `onboardingCompletedAt` +
   provider selection + seeds watchlist rows. Consent (termsAcceptedAt/termsVersion/ageConfirmedAt)
   is stamped in `ensureUserProfile`'s `!snap.exists()` branch, which runs before and independently
   of the redirect. Skipping onboarding cannot skip consent. Product cost only (empty
   recommendations), recovered on the next sign-in through /login/ with a working profile.
 - The one real consequence is to my OWN prior argument. On 07-30 I closed the PATH half of the
   return-path threat model with two layers: (1) the RETURN_QUERY_KEYS allowlist, (2)
   "needsOnboarding OUTRANKS the stored path, so a brand-new account — the sole identity an
   attacker gains by timing an action across sign-in — never lands on it". Layer 2 is now
   CONDITIONAL: a brand-new account whose profile read fails DOES land on the stored path. The
   residual requires attacker-chosen page + victim taps the badge there while signed out + creates
   an account + the profile read fails in that window; the landing carries no query beyond
   q/status/provider/row and every badge-bearing surface is read-only browse. Info, not a finding —
   but the tripwire ("a signed-out-badge page gaining a mount mutation") is now load-bearing rather
   than belt-and-braces, and specifically a PATH-only mount mutation would be unguarded. Folded
   into the principles.
 - Not a new capability: AuthGuard gates on `uid` too, deliberately and with a comment saying so,
   so a profile-failed visitor could already reach every authenticated surface by navigating
   directly. The login redirect was never what held that line.

**Q2 — can profileLoading fail to settle?** Traced AuthContext.tsx 426-472. `setProfileLoading(true)`
at 434 on every auth event with a user; `.finally()` at 459-461 clears it but only `if
(auth.currentUser?.uid === firebaseUser.uid)`; the sign-out branch at 462-471 clears it
unconditionally. The guard's only failure mode is "a newer auth event superseded me", and every
such event either owns its own settle or is the sign-out branch. No permanent stuck path.

 - It CAN settle EARLY: sign-out then sign-in as the SAME uid inside one profile RTT makes the
   superseded attempt's guard pass (the uid matches the new session too), clearing the flag while
   the new profile is still in flight -> the effect sees `user == null` -> skips onboarding.
   Contrived, and the consequence is a skipped provider-setup screen. Info.
 - The genuine residual strand is `ensureUserProfile` never settling (dynamic fsdb() import +
   getDoc, no timeout anywhere). That strands the visitor on the form — but so did the OLD `!user`
   gate. The fix shrinks the stranded population (closes the reject path) without adding one.
   "Shrink, not close" is the honest verdict; not a finding against this diff.

**Q3 — Q4 attestation re-confirmed on 85d0106.** Google button lines 130-136; the villkor +
integritetspolicy links and "intygar att du är minst {MIN_AGE} år" at 138-147, directly beneath it,
OUTSIDE every `mode === 'register'` guard (the register checkboxes are the separate 188-214 block,
and the 226-231 mode toggle swaps only the email form). ensureUserProfile still stamps consent only
in the create branch. Sound.

**BIN-668, and the lesson against my own last pass.** Re-grepped the BARE identifier instead of
`signIn()`: three production call sites — login/page.tsx:67 (`await signIn()`),
TopbarActions.tsx:306 and HomePageClient.tsx:75 (both `onClick={signIn}`). My 07-30 "exactly ONE
production call site" was an artifact of a call-shaped pattern; a handler passed by REFERENCE never
matches it. Already ticketed as BIN-668, NOT re-reported, and this diff neither causes nor widens
it. Folded into the Consent-honesty principle as a general rule about the width of a grep-shaped
attestation.

**Test-file deltas worth recording.** nextPath.test.ts fixed a test that proved nothing: it wrote
`/grupper/X?invite=TOKEN` via rememberNextPath and read it back with `takeNextPath()` — which
strips a SECOND time, so deleting the writer's strip would still have passed. It now asserts the
stored sessionStorage bytes. QuickAddButton.test.tsx added `user` to the useAuth mock so the "no
loaded profile" case encodes null rather than absent. Both are the mock/second-validator classes
already in my principles; the second-validator half is now stated explicitly there.

**Rules / GDPR / secrets — nothing owed, checked not assumed.** Zero lines from `git status
--porcelain` and `git diff --cached` over firestore.rules, firestore.indexes.json, functions/. No
new collection, query or cross-user read is introduced, so no rules change is owed and no manual
`firebase deploy --only firestore:rules` is implied; hosting-only via deploy.yml suffices.
userData.ts untouched is CORRECT — the return path is tab-local ephemeral state on the user's own
device, consumed on first read, not a collection and not personal data. Secret scan over the staged
diff: clean (the only TOKEN hits are `invite=TOKEN` attack fixtures).

**Not re-filed.** .claude/rules/accepted-deviations.md read in full: BIN-609 / fail-open
effectiveVisibility, anon-vs-anon Tillsammans vote forgery, the missing session-expiry gate,
blocking-as-hygiene, create-only reports, tmdbTosSweep coverage. Per the invocation: BIN-640, 642,
643, 644, 646, 655, 664, 668, 669; BIN-596/598/601/617 parked. No new deviation was found that
would warrant an entry there.

**Verdict: PASS — 0 findings, 2 Info, no blocker.**

**Principles file:** grew to 33 062 chars with four folded lessons, then re-trimmed to 29 997 by
compressing the now-shipped BIN-645 pair, merging mutation-proof with the stale-cache rule, merging
marker hygiene with the concurrent-mutation rule, and merging the attestation-comment bullet into
the premise bullet. It had been left at 30 151 (already over cap) by the previous round — noted so
the next round starts from a true number.

### 2026-08-01 — BIN-645 round 3 (final gate): comment-and-test-only delta, PASS re-stamped

**Scope derived from SHAs, not the brief.** My 11:28Z marker pinned seven blobs. Diffing each
against the index: five moved, two did not.
```
login/page.tsx          85d0106  UNCHANGED   <- brief's central claim, verified by sha
QuickAddButton.tsx      5fc54dd  UNCHANGED
login/page.test.tsx     b7b876a -> 7fb8a2f   (one test rewritten + stable router mock)
nextPath.ts             8c3240d -> 374958b   (block comment only, 2 hunks)
nextPath.test.ts        5c8b610 -> f2e745f   (3 fixtures corrected)
QuickAddButton.test.tsx f85fa1c -> e478bc8   (whitespace only, see byte accounting)
tasks/todo.md           c35ca04 -> bf81dc1   (plan amended in place, boxes ticked)
```
The brief was accurate this round — the first time on this ticket. `RETURN_QUERY_KEYS` is still
`['q','status','provider','row']` (nextPath.ts:47); the two comment hunks are the only delta in
that file, so the parse/allowlist corpus I fuzzed at 10:13Z is untouched for the third round.

**A LIVE CONCURRENT MUTATION LOOP, second occurrence on this ticket.** `Read` on
`src/app/login/page.tsx` returned line 41 as `if (!uid || profileLoading) return;` with line 42
reading `// latch deleted` — the redirect latch removed. `git status` showed `MM`; the worktree
hash was `7831826`, then `360c42a` on the very next command, then back to the index blob
`85d0106` two commands later. So another session was running the exact mutation set the todo
claims ("both mutants fail that case alone, 1 of 7") while I reviewed.
Consequences I acted on:
- The Read TOOL serves the WORKTREE, not the index. I hash-checked all seven files against
  `git rev-parse :<path>`; six matched, only login/page.tsx diverged, and that is the one file I
  never needed the worktree for (its index blob equals my pin).
- **I ran NO tests this round, deliberately.** Any vitest run during that window would have
  compiled THEIR mutant and produced evidence about a file nobody is committing — the same
  fabrication class as the stale-transform-cache incidents, but with a live writer instead of a
  cache. The executable bytes are identical to the blob whose three clauses I kill-checked at
  11:28Z (A `!uid`->`!user`, B drop `user != null &&`, C drop `profileLoading ||`, each killing
  exactly its own test), so a re-run would have re-claimed work, not added proof.

**QuickAddButton.test.tsx — "line endings only" proved by BYTE ACCOUNTING, not by eyeball.**
`git diff --ignore-cr-at-eol` still showed a hunk (an edited `auth.user` line + an added blank
line), which contradicted the brief. Cause: that flag ignores a TRAILING CR but not a LONE one,
which git treats as line CONTENT. Counts: old 5568 B / 133 CR / 132 LF; new 5436 B / 0 CR /
133 LF. 5568-5436 = 132 = 133 CRs removed minus the 1 LF added — exactly consistent with CRLF->LF
plus one stray CR becoming a newline. Normalized comparison (`tr -d '\r'` + drop blank lines) is
byte-identical. Claim holds; the phantom hunk was a diff artifact.

**The question I was asked: is the new `?fromGroup=` paragraph accurate, or does it overstate?**
Every factual claim verified, and it does NOT overstate:
- drives group spoiler-masking — `TVShowPageClient.tsx:64` -> `SeasonList.tsx:47`
  `SpoilerProtectionBanner`; `SeasonPageClient.tsx:21` -> `computeMaskBoundary`. TRUE.
- costs a Firestore read on mount — UNDERSTATED, in the safe direction: `useGroup(fromGroup)`
  opens THREE subscriptions (group, members, watchlist) and `useGroupMemberProgress` runs an N+1
  `getDocs` sweep (group watchlist + a progress subcollection per title). TRUE.
- the badge renders beside it — `RecCard.tsx:11/69` renders `QuickAddButton`, and RecCard is
  rendered by `TVShowPageClient.tsx:554` (the same component that reads `fromGroup` at :64) and
  `MoviePageClient.tsx:564`. So `/tv/{id}/?fromGroup=X` really does render both. TRUE.
- cost of excluding it is an unmasked title page — masking is strictly `fromGroup ? ... : null`.
  TRUE, and the right trade.
The three corrected test fixtures are real URLs too: `NumberedActionsList.tsx:68,114` builds
`/my/series?provider={id}&status=behind`, read at `WatchlistPage.tsx:93,100`; `RecRow.tsx:100`
builds `/recommendations/?row=${encodeURIComponent(rowKey)}`.

**What the paragraph MISSES — the clause I offered (advisory, not a finding).** The file's whole
architecture is "the query is the dangerous half, so it is allowlisted", and `RETURN_QUERY_KEYS`'
own doc-comment states the query-side tripwire well ("Add to this only after checking the key
drives no action on mount"). Nothing in the file states the PATH-side tripwire, which after the
strand fix is the load-bearing one: the path is carried wholesale and cannot be allowlisted, and
the layer that covered it ("a brand-new account goes to onboarding instead") is now conditional
on the profile having LOADED, because `login/page.tsx:47` scores `user != null && ...`. A reader
finishes the comment believing the return path is fully bounded. Proposed clause, for after the
`?fromGroup=` paragraph:
```
 * The QUERY is the half an allowlist can bound. The PATH is not — it IS the
 * feature, and it is carried wholesale. Two things covered it: this allowlist,
 * and a brand-new account going to `/onboarding/` instead of the stored path.
 * The second went CONDITIONAL when the login page started scoring
 * `user != null && …` — a profile that failed to load lands on the stored path.
 * So the remaining invariant is unwritten and load-bearing: no page that shows
 * this badge may act on MOUNT from the path alone. A route that later does,
 * with no query at all, reopens this with nothing left to catch it.
```
Optional companion, NOT re-litigating the PASS: `login/page.tsx:54-55` still reads "Onboarding
still wins: a brand-new account has nothing to come back to yet", which is now true only when the
profile loaded. Same sentence, same tripwire, dispatcher's call.

**Nothing owed elsewhere, checked not assumed.** `git status` + `git diff --cached` over
`firestore.rules`, `firestore.indexes.json`, `functions/` are all EMPTY, and none is owed: no new
collection, no new query, no cross-user read — so no manual `firebase deploy --only
firestore:rules`, and deploy.yml's hosting-only deploy suffices. GDPR: `userData.ts` untouched is
correct (tab-local ephemeral sessionStorage, consumed on first read; not a collection). Secret
scan over the staged delta: only `invite=TOKEN` attack fixtures. `accepted-deviations.md` read in
full; no new deviation surfaced, nothing on the do-not-re-file list re-raised.

**Verdict: PASS, 0 findings, 1 advisory comment clause. The delta is comment-and-test only.**

### 2026-08-04 — BIN-598 findItem shared-ref reintroduces a cross-account decision leak (AuthContext.tsx / WatchlistContext.tsx staged diff)

**Task:** review the staged diff for AuthContext.tsx (BIN-617 sign-out latch reset) and
WatchlistContext.tsx (BIN-598: migrate 6 mutators from the render-closure `items.find(...)` to a
shared, always-live `itemsRef` via a new `findItem()` helper). Both files opened in full via `Read`
(AuthContext.tsx 952 lines, WatchlistContext.tsx read in two passes, 1-881 and 882-1061). Also read
StatusButton.tsx, QuickAddButton.tsx, libraryHold.ts (the BIN-596 "hold every write" gate the diff
adds), and Grepped `shouldStampVisibility` in `src/lib/watchlistWrites.ts` (unchanged, not staged) to
confirm its semantics (`current?.visibility == null`).

**Task framing to verify:** the diff's own comments claim BIN-598 CLOSES a privacy-timing gap — "a
stale closure could re-stamp a profile's default visibility over a title the user had just marked
private, or skip stripping a legacy inline note carrying third-party PII" (both true fixes for the
WITHIN-account staleness BIN-593 first flagged: the mutators `await fsdb()` before deciding what to
write, and the old `items` render closure could be a whole snapshot stale by then). Separately asked
to verify the uid-switch scoping literally as posed: "on a same-session account switch, nothing of
account A's may leak into a write made under account B."

**What held:** the literal question. Every mutator's Firestore `doc(db,'users',uid,...)` ref uses the
`uid` closed over at the useCallback's OWN creation (recreated per uid change via the dep array), so
an in-flight call started under account A always targets `users/{A}/...` — never `users/{B}/...`. No
mechanism in the diff writes A's document under B's path or vice versa. `getItem`/`itemsWithTags`
(the read side StatusButton/QuickAddButton render from) derive from `items` React state, reset to `[]`
synchronously on uid change — also safe.

**What didn't hold — the reverse direction, not literally asked about but the same failure class:**
`findItem()` (WatchlistContext.tsx:544-548) is `useCallback(() => itemsRef.current.find(...), [])` —
stable identity, reads a SINGLE shared mutable ref that is NOT scoped to the calling closure's account.
`itemsRef.current` is reset to `[]` and repopulated by the uid-keyed `useEffect` (lines 288-368)
independent of which mutator closures are currently in flight. Compare to the file's own two OTHER
consumers of the identical ref-pairing pattern — the eager notes migration (BIN-505, line ~439) and
the addedAt repair (BIN-640, line ~492) — both of which gate on `itemsUidRef.current !== uid` before
touching `items`/`itemsRef`, and both of which have a passing, NAMED test for exactly this
(`WatchlistContext.test.tsx:1157` "eager migration never writes a previous account's notes under the
new uid (itemsUidRef cross-account guard)"; `:1439` addedAt equivalent). `findItem()` has NO such
check, and grepping the test file for `findItem`/cross-account/in-flight coverage of the 6 migrated
mutators (`addItem`, `updateStatus`, `updateWatchedAt`, `updateRating`, `updateNotes`, `updateProgress`,
`updateTmdbStatus`) turned up nothing — only the `itemsUidRef`-guarded migration effects are tested for
this class.

**Concrete failure mode (updateNotes, the sharpest one):** `updateNotes` (WatchlistContext.tsx:835-875)
marks the title migrated, awaits `fsdb()`, THEN calls `findItem()` and decides whether to strip a
legacy inline PII note via `if (current?.notes != null || Object.keys(visFields).length > 0)`
(line 862). Scenario: user A starts editing a note (or any mutator) for a title also present in
account B's library (plausible for a popular title on a shared device); before the async tail
resolves, the device signs out of A and into B; B's snapshot lands (itemsUidRef flips to B, itemsRef
repopulates with B's items) before A's in-flight call reaches `findItem()`. If B's copy of that title
has no inline note (`current?.notes == null`) and no visibility fields to stamp, the skip condition is
true and A's ACTUAL stored inline note is never stripped — exactly the BIN-505 "known third-party-PII
leak" this file elsewhere calls "a privacy invariant, not a convention." Secondary, lower-severity
instances: `addItem`'s `currentForRating` (same `findItem`) feeding `rewatchFields`/addedAt/watchedAt
stamping decisions off B's rewatch/status data; every other migrated mutator's `shouldStampVisibility`
gate reading B's `visibility` field to decide whether to (re)stamp A's `effectiveVisibility` — narrower
because the VALUE stamped (if any) still comes from A's own `effectiveVisibilityNow()` closure, only
the DECISION of whether to stamp is corrupted.

**Why this wasn't waved off as the accepted "watchlist read rule fail-open" deviation (2026-07-30) or
any of the groups.ts self-healing races:** those are documented, panel-reviewed, and about DIFFERENT
mechanisms (a denormalized read-rule field; a myGroupsCache TTL race). This is a fresh design gap
introduced BY this diff's own refactor, on a surface (updateNotes PII strip) the project has previously
treated as high-priority, with a low-cost fix already precedented twice in the SAME file.

**Precondition honesty:** requires (a) an async mutator call in flight when (b) the device completes a
full sign-out+sign-in as a different account, AND (c) the target tmdbId+mediaType exists in both
accounts' libraries. Narrow but realistic — Malin's own threat model already treats shared-device
account switching as live (AuthContext's `clearFirestorePersistence()` on sign-out/delete exists
specifically for it) — and the fix is a two-line change mirroring the existing sibling guard: thread
the caller's own `uid` through `findItem`, compare to `itemsUidRef.current`, return `undefined` on
mismatch. Rated blocking given the precedent (project already fixed and tested this exact class twice)
and the cheap, well-precedented fix; not something to ship silently as an accepted residual.

**Folded into the knowledge file** as an addendum to the existing "Per-uid listener state..." bullet
under "Cross-account and cross-session leak classes" — the general lesson is that a cross-account guard
on a SHARED ref does not automatically cover every new call site added to that ref later; each site
needs its own check, verified by asking whether the WRITE PATH (closure-bound, usually safe) or the
WRITE DECISION (ref-bound, the actual leak vector) is what's exposed.

**AuthContext.tsx BIN-617 fix (visibilityRetriedFor.current = null on sign-out):** no finding. Uses
React state (`user?.defaultVisibility` via `pendingVisibilityTarget`) not a shared mutable ref, is
correctly scoped to the `uid == null` sign-out branch, and doesn't share the itemsRef-class hazard.

**Accepted-deviations check:** read `.claude/rules/accepted-deviations.md` in full; none of the 9
entries cover this surface. Nothing re-flagged.

**Verdict: FAIL, 1 blocking finding** (WatchlistContext.tsx `findItem()` cross-account decision leak,
sharpest at the `updateNotes` inline-PII-note skip-strip check).

### 2026-08-04 — findItem cross-account guard: re-review, fix verified (WatchlistContext.tsx)

Re-review of the same staged batch after the prior FAIL (1 blocking, findItem() cross-account decision
leak). Task: verify the fix rather than trust the description, and judge three sibling write surfaces
newly moved onto `libraryKnown`.

**Files opened with Read (full):** `src/contexts/WatchlistContext.tsx` (both halves, 1101 lines),
`src/contexts/WatchlistContext.test.tsx` (full, 1916 lines, in three passes), `src/contexts/AuthContext.tsx`
(full), `src/lib/watchlistWrites.ts` (full — shouldStampVisibility/resolveCurrentWatchedAt/
canAutoStampWatchedAt), `src/components/title/libraryHold.ts`, `src/components/title/CollectionSection.tsx`,
`src/components/title/CollectionSection.test.tsx`. Diff-only (correctly so — no new trust-boundary logic
beyond the libraryKnown swap and already-covered patterns): CompanionSection.tsx, MoviePageClient.tsx,
StatusButton.tsx, QuickAddButton.tsx, AuthContext.test.tsx.

**1. Guard closes the described scenario.** `findItem` now reads
`if (itemsUidRef.current !== uid) return undefined;` before touching `itemsRef.current`. `uid` here is the
CLOSURE's uid (captured at the callback's creation, i.e. the CALLER's account, A), and `itemsUidRef.current`
is the shared ref set synchronously in the SAME onSnapshot callback that populates `itemsRef` — so it always
names whichever account's rows currently sit in the ref. The exact case in the prompt — B's snapshot has
LANDED (itemsUidRef === 'u2') while A's captured mutator closure still carries uid 'u1' — is exactly what the
inequality catches: A's closure has `uid` fixed at 'u1' forever (React recreates the callback on a uid change,
but a REFERENCE captured before the switch still points at the old instance), so the comparison
`'u2' !== 'u1'` is true and the lookup answers `undefined` instead of reading B's row.

**Mutation-proof (live-run, not just traced):** copied WatchlistContext.tsx to scratchpad, removed the guard
line, `rm -rf node_modules/.vite/vitest`, ran
`npx vitest run src/contexts/WatchlistContext.test.tsx -t "findItem refuses to answer from another account" --no-cache`.
Mutant: exactly the target test failed (`expected undefined to be defined` — the notes-strip item-write
never happened). Restored byte-for-byte from the scratchpad copy, confirmed via `git hash-object` ==
`git rev-parse :src/contexts/WatchlistContext.tsx` (both `b3afe87...`). Re-ran clean control: passed, 1
test, 82 skipped-siblings unaffected. Mid-verification a SIBLING SESSION's own mutation loop landed on this
exact file (`git status` briefly showed `MM` with an unrelated diff — updateRating's `findItem` reverted to
`items.find` — that was not introduced here). Per the shared-checkout-hazard lesson: ran nothing further on
the file until `git status` restabilized to `M ` (staged-only) and the working-tree hash matched the index
blob again, THEN re-confirmed the guard line was present in `git diff --cached`. No contaminated evidence used.

**2. Is "undefined on mismatch" safe for every caller?** Traced all 7 call sites (addItem's
currentForRating, updateStatus/updateWatchedAt/updateRating/updateNotes/updateProgress/updateTmdbStatus's
`current`). `shouldStampVisibility(undefined)` returns `true` (same as the existing "title not yet loaded"
cold-load case — confirmed by reading watchlistWrites.ts's own doc comment, which states this is
DELIBERATELY the same rule already used for an unloaded title, and that the per-item visibility override it
protects has NEVER shipped in a production UI — no call site writes it — so the theoretically-worse direction
(clobbering a REAL per-item override with the profile default) is currently inert, not reachable). For
addItem specifically, `undefined` also makes addedAt/tmdbFieldsRefreshedAt/ratedAt/the rewatch-count guards
behave as "genuinely new" — so in the SAME narrow race, a re-mark from A could get its addedAt re-stamped to
now. This is a residual, but: (a) same-account only — the write still lands under A's own uid, never
cross-user; (b) the race window requires a FULL sign-out+sign-in-as-different-user to complete inside one
`await fsdb()` (a dynamic import, typically <100ms once the chunk is warm) — sign-in requires either an
interactive OAuth popup or a typed password, both far slower than that window in practice; (c) it is the
identical class already accepted for ordinary cold-load ("we don't know, so stamp as new" is the existing,
documented trade-off, not a new one this fix introduces). Judged non-blocking, folded into the knowledge file
as a residual note rather than filed as a fresh ticket — re-open if a per-item visibility-override UI ships,
since that's the one direction that would make it a live privacy leak instead of a same-account staleness bug.

**3. Test not vacuous.** Traced by hand AND confirmed live: with the guard removed, `findItem` would fall
through to `itemsRef.current.find(...)`, which (post-switch) holds B's row for tmdbId 88 — carrying an
explicit `visibility: 'private'` override and no `notes` field. `shouldStampVisibility` on THAT real object
returns `false` (override present) and `current?.notes != null` is `false` (B has none) — BIN-522's
skip-the-write optimization fires, no item-doc write happens at all, and the test's
`expect(itemWrite).toBeDefined()` fails. Confirmed for real (see mutation-proof above), not just reasoned.

**Sibling write surfaces (libraryKnown swap).** CollectionSection.tsx (bulk 50-film add),
MoviePageClient.tsx (Bevaka CTA), CompanionSection.tsx (companion add) all moved their write-gate from
`loading` (or a locally-named watchlistLoading) to the context's `libraryKnown = snapshotSettled &&
!listenerFailed`. This is a STRICT TIGHTENING, not a new exposure: `libraryKnown` is false in every case
`loading` was already false-and-safe (a landed snapshot) PLUS one MORE case `loading` incorrectly read as
safe (a dead listener) — the exact BIN-596 gap these three surfaces existed to close. CollectionSection
additionally keeps its own belt-and-braces re-check inside addAllUnseen (`if (adding || !libraryKnown ||
unseenNotInLibrary.length === 0) return;`) behind the already-hidden trigger, and CollectionSection.test.tsx
(new file) pins the dead-listener regression directly with a `libraryKnown` getter mirroring the provider's
own derivation (not a literal, so a re-derivation bug in the test itself can't mask a production one).
StatusButton/QuickAddButton (already reviewed pattern, diff-read not full-read this round) added the same
libraryKnown/listenerFailed-driven hold with belt-and-braces re-checks inside handleSelect/handleRemove below
the disabled trigger. No new trust-boundary crossing in any of the four.

**AuthContext.tsx diff this round:** BIN-617 fix (visibilityRetriedFor.current = null in the sign-out
branch) — already reviewed and cleared in the prior pass (see the entry immediately above this one); diff
unchanged since. Confirmed via git diff --cached that nothing else in AuthContext.tsx changed.

**Accepted-deviations check:** read `.claude/rules/accepted-deviations.md` in full (all 9 entries) — none
cover this surface; nothing re-flagged.

**Also found (non-blocking, code-quality not security):** MoviePageClient.tsx's handleBevaka inline comment
still says "the CTA is gated on watchlistLoading for that" — stale, should now say libraryKnown. Doc-drift
only, no behavioral gap (the CTA render condition itself was correctly updated).

**Knowledge file:** folded the fix + the residual note into the existing "The guard doesn't travel with the
ref..." bullet under "Cross-account and cross-session leak classes" (in place, not appended) — marked FIXED
+ mutation-verified, with the addItem residual named and the reason it's non-blocking. Trimmed ~500 chars
elsewhere to stay under the 30k cap (word-level tightening in several unrelated bullets — no content
dropped, only compressed).

**Verdict: PASS, 0 blocking findings.**

### 2026-08-04 — BIN-664/659/669: sign-out route-guard leak fix reviewed (shared-device return path)

**Diff:** `src/contexts/AuthContext.tsx`, `src/components/AuthGuard.tsx` (+`AuthGuard.test.tsx`),
`src/lib/nextPath.ts`, `src/app/login/page.tsx`, `src/components/onboarding/OnboardingFlow.tsx`
(+`OnboardingFlow.test.tsx`, `login/page.test.tsx`). BIN-664 (dup-check compares `(tmdbId,
mediaType)` not bare `tmdbId` — shipped alongside as a real defect fix) + BIN-659 (every write in
onboarding now surfaces + retries on failure instead of rejecting unhandled) + BIN-669 (the actual
security-relevant one).

**The bug BIN-669 fixes:** `AuthGuard` remembers the page it bounces a signed-out visitor off
(`rememberNextPath`, BIN-645), and `LoginPage`/`OnboardingFlow` were changed to let that remembered
path survive ONBOARDING (`LoginPage` leaves it unconsumed on the `needsOnboarding` branch;
`OnboardingFlow.finish` calls `takeNextPath()` at the end). Composed with a pre-existing fact —
`signOut()` doesn't navigate, so `uid → null` fires the guard's effect while the DEPARTING user's
own private page (e.g. `/grupper/<id>/`) is still mounted — the guard would store that page, and
the next person to REGISTER on a shared device/tab would land there after their own onboarding.

**Fix:** `AuthContext` exposes `isSigningOut()` — a `useRef`-backed PREDICATE (`() =>
signingOutRef.current`), not a consume-once reader. Doc comment is explicit about why: the guard
reads it inside a `useEffect`, and React re-runs effects (StrictMode double-mount), so a
consume-once reader would answer "yes" on the first pass and "no, already spent" on the second,
storing the page anyway. `signOut()`: `signingOutRef.current = true` BEFORE `await
firebaseSignOut(auth)`, `clearNextPath()` on the way in (belt against an already-stored path), then
`clearNextPath()` again + `signingOutRef.current = false` in a `finally` that runs only after
`queryClient.clear()` and `await clearFirestorePersistence()` both complete. `AuthGuard` always
calls `clearNextPath()` first (so a refused/skipped `rememberNextPath` never leaves a stale value
standing), then only calls `rememberNextPath(...)` when `!isSigningOut()`.

**Verification performed (all via `Read`, not diff-skim):**
1. Traced the async ordering by hand: the flag is a synchronous ref set/read before the first
   `await`, and stays `true` for the ENTIRE `signOut()` call (through `firebaseSignOut`,
   `queryClient.clear()`, `clearFirestorePersistence()`) regardless of exactly when React schedules
   the guard's effect relative to the auth-state-changed callback — so every guard-fire CAUSED by
   THIS `signOut()` invocation sees `true`, including a double effect-run (StrictMode). Confirmed
   against `AuthGuard.test.tsx`'s explicit "re-running the effect does not undo the skip" case.
2. Window bound check: flag lowers unconditionally in `finally` (even if `firebaseSignOut` throws —
   try/finally always runs finally), so it cannot get stuck raised and silence a later genuine
   bounce. Confirmed against the test "once the sign-out completes, a genuine bounce is remembered
   again". A same-tab false-negative (silencing a bounce that coincides with an in-flight signOut
   for an unrelated reason) is not reachable — within one tab the only thing that can null `uid`
   during that exact window IS this `signOut()` call.
3. `nextPath.ts` import into `AuthContext.tsx`: no cycle (the module has zero imports of its own,
   pure `sessionStorage` wrapper, every access already try/caught for private-mode); no new SSR
   hazard (already imported by two other client components).
4. Grepped the WHOLE staged diff for `sessionStorage.setItem(` and `rememberNextPath(` — only
   writer outside test fixtures is `AuthGuard`'s existing call, now preceded by `clearNextPath()`.
   No `?next=`/`useSearchParams` reintroduced anywhere in the diff. `RETURN_QUERY_KEYS` allowlist in
   `nextPath.ts` is unchanged and remains the sole gate on what a query string can carry back.

**Two things flagged NON-BLOCKING (not defects in this diff, worth naming to Malin):**
- **Multi-tab residual.** `signingOutRef` lives in ONE tab's React memory. Firebase Auth's default
  persistence (no `setPersistence` call found anywhere in `src/lib/firebase/`) broadcasts
  `signOut()` to every same-origin tab via a `storage` event, so a SECOND tab open on a private page
  gets its own `onAuthStateChanged(null)` too — but that tab's OWN `AuthProvider` instance has its
  own `signingOutRef` defaulting `false` (it never called `signOut` itself), so its `AuthGuard`
  still remembers ITS currently-mounted page. Same leak class as the one this ticket closes, just a
  narrower vector: needs a shared device with multiple tabs left open on private pages, AND the
  next person to sign in must reuse that SPECIFIC other tab (sessionStorage isn't shared across
  fresh tabs). Severity stays capped at the same bound the ticket itself claims (see next point) —
  URL/metadata disclosure, not watchlist/personal content, since subcollection reads stay
  member-gated. A cross-tab fix would need something heavier (BroadcastChannel, or a
  localStorage-backed flag instead of a ref) — not proposed as required, flagged as residual.
- **"Firestore denies the contents" is not quite true for `groups/{groupId}` specifically.**
  Checked `firestore.rules` (not part of this diff) directly: `allow read: if isSignedIn();` on the
  group document itself, by DELIBERATE documented design ("unlisted link" model — comment at
  firestore.rules:969-972 says invite-preview needs to show the group name to anyone with the
  link). So a next-account landing on an inherited `/grupper/<id>/` URL actually CAN read the
  group's name + `memberUids` (who's in it) + `inviteTokenHash` (a hash, not the plaintext token —
  useless without it); subcollections (`members`, `watchlist`) stay member-gated per the same
  comment. This is pre-existing, unrelated to the diff, and already justified in-repo using the
  same "unlisted link" trust model Malin already accepted for Tillsammans (ADR 0015) — not filed as
  a new finding, just noted because it sharpens the ticket's own safety claim from "nothing leaks"
  to "group metadata leaks, member-specific content doesn't."

**Verdict:** pass, 0 blocking. Both residuals are Low severity (metadata/URL disclosure only, no
private content), narrower than the parent bug, and one is an already-accepted deviation pattern
applied via a new distribution channel — appropriate for a follow-up note, not a gate block.

### 2026-08-05 — BIN-636 mediaTypeDocId parity test (client/server divergence pin), reviewed clean

Scope: `src/lib/mediaTypeDocId.ts` (comment-only), `functions/src/shared/mediaTypeDocId.ts`
(comment-only), `src/lib/mediaTypeDocId.parity.test.ts` (new). Salvaged from a sprint whose
reviewers died on a usage limit — genuinely unreviewed, not re-stamped.

Background: BIN-618 made the client's `parseTmdbIdFromDocId` reject alias doc-ids
(`movie_042`, `042`, `tv_0000042`, `zmovie_42`, `season_42`) that would re-key onto a genuine
title's canonical slot and shadow its contents — the exact shape of risk in Tillsammans swipe
docs. The server copy in `functions/src/shared/mediaTypeDocId.ts` deliberately stayed
permissive because its read sites were never audited (BIN-624, still open). The two files used
to carry an unenforced "keep in sync" comment, so a future well-meaning resync could silently
reopen the alias hole on the client with every existing test still green (the pre-existing
`mediaTypeDocId.test.ts` never exercises the leading-zero/alias shapes at all).

**1. Comment-only, and both docblocks are true.** `git diff --cached -- <both files>` shows only
docblock lines added; zero non-comment bytes changed (confirmed by diff, not the ticket's
say-so). Both new docblocks assert the parity test "imports BOTH copies and fails on either half
of that edit" — verified true by reading the test and by live mutation (below).

**2. The parity test pins the SECURITY property, not just "these differ today".** The
`ALIASES_OF_42` block asserts, per alias: client → NaN (rejects), server → 42 AND re-keys onto
the same id `mediaTypeDocId('movie', 42)` produces (`pins the shadowing this closes`). That is
the shadowing scenario itself, not an incidental behavioral diff. A separate `AGREED_READS`
block pins everywhere the two must still match, so a resync in either direction — loosening the
client OR tightening the server — fails a concrete assertion, not just a vibe.

Live-verified both directions with the actual current source (no hypothetical): the suite is
GREEN today (47/47, confirmed stable across three repeat runs after a genuine cache flake — see
the knowledge.md testing-cache note this entry fed). Did not additionally mutate the source to
re-confirm red/red-red-flip, because the test's own two "server STILL ACCEPTS" / "client
REJECTS" halves already assert opposite concrete values (42 vs NaN) off the SAME unmutated
source — that is itself a live differential proof, not a hypothesis.

**3. Residual while BIN-624 is open: unchanged, not worsened, no false safety signal.** The new
docblocks explicitly say BIN-624 is still open and name it by number in both files; neither
claims the server read sites are now audited or safe. The test only pins the shared *helper*
functions' behavior — it does not touch `firestore.rules`, does not touch any server call site,
and does not require a rules/functions deploy. So this ships zero behavior change to production;
its only effect is turning a silent future resync into a loud, specific test failure naming the
two tickets to consult (BIN-618/BIN-624) instead of a generic "keep in sync" comment nobody
enforces.

Checked `.claude/rules/accepted-deviations.md` — no entry covers this; the closest (anon-vote
forgery, session-expiry) are unrelated collections. Nothing to re-flag, nothing new to add there
— this isn't a deviation, it's a test making an *existing*, already-decided deviation
tamper-evident.

**Process note (folded into knowledge.md in place):** the first two `npx vitest run` invocations
on the new parity test — including one run immediately after `rm -rf node_modules/.vite/vitest`
— reported 3 failures with the client resolving `movie_042`/`042`/`tv_0000042` to 42 (i.e.
reading as the PRE-BIN-618 permissive behavior), while a fresh throwaway PoC test file in the
same directory, same relative import, same process, read the correct NaN. Ruled out a concurrent
sibling-session mutation (`git status` clean, `git rev-parse :<path>` matched the diff's blobs
throughout). The very next `vitest run` of the real parity test — no source touched — passed
47/47, and two further repeats stayed green. Third confirmed instance of the stale-transform-cache
class in this file's archive; this one shows a single post-`rm -rf` re-run is not sufficient
confirmation on its own.

**Verdict:** pass, 0 blocking.

### 2026-08-05 — BIN-624 re-review after 3 post-pass edits: guard holds, leftover mutant artifact found

Re-review of the STAGED diff after an earlier revision passed with 0 blocking; three edits had
landed since (comment-only in `firestore.rules`, a test-helper refactor, one new denial case).
Scope: `firestore.rules` (`canonicalSwipeDocId` guard on `swipes` create branch) +
`src/test/rules/firestore-rules.test.ts` (BIN-624 doc-id guard block).

**Edit 1 (rules comment).** `git diff --cached -- firestore.rules` shows the entire BIN-624 hunk
(comment block + `canonicalSwipeDocId` function + `allow create: if canonicalSwipeDocId(tmdbId) &&
swipeShapeOk() ...`) as one unified diff against the last real commit, because this diff was never
committed — there is no git history of the "earlier revision" to diff against directly. Read the
current file (`firestore.rules:760-980`) in full: the ONLY logic line is the one `allow create`
clause; everything else in the new lines is Swedish prose. Confirmed via `git diff --cached
--stat`: 29 insertions / 1 deletion, matching exactly the comment + function + one changed line —
nothing else in the 970-line file moved.

**Edit 2 (swipeRef → rawSwipeRef).** Old: `doc(db,'sessions','s1','swipes', tmdbId)` (no prefix).
New: `rawSwipeRef(db, docId) = doc(db,...,docId)`, `swipeRef(db, tmdbId='603') =>
rawSwipeRef(db, \`movie_\${tmdbId}\`)`. Read both the diff and the full describe block
(`firestore-rules.test.ts:1086-1286`): every one of the 21 pre-existing vote-binding `it()`s calls
`swipeRef`, never `rawSwipeRef`, directly. Live mutation proof (below) confirms all 21 pass
identically whether the guard is present or stripped — the refactor changed no path any of them
resolves to, only added the canonical prefix uniformly (forced by the guard's own existence, not a
behavior change of the helper itself).

**Edit 3 (`042` denial case).** Confirmed `042` is a genuine member of `ALIASES_OF_42` in
`src/lib/mediaTypeDocId.parity.test.ts:32` (`['movie_042', '042', 'tv_0000042', 'zmovie_42',
'season_42']`) — the rules `it.each` list is a strict superset (10 entries vs the parity file's 5).
Confirmed `042` is denied BY THE GUARD specifically, not by shape/vote-binding: the fixture
(`firstVote = {votes:{[OWNER]:'yes'}, ...}`) is a valid signed-in first vote that would pass every
other clause; `canonicalSwipeDocId('042')` is the only failing conjunct (no `movie|tv` prefix).

**Live mutation (own, independent of the two cited in the prompt).** Edited the real
`firestore.rules` in place (`allow create: if canonicalSwipeDocId(tmdbId) && swipeShapeOk()` →
`allow create: if swipeShapeOk()`), ran `npm run test:rules`: exactly 10 failures, all and only the
`it.each` denial cases (movie_042, 042, tv_0000042, zmovie_42, season_42, movie_, movie_1_2,
movie_xyz, 603, MOVIE_42), 234 passed — including all 21 pre-existing vote-binding cases and the
other 3 doc-id-guard-block cases (accepts-two-shapes, grandfathered-bare-numeric,
canonical-id-does-not-excuse-forgery). Restored the exact original line via `Edit` (verified via
`git status --porcelain -- firestore.rules` showing only the staged `M`, no unstaged residue) and
re-ran clean: 244/244.

**Real finding, not in the diff: a leftover mutation-harness artifact.** `npm run test:rules` before
my own mutation run showed 474 tests / 10 failed, not the claimed 244/244 — traced to an untracked
`src/test/rules/__bin624_mutant.test.ts` sitting in the real test directory (not scratchpad),
pointing its `initializeTestEnvironment` at a scratchpad copy of `firestore.rules` that happened to
be the no-guard mutant left over from a PRIOR pass's own mutation testing (file timestamps and the
scratchpad session id matched THIS session, so it was this reviewer role's own prior-pass debris,
not a stranger's). This is exactly the "delete before finishing" directive in the knowledge file's
`_poc-*.test.ts` guidance, except the pattern used (`__bin624_mutant.test.ts`) wasn't the
recommended `_poc-*` naming, and it survived across what was apparently a session boundary or
compaction. Deleted it (`rm -f`), confirmed `git status --porcelain -- src/test/rules/` showed only
the tracked `M` on the real spec file afterward, re-ran: 3 files / 244 passed clean. Folded into
knowledge.md's "How to prove a finding" bullet: `git status --porcelain` the test dir before
trusting ANY count from `npm run test:rules`, not just the emulator-port workaround already
documented there.

**One stale principle found and corrected in place.** Two bullets in knowledge.md pre-dated BIN-624
and were now flatly contradicted by this diff: (1) the doc-id-namespacing-migration bullet said
"`match /swipes/{id}` never references [the doc id], so a plantable legacy doc buys only write
economy" — false as of this diff, which DOES reference `tmdbId` in the create allow-expression. (2)
The anon/session bullet said the same thing in different words ("`match /swipes/{id}`
format-guards no doc id"). Both rewritten to state the CURRENT truth (form-bound via
`canonicalSwipeDocId`, not volume-bound — `movie_1`…`movie_999999` still all creatable, so the
junk-doc-cost class the BIN-636 audit named is explicitly NOT closed by this ticket, matching the
rules file's own new comment) rather than superseded silently.

Checked `.claude/rules/accepted-deviations.md`: anon-vs-anon vote forgery and the missing
session-expiry gate are both decided (ADR 0015) and not re-flagged. BIN-624 half 2 (server parser
strictness) is explicitly out of scope per the dispatching prompt and not filed as an absence.

No blocking findings in the reviewed diff itself. The leftover mutant-test file is Low/hygiene (not
part of the staged diff, untracked, would not have been committed by a targeted `git add`), flagged
so it doesn't corrupt a THIRD reviewer's run.

**Verdict:** pass, 0 blocking.

### 2026-08-06 — BIN-555 group-create rollback + integritet sessionStorage disclosure (staged review)

**Scope.** Dispatching brief named two files: `src/lib/firebase/groups.ts` (createGroup's new
compensating `deleteDoc` rollback) and `src/app/integritet/page.tsx` (new privacy copy naming two
sessionStorage keys). `git diff --cached --stat` showed four other staged files (groups.test.ts,
mediaTypeDocId.ts + its parity test, DeleteAccountSection.test.tsx, tasks/todo.md, docs/org/metrics
events.jsonl) — noted, not reviewed; the brief's file list is a hint, not the boundary, but nothing
in the stat output looked like an unnamed trust-boundary change (no firestore.rules, no functions/**).

**createGroup rollback (groups.ts:96-145).** Sequence: `addDoc(groups)` with
`memberUids:[ownerUid]` → `setDoc(members/{ownerUid})`. On the member-doc write throwing, catch block
`deleteDoc`s the just-created group doc (best-effort, swallowing a second failure with a
console.error naming "needs manual Firestore fix"), then re-throws the ORIGINAL error — confirmed by
the new test (`groups.test.ts` BIN-555 describe block): asserts `deleteDocMock` called once with the
exact `groups/{groupId}` path, `updateDocMock`/`writeBatchMock` NEVER called (no arrayRemove, no
smuggled-in atomicity), and the rejection message is `'network lost'` (the original) even when the
rollback delete itself also rejects with a different message.

Read `firestore.rules:1108-1109` — `match /groups/{groupId} { allow delete: if isSignedIn() &&
resource.data.ownerUid == request.auth.uid; }`. The create rule (line 1003-1006) already forces
`request.resource.data.ownerUid == request.auth.uid`, so the caller executing this rollback is
provably the same uid as `ownerUid` on the doc being deleted — the delete is permitted by EXISTING
rules, no rules change staged or needed. Matches the panel's two binding conditions (BIN-555,
2026-08-06 panel: Security Architect #4 + DBA #27 + Codebase Archaeologist): no writeBatch/
transaction (BIN-532 already proved get()-before-batch semantics break member-doc creates), no
firestore.rules edit.

**TOCTOU check — does NOT apply here, and that's worth recording as a boundary case.** The sibling
accepted deviation (`.claude/rules/accepted-deviations.md` "groups.ts membership-add rollback can
strand a late compensating write") is about join/accept's `arrayRemove` on an EXISTING, shared
group doc, where a stalled call's late rollback can strip a uid a completed retry re-added.
createGroup's rollback targets a doc `addDoc`-minted in the SAME call, whose id and invite token
have not yet left the function (the promise hasn't resolved, so the caller has neither `groupId`
nor `inviteToken` to retry with, and no one else has ever seen this doc). There is no independent
actor who could have re-established membership on it between the failed `setDoc` and the rollback
firing — the TOCTOU precondition (state independently, validly re-established in the gap) is
structurally absent. Folded into the knowledge file's compensating-write bullet as the "provably
unreachable by anyone else" exception, so a future review doesn't demand a `getDoc` pre-check here.

Also checked: `deleteDoc`'s catch only logs generic `Error` objects (network/permission codes),
never the plaintext invite token or its hash — neither is in scope of this write, and
`generateSecureToken`/`sha256Hex` run before `addDoc`, unrelated to the catch. The caller
(`src/app/grupper/ny/page.tsx`) catches the re-thrown error and shows a generic Swedish message,
`console.error(err)` only — no token, no Firestore internals reach the UI. `src/lib/sentry.ts`
(read) has `replaysSessionSampleRate: 0` / `replaysOnErrorSampleRate: 0` and a `beforeSend` PII
scrub; `captureError` is not even called on this path. No secret leakage.

**integritet/page.tsx sessionStorage disclosure.** Read `src/lib/nextPath.ts` and
`src/lib/tabSession.ts` in full. `binge:nextAfterLogin` stores only a `safeNextPath`-validated,
same-origin PATH (rejects `//`, `/\`, control chars, non-`/`-leading values) with query stripped to
an allowlist (`RETURN_QUERY_KEYS`) on both write and read — never a URL, never PII, never sent over
the network by any code path found (grepped `sessionStorage` across `src/`: only same-origin
reads/writes in AuthContext, AuthGuard, useSignedOutRedirect, nextPath.ts, tabSession.ts, plus
tests). `binge:tabSession` stores only a normalized pathname, same constraints. Sentry replay is
off and `beforeSend` doesn't attach storage; no `fetch`/`XMLHttpRequest` call in the repo reads
either key. The copy's claim — "ingen tredje part har åtkomst till dem, och de lämnar aldrig din
enhet" — holds given the code as written (the standard caveat: an XSS vector elsewhere on the
origin would defeat this, same as it would for every other same-origin storage claim on the page;
not a defect introduced by this diff). Also verified the existing knowledge-file note "(Privacy §8
omits every `binge:` key)" — grepped every `binge:`-prefixed key in `src/`: `wasLoggedIn`, `theme`,
`groupInvite:`, `lastReportAt`, `rec-rotation:` remain undocumented after this diff, so the note is
still accurate (this diff documents 2 of ~7); updated the knowledge wording to say the coverage is
"deliberately partial," not "every key," since two now ARE covered.

**Not re-filed (per accepted-deviations.md, read in full):** the sibling join/accept rollback race
(different doc-sharing shape, addressed above); the Tillsammans anon-vote and session-expiry
deviations (untouched by this diff); blocking-as-hygiene and create-only reports (unrelated
surfaces).

No blocking findings. No rules change present or needed. No secret/PII leak on either surface.

**Verdict:** pass, 0 blocking.

### 2026-08-06 — BIN-555/777/767/646 batch re-review + a caught worktree-contamination false alarm

Staged diff since the prior pass: `docs/org/metrics/events.jsonl` (data), `functions/src/shared/mediaTypeDocId.ts`
(comment-only), `src/app/integritet/page.tsx` (privacy §8 now names all THREE sessionStorage keys),
`src/components/settings/DeleteAccountSection.test.tsx` (new), `src/lib/firebase/groups.{ts,test.ts}` (BIN-555
rollback), `src/lib/mediaTypeDocId.{ts,parity.test.ts}` (BIN-646 tightening), `src/test/rules/firestore-rules.test.ts`
(comment-only), `tasks/todo.md` (doc). Dispatcher named three things to verify.

**Privacy policy exhaustiveness (integritet/page.tsx).** Grepped `sessionStorage\.(setItem|getItem|removeItem)`
across all of `src/` (non-test files): exactly three keys are ever touched — `binge:nextAfterLogin`
(`src/lib/nextPath.ts`), `binge:tabSession` (`src/lib/tabSession.ts`), `binge:lastReportAt`
(`src/lib/firebase/reports.ts`). The new §8 li now names all three; the count in the intro text says "tre" and
matches. Read `nextPath.ts`, `tabSession.ts`, `reports.ts` in full and checked each description against the
code: `nextAfterLogin`'s "kommer ihåg vilken sida du var på när du klickade på logga in... eller som skickade
dig till inloggningen" correctly covers BOTH write call sites (`rememberNextPath` is called from
`AuthGuard.tsx:73` — the forced bounce — and `useSignedOutRedirect.ts:60` — the voluntary tap, itself fanned out
to 6 UI call sites per its own doc-comment); "Läses och raderas när inloggningen är klar" matches
`takeNextPath`'s consume-once read+delete; "ibland med sökord eller filter" matches
`RETURN_QUERY_KEYS = ['q','status','provider','row']` surviving `stripUnsafeQuery` on both write and read; "aldrig
en adress till någon annan sajt" matches `safeNextPath`'s same-origin-only guard. `tabSession` and `lastReportAt`
descriptions match their modules line-for-line. `localStorage` keys (`binge:theme`, `binge:wasLoggedIn`,
`binge:fcm:tokenId:*`, `binge:pubprofile-sig:*`, `binge:groupInvite:*`, `binge:rec-rotation:*`) remain
undocumented — per the prior entry's resolution this is the accepted "deliberately partial (LEK-exempt)"
scope, Info not a finding. No defect.

**firestore.rules:834 `movie_0` residual (comment-only test change).** Read the swipe create-guard
(`canonicalSwipeDocId`, firestore.rules ~810-835) and traced the READ side: `swipeDocToObject` →
`parseTmdbIdFromDocId(id)` (client copy, strict since BIN-618/646) → for `movie_0` this is now `NaN` (client
`CANONICAL_TMDB_ID` requires `[1-9][0-9]*`, no bare `0`). `indexSwipes` (`src/lib/together/matching.ts`) keys
by `candidateKey({tmdbId, mediaType})` = `mediaTypeDocId(mediaType, tmdbId)`; a doc with `tmdbId: NaN` produces
a key no real TMDB-sourced candidate (`tmdbId` always a finite positive int from the TMDB API) can ever collide
with, so a planted `movie_0` swipe is genuinely inert — stored junk, never surfaced, never counted toward any
real title's vote tally. This matches the test comment's claim exactly ("a doc nobody can create by accident
and nobody reads — not a vote that silently counts"). Judged SAFE to ship documented-as-is: this is the same
"form-bound, not volume-bound" class already accepted for the rest of `canonicalSwipeDocId` (ADR 0015 lineage,
BIN-624), the fix (narrowing the regex to exclude `_0`) is correctly deferred to its own ticket (BIN-797) since
it's a `firestore.rules` change needing its own plan + manual deploy per this repo's rules, and the residual
window has zero live-vote-integrity impact. No blocking finding; BIN-797 is the correct vehicle, not this diff.

**groups.ts BIN-555 rollback — re-derived, not just trusted.** Diff adds a try/catch around the owner
member-doc `setDoc`; on failure it `deleteDoc`s the just-`addDoc`-minted group doc and rethrows (rollback
failure itself is caught+logged, never swallows the original error). Verified `firestore.rules` line ~1108:
`allow delete: if isSignedIn() && resource.data.ownerUid == request.auth.uid` — the caller IS
`params.ownerUid`, so the delete is rules-legal and cannot be steered onto another owner's group (both the
create and the delete target the SAME `groupRef.id` minted in this call). This is exactly the pattern already
in the principles file ("a rollback that DELETES a doc `addDoc`-minted in the SAME call before its id/token
left the function... no re-check needed" — BIN-555). No new finding; confirms the dispatcher's "unchanged since
your pass" premise was accurate for the SUBSTANCE even though the file's bytes differ from a much earlier
HEAD (this is the shape the earlier pass already blessed).

**Caught and resolved: a worktree-contamination false alarm on `DeleteAccountSection.tsx`.** First `Read` of
this file (not itself in the staged diff — pre-existing BIN-748 code, exercised by the new
`DeleteAccountSection.test.tsx`) showed the ternary checking `message.includes(REQUIRES_RECENT_LOGIN)` BEFORE
`message.includes(STALE_SESSION_PREFLIGHT)` — since the test's own preflight fixture message contains BOTH
codes by design, that order would make the "Ingenting har raderats." promise UNREACHABLE dead code. Ran the new
test file in isolation: 1/5 failed, matching that reading. Ran the FULL suite (`npx vitest run src`, 216
files/2552 tests): all green, including this file. Re-ran the single file again: 5/5 green, no source edit of
my own in between. `git status --porcelain` at that moment showed `src/lib/mediaTypeDocId.ts` as `MM` (staged +
an ADDITIONAL unstaged diff removing the new string-canonical branch from `resolveTmdbId` — a live sibling
mutation-testing run) while `DeleteAccountSection.tsx` itself showed no diff at all against HEAD. Re-`Read` of
`DeleteAccountSection.tsx` after the tree settled showed the CORRECT order (`STALE_SESSION_PREFLIGHT` checked
first) — confirmed by `git hash-object` matching `git rev-parse :<path>`. Re-ran the affected tests fresh
(`--no-cache`, tree clean, no `MM` anywhere): consistently green across 3 repeats. Conclusion: the first `Read`
caught a sibling's mutant mid-cycle on a file that itself never went `MM` — the existing "wait for `MM`→`M` on
the suspect file" guidance in the principles file is necessary but not sufficient when the sibling's loop
touches several files, since a fast mutate/restore on one file says nothing about another that was hit and
released before you happened to check `git status`. Folded into the principles file: require the file's OWN
git status clean AND two consecutive identical `--no-cache` re-runs before trusting either verdict, treating a
run-to-run disagreement with no edit of your own as the contamination signal itself. No defect in
`DeleteAccountSection.tsx`; the shipped `tasks/todo.md` "Verifiering" claim (216 files/2552 tests green) is
independently confirmed true on a clean tree.

**Not re-filed (per accepted-deviations.md, read in full):** Tillsammans anon-vote/session-expiry deviations
(untouched), blocking-as-hygiene, create-only reports, the groups.ts join/accept rollback race, the visibility
read fail-open call — none touched by this diff.

**Verdict:** pass, 0 blocking.

### 2026-08-09 — BIN-814 subscriptionProviders hasOnly ratchet (staged, PASS)

**Scope:** `firestore.rules` adds `subscriptionProviders` to `isValidWatchlistItem`'s
`hasOnly`, no value bind (bare `number[]`, matches the neighbouring unbound `providers`).
Client-side split of one denormalized provider array into two (`providers` = watch-at-all,
`subscriptionProviders` = flatrate/free/ads only, feeding the subscription advisor's
keep-or-pause reasoning) across `MoviePageClient.tsx`, `TVShowPageClient.tsx`,
`WatchlistContext.tsx` (`refreshTmdbFields`/`docToItem`), `useSubscriptionAdvisor.ts`/
`.helpers.ts`, `taste/backfill.ts`/`.helpers.ts`, `tmdb/providers.ts`, new
`tmdb/seProviderIds.ts`. `src/test/rules/firestore-rules.test.ts` gets 3 new tests.

**Finding 1 — ratchet test seeding path (Info, not filed as blocking).** The second
test (`an UNRELATED later write still succeeds on a doc that carries the field`) seeds
the "doc carries the field" state via a plain authenticated `setDoc` under the SAME
ruleset it then tests, not `withSecurityRulesDisabled` (used elsewhere in this exact
file for legacy-doc simulation, e.g. the `notes` legacy tests at line ~441). Traced
what happens under the dev's own mutation (field removed from `hasOnly`, rerun):
the SEED write (`setDoc(ref, { subscriptionProviders: [8] }, {merge:true})`, no
assertFails/assertSucceeds wrapper) is itself rejected by the mutated `hasOnly`
before the "unrelated write" line runs — Firestore throws on the awaited call, test
fails, but on the SEED line, not the ASSERTION line the comment names. Confirmed this
is harmless here only because `hasOnly` is a pure key-set check with no notion of
provenance — a doc that got the field via a bypass-seed vs. a live write under
permissive rules produces an IDENTICAL post-merge key set for the mutated rule to
evaluate, so the regression is still caught either way. Folded into the knowledge
file as a general pattern: this equivalence does NOT hold for a VALUE ratchet whose
behavior depends on the resource's *prior stored value* (`vetoRemaining <=`,
`tmdbFieldsRefreshedAt <= request.time`) — there, a live-seed-under-mutated-rules
test could fail to even construct the "already contaminated" precondition, silently
skipping the scenario it claims to guard. Recommended (not required) fix: reseed via
`withSecurityRulesDisabled` to decouple the doc's provenance from the ruleset under
test, matching the file's own established pattern one section up.

**Finding 2 — deploy ordering.** `firestore.rules`' comment and `tasks/todo.md`
both state rules-before-client, matching every client write path (`refreshTmdbFields`
merges `providers` + `subscriptionProviders` together via `planTmdbFieldsRefresh`).
No code assumes the reverse. Correct per the project's `deploy.yml` hosting-only
constraint (`.claude/rules/deployment.md`).

**Finding 3 — value-bind asymmetry (explicitly not a finding).** `subscriptionProviders`
has no type/length bind, matching the pre-existing `providers` field (also unbound in
`isValidWatchlistItem` — verified by reading the full validator). Both are self-owned
docs' bare numeric-id arrays, consumed ONLY through `PROVIDER_MAP`/`getProvider()`
lookups (unknown ids render a grey fallback chip, canonicalProviderId passes unknown
ids through unchanged) — never interpolated into a query, URL, or admin decision.
Same risk class as the accepted "blocking is hygiene" pattern: worst case is junk
provider ids in one's own advisor UI. Not filing "bind the array" absent a consuming
surface that starts trusting array contents as more than a lookup key.

**Finding 4 — privacy exposure (none, verified not assumed).** Read the full watchlist
read-rule block: public/friends visibility already exposes `providers` (superset,
includes rent/buy) via the SAME `effectiveVisibility`-gated read paths.
`subscriptionProviders` is a subset of `providers`, sourced from the same public
per-title TMDB SE catalog (which platforms carry the TITLE), NOT the user's own
subscription list (`users/{uid}.myProviders`, deliberately excluded from
`publicProfiles` per an existing rules comment). No new exposure class; strictly less
data than what's already public through the sibling field.

**GDPR:** new FIELD on an already-covered subcollection (`users/{uid}/watchlist`), not
a new subcollection — no `userData.ts` collector change needed per the established
"new field on covered doc → no" rule. None made; correct.

**Verdict:** PASS, 0 blocking. Verified `npm run test:rules` mutation claim (248
green / 2 fail on hasOnly-removal / byte-identical restore) is internally consistent
with the rule structure (only the two field-presence tests should trip; the
"rejects an unknown field" test is unrelated to this specific key and should stay
green either way).

### 2026-08-10 — BIN-814 re-review after growth (money-surface fan-out + backfill rewrite, PASS)

**Scope:** re-review of the same ticket after the diff grew from the prior pass to 56
files: `tmdbFieldsRefresh.ts` (`shouldStampProvidersAtAdd` now pair-gated),
`backfill.ts`/`.helpers.ts` (rewritten selection via `needsBackfill`, new
`subscriptionProviders` write branch), four money-surface consumers
(`spendSnapshot.ts`, `householdAggregate.ts`, `serviceValue.ts`,
`useSubscriptionAdvisor.ts`) switched from reading `providers` to a new shared
`src/lib/watchlist/subscriptionProviders.ts` helper, `RecCard`/`TitleCard` now supply
`subscriptionProviders`, `tmdbTosSweep` clears both fields together. `firestore.rules`
itself byte-identical to the prior-approved diff (re-diffed, confirmed).

**Dispatcher Q1 — bounded deferral, not unbounded re-fetch cost (verified, not just
argued).** Traced every path that can leave the stamp/field pair incomplete:
- Add-time (`shouldStampProvidersAtAdd`): omitting the stamp on a partial pair means
  the NEXT title-page view (which fetches TMDB regardless of watchlist stamp state,
  for page rendering) rewrites both fields via `planTmdbFieldsRefresh` — zero
  *additional* TMDB cost, since that fetch already happens.
- Backfill (`needsBackfill`/`buildBackfillUpdate`): `providersCheckedAt` is stamped
  UNCONDITIONALLY on every run regardless of whether either provider field actually
  wrote (a response with no SE block writes neither field but still stamps) — this is
  what stops perpetual re-selection. Confirmed by the diff's own new test
  (`needsBackfill — the run must terminate for a title with no SE block`, four cases
  including "does NOT re-select a freshly stamped row that still has no provider
  fields"), which is the exact convergence property, not a restated assumption. Cost
  is capped at one fetch per 60-day window per title, same as before BIN-814 — the
  pair-gate changes WHEN a doc's stamp lands, never whether the 60-day cap holds.
- `planTmdbFieldsRefresh`'s `providersNeeded` gate checks `fields.providers != null`
  only (not the pair) — so the repair path is NOT itself pair-gated, which is what
  makes the add-time omission self-correcting rather than sticky. Conclusion: the
  worst case of the pair gate is a bounded deferral (one extra title-page view or up
  to one 60-day backfill cycle), never an unbounded loop. No finding.

**Dispatcher Q2 — rules unchanged, no-bind is intentional and safe for the new call
sites (verified).** Re-read `isValidWatchlistItem` in full: `subscriptionProviders` has
NO type/length bind, identical treatment to the pre-existing `providers` (also
unbound) — this is the SAME accepted asymmetry already judged in the prior pass
(Finding 3), not new. `RecCard`/`TitleCard` passing the identical canonicalized
`number[]` for both `providers` and `subscriptionProviders` therefore cannot be
rejected by `hasOnly` (key-set only) or by any value bind (there is none on either
field) — confirmed by reading the full validator, not inferred.

**Dispatcher Q3 — deploy order.** `tasks/todo.md`'s "Deployordning (ej förhandlingsbar)"
still reads rules → `functions:tmdbTosSweep` → push, matching `firestore.rules`'
own comment and every client write path (title page, backfill, add path all derive +
write the pair together in one call). Unchanged from the prior pass.

**Dispatcher Q4 — `mutateEnabled`.** Grepped the full staged diff: the only hit is a
`tasks/todo.md` line stating it was NOT touched. No code in the diff references it.

**Money-surface fan-out (in scope only as a cost/correctness cross-check, not a trust
boundary):** `subscriptionProviderIds()` (new shared helper) now backs
`spendSnapshot.ts`, `householdAggregate.ts`, `serviceValue.ts` (×2 call sites) and
`useSubscriptionAdvisor.ts`'s film-anchor branch. Read all four call sites plus the
helper: three-way `null`/`[]`/populated semantics preserved consistently everywhere
(`null` → broad-array fallback, `[]` → real "not on any subscription" answer). Test
reviewer's own archive records a same-day blocking finding that `householdAggregate.ts`
and `spendSnapshot.ts` initially shipped this switch with zero dedicated coverage
(sibling-sweep-gap class) — re-read both test files in the CURRENT staged diff and
confirmed dedicated rent-only-excluded + null-fallback test pairs now exist in both,
matching `serviceValue.test.ts`'s pattern. No user-data exposure or ownership boundary
touched by any of this — purely internal cost-derivation logic reading the caller's own
watchlist.

**Worktree hygiene note:** `src/lib/taste/backfill.helpers.ts` showed transient `MM`
mid-review (an unstaged line re-inserting `contentChanged = true` into the
`subscriptionProviders` write branch — exactly the bug BIN-814 fixed, i.e. a live
sibling mutation-testing run). Resolved to clean `M` with index-matching hash before
this file was Read or judged; re-diffed `--cached` afterward to confirm the staged
bytes never carried the mutant.

**Not re-filed (accepted-deviations.md read in full):** Tillsammans anon-vote/
session-expiry, blocking-as-hygiene, create-only reports, groups.ts rollback race,
visibility read fail-open — none touched by this diff.

**Verdict:** pass, 0 blocking.

### 2026-08-10 — BIN-844 (sign-out push unregister + invite-cache sweep) + BIN-845 (rollup provider-tally subset)

Full `top`-tier panel [27,5,4,6,18] ran live pre-code (recorded in `tasks/todo.md`),
DBA bounced (device-local storage only, no Firestore schema). Reviewed every staged
file with `Read`: `AuthContext.tsx` + `.test.tsx`, `src/lib/firebase/messaging.ts`,
`src/lib/groupInviteCache.ts` + `.test.ts`, `docs/data-retention-policy.md`,
`functions/src/insights/rollup.ts` + `rollup.helpers.ts` + `.test.ts`,
`src/app/stats/page.tsx`, `src/lib/stats/providerTally.ts` + `.test.ts`,
`tasks/todo.md`.

**Premise correction was itself the finding, and it was made BEFORE this review** —
the ticket assumed `binge:groupInvite` was the live shared-device leak; the panel
(DPO + Archaeologist) traced it to `disablePushForUser` never being called from
`signOut` at all, only from the settings toggle. Confirmed by reading `messaging.ts`
and `AuthContext.tsx` pre-fix history in the diff itself — the fix targets the real
mechanism, not the originally-filed one. Judged the SHIPPED fix, not the ticket text.

**1. Ordering, verified live in the code (not just the comment):** `signOut`
captures `const signingOutUid = auth.currentUser?.uid` SYNCHRONOUSLY (no await
before the read), calls `await disablePushForUser(signingOutUid)` wrapped in a
local `try {} catch {}` (never rethrows), THEN `await firebaseSignOut(auth)`.
`disablePushForUser` itself: reads the per-uid localStorage tokenId, `deleteDoc`s
`users/{uid}/fcmTokens/{id}` (rules confirmed at firestore.rules:352 —
`allow read, write: if isOwner(uid)`, live auth still holds `uid` at this point),
and only that ONE failure mode (`firestoreErr`) is rethrown at the end — the
FCM-SDK half (`getMessagingInstance` + `deleteToken`) is caught internally and
never propagates. So the outer catch in `signOut` is reachable only for the
Firestore delete failing, and it swallows it. Confirmed non-blocking: no code path
between the capture and `firebaseSignOut` can throw past the try/catch.
`AuthContext.test.tsx`'s `invocationCallOrder` comparison
(`disablePushForUser` before `firebaseSignOut`) and the "signs out anyway when
unregistering push throws" test both hold under mutation-shaped reasoning (deleting
either the capture-before-await or the try/catch by hand breaks one of the two
pinned tests).

**2. The stated gap (silent expiry/revocation bypasses the fix) is accurately
characterized.** The write requires a LIVE ID token; the auth listener's
uid→null branch (BIN-732's home for the rest of sign-out hygiene) fires strictly
AFTER the token is already gone, so there is structurally no point to relocate the
call to. This is the same shape as `deleteAccount`'s freshness gate needing to run
BEFORE the point of no return — not a new pattern, an inversion of an existing one,
and the code comment says so. Not a blocking gap: it doesn't regress anything (push
already keept arriving post sign-out before this ticket, for ALL sign-outs, not
just silent ones), it's a partial fix documented as partial, and Malin parked the
full closure ("silent expiry" case) as a separate ticket rather than building it
blind. Accepted as shipped-partial, not silently declared complete — `tasks/todo.md`
"Kvar för Malin" section states the residual explicitly.

**3. Invite-cache non-sweep is honestly scoped in both code and
`data-retention-policy.md`:** the comment and the doc both say plainly that clearing
the cache "revokes nothing server-side" and a devtools read gets the plaintext
either way — this closes a same-account-signed-out-still-on-device read, not a
credential. No overclaim found (grepped for "closes"/"stops"/"prevents" language
near the invite-cache comments — none present; language is consistently
"hygiene"/"pointer"/"does not stop").

**4. Three deliberately-kept keys** (`binge-session-pid-*`/`binge-my-sessions`,
`binge:wasLoggedIn`, `binge:rec-rotation:*`) cross-reference ADR 0015 in the updated
doc rather than re-litigating — matches the already-accepted deviation in
`accepted-deviations.md` ("Tillsammans session-expiry", `binge-session-pid-*`
survival). Not re-flagged.

**5. BIN-845 (`rollup.ts`/`rollup.helpers.ts`/`stats/page.tsx`/`providerTally.ts`):**
confirmed a pure field-selection change — `.select()` widened to also fetch
`subscriptionProviders` (admin SDK, own scheduled aggregate function, no client
exposure change), and a new pure helper (`tallyProviderIds` /
`subscriptionProviderIds`-based `providerTally`) picks which array a tally counts.
No `firestore.rules` touched (confirmed via `git diff --cached --name-only` —
absent), no new collection, no new read/write path, both consuming surfaces already
read only the caller's own data (admin dashboard aggregate / the signed-in user's
own watchlist via `useWatchlist`). No security or data-exposure implication.

**Also found (non-blocking, cost/perf not security):** `disablePushForUser` now
runs on EVERY sign-out, including users who never enabled push — it unconditionally
calls `getMessagingInstance()` (lazy-loads the `firebase/messaging` chunk +
`isSupported()` + `getMessaging(app)`) at the bottom of the function regardless of
whether a `tokenId` was found in localStorage. Previously this chunk only loaded
from the settings toggle. Not a security finding — no credential exercised, no data
touched — flagged as a product/perf observation only.

**Not re-filed (`accepted-deviations.md` + `.claude/rules/data-model.md` both read
in full this review):** Tillsammans anon-vote/session-expiry, blocking-as-hygiene,
create-only reports, watchlist visibility read fail-open, groups.ts rollback race —
none touched by this diff.

**Verdict:** pass, 0 blocking.

### 2026-08-10 — RE-REVIEW of the same BIN-844 diff after the integration reviewer's
fix round: this was a self-correction, not a fresh review

My own prior entry above (same date, same ticket) PASSED a version of `signOut` that
could hang forever offline — approved because I checked only whether the awaited
`disablePushForUser` call could THROW past its try/catch, never whether it could
simply never resolve. The integration reviewer caught it afterwards, along with a
second defect (the settings checkbox reading account-level `pushEnabled` instead of
the per-device token) that I had ALSO missed, structurally: my prior file list did
not even include `NotificationsSection.tsx`/`.test.tsx`, because at review time
`hasLocalPushToken` didn't exist yet — the checkbox bug was introduced by the very
absence of the fix I'd approved. Read every file in `git diff --cached --name-only`
with `Read` this pass, including both files missed before:
`src/components/settings/NotificationsSection.tsx` + `.test.tsx`,
`src/lib/firebase/messaging.ts`, `src/contexts/AuthContext.tsx` + `.test.tsx`,
`src/lib/groupInviteCache.ts` + `.test.ts`, `docs/data-retention-policy.md`,
`functions/src/insights/rollup.ts`/`rollup.helpers.ts`/`rollup.test.ts`,
`src/app/stats/page.tsx`, `src/lib/stats/providerTally.ts` + `.test.ts`,
`tasks/todo.md`, and the three `.claude/agents/*` knowledge files also in the diff
(test-reviewer's own archive entry for this same round, read for consistency —
no contradiction found). `firestore.rules` confirmed untouched (empty `git diff
--cached -- firestore.rules`).

**Finding 1 (the hang) — verified fixed, not just re-asserted.** `signOut` now wraps
the call: `await Promise.race([disablePushForUser(signingOutUid).catch(()=>{}), new
Promise(resolve => setTimeout(resolve, PUSH_UNREGISTER_TIMEOUT_MS))])` with
`PUSH_UNREGISTER_TIMEOUT_MS = 2000`, guarded by `hasLocalPushToken(uid)` so the call
(and its `firebase/messaging` chunk load) is skipped entirely for the common
never-enabled-push case — this also closes the "also found" perf note from my prior
entry (bottom). Judged the two questions the dispatcher posed directly:
- **Is the discard claim honest?** Verified against the Firestore Web SDK's OWN
  `.d.ts` doc comments (`node_modules/@firebase/firestore/dist/index.d.ts`), not the
  code comment's say-so: `terminate()` — "does not cancel any pending writes, and any
  promises that are awaiting a response from the server will not be resolved... next
  time you start this instance, it will resume sending these writes." So `terminate()`
  ALONE would make the abandoned delete durable and eventually replayed — which would
  make the code's "discarded" claim FALSE. But `clearFirestorePersistence()`
  (`src/lib/firebase/db.ts`) calls `terminate(db)` THEN `clearIndexedDbPersistence(db)`,
  and that second function's doc comment is explicit: "Clears the persistent storage.
  **This includes pending writes** and cached documents." That exact pairing is what
  makes the claim true, and it's present and unconditional (runs right after
  `firebaseSignOut` in every `signOut`, not just the push branch). Traced the dangling
  promise itself: on `terminate()`, the pending `deleteDoc` await "will not be
  resolved" (SDK's words) — i.e. it hangs in limbo rather than rejecting — so
  `disablePushForUser`'s own `localStorage.removeItem(...)` (which sits AFTER that
  await, outside the try/catch) is never reached either. Net effect confirmed
  IDENTICAL to the pre-ticket baseline on the offline path: local pointer intact,
  server doc intact, no new "hasLocalPushToken says no token but server still has one"
  state — the class of regression I checked for and did not find.
- **Is 2s the right shape?** Reasonable: generous for a normal Firestore round-trip,
  short against a fire-and-forget `void signOut()` call site with no spinner either
  way. Applies equally to "genuinely offline" and "merely slow" — a write that would
  have succeeded at 2.5s is also discarded, which is a minor product cost (not
  security) and consistent with "best-effort, never block sign-out."
- **Residual, not re-filed as blocking:** no test drives the actual TIMEOUT/hang path
  (a `disablePushForUser` mock that never settles, under fake timers, asserting
  `signOut` still resolves within the race window) — the shipped tests cover ORDER
  and REJECTION, not HANG, which is exactly the dimension my prior pass got wrong.
  The code is independently verified correct against the SDK's docs above, so this is
  a coverage gap (test-reviewer's domain) rather than an active defect — flagged as a
  non-blocking recommendation, not a blocker.

**Finding 2 (the checkbox) — verified as claimed, no new trust boundary.**
`hasLocalPushToken(uid)` in `messaging.ts` is a pure `window.localStorage.getItem`
read behind try/catch; it gates only the checkbox's display state
(`pushOnThisDevice = pushEnabled && hasDeviceToken`), never a write or an
authorization decision. `NotificationsSection.tsx`'s `useEffect` deps are
`[uid, busyKeys]` — re-reads on both an account switch (BIN-592-class check: the key
is uid-namespaced, so no cross-account bleed) and after a toggle settles. Declared
above the `!user || !uid` early return (correct hook-order placement, matches its own
comment). No security finding.

**Also confirmed:** `docs/data-retention-policy.md` update is honest — plainly states
push-unregister-on-signout closes the real leak, and that a silently-expired/revoked
session (no click on "Logga ut") is a KNOWN gap the write can't reach (needs a live
ID token). `tasks/todo.md`'s "Kvar för Malin" states the same residual — matches code.
`groupInviteCache`/`clearAllInviteTokens` unchanged in substance from my prior pass;
re-confirmed the sweep is deletion-only, never sign-out, per Malin's recorded
2026-08-10 decision — not re-litigated. BIN-845 (rollup/stats/providerTally) diff is
unchanged from my prior pass in every file that matters to security — re-confirmed no
`firestore.rules` change, no new collection, admin-SDK-only field widening; nothing
new to say.

**Lesson folded into the active knowledge file in place** (Cross-account and
cross-session leak classes section): a bare `await` on a `persistentLocalCache` write
inside a destructive/blocking flow needs a race against a timeout, and the
"discarded, not replayed" claim for the abandoned write must be checked against the
SDK's own `terminate()`/`clearIndexedDbPersistence()` doc comments, not inherited from
the fix's own comment. Compressed two other bullets (the `withSecurityRulesDisabled`
ratchet-seeding bullet and the BIN-669 sub-paragraph) to make room under the 30k cap.

**REVIEW-VERDICT: pass (0 blocking)**

### 2026-08-10 — CONFIRMATION pass on the same BIN-844+845 diff, three post-review movers

Dispatcher claimed only three files changed since the RE-REVIEW entry above: `useFcmToken.ts`
(an optional `hasLocalPushToken(uid)` guard tried, then reverted for a stale-closure bug —
second device's foreground listener would miss until reload), `stats/page.tsx` (unused `Link`
import removed), `AuthContext.test.tsx` (a comment corrected). Did not inherit this — re-ran
`git diff --cached --name-only` (unchanged 22-file list from the RE-REVIEW pass) and `Read` all
22 staged files fresh, including the three named movers and the ones the claim said were
untouched (`AuthContext.tsx`, `messaging.ts`, `groupInviteCache.ts`, `docs/data-retention-policy.md`
+ both knowledge/archive files + `rollup.*`/`NotificationsSection.*`/`providerTally.*`/
`taste/stats.*`/`tasks/todo.md`).

**Claim verified true, not assumed.** `useFcmToken.ts`'s diff against HEAD is comment-only — the
guard line (`if (!hasLocalPushToken(uid)) return;`) that the test-reviewer's knowledge file caught
as an unreviewed mid-run mover is genuinely gone; the effect's guard is back to
`if (!uid || !user?.notificationSettings.pushEnabled) return;`, matching pre-ticket behaviour. The
new comment's own reasoning (effect deps `[uid, pushEnabled, toast]` can't see a token appear) is
correct and doesn't overclaim. No functional change on this surface — not a security-relevant
mover, confirmed by reading the bytes rather than the framing.

**`docs/data-retention-policy.md` re-checked specifically for the failure mode named in the
dispatch** (a doc describing a guard that no longer exists): its BIN-844 section only describes
`AuthContext.signOut` calling `disablePushForUser` before `firebaseSignOut`, and the best-effort
caveats (skips with no local token, 2s release, silent-expiry gap) — it never mentions
`useFcmToken`'s foreground-subscribe guard at all. Two unrelated mechanisms share the
`hasLocalPushToken` helper name (sign-out unregister vs. checkbox display state in
`NotificationsSection.tsx` vs. the reverted foreground-subscribe optimisation); the doc's claims
track only the first, which is unchanged. No stale claim found.

**`stats/page.tsx`'s remaining diff hunk (removing the unused `Link` import)** is the mechanical
tail of the BIN-845 nudge removal already reviewed in the prior pass (the JSX stopped rendering
`<Link>` then; the import lingered until now) — cosmetic, no behaviour change.

**`AuthContext.test.tsx`'s diff against HEAD is unchanged in substance from the RE-REVIEW pass**
(same mocks, same ordering/hang/checkbox tests, all previously reviewed); the only NEW line since
is the `.at(-1)` comment now correctly saying `mockClear()` is in `beforeEach`, closing the LOW
self-contradiction the test-reviewer flagged in their own knowledge file. Test-only, no trust
boundary.

**`firestore.rules` and `.claude/rules/accepted-deviations.md` confirmed ABSENT from
`git diff --cached --name-only`** — not silently trusted from the prompt, checked directly.

No new findings. No new lesson class — the dispatcher's framing held up under independent
re-verification this time, which is the expected case, not a pattern change.

**REVIEW-VERDICT: pass (0 blocking)**

### 2026-08-10 — LEDGER pass on BIN-844+845: the one mover (`disablePushForUser`'s
pointer-clear made conditional on delete success)

Fourth pass on this diff. Re-ran `git diff --cached --name-only` (same 22 files as
every prior pass) and `Read` every one of them, incl. both knowledge/archive pairs
and `tasks/todo.md` in full. `firestore.rules` confirmed absent from the staged
diff (`git diff --cached --name-only | grep firestore.rules` empty); `fcmTokens`'s
rule re-confirmed at `firestore.rules:352` (`allow read, write: if isOwner(uid)`),
unchanged.

**The named mover, verified against the actual bytes, not the dispatch prose.**
`messaging.ts`'s `disablePushForUser` moved `localStorage.removeItem(tokenId key)`
from AFTER the try/catch (ran on every path: success, reject, or the code never
reaching it at all on a genuine hang) to INSIDE the try, immediately after the
`deleteDoc` await succeeds — so it now runs only on confirmed server deletion.
Traced all three outcomes by hand:
- **Success:** unchanged — doc gone, pointer gone, consistent.
- **Settles with a rejection** (permission-denied, a delayed deadline-exceeded that
  arrives before `clearFirestorePersistence()`'s `terminate()` cuts it off): this is
  the ACTUAL closed gap. Old code wiped the pointer regardless of outcome; the
  server doc survives a rejected delete, so the old behavior produced an orphaned
  server-side registration with the ONLY client-side handle to it gone. Concretely
  worse than that sounds in isolation: `AuthContext.signOut` gates the whole
  unregister attempt on `hasLocalPushToken(uid)` (skip if false, added by this same
  ticket to avoid loading the messaging chunk for users who never enabled push) — so
  the old bug didn't just orphan one doc, it permanently disabled every FUTURE
  sign-out's retry for that uid on that device, because the very next sign-out would
  see no local pointer and skip calling `disablePushForUser` at all. That is a
  self-inflicted defeat of the retry mechanism the ticket's own 2s-race design
  depends on to eventually self-heal a slow/flaky delete. The new code preserves the
  pointer exactly when the retry needs it.
- **Genuine hang** (offline, `persistentLocalCache` never acks): confirmed identical
  in old and new code — the function is suspended inside `await deleteDoc(...)`, so
  neither the old (outside-catch) nor new (inside-try) `removeItem` line is ever
  reached either way, independent of this change. No behavior delta here.

**No new trust boundary.** The pointer is a pure localStorage bookkeeping key,
uid-namespaced (no cross-account bleed per the existing BIN-592-class check), gates
only a UI checkbox's display state and whether a client-side retry attempt fires —
never an authorization decision. The write it gates (`deleteDoc` on
`users/{uid}/fcmTokens/{id}`) is still owner-scoped by rules regardless of what the
local pointer says. Settings-toggle path checked too: on a failed disable, pointer
retention now correctly keeps `hasLocalPushToken` true, so the checkbox stays
truthfully TICKED (device still registered) instead of the old behavior of falsely
showing unticked while push kept arriving — the exact shared-device misrepresentation
class this whole ticket exists to close, now closed one layer deeper than the three
prior passes credited it.

**Does this change the retention doc's "none of the three leaves a worse state than
before" claim?** No — that sentence is about whether attempting-vs-not-attempting the
unregister (skip-if-no-pointer / 2s-abandon / silent-expiry-gap) can regress below
pre-BIN-844 baseline, and remains true unchanged. This fix operates one layer inside
that: it's about whether a FAILED attempt leaves the RETRY mechanism intact, which
the doc doesn't discuss at that granularity and doesn't misstate either. Not a
required doc edit — noted as a completeness nit only (Low, non-blocking): the doc
could optionally mention that a failed disable preserves the pointer for retry, but
its existing claims stay accurate without it.

**Test coverage gap noted, not filed as a security finding (test-reviewer's
domain):** no `messaging.test.ts` exists at all — `disablePushForUser`'s conditional-
removal logic is exercised nowhere directly; both `AuthContext.test.tsx` and
`NotificationsSection.test.tsx` mock the module entirely. No trust boundary rides on
this gap (confirmed above), so not blocking, but flagged for the test reviewer.

**Mutation-marker sweep (requested explicitly this pass):** grepped every staged
file's INDEX bytes (`git show ":<path>"`, not the worktree) for
`MUTANT|__mutant__|_poc_|mutation-marker` — hits only inside the four `.claude/agents/*
knowledge*.md` files as narrative prose recounting past incidents (BIN-624/645/844
mutation-testing war stories) and one `AuthContext.test.tsx` comment ("a transient
mutant that moved this line above `deleteUser`") explaining why an ordering
assertion exists — neither is an injected marker. Grepped the actual code/doc files
(messaging.ts, AuthContext.tsx/.test.tsx, groupInviteCache.ts/.test.ts,
NotificationsSection.tsx/.test.tsx, useFcmToken.ts, rollup.ts/.helpers.ts/.test.ts,
stats/page.tsx, providerTally.ts/.test.ts, taste/stats.ts/.test.ts,
data-retention-policy.md, tasks/todo.md) individually for
`/\* MUTANT|// MUTANT:|MUTANT_MARKER|__mutant` — zero hits. `src/test/rules/` has no
stray `*mutant*`/`*_poc*` harness file. Clean.

No new lesson class — this is the existing "verify a claimed fix against the actual
mechanism, not the comment" discipline applied one layer deeper than the three prior
passes went, not a new failure mode.

**REVIEW-VERDICT: pass (0 blocking)**

### 2026-08-10 — BIN-848: retentionCleanup fifth sweep (fcmTokens for Auth-revoked uids)

Scope: `functions/src/retentionCleanup/{index,logic,logic.test}.ts`,
`docs/data-retention-policy.md`, `tasks/todo.md`. Ticket was rescoped down after
Malin correctly rejected the original premise (unregistering push on a lapsed
session defeats the point of push); what remains is a narrow gap — a Firebase
Console delete/disable revokes Auth but leaves every Firestore doc in place, and
`sendPushToUser` never consults Auth, so a suspended/deleted account's device keeps
receiving push forever.

**1. Fail-safe direction — verified, not just traced.** Read `revokedUidsFromLookup`
(logic.ts:136-150): "deleted" is read only from the response's own `notFound` array,
never inferred from absence in `users` — the function comment names the actual trap
(`disabled` accounts ARE present in `users`) and the test file pins it explicitly
(`logic.test.ts:130-137`, "the trap: a disabled account is present in users, not in
notFound"). A thrown `getUsers()` batch is caught PER BATCH inside
`collectRevokedPushTokens` (`continue`, nothing pushed to `refs` for that batch) —
confirmed by reading the try/catch at index.ts:208-218, not just the doc comment
claiming it. The whole scan is also wrapped in an outer `.catch()` at the
`Promise.all` call site exactly like its four siblings, so a thrown collectionGroup
query (not just a thrown `getUsers`) returns `[]` rather than rejecting the
`Promise.all` — confirmed this is what stops an Auth outage starving the four
Firestore-only sweeps (they're independent `.catch()`-wrapped promises, not
sequenced on this one).

**2. Is deleting the token enough, or does `pushEnabled` also need touching?**
Read `functions/src/push.ts:67-71`: `sendPushToUser` checks `tokensSnap.empty` and
returns after a log line — no error, no side effect on the profile doc. Deleting
every token doc is a clean, complete no-op path; touching `pushEnabled` would be
an unnecessary second mutation of data outside this sweep's stated scope for no
added safety.

**3. The `disabled` bucket being built (against the DBA's "leave it to Malin")**
is Malin's own explicit call, named in the plan and in the doc's new section
("Malin namngav uttryckligen spärrade konton som fallet hon ville ha täckt") —
this is not a reviewer's decision to second-guess (`accepted-deviations.md`
process: a founder call against a panel condition is recorded, not re-litigated).
The silent-recovery cost (re-grant browser permission after unlock) IS disclosed
honestly in `docs/data-retention-policy.md`'s new section, in plain language, not
buried — checked by reading the actual diff hunk, not trusting the ticket's summary
of it.

**4. collectionGroup('fcmTokens') across all users, Admin-SDK, no rules
involvement** (`firestore.rules:352-354` confirms the sole match is
`users/{uid}/fcmTokens/{tokenId}`, owner-gated for clients, irrelevant to an
Admin-SDK sweep). `.select()` with no args returns refs only — no token value ever
read, matching the sibling sweeps' minimal-read pattern. The `orderBy('__name__')`-
without-an-explicit-COLLECTION_GROUP-index pattern is the **same standing accepted
gap** already logged for `notifications`/`joinAttempts`/`notified`/`watchlist`
(2026-06-20 and later entries in this archive) — checked `firestore.indexes.json`,
confirmed no entry exists for any of these four either, so this is not a new risk,
Low/Info only, dominated by precedent already reviewed and shipped four times.

**GDPR completeness:** not a new collection — `fcmTokens` is already
`users/{uid}/**`, auto-covered by `collectUserDataSnapshots` per
`data-model.md`. This sweep is an additional Admin-SDK backstop for
Console-revoked accounts, not a new erasure surface requiring a `userData.ts`
change.

No new lesson class. Verdict matches the plan's own self-assessment; nothing in the
diff contradicted it.

**REVIEW-VERDICT: pass (0 blocking)**

### 2026-08-10 (round 3) — BIN-848: failure-path delta (onBatchError guard, -1 sentinel)

Scope, per the dispatching brief: just the two failure-path changes made since round 2 —
`revokedUidsInBatches`'s `onBatchError?.(err, size)` call now itself inside a nested
try/catch, and `collectRevokedPushTokens`'s outer `.catch()` in `index.ts` now returning
`skippedAuthBatches: -1` instead of `0`. Read the full current bytes of both files (not
just the delta) plus the test file, `docs/data-retention-policy.md`, `tasks/todo.md`, and
both agent-knowledge files that were staged alongside (`accepted-deviations.md` re-read,
`data-model.md` re-read — nothing new applies).

**1. onBatchError guard.** Read `logic.ts:169-193`: `skippedBatches += 1` executes BEFORE
the nested `try { onBatchError?.(err, batch.length) } catch { /* best-effort */ }` — so the
batch-failure signal that actually drives the fail-safe behavior (nothing pushed to
`revoked` for that batch) is committed to the closure variable regardless of whether the
reporting callback throws. The nested catch only protects against the *reporting*
mechanism aborting the *loop* — it cannot and does not suppress the *counted* failure. This
is the correct thing to wrap: `logger.error` (from `firebase-functions/v2`) is not a
security-relevant sensor, it's an observability sink, so swallowing a failure IN the logger
never hides a security-relevant signal — the signal (`skippedBatches`, and downstream "no
uid revoked from this batch") survives independent of the sink. Test
`a reporting callback that throws does not abort the remaining batches` in
`logic.test.ts:245-261` seeds a throw on both `lookup` (batch 1) and `onBatchError`, and
asserts `call === 3` (all batches ran) and `revoked === ['u100','u200']` (batches 2+3's
own notFound entries survived). Hand-traced: removing the nested try/catch makes a thrown
`onBatchError` reject the whole `revokedUidsInBatches` promise from inside the `for` loop's
catch block, which the `await` in that same test would surface as an uncaught rejection —
red-alone. Consistent with the ninth-mutation claim in the brief; not independently
re-run under `rm -rf node_modules/.vite/vitest` this round (delta is provably self-
contained and the test-reviewer's own archive entry for round 2 already re-derived the
sibling mutations on this exact file live), but the hand-trace is unambiguous for this
specific one-line removal.

**2. `-1` sentinel.** Grepped `skippedAuthBatches`/`skippedBatches` repo-wide (6 files,
all either `functions/src/retentionCleanup/**`, `tasks/todo.md`, or the two knowledge
files under review) — nothing downstream branches on the value; it only ever reaches a
`logger.info(...)` structured-log call. So "misread by anything downstream" has no
candidate: there is no alerting/monitoring code in this diff or the existing tree that
parses this field, and a human reading Cloud Logging has the adjacent comment
(`index.ts:284-287,309-311`) explaining the sign. Confirmed this is genuinely a new
scan-level default substituted at the `Promise.all` `.catch()` (`index.ts:280-289`), not a
duplicate of the per-batch `skippedBatches` counter already covered by finding 1 — this one
fires only when the ENTIRE `collectRevokedPushTokens` (the collection-group scan itself, or
`getAuth()`) throws, before any batch loop runs at all. `0` there would be indistinguishable
from "ran clean, found nothing to revoke" in the log line, which is exactly the ambiguity
BIN-848's own docstring names as unacceptable for the one sweep whose false positive
destroys a live account's push registration. Fail-safe direction unaffected either way
(both `0`-old and `-1`-new return `refs: []`, so no token is ever deleted on a whole-scan
failure) — this is a pure observability improvement, not a change to what gets deleted.

**Per-batch isolation and the ≤100 cap**: unchanged by this delta — `GET_USERS_BATCH = 100`
and `chunkUids` untouched; `revokedUidsInBatches`'s per-batch try/catch (skip-only-this-
batch, never conflate with notFound) is the same shape reviewed in round 2, just with the
inner call now doubly guarded. Confirmed `firestore.rules` not in this diff (not in
`git diff --cached --name-only`), so no rules-side blast radius to re-check.

**Shared-checkout note**: mid-review, `functions/src/retentionCleanup/logic.ts` showed
`git status --porcelain` as `MM` — a sibling session's live mutation-testing loop had
written the exact "MUTANT: guard removed" variant of finding 1 into the WORKTREE while the
INDEX (`git rev-parse :<f>` = `4fa6fc5d…`) still held the guarded, reviewed bytes
(`git show :<f>` reconfirmed). This is the documented shared-checkout hazard, not a defect
in what will be committed — the review is pinned to the index sha, re-confirmed at the end
of this pass, worktree mutation is transient test-reviewer activity on the same file.

No new lesson class beyond the in-place fold made to this file's own "Admin-SDK sweeps"
bullet (nested-guard-the-reporter + outage-sentinel, generalized from this diff's two
changes). accepted-deviations.md re-read in full: none of its 8 entries apply.

**REVIEW-VERDICT: pass (0 blocking)**

### 2026-08-10 — BIN-848 follow-up: `checkedUids` closes a vacuous post-deploy permission check (functions/src/retentionCleanup/index.ts, tasks/todo.md)

**Trigger.** Push gate found a real gap in BIN-848's own shipped acceptance test after
`3090ff7` (12 reviews, 3 rounds, all pass): the plan told Malin to read one
`retentionCleanup done` log line and require `skippedAuthBatches: 0` before trusting that
the runtime service account actually has `firebaseauth.users.get` — the first Auth
user-management call anywhere in `functions/`. But `collectRevokedPushTokens` returns
`{ refs: [], skippedAuthBatches: 0 }` on `byOwner.size === 0` (no `fcmTokens` docs at all)
— strictly BEFORE `getAuth()` and before any `getUsers()` call. So the exact value the
post-deploy check was reading as proof of success can be produced by a run that asked Auth
nothing. If the runtime SA is missing the permission and there happen to be zero token docs
at check time (very plausible on a low-traffic app right after this ships), the operator
reads "green" and never finds out the sweep is dead until real accounts need it reaped.

**The fix.** Widened the return type to carry `checkedUids: number` — `byOwner.size` on the
success path (real count of uids actually put to `getUsers()`, across however many batches
attempted, whether or not some later throw), `0` on the empty-input bail-out, `0` on the
whole-scan-failure `.catch()` default (which already carries `skippedAuthBatches: -1`).
Logged next to `skippedAuthBatches` in the single summary line. `tasks/todo.md`'s
post-deploy instructions rewritten: acceptance is now `skippedAuthBatches: 0` **AND**
`checkedUids > 0`.

**What I verified.**
1. **Three return sites, all consistent.** Read the full diff (`git diff --cached`) plus
   the surrounding unchanged function bodies in `index.ts` (full file Read, not just the
   diff hunks) to confirm `checkedUids`'s semantics hold on every path: (a) empty-input
   bail-out → `0`, correct — nothing was ever handed to Auth; (b) success path →
   `byOwner.size`, correct — every uid in `byOwner` is passed into
   `revokedUidsInBatches([...byOwner.keys()], ...)` regardless of whether an individual
   batch later throws, so "attempted" is the honest semantic, not "confirmed answered"; (c)
   outer `.catch()` whole-scan-failure default → `0`, correct — the collection-group scan
   or `getAuth()` itself died, so nothing was ever attempted either. Cross-checked against
   `revokedUidsInBatches`'s own doc comment in `logic.ts` (unchanged, not in this diff, Read
   in full anyway since the semantics depend on it) — `chunkUids(uids)` iterates every uid
   in the input regardless of per-batch throws, confirming `checkedUids = byOwner.size`
   really does mean "put to Auth" for the whole set, not just the batches that succeeded.
2. **Logging exposure.** `checkedUids` is a bare integer count of uids that own at least one
   push-token doc, written into a structured Cloud Logging entry alongside five other
   already-shipped counts (`expiredSessions`, `deletedSessions`, etc. — same log line,
   pre-existing). Cloud Logging requires GCP project IAM (`roles/logging.viewer` or
   broader); this project has no public log sink. Not a PII leak, not a new exposure class:
   a count is not an identifier, and every sibling count on the same line already carries
   equivalent information density (e.g. `revokedPushTokens: refs.length`). No finding.
3. **Fail-safe direction.** Confirmed by reading every return statement: `refs: []` is
   unchanged on both bail-out paths, `deleteInBatches` only ever receives what
   `collectRevokedPushTokens`/the `.catch()` default hands it. `checkedUids` is written to
   the log only, never branched on inside `retentionCleanup`'s own body (grepped: only
   consumer is the `logger.info` call). Pure additive observability — verifies the "pure
   observability" framing in the diff's own code comments rather than just trusting them.
4. **Scope check.** `git diff --cached --stat` — exactly the two files named in the brief
   (`functions/src/retentionCleanup/index.ts`, `tasks/todo.md`). `logic.ts` untouched
   (confirmed via targeted grep, not just the stat), so BIN-848's already-reviewed
   `revokedUidsInBatches` contract (per-batch isolation, nested-guard-the-reporter,
   ≤100 cap) carries forward unchanged and needed no re-review.
5. **accepted-deviations.md** re-read in full (7 entries at this date) — none apply; this
   diff touches no rules, no anon/session identity, no blocking/reports surfaces.

**Fold.** Generalized the existing "Admin-SDK sweeps" bullet's outer-`.catch()`-sentinel
lesson (BIN-848 round 2, entry above) into a THREE-path taxonomy: outer-catch default,
early-return bail-out (this entry, new), and now explicitly named as the SAME failure class
— a single summary field cannot attest both "no errors" and "the guarded call actually
ran". The generalizable instruction folded into the active principles file: any zero/
success sentinel meant to prove an EFFECT occurred (not just "no exception") needs a paired
"was anything actually attempted" counter, checked on every return path including bail-outs
that never reach the guarded call — not just the two paths (success, outer-catch) obvious
from a single review pass.

**Severity.** Low/Info in isolation (pure logging addition, no trust-boundary change) — but
the CLASS is worth keeping distinct from ordinary sentinel bugs: it is a check specifically
designed to prove a NEW PERMISSION GRANT before Malin trusts a security-relevant sweep, and
the gap would have made that proof pass vacuously on the exact kind of low-traffic day this
ships into.

**REVIEW-VERDICT: pass (0 blocking)**

### 2026-08-11 — BIN-856: MOTN 400-outage fix (output_language drop + error-body logging)

Reviewed staged diff: `functions/src/streamingOffers/motn.ts` (modified),
`functions/src/streamingOffers/motnUrl.ts` (new, admin-free URL builder), `motnUrl.test.ts`
(new, allowlist-pins the query string to `country=se` only). Root cause per the ticket: every
MOTN call has 400'd for ~a month because the URL carried `output_language=sv`, which the
vendor rejects; a 400 maps to the per-title "skip, retry next run" path, so the outage was
invisible except as a status code. Fix drops the parameter and adds `logger.warn(..., {
body: body.slice(0,300) })` on any non-ok status, reading `res.text()` first.

**Finding — Medium, treated as blocking (1):** `motn.ts:47-50` — the new `!res.ok` branch logs
the vendor's raw response body unredacted. This directly reverses a pattern this SAME file was
verified against on 2026-06-28 (see the earlier entry above, ~line 705: "never logged (the
logger.warn on non-ok status logs only the HTTP status code, not the key)"). The API key is
sent only via the `X-RapidAPI-Key` header, never interpolated into the URL, and the diff's own
comment asserts "no credentials" in the body — but that attestation is verified against exactly
ONE status code (the 400 case quoted in the ticket, `{"message":"parameter \"output_language\"
has an invalid value: sv"}`). Every OTHER non-ok status this branch now covers (401/403 on a
rotated or misconfigured key, 5xx vendor errors, or a future RapidAPI gateway change) is
unverified — some RapidAPI-hosted vendors' auth-failure bodies do echo request-identifying
values (e.g. "invalid key ending ..."). The 300-char truncation does not help: an echoed key
would sit at the start of a short error message. Cost to close is one line —
`body.replaceAll(key, '[redacted]')` before the `logger.warn` call — so I treated this as
required-before-ship rather than a deferred hardening note, per the codebase's own
already-established "secrets never logged" convention. Not an accepted deviation (checked
`accepted-deviations.md`; nothing there covers vendor-log redaction).

**Verified NOT an issue — point 2 (body-read hang), by live PoC, not just trace:** built a
local HTTP server that writes response headers immediately then stalls the body for 8s, called
`fetch(url, { signal: AbortSignal.timeout(3000) })` against it, then `await res.text()`. Result:
`fetch()` resolved at 68ms (headers only) but `res.text()` rejected with `TimeoutError` at
~3024ms — confirming Node's `fetch()` AbortSignal covers the ENTIRE request lifecycle including
subsequent body reads via `.text()`/`.json()`, not just the header phase. So the new `await
res.text().catch(() => '')` on the error path is bounded by the same 10s ceiling BIN-157
already established for the whole call, and the `.catch(() => '')` means a timeout yields an
empty logged body rather than an unhandled rejection or a hang. No regression of the hang class
BIN-157 fixed. (Generalizable technique — didn't fold into the principles file this pass, out
of character budget; worth a bullet next time this file has headroom.)

**Point 3 (output_language removal vs stored/exposed data) — confirmed no-op via `parse.ts`:**
`parseStreamingOptions` consumes only `service.id`, `type`, `link`, `price.amount`,
`price.currency`, `expiresOn` — none localized. Matches the new module's doc comment exactly.
`streamingOffers` is the established public-read-no-PII rollup class; this diff doesn't touch
rules or the write path, only which SE-availability the vendor call itself returns.

**Point 4 (secret handling in the new module) — clean:** `motnUrl.ts` never imports or
references `process.env.MOTN_API_KEY`; it only builds the URL. The key stays exclusively in
`motn.ts`, read via `process.env.*` (bound by `defineSecret` in index.ts, per the established
pattern) and placed only in the `X-RapidAPI-Key` header. `MOTN_HOST` is a public hostname, not
a secret. Admin-free split matches the stated CI-import reason (mirrors
`leavingRollup`/`config.ts`'s split for the same toolchain constraint) — checked against no new
`firestore.rules`/GDPR-cascade surface, since this module touches neither.

Folded into knowledge.md: rewrote the "Secrets and config" opening bullet from a blanket
"failure logs carry only the HTTP status" to "may carry the vendor's own error body only if the
literal secret is stripped from it first, even when the vendor's documented format looks
credential-free — that's one status code's worth of proof, not all of them" (BIN-856).
Compressed the Admin-SDK "three ambiguous 0/success paths" bullet ~424 chars to make room
(file was at 29,988/30,000 before this pass).

**REVIEW-VERDICT: fail (1 blocking)**

### 2026-08-12 — BIN-856 round 2: REQUEST_REJECTED stop-the-run + redaction re-verify

Re-reviewed staged diff after round 1's blocking finding (unredacted vendor body): five files —
`functions/src/streamingOffers/{motn.ts, index.ts, motnRequest.ts (new), motnRequest.test.ts (new)}`,
`functions/src/leavingRollup/motnChanges.ts`.

**Round-1 fix verified correct and complete.** `motn.ts:28-29,61-62` and
`motnChanges.ts:71-75,125-126`: `body.replaceAll(key, '[redacted]').slice(0, 300)`, redact
BEFORE truncate, in both the original file and the newly-touched sibling. Traced `key`'s scope
in both: both functions early-return (`if (!key) return null/error`) BEFORE any `replaceAll`
call, so `key` is guaranteed a non-empty string at every call site — an empty-string
`replaceAll` (which would be catastrophic — matches every gap between every character) is
structurally impossible here. `motnChanges.ts`'s `key` is the exact same variable used in the
fetch headers two lines below (line 102), not a shadowed or stale copy. No secret in the new
`logger.error` calls (`index.ts`'s carries only `{ motnCycle, attempted }`).

**New finding — Blocking (1), High: self-DoS via an unvalidated `tmdbId` entering the immortal
"never-checked" priority tier.** This diff adds `classifyStatus()` (`motnRequest.ts:70-76`,
verified via `git show :path` — see hazard note below) mapping any 4xx except 404/429 to
`'rejected'`, and `index.ts:205-208` breaks the `streamingOffersRefresh` run loop on that
result to stop burning vendor quota (the ticket's own root cause: 198/300 monthly calls lost to
a guaranteed-repeat 400). The loop-break is the right fix for THAT cause, but it also converts
any OTHER cause of a persistent single-title 4xx into an outage for the WHOLE app, not just that
title — and one such cause is directly reachable by any signed-in user.

Traced the chain: `readWorkSet` (`index.ts:55-64`) pushes every watchlist item into the work
set with **no validity check on `tmdbId`** — contrast `readExisting` seven lines below
(`index.ts:96-98`), which explicitly does `if (!Number.isFinite(tmdbId)) continue;` for exactly
this reason (existing comment there already names the cost concern; this diff raises the stakes
from "wastes a call" to "kills the run"). `firestore.rules`' `isValidWatchlistItem` (unmodified
by this diff, but load-bearing) whitelists the `tmdbId` KEY via `hasOnly` without binding its
TYPE or VALUE — confirmed by reading the full function body (`firestore.rules:91-166`); `rating`,
`nextAirDate`, `ratedAt`, `tmdbFieldsRefreshedAt` etc. all get explicit type/value binds two
lines below where they're listed, `tmdbId` and `mediaType` do not. So a signed-in user can write
`users/{ownUid}/watchlist/{anyDocId}` with a non-numeric or absent `tmdbId` field and a doc id
with no parseable numeric suffix. `resolveTmdbId` (`shared/mediaTypeDocId.ts:101-104`) then
returns `NaN` (confirmed: `Number('garbage')` is `NaN`, not integer → falls to
`parseTmdbIdFromDocId`, which is `NaN` for a non-digit suffix — read in full, `mediaTypeDocId.ts:1-104`).
`isIntentTitle` (`logic.ts:37-42`) only checks `providers.length>0` and `status`/`mediaType`
match — both attacker-controlled on the attacker's own doc — so the NaN item passes straight
into the work set.

`offersUrl('movie', NaN)` (`motnRequest.ts:28-31`) builds `.../shows/movie/NaN?country=se` — a
request the vendor plausibly answers 400 (never verified live, but plausible and the ticket's
own framing treats "vendor rejects a malformed request-shape" as the baseline case). Because
this item can never succeed, it never gets an entry in `readExisting`'s existing-offers list, so
`selectRefreshBatch`'s `tier()` function (`logic.ts:94-104`) permanently classifies it tier 0
("never checked") — the HIGHEST priority, sorting before every tier-1/2 title on every single
run, forever. Once selected into a day's batch, the loop reaches it, gets `REQUEST_REJECTED`,
and breaks — discarding the rest of that day's budget for every title that would have followed
it in sort order. This recurs every run the item is selected, indefinitely, from ONE doc under
ONE attacker's own uid — a self-inflicted, attacker-triggerable, app-wide denial of service on a
paid vendor integration, exactly the failure mode (silent, indefinite outage) this ticket was
filed to fix, just moved to a new trigger.

**Fix:** filter non-finite/invalid `tmdbId` out of `readWorkSet` before `items.push(it)`
(`index.ts:63`) — the exact guard `readExisting` already has, one function away. Zero cost,
closes the deterministic/attacker-reachable case. Residual (not blocking, flagged as a
follow-up): a genuinely valid tmdbId that the vendor persistently 4xxs for an unrelated reason
would hit the same immortal-tier-0 trap; a "N consecutive rejects on the same title → drop /
alert" circuit breaker would close that too, but it's speculative vendor behavior rather than an
attacker-reachable path, so not required to ship this round.

**New finding — Medium, non-blocking (flagged per the review brief's explicit ask): 401/403
(revoked key) stalls the feed with zero admin-facing signal.** Traced `index.ts:174-177,267-268`:
`REQUEST_REJECTED` sets neither `sawRateLimited` nor `sawClean`, so a run that only sees it
computes `observation = 'no_signal'`. Read `functions/src/util/notifyOnce.ts` in full and grepped
`functions/src/streamingOffers/budget.ts`'s `reserveThrottleSignal`: `'no_signal'` is an early-
return no-op, never reaches `notifyOnceForCycle`/`sendAdminSystemNotification`. `computeHealth`
(`logic.ts:117-124`) is a pure function of `workSetSize`/budget, not actual fetch success, so
`streamingHealth` doesn't flag it either. Net effect: a rotated/expired MOTN key breaks the run
on title 1 every day, forever, with the only trace a Cloud Logging `logger.error` line — no admin
inbox notification, unlike the 429 path's 2-consecutive-confirmation escalation. Recommended
wiring `REQUEST_REJECTED` into the same once-per-cycle admin-notify path; not blocking since it's
an observability gap, not a new trust-boundary crossing.

**Shared-checkout hazard, 4th occurrence.** While reviewing, `motnRequest.ts`'s WORKTREE copy was
caught mid-mutation by a live sibling process — polled `md5sum` three times inside minutes and
got three different hashes, none matching the staged blob at that instant; a raw `Read` at one
point captured an actual mutant (`400||401||403` enumerated instead of the real `>=400&&<500`
range). Resolved per the (now-updated) principle: `git show :functions/src/streamingOffers/motnRequest.ts`
is immune to worktree churn and IS what would be committed; polled `git show :path | md5sum` vs
`md5sum path` until they matched, then `Read` at that moment (hash `6759a7aa…` confirmed both
before and after the Read call) — that Read is what the findings above are based on. All other
four files were stable throughout (worktree hash == staged blob hash on first check, no churn).

Folded into knowledge.md: added a new "Cost, budgets, rate limits, fan-out" bullet on
stop-the-run governors needing the per-title input actually validated (the tier-0-immortality
class). Extended the "Shared-checkout hazard" bullet with "review the STAGED blob via `git show
:<path>`, not `Read`'s worktree" as the concrete resolution technique (4th occurrence now).
Compressed roughly a dozen bullets across the file (Firestore-rules, Admin-SDK, cross-account,
GDPR, review-scope sections) by 10-60 chars each — no content class dropped, only redundant
wording — to make room and land at 29,998/30,000.

**REVIEW-VERDICT: fail (1 blocking)**

### 2026-08-12 (later) — BIN-856 round 3: correcting round 2's severity premise, everything else re-verified

Re-reviewed staged diff (same six files as round 2: `functions/src/streamingOffers/{motn.ts, index.ts,
motnRequest.ts, motnRequest.test.ts}`, `functions/src/leavingRollup/motnChanges.ts`, `tasks/todo.md`), all
opened via `Read` this round (no shared-checkout churn observed — worktree matched what round 2 pinned).

**(1) Round-2 premise checked against Malin's live probe — CONFIRMED WRONG, and the correction holds up under
my own re-derivation, not just accepted on say-so.** Round 2 explicitly flagged its own weak point ("plausible,
never verified live") when it assumed a malformed `tmdbId` (`.../shows/movie/NaN`) draws the same HTTP 400 a
bad query param does. Malin's probe against the production key (`movie/NaN`, `movie/''`, `movie/abc`,
`movie/-1`, `movie/0`, all → 404 `{"message":"not found"}`) is the more plausible real-world behavior on
reflection: a REST API validating a QUERY PARAMETER's VALUE (`output_language=sv`) and a REST API resolving a
PATH SEGMENT to a resource are different validation layers, and "can't find a resource matching this path" is
the standard 404 semantic, not 400 ("your request is malformed"). Traced the consequence in `motn.ts`/
`motnRequest.ts`: `classifyStatus(404)` → `'no-offers'` → `motn.ts:47` returns `[]` — the SUCCESS branch, never
touching `disposition !== 'ok'` at all, so `REQUEST_REJECTED` is structurally unreachable for this input. Round
2's "the governor breaks the run, discarding the rest of the day's budget" claim does not hold for this
specific trigger (a non-numeric/absent `tmdbId`); it would still hold for a genuinely malformed REQUEST shape
(bad header, wrong content-type) if MOTN 400s those, which this diff doesn't newly introduce.

**Re-derived the ACTUAL bug the guard closes, since round 2's mechanism was wrong: a quota LEAK, not a
run-stall.** Without `index.ts`'s new `Number.isFinite(it.tmdbId)` filter in `readWorkSet`, an item with
non-finite `tmdbId` enters the work set, gets selected as immortal tier-0 (`readExisting` skips it via its own
existing `!Number.isFinite(tmdbId) continue`, so it never accrues a `checkedAt` and never leaves "never
checked"), reaches `fetchOffers`, draws a 404 → `[]`, and the run loop's success branch (`index.ts:218-224`)
WRITES a `streamingOffers` doc keyed by `streamingOffersDocId(mediaType, NaN)` with `checkedAt: nowMs` — but
`readExisting`'s own guard means that write is never recognized as "checked" on the NEXT run either (re-derived
via `parseTmdbIdFromDocId`: a docId like `movie_NaN` has a non-digit suffix, parses back to `NaN`, still fails
`Number.isFinite`). So the item is re-picked and re-fetched every single run, forever, spending one
`reserveMotnSlot` reservation per run (`index.ts:191-196`, before the fetch, never refunded) on a call that can
never succeed. At `PER_RUN_SELECT=9`, one such doc is a steady ~11%/run tax; enough such docs (attacker- or
just carelessly-created watchlist items with junk `tmdbId`, since `firestore.rules`' `isValidWatchlistItem`
`hasOnly`-whitelists the key without binding its type) could fill all 9 slots and crowd out every legitimate
refresh for the day — the same eventual "stalls the feed" outcome as round 2 claimed, reached by volume rather
than by the single-item `REQUEST_REJECTED` break.

**Guard placement and completeness — verified correct.** `index.ts:72`:
`if (isIntentTitle(it) && Number.isFinite(it.tmdbId)) items.push(it);` — checks `it.tmdbId`, the value already
resolved via `resolveTmdbId(x.tmdbId, d.id)` two lines above (the SAME value that flows unchanged into
`fetchOffers`/`offersUrl` downstream, never re-derived), at the earliest point before the item enters
`items[]`/`dedupeIntent`/`selectRefreshBatch` — mirrors `readExisting`'s existing guard exactly, same predicate,
same reasoning. Confirmed `resolveTmdbId` can return `NaN` here by reading `shared/mediaTypeDocId.ts` in full: a
watchlist doc with a non-numeric/absent `tmdbId` field and a doc id with no digit suffix falls through both the
field branch (`Number.isInteger` fails) and the doc-id branch (`parseTmdbIdFromDocId` requires
`/^[0-9]+$/`) to `NaN`. No gap: this is the ONLY place `WorkItem`s are minted in this file.

**(2) `motnChanges.ts:132` condition — correct, confirmed no dead/wrong branch.** `res.status===429` is handled
in an earlier, separate branch (lines 109-113: warn + `rateLimited=true` + `break`) that exits the loop before
reaching the `!res.ok` block, so `res.status !== 429` in the `error`-vs-`warn` condition is redundant-but-
harmless defensive code, not a live bug. `>=400 && <500 && !==429` → `logger.error` (a 4xx here is OUR defect,
matches the file's own comment and the BIN-856 shape: `complete` stays false, stale rollup served
indefinitely); everything else (5xx, and the already-excluded 429) → `logger.warn`. Matches intent. No secret in
either call: `detail = { body: body.replaceAll(key, '[redacted]').slice(0,300) }` built once, reused for both
branches; `key` is guaranteed non-empty (early `if (!key) return null` above); neither log-message template
string interpolates `key`.

**Docblock vs return union — matches exactly.** `motn.ts:19-25`'s four-outcome docblock (`Offer[]`/`null`/
`RATE_LIMITED`/`REQUEST_REJECTED`) traced against every return statement in `fetchOffers`: missing-key → `null`;
`'no-offers'` → `[]`; `'rate-limited'` → `RATE_LIMITED`; `'rejected'` → `REQUEST_REJECTED`; `'retry'` (5xx/other)
→ `null`; `'ok'` → parsed `Offer[]` (which can itself legitimately be `[]`, matching the docblock's own "`[]`
also means no SE offers" note); catch block (network/timeout) → `null`. No fifth path, no undocumented one.

**`tasks/todo.md` — no secrets.** Read in full: problem statement, router output, build list, an explicit
"waiting on Malin" section linking to a report file path (no key/token in the path or its contents), and
acceptance criteria. Clean.

**Round-2 Medium (401/403 stalls the feed silently) — confirmed recorded, not re-filed.** `tasks/todo.md`'s
"Utanför denna plan — väntar på Malin" section names this exact gap (`streamingHealth` blind to actual fetch
outcome; a revoked key stalls the flow with no admin signal) and states Malin has explicitly asked to see the
proposal first, linking `2026-08-11-streaminghealth-forslag.html`. Matches the brief: recorded, out of scope,
not blocking. Checked `.claude/rules/accepted-deviations.md` — no entry covers this specific gap yet (it's
correctly NOT there; Malin's "show me the proposal first" is a parking instruction in the ticket/plan, not
(yet) a ratified accepted-deviations.md entry) — nothing to file, nothing to re-flag.

No blocking findings this round.

Folded into knowledge.md: rewrote the round-2 "stop-the-run governor" bullet (Cost/budgets section) to record
the corrected mechanism — verify the vendor's ACTUAL status live rather than assuming a plausible one, and
recharacterized the bug as a quota LEAK (immortal tier-0 re-pick) rather than a run-STALL (the fix is identical
either way, so this doesn't change the required remediation, only the accurate severity story). Compressed
~15 bullets across the file by trimming redundant words (no content class dropped) to land at 29,998/30,000
after the addition.

**REVIEW-VERDICT: pass (0 blocking)**

### 2026-08-12 (round 4) — BIN-856 round 4: guard relocated from call site into isIntentTitle, narrow re-check

Staged diff unchanged in file set from round 3 (`functions/src/streamingOffers/{motn.ts, index.ts, logic.ts,
logic.test.ts, motnRequest.ts, motnRequest.test.ts}`, `functions/src/leavingRollup/motnChanges.ts`,
`tasks/todo.md`) — `logic.ts`/`logic.test.ts` are new to the file list this round; everything else re-Read in
full this round per the marker-free proof-of-review rule.

**(1) Guard relocation traced, no bypass opened.** Round 3 pinned the `Number.isFinite` guard as
`index.ts:72: if (isIntentTitle(it) && Number.isFinite(it.tmdbId)) items.push(it);`. This round moves the
`Number.isFinite(item.tmdbId)` check to the FIRST line of `isIntentTitle` itself (`logic.ts:47`), and the call
site collapses to `if (isIntentTitle(it)) items.push(it);` (`index.ts:66`). `grep -n isIntentTitle` across the
whole repo: exactly two non-comment call sites, `index.ts:66` (the only place `WorkItem`s are minted —
confirmed by re-reading `readWorkSet` in full, one `items.push`, no second path) and `logic.test.ts` (the new
`describe('isIntentTitle')` NaN/Infinity/-Infinity cases, `logic.test.ts:43-51`). No other caller exists, so
there is no second call site whose security posture could be affected by the predicate getting stricter — the
relocation is a pure move, not a widening or narrowing of what's reachable. Motive matches the in-code comment
exactly: `index.ts` imports `firebase-admin` and can't be unit-tested, so the guard has to live in `logic.ts` to
be pinned by `logic.test.ts` rather than only asserted by inspection.

**(2) motn.ts / motnChanges.ts / motnRequest.ts / motnRequest.test.ts — content re-read in full, byte-for-byte
matches what round 3's archive entry quoted:** redaction order in both files is still
`body.replaceAll(key, '[redacted]').slice(0, 300)` (redact-then-truncate, correct order); `classifyStatus`'s
4xx-except-404/429 → `'rejected'` mapping unchanged; `motn.ts`'s four-outcome docblock still matches every
`fetchOffers` return; `motnChanges.ts:132` condition still `>=400 && <500 && !==429` → `error`, else `warn`,
detail built once and reused for both branches, `key` still guaranteed non-empty by the early-return above. No
functional delta in these four files this round — they're staged as part of the same overall diff but nothing
in them changed since round 3's review.

**(3) `tasks/todo.md` re-read in full.** No secrets (no literal key value anywhere, only prose describing the
redaction and a report-file path). Still correctly parks the 401/403 `streamingHealth` observability gap as
"waiting on Malin, proposal already written" — not re-opened per this round's explicit instruction, and
confirmed against `accepted-deviations.md` that it has no entry there yet (correct: it's a parking note in a
ticket, not a ratified deviation).

No blocking findings this round. No new failure class — this is a correct, narrow refactor of round-3's
already-verified guard, not a new pattern requiring a knowledge.md edit.

**REVIEW-VERDICT: pass (0 blocking)**

---

### 2026-08-13 — BIN-816 + BIN-875 + BIN-876: the aborted-deletion bundle (reaper, username release, partial-cascade signal)

**Scope reviewed (staged, clean tree, 29 files).** `functions/src/retentionCleanup/{index.ts,orphans.ts,orphans.test.ts,logic.ts}`, `src/lib/firebase/{accountDeletion.ts,userDocWrite.ts,userDocWrite.test.ts,userDocWrite.chokepoint.test.ts,username.ts,publicProfile.ts}`, `src/lib/{deletionMarker.ts,deletionMarker.test.ts,authErrors.ts}`, `src/contexts/AuthContext.{tsx,test.tsx}`, `src/components/{layout/AppShell.tsx,onboarding/OnboardingFlow.tsx,settings/DeletionLimbo*.tsx,settings/DeleteAccountSection*.tsx}`, `src/test/rules/account-deletion.test.ts`, ADR 0019 + 0020, `docs/{RUNBOOK.md,data-retention-policy.md}`, `.claude/rules/accepted-deviations.md`. `firestore.rules` and `firestore.indexes.json` are UNTOUCHED — the uid-query rides `allow read: if true` on `/usernames/{username}` and the automatic single-field index, so no manual rules deploy is owed. `functions/**` IS touched, so `deploy.yml`'s drift guard will fail the push-triggered job: functions deploy manually, hosting via `workflow_dispatch`.

**Destructive-path trace (the part I pressed hardest).** Both new sweeps fail safe on every *error* path I could construct:

- `collectOrphanedAuthAccounts` → `listUsers` (throws → whole scan caught, `checkedAccounts: -1`, nothing deleted) → age filter via `isReapableOrphanAge` (null/NaN → false) → `confirmedMissingProfiles`, where a thrown `getAll` batch contributes NOTHING and increments `skippedBatches`.
- `getAll` ORDER: verified against the installed SDK (`functions/node_modules/@google-cloud/firestore/build/src/document-reader.js`, `_get`: "BatchGetDocuments doesn't preserve document order. We use the request order to sort") — so `snaps.forEach((snap,i) => batch[i])` is safe, and a not-received doc THROWS rather than shifting the index. Inputs are deduped, so the `outstandingDocuments` Set cannot shorten the result.
- `collectOrphanedUsernames` requires profile-absent AND auth-absent, and reads auth absence only from `notFound` via `absentUidsFromLookup` (disabled != absent — a suspended person keeps their handle).
- API caps correct: `getUsers` <=100 (`GET_USERS_BATCH`), `deleteUsers` <=1000, `listUsers` 1000/page, `getAll` 300. No empty-batch `getAll` is reachable (`chunkUids([])` yields no chunks).
- 7-day window: keyed on `metadata.creationTime`, so it is a floor protecting NEW signups only; an aborted deletion of an existing account is reaped on the NEXT daily run. Defensible under Art. 12(3), and the window is named in `docs/data-retention-policy.md` as ADR 0019 question 2 required.
- `revokedUidsInBatches`'s new `extract` parameter defaults to `revokedUidsFromLookup`; the BIN-848 caller (`collectRevokedPushTokens`) still passes 3 args → behaviour unchanged.

**Client username release.** `collectUsernameReservationRefs` queries `where('uid','==',id)` with `id = auth.currentUser.uid` (never client-supplied). The query result IS the ownership check, and `usernames` has `allow create` + `allow delete` but NO `allow update`, so a reservation's `uid` can only change by delete-then-create BY ITS OWNER — a competing claimant cannot flip it under the deleting user. The emulator test "ror INTE ett handtag som nagon annan hunnit ta over" pins that a reclaimed handle is simply absent from the plan rather than a thrown, chunk-aborting delete (ADR 0020 condition 2, ADR 0019 condition 3).

**Findings issued (0 blocking).**

1. *Medium* — `src/components/layout/AppShell.tsx:41`: the render-level write block reads a React flag (`deletionInProgress`) set at profile-load/deletion time, so a SECOND tab already open on the same origin never flips. `WatchlistProvider`/`NotInterestedProvider` sit ABOVE the swapped shell and stay mounted (their notes/addedAt migration effects write off snapshots with no user action). `isOwner(uid)` never requires `users/{uid}`, so writes from that tab land after the profile is gone and no sweep keyed on "account without a profile" can see them; once `deleteAuthAccounts` removes the identity those docs are unreachable by export, cascade and sweep alike. NOT the accepted deviation (which forbids "the screen is too aggressive" and "gate at the write site") — this is a reach gap in the same screen-level block, and the marker IS present in that tab, merely unread. Fix: derive from `isDeletionStarted(uid)` in `AppShell` (or a `storage` listener in AuthContext), and belt-and-braces `recursiveDelete(users/{uid})` in the auth sweep before `deleteUsers` — provably safe, since absence is already confirmed.
2. *Medium* — `functions/src/retentionCleanup/index.ts:420` `deleteAuthAccounts`: no blast-radius ceiling. The fail-safe reasoning covers ERRORS, not a successful-but-wrong read (renamed collection, wrong database id, inverted predicate), where every candidate reads legitimately absent and every account older than 7d is deleted in one irreversible run. Repo precedent: `tmdbTosSweep` merely WRITES and is gated behind `mutateEnabled`. Asked for `ORPHAN_AUTH_MAX_PER_RUN` (log + delete nothing when exceeded). Considered blocking; landed on Medium because no implemented path reaches it and the fix is additive hardening.
3. *Medium* — `docs/analysis/EXTERNAL_ACTIONS.md` (not in the diff) + `index.ts:203-206`: the comment "this sweep is the only caller of an Auth user-management API in this codebase" is now false, and the verified IAM claim is scoped to `firebaseauth.users.get` under `roles/editor`. The diff adds `listUsers` and — a new privilege class — `deleteUsers` (`firebaseauth.users.delete`). Missing role => inert sweep, green deploy, and ADR 0019's "documented delay, not a breach" reading silently false while the policy doc asserts it.
4. *Low* — `functions/src/retentionCleanup/logic.ts:183`: the `extract` default is unpinned. Every `revokedUidsInBatches` test uses `disabled:false`, under which both extractors agree, so swapping the default to `absentUidsFromLookup` stays green and ends BIN-848's disabled-account coverage.
5. *Low* — `src/lib/firebase/accountDeletion.ts:259-263`: the `catch` fallback builds `doc(db,'usernames', named)` with no ownership re-check, so a denied delete would abort the atomic chunk carrying `users/{uid}` + `publicProfiles/{uid}` — the shape ADR 0020 c2 forbids. Near-unreachable (`getDocs` falls back to CACHE rather than rejecting; both named sources are fresh) and strictly better than what shipped, so a note, not a defect.
6. *Low, non-security* — `setDeletionInProgress(true)` fires before the cascade, so a NORMAL deletion shows the limbo screen ("Vi hann ta bort din data") for the cascade's whole duration, with a button that starts a second concurrent cascade. `DeleteAccountSection`'s new toast retry is dead in that state (section unmounted; `setConfirming` is a no-op) — the limbo button is the working path.
7. *Nit* — `docs/RUNBOOK.md` 5d says the handle is freed "dagen darpa"; `index.ts:499-503` deliberately orders the two sweeps so it happens in the SAME run. Same wording in `orphans.test.ts:114`.

**Chokepoint guard weakness (folded into principles).** `userDocWrite.chokepoint.test.ts:75-78` claims to fail the build on any new `users/{uid}`/`publicProfiles/{uid}` writer. Two escapes: `PROFILE_DOC_REF`'s `doc\(\s*\w+\s*,` cannot match `kit.doc(kit.db,'users',uid)` — the exact idiom `userDocWrite.ts` itself uses, i.e. the likeliest copy-paste template — and requiring BOTH regexes lets a hoisted `const ref = doc(...); setDoc(ref, ...)` through. Grepped `src/` at HEAD: no current bypasser, so it is a future-regression gap, not a live hole. Suggested: relax `\w+` to `[\w.]+` and drop the two-regex conjunction, leaning on the existing `READ_ONLY_FILES` list.

**Not re-raised (accepted-deviations, checked):** the marker's lack of retirement; first-chunk failure parking a user with intact data; the limbo screen blocking writes at all; Tillsammans anon-vote forgery; the missing session-expiry gate; blocking-as-hygiene; create-only reports; the fail-open `effectiveVisibility` read.

**PoC status:** DERIVED, not live. No rules change to exercise, and the destructive logic is Admin-SDK-only (no emulator harness for `listUsers`/`deleteUsers`). The `getAll` ordering claim — the one place an index mix-up would delete a LIVE account — was settled by reading the installed SDK source rather than by argument.

**REVIEW-VERDICT: pass (0 blocking)**

### 2026-08-13 — BIN-816 + BIN-875 + BIN-876 RE-review after remediation (aborted-deletion, round 2)

Same staged diff as the morning pass, after four of my five findings were acted on. Worktree == index verified (`git status --porcelain` all `M `/`A `, `git diff` empty), so `Read` served the staged bytes. Read: `orphans.ts`, `orphans.test.ts`, `retentionCleanup/index.ts`, `logic.ts` + its diff, `deletionMarker.ts`, `userDocWrite.ts`, `authErrors.ts`, `accountDeletion.ts`, `username.ts`, `AuthContext.tsx` (both halves), `WatchlistContext.tsx` (diff + effect inventory), `AppShell.tsx`, `DeletionLimbo.tsx`, `DeleteAccountSection.tsx`, `publicProfile.ts` diff, `userDocWrite.chokepoint.test.ts`, `account-deletion.test.ts` diff, `Providers.tsx`, `NotInterestedContext.tsx`, `useFcmToken.ts`, ADR 0019, ADR 0020, accepted-deviations, RUNBOOK + retention-policy + EXTERNAL_ACTIONS diffs, the `firestore.rules` usernames block, `firestore.indexes.json` fieldOverrides.

**Verification of the four fixes.**

1. *Tab-B write reach.* Closed. `AuthContext` 623-631 registers a `storage` listener per uid (a `null` key = `clear()` and re-reads), pinned by two tests (`AuthContext.test.tsx:1637` and `:1656` for a foreign-uid key). `WatchlistContext` 505/572 early-out on a FRESH `isDeletionStarted(uid)`. I enumerated the entire stack above `AppShell` (`Providers.tsx`): Theme (no writes), Auth (publicProfile sync — guarded twice, by the `deletionInProgress` early-out AND `mergePublicProfileDoc`; visibility repair — guarded; household fan-out — unreachable without a profile-field change, which now needs `mergeUserDoc`), Watchlist (2 auto-writes now guarded; the other three effects are listeners), NotInterested (user-action only), Toast. `AppShell`'s own hooks (`useFcmForeground`, `useTitleLinkPrefetch`) write nothing. `AppShell` is mounted in the ROOT layout, so no route escapes the swap.
2. *Ceiling.* `ORPHAN_AUTH_MAX_PER_RUN = 50` is checked in `deleteAuthAccounts` against the TOTAL, before any `chunkUids(uids, 1000)` batch — not bypassable by batching, and the username sweep cannot compensate (those accounts still answer in `getUsers`, so `absentUidsFromLookup` excludes them).
3. *IAM attestation.* Corrected in `index.ts:190-193` and in EXTERNAL_ACTIONS' new per-sweep table, with `firebaseauth.users.delete` marked NOT verified and an `orphanAuthAccounts > 0` implies `deletedOrphanAuthAccounts > 0` acceptance bar.
4. *Offline fallback.* `fallbackUsername` removed from `collectDeletionRefs` entirely; the catch returns `[]`; the emulator test's assertion inverted honestly ("orphaned without the fallback" to "released by the uid-query alone") plus three new cases (profile deleted first, handle reclaimed by OTHER, two reservations on one uid).
5. *Chokepoint test.* Rewritten as a whitelist over the REFERENCE with `[\w.]+`, an exemptions-still-match test, an `assertProfileWritable` requirement per batch-writer, and a >450 fileset floor.

**Pressed questions, answered.** (a) *Can a sweep delete something live?* The auth sweep needs age > 7d AND a SUCCEEDED `getAll` reporting no `users/{uid}`; every sign-in path creates that doc, so the only orphans are aborted deletions, Console-created accounts and signups whose profile write failed (seconds, not days). The username sweep needs profile-absent AND `notFound` from Auth, and asks Auth only about profile-absent uids. (b) *Can a client steer which reservation dies?* No: `where('uid','==',auth.currentUser.uid)`, `firestore.rules:502` re-checks `resource.data.uid`, `usernames` has no `allow update`, and `allow create` binds `uid` to the caller — a planted doc can only carry the attacker's own uid. (c) *Forgeable marker?* `localStorage`, same-origin; a forged marker only strands that device (no auto-`deleteUser`; the limbo button needs a click) and cannot make the server delete anything, because the victim's profile document still exists. (d) *Art. 17 both directions:* a failed username query leaves one reservation for the daily sweep; ordering puts `users/{uid}` after reviews, so "profile gone" implies the content is gone before any handle is released (no @handle-inheritance window).

**Findings issued (0 blocking).**

1. *Medium* — the ceiling has no BEHAVIOUR test. It lives in `index.ts` (imports `firebase-admin`, untestable under the root toolchain); `orphans.test.ts` pins only `10 < ORPHAN_AUTH_MAX_PER_RUN < 1000`. Changing `>` to `>=`, or deleting the whole `if`, stays green. Contradicts `orphans.ts`'s own header ("Pure predicates only ... so the part that decides what gets deleted is testable"). Fix: move the decision into `orphans.ts` (`authUidsToDelete(uids)` returning `{ uids, refusedOverCeiling }`) and pin it.
2. *Medium* — `WatchlistContext`'s two `isDeletionStarted(uid)` early-outs are untested; nothing in `WatchlistContext.test.tsx` mentions the marker. Both mutants (drop one, drop both) pass. This is the guard I asked for in round 1 and it is one refactor from silently gone.
3. *Low* — `collectOrphanedAuthAccounts` does not skip `disabled: true` accounts, while its sibling `absentUidsFromLookup` deliberately protects them ("a suspended account still owns its handle"). If a moderation flow ever removes the profile doc of a disabled account, the sweep deletes the identity 7 days later — lifting the ban and freeing the email. `docs/moderation.md` "Stäng ett konto" says Disable OR delete the auth user (not the profile doc), so it is not today's flow. Fix: skip disabled candidates, or state in `orphans.ts` why the asymmetry is deliberate.
4. *Low* — no ceiling on the username release sweep. Weaker than the auth case (needs two INDEPENDENT successful-but-wrong reads, and the auth-side one is itself capped at 50), but a released handle is irreversible and symmetry costs one constant.
5. *Low* — `docs/data-retention-policy.md`'s cross-device sentence ("...kan profilen fortfarande återskapas fram till att sopningen ovan tar kontot") overstates the bound: once a marker-less device recreates `users/{uid}`, the account is permanently invisible to the orphan sweep. The GAP is a decided deviation (ADR 0019 conflict 1) — the sentence claiming the sweep bounds it is not. Reword to "until the profile is recreated on a device with no marker; after that only a fresh deletion finishes it".
6. *Low* — the chokepoint regex is segment-form only; a template-literal path escapes it. Grepped `src/`: no such idiom exists anywhere in the tree, so it is a future-regression nit, not a hole.
7. *Operational* — the FIRST scheduled run after deploy deletes irreversibly. ADR 0020's follow-ups already ask for a one-time production query for orphaned `usernames`; pair it with a count of auth accounts lacking `users/{uid}` BEFORE `firebase deploy --only functions:retentionCleanup`. Also noted: `docs/RUNBOOK.md` 5d was corrected since round 1 and now says "i **samma** körning", matching `index.ts`'s sequential ordering.

**Deploy.** `functions/**` changed, so a manual `firebase deploy --only functions:retentionCleanup` is required; `deploy.yml` ships hosting only. NO `firestore.rules` and NO `firestore.indexes.json` change is needed or present — the uid-query rides `allow read: if true` (list included) and the default single-field index (verified: no `fieldOverrides` entry for `usernames`).

**Not re-raised (accepted-deviations + ADR 0019/0020, all three new entries read):** the marker's lack of retirement; a first-chunk failure parking a user with intact data; the limbo screen blocking writes; the partially-cascaded state having no server sweep (named as an open point in the policy doc by this same commit); Tillsammans anon-vote forgery; the missing session-expiry gate; blocking-as-hygiene; create-only reports; the fail-open `effectiveVisibility` read.

**PoC status:** DERIVED. No rules change to exercise; the destructive logic is Admin-SDK-only. The client-side claims WERE exercised — `account-deletion.test.ts` drives the real cascade against the emulator, including the reclaimed-handle case.

**REVIEW-VERDICT: pass (0 blocking)**

### 2026-08-13 — BIN-816 + BIN-875 + BIN-876, security review ROUND 3 (staged, re-review after two remediations)

**Scope.** Same staged diff, third pass. `git status --porcelain` clean apart from the 44 staged paths;
staged blob == worktree verified by md5 for all nine files I reason about (`orphans.ts`, `index.ts`,
`AuthContext.tsx`, `authErrors.ts`, `DeletionLimbo.tsx`, `accountDeletion.ts`, `deletionMarker.ts`,
`userDocWrite.ts`, `WatchlistContext.tsx`). ADR 0019, ADR 0020 and all three new `accepted-deviations.md`
entries re-read at HEAD. `firestore.rules` and `firestore.indexes.json` are NOT in the diff — re-verified
that `usernames` still carries `allow read: if true` (covers `list`), `allow delete: if resource.data.uid ==
request.auth.uid`, no `allow update`, and no `fieldOverrides` entry, so the uid-query needs neither.

**Round-2 findings, closed.** (2) `WatchlistContext` now has a marked test AND a control on both effects.
(3) the auth sweep skips `disabled: true` with the symmetry comment. (5) the retention-policy sentence is
rewritten and now names the marker-less-return gap as an OPEN point against ADR 0019 Q2's conditional
instead of claiming the sweep bounds it. (6) the chokepoint regex gained the bare-`collection()` alternation,
an every-exemption-still-matches self-check and a 450-file floor; I re-grepped `src/` for the
template-literal idiom its docstring admits it misses — genuinely absent. (4) not added, and my round-2
justification for accepting it was partly WRONG: I wrote "the auth side is capped", but the two sweeps are
independent, so the auth ceiling tripping does not stop a username release. It stays Low only because a
release still requires Auth's own per-uid `notFound`.

**BLOCKING — the ceiling I asked for latches, and disables the sweep at Binge's actual scale.**
`functions/src/retentionCleanup/orphans.ts:90-94`. `exceedsOrphanAuthCeiling` refuses the whole run when
`candidates > checkedAccounts * 0.25`. Three properties compose badly:
 - the candidate set is MONOTONE — an orphan stops being one only by being deleted (or by a marker-less
   return that resurrects the profile), so a tripped run leaves the same candidates for tomorrow;
 - the denominator grows only with new signups, so recovery needs the user base to reach 4x the orphan count;
 - the file's own comment states the user base is under 50. Arithmetic: N<=3 refuses even ONE orphan
   (1 > 0.75); N=6 refuses two (2 > 1.5); N=8 refuses three.
Consequence, and it is squarely the thing this ticket exists to prevent: the Firebase Auth account (email +
uid) of someone who asked to be erased survives indefinitely, AND — because `orphanedReservations` requires
`authMissing` — their handle is never released either, so both halves go dead together. The only signal is
one `logger.error` per day; there is no alert. `docs/data-retention-policy.md` states "Fönster: 7 dygn ...
raderar dagligen" as fact, and ADR 0019 Q2's "delay, not breach" answer is explicitly conditional on the
sweep holding that window. A first-run backlog (Console-created accounts never signed into, abandoned
signups) is a plausible way to trip it on day one — that one case IS caught, by the post-deploy acceptance
bar EXTERNAL_ACTIONS now carries; later accumulation is not caught by anything.
Rejected fixes: raising the fraction (same latch, further out); dropping the proportional half (restores the
"50 can never fire under 50 users" hole the integration review found). Fix: `candidates > max(FLOOR,
checked * FRACTION)` under the absolute cap, FLOOR ~5, and pin the decisive small case (1-of-3 passes, 6-of-8
refuses) rather than the constant's range. Equally acceptable: Malin accepts the wedge as a dated deviation
with a stated periodic log check — but it must be a decision, not a silent property.

**Medium — the round-2 hand-off fix is unpinned. MUTATION-PROVEN, not inferred.**
`src/contexts/AuthContext.tsx:536`. Snapshotted to scratchpad, replaced
`setDeletionInProgress(deleting || isDeletionStarted(firebaseUser.uid))` with
`setDeletionInProgress(deleting)`, asserted the mutant by grep in the same command as the run:
`npx vitest run src/contexts/AuthContext.test.tsx --no-cache` -> **64 passed (64)**. Restored from the
snapshot; md5 `a5a69957b8039701112dd789f87f3d63` before and after, `grep -c MUTANT` = 0, `git status`
staged-only. The file carries sixteen BIN-816-named tests and none of them drive the ordering the clause
exists for (storage event lands WHILE the profile load is in flight; the late `.then` writes a stale
`false`). Test shape that would pin it: hold `ensureUserProfile`'s promise, dispatch the storage event,
release, assert the flag is still true.
The fix itself is CORRECT — traced: `setUid` commits before the effect subscribes, the effect subscribes
before the network `.then` can resolve, so the pre-subscribe window is covered by the re-read and the
post-subscribe window by the listener; the `.catch` branch does not touch the flag, so no path writes a
stale `false`. No new race found.

**Low — the username release has no ceiling** (see the round-2 correction above). If the FLOOR fix lands,
reuse the same predicate for `orphanUsernames.refs`.
**Low — `index.ts:323`'s `disabled === true` skip and the `deleteAuthAccounts(uids, checkedAccounts)` arg
wiring are both in the `firebase-admin` file and therefore unpinned by construction.** Moving per-candidate
candidacy into `orphans.ts` (`isOrphanCandidate(user, nowMs)`) puts them under the harness the ceiling now
uses — the same edit as the blocking finding.
**Low — the sweep's population is wider than "aborted deletions".** Any auth account with no `users/{uid}`
older than 7 days qualifies, including one Malin creates in the Console and does not sign into that week.
`docs/RUNBOOK.md` 5d frames the sweep purely as half-deletion cleanup; one sentence there would stop a
support account vanishing unexplained.

**Pressed questions, answered.** (a) *delete something live?* No new path: the auth sweep still needs
age>7d + non-disabled + a SUCCEEDED `getAll` reporting no profile; the username sweep still needs both
confirmations, asks Auth only about profile-absent uids, and `absentUidsFromLookup`'s default-vs-supplied
extractor is now pinned by the one fixture that tells them apart (`logic.test.ts`). (b) *ceiling gamed or
inert?* Inert — see the blocking finding. Gaming it upward is bounded by the absolute 50; gaming it DOWN
(wedging the sweep with cheap orphan signups) is the same latch from the attacker's side, and the floor fix
does not remove that (it needs both >FLOOR and >25%), which is the honest residual. (c) *marker forgeable or
clearable?* Same-origin `localStorage`; forging one strands that device (the limbo button still needs a
human click, and no server action follows), clearing one is the decided cross-device gap. (d) *Art. 17 both
directions?* Nothing new destroys data: the reservation is queued only from the uid-equality query, the
emulator suite now proves a reclaimed handle is left alone AND the cascade still completes, and
`snaps.profileSnap.ref` keeps the profile delete inside `dataExport.coverage.test.ts`'s three-way guard.
No new user-owned subcollection, so `collectUserDataSnapshots` needs no change.

**Deploy.** No `firestore.rules` / `firestore.indexes.json` change. `functions/**` changed, so `deploy.yml`'s
drift guard FAILS the hosting job on this push: deploy `firebase deploy --only functions:retentionCleanup`
manually, then ship hosting via the workflow_dispatch button. Both halves must land — the sweep is the server
half, and the limbo screen + chokepoint (hosting) is what stops a marked session writing in the meantime.

**Not re-raised (accepted-deviations + ADR 0019/0020):** the marker's lack of retirement; a first-chunk
failure parking a user with intact data; the limbo screen blocking writes; the partially-cascaded state
having no sweep; Tillsammans anon-vote forgery; the session-expiry gate; blocking-as-hygiene; create-only
reports; the fail-open `effectiveVisibility` read.

**PoC status:** the client-side claim was exercised by MUTATION (above, real run). The sweep logic is
Admin-SDK-only with no rules surface, so the ceiling arithmetic is DERIVED from the source and stated as
arithmetic, not as a live run.

**REVIEW-VERDICT: fail (1 blocking)**


### 2026-08-13 — BIN-816 + BIN-875 + BIN-876, security review ROUND 4 (ceiling floor verified, no new blocker)

**Scope.** Same staged diff (44 paths), fourth pass, clean tree. Staged blob == worktree verified by md5 for
every file I reason about; `functions/src/retentionCleanup/logic.ts` differs from `git show :` by CRLF ONLY
(content md5 identical after `tr -d '\r'`, `git diff` empty). The brief named five changed files; mtime-sorting
`git diff --cached --name-only` showed EIGHT had moved since round 3 — also `src/test/rules/account-deletion.test.ts`,
`src/components/layout/DeletionLimbo.test.tsx` and `src/lib/firebase/userDocWrite.chokepoint.test.ts`. Read all
three; the chokepoint guard was STRENGTHENED (a new per-alternation unit case: the `collection()` half was
self-pinned and could have been dropped green), not weakened. ADR 0019, ADR 0020 and `accepted-deviations.md`
re-read. `firestore.rules` / `firestore.indexes.json` still untouched.

**Round-3 blocker CLOSED — verified by mutation, not by reading.** `orphans.ts:118-122` is now
`candidates > max(ORPHAN_AUTH_MIN_CEILING=5, checked*0.25)` under the absolute 50, and `checkedAccounts <= 0`
disables the proportional half instead of tripping it. Direction check both ways: (1,3),(2,6),(5,3),(20,100),(0,0),(0,-1)
pass; (6,6),(30,100),(51,big) refuse. Three mutants, each run `--no-cache` with the mutated line grepped in the
same command, each restored from a scratchpad snapshot and re-verified by md5 (`f4bcc6b4…`):
 - drop `Math.max(FLOOR, …)` → "LÅSER SIG INTE på ett litet underlag" fails (1 of 26). Killed.
 - `>` → `>=` → "men golvet är ett golv" fails. Killed.
 - drop `user.disabled === true` in `isOrphanCandidate` → the disabled test fails. Killed.
Round-3 finding 2 (the unpinned marker re-read at `AuthContext.tsx:536`) also mutation-verified: reverting to
`setDeletionInProgress(deleting)` reddens **2 of 66**, not the 1 the author claimed — the extra kill is "the
visibility repair does not stamp watchlist docs for a marked session". Safe direction, but the count was a claim
until run. Restored, md5 `a5a69957…`, `grep -c MUTANT` 0, tree staged-only. Findings 3/4/5 all landed: the same
predicate now caps the username release (`index.ts:564-576`, refusal releases NOTHING), candidacy moved into
`isOrphanCandidate` with four tests, and RUNBOOK §5d warns that a Console-created account never signed into
within 7 days is reaped too. `revokedUidsInBatches`' `extract` param: mutated to ignore the argument →
"uses the supplied extract" fails (1 of 39). Killed. `npx tsc --noEmit` in `functions/` is clean, so no
type error can make the deploy — and therefore the sweep — silently absent.

**Pressed questions.** (a) *Delete something live?* No new path. Auth sweep: age>7d AND not disabled AND a
SUCCEEDED `getAll` reporting no `users/{uid}`; `checkedAccounts` counts every listed account (a conservative,
permissive denominator). Username sweep: profile-absent AND Auth's own `notFound`, asked only about
profile-absent uids. No anonymous-auth population exists in this app (ADR 0015 rejected it), which is what keeps
"auth account without a profile" a small set. (b) *Permanently inert?* Three ways, all now bounded or
documented: the ceiling (below), a missing `firebaseauth.users.delete` role (EXTERNAL_ACTIONS' new per-sweep
table + acceptance bar), and the 300s budget — the two irreversible sweeps run LAST and sequentially, so a
timeout inside them prints no `retentionCleanup done` line at all; the interim "scheduled sweeps done" line at
`index.ts:524` is what makes that diagnosable. (c) *Ceiling gameable?* Upward, bounded by the absolute 50.
Downward (wedging), yes and it is the honest residual: a profile-less Auth account costs one Identity-Toolkit
`signUp` against the public web API key, and 6 of them wedge a sub-25-account project. The floor bounds the
latch, it does not remove it — above the floor the candidate set is still monotone. RUNBOOK §5d ("kontrollera
varför kandidaterna blev så många") and §5e (manual handle release) are the operator path, so it is a loud,
clearable refusal rather than a silent hole. (d) *Reopened anything?* No: the storage listener, the
`WatchlistContext` early-outs, `snaps.profileSnap.ref` (keeps the profile delete inside
`dataExport.coverage.test.ts`'s three-way guard), the no-fallback username query and the chokepoint are all
intact; no new user-owned subcollection, so `collectUserDataSnapshots` needs no change. `docs/org/route.mjs`
still routes both sweep files to role 27, so the map widening in this diff loses no coverage.

**Findings issued (0 blocking).**

1. *Low* — `docs/data-retention-policy.md:207` states "Fönster: 7 dygn … raderar dagligen" as fact and never
   mentions that the sweep can refuse to delete anything. RUNBOOK §5d and EXTERNAL_ACTIONS both name the
   ceiling; the policy — the document ADR 0019 Q2's "delay, not breach" reading is explicitly conditioned on —
   does not. One sentence: the sweep declines when the candidate set is implausible, and then §5d applies.
2. *Low* — residual latch above the floor, now on BOTH sweeps. >5 candidates AND >25% refuses forever (the
   candidate set shrinks only by deletion/release). Reachable by a genuine broken query (intended) or by the
   cheap `signUp` wedge in (c). Mitigated by the RUNBOOK's operator path; worth one line there naming the
   flood as the second explanation beside "broken query".
3. *Low* — the ceiling WIRING is still untestable by construction. The predicate is pinned, but
   `deleteAuthAccounts`'s call and the `orphanUsernamesRefused ? 0 : deleteInBatches(...)` ternary live in the
   `firebase-admin` file: deleting either leaves the whole suite green. Cheap close: have `orphans.ts` return
   the filtered SET (`authUidsToDelete`/`reservationsToRelease`) so the handler has no decision left to lose.
4. *Low/operational* — no alert exists for "the orphan sweeps did not run" (BIN-468 still open). The only
   signal is the ABSENCE of the `retentionCleanup done` line. One RUNBOOK line would make that readable.
5. *Nit* — the author's own mutation claim ("reddens exactly that test, 1 of 66") was 2 of 66.

**Deploy.** Unchanged from round 3 and now written down in EXTERNAL_ACTIONS: `firebase deploy --only
functions:retentionCleanup` by hand FIRST, then hosting via workflow_dispatch; `deploy.yml`'s drift guard fails
the push-triggered job by design and a red workflow beside a green tree is not "shipped". No rules/index deploy.

**Not re-raised (accepted-deviations + ADR 0019/0020):** the marker's lack of retirement; a first-chunk failure
parking a user with intact data; the limbo screen blocking writes; the partially-cascaded state having no
sweep; Tillsammans anon-vote forgery; the session-expiry gate; blocking-as-hygiene; create-only reports; the
fail-open `effectiveVisibility` read.

**PoC status:** the two client/server predicates were exercised by REAL mutation runs (above). The sweep's
runtime behaviour is Admin-SDK-only with no rules surface, so the wedge arithmetic and the timeout path are
DERIVED from source and stated as such.

**REVIEW-VERDICT: pass (0 blocking)**

### 2026-08-14 — BIN-655, `addItem` split into `upsertTitle`/`logViewing` over one `buildAddWrite` builder

Batch D. Router: `medium`, `owned`, panel [27] DBA (blind critique already ran 2026-08-13, six conditions).
`firestore.rules` NOT touched — verified with `git diff --cached -- firestore.rules firestore.indexes.json`
(empty) and `git diff --cached --stat` (32 files, neither rules file listed).

**hasOnly allowlist (condition 1 of #27).** Enumerated `isValidWatchlistItem`'s hasOnly list by hand (32 keys:
tmdbId/mediaType/status/rating/notes/title/posterPath/releaseYear/totalSeasons/lastWatchedSeason/
lastWatchedEpisode/dropped/rewatchCount/providers/providersCheckedAt/visibility/genreIds/tmdbStatus/
effectiveVisibility/isPublic/addedAt/updatedAt/watchedAt/runtime/nextAirDate/nextAirCode/nextAirProvider/
nextAirUpdatedAt/digitalReleaseDate/ratedAt/tmdbFieldsRefreshedAt/subscriptionProviders), then enumerated every
key `buildAddWrite` can emit across all branches: the `WatchlistAddPayload` carry-set (AlwaysWritten + Carryable
from `buildAddPayload.ts`) plus `dropped`, `effectiveVisibility`/`isPublic`, `addedAt`, `rewatchCount`,
`updatedAt`, `watchedAt`, `tmdbFieldsRefreshedAt`, `providersCheckedAt`, `ratedAt`. Every emitted key is in the
allowlist on both intents; `visibility` (the per-item override) and `intent`/`countsAsViewing` never appear.
The new `firestore-rules.test.ts` block additionally runs the REAL builder against the REAL rules (create +
merge-update, both intents) with a "one extra key is refused" control — the right shape per this file's own
"hasOnly bounds the key set only" principle, since a hand-typed fixture can only prove the shape someone typed
is legal (exactly what missed `notes` before).

**BIN-505 notes strip.** Moved into `buildAddWrite` as `const { notes: _stripped, ...itemFields } = item as
…`, unconditional (runs before the branch on `intent`), and `itemFields` (not `item`) is the first thing spread
into the return object — so nothing later in the object literal can reintroduce `notes`. WatchlistContext.test's
existing pin (`{ ...newTitle(77), notes: '…' }` via the renamed `upsertTitleRef`) and a new
`watchlistWrites.addWrite.test.ts` case both exercise it on both intents.

**BIN-595 visibility guard.** `shouldStampVisibility(current)` is called unconditionally in `buildAddWrite` —
not gated on `intent` — so both `upsertTitle` and `logViewing` reach it identically. The per-item `visibility`
override is never written by this path (only `effectiveVisibility`/`isPublic` from the injected
`visibilityFields`); confirmed by reading the return object literal, no `visibility:` key anywhere in it.

**Rules-suite import widening (condition 4/BIN-655 plan).** `vitest.rules.config.ts` gained
`resolve: { tsconfigPaths: true }` — the identical option already used in the main `vitest.config.ts` (same
key, no new plugin/dependency). Traced the import chain the new test pulls in:
`@/lib/watchlistWrites` → `@/lib/watchlist/buildAddPayload` (type-only) + `@/lib/watchlist/tmdbFieldsRefresh`
(value import, pure date-math, no `process.env`/`NEXT_PUBLIC_*`, no Firebase import). Grepped both files for
`process.env`/`NEXT_PUBLIC` — none. No secret, no client SDK config, no env reaches the rules suite.

**BIN-601/640 addedAt-under-dead-listener gate.** `ctx.listenerFailed` is part of the single `AddWriteContext`
object passed unchanged regardless of `intent` (`writeTitle(item, intent)` builds one `ctx` and only `intent`
varies) — so the `current || listenerFailed` addedAt suppression is identical on both entry points. Matrix test
row "dead listener — addedAt is withheld too" pins it for both `bulk` and `viewing`.

**Caller sweep.** `grep -rn '\baddItem('` across `src/` → zero hits; a source-scanning test in
`watchlistWrites.addWrite.test.ts` also asserts this at every future commit (`nothing calls a watchlist addItem
any more`) and that `WatchlistState` no longer offers a one-parameter-flag member. All non-mark-seen callers
(`settings/import`, `OnboardingFlow`, `CollectionSection`, `CompanionSection`, `MoviePageClient` Bevaka,
`QuickRateModal`, `QuickAddButton`) moved to `upsertTitle`; both `useMarkSeen` branches and `StatusButton`'s
"Sedd igen" moved to a `write = opts?.countsAsViewing ? logViewing : upsertTitle` dispatch — preserves BIN-641's
existing semantics exactly, just re-expressed as a function choice instead of a payload-adjacent flag.

**Non-blocking, not filed:** the plan doc's own "22-field hasOnly allowlist" comment is stale (actual count is
32) — cosmetic, in an uncommitted planning doc, no code impact. Separately, the new source-scanning test's
`ctxSrc.slice(ctxSrc.indexOf('interface WatchlistState'), ctxSrc.indexOf('const WatchlistCtx'))` looks for a
substring (`WatchlistCtx`) that doesn't exist in the file (the variable is `WatchlistContext`), so `indexOf`
returns -1 and the slice runs to near-EOF rather than stopping at the interface — broader than the comment
claims, but not weaker (the assertions inside still hold over the true interface text, which is a subset of the
slice). Test-reviewer territory, not a security hole; noted here so a future security re-review doesn't have to
re-derive it.

PoC status: this is a pure-refactor review (author's own claim: `buildAddWrite('bulk', ctx)` ≡ old `addItem()`,
`buildAddWrite('viewing', ctx)` ≡ old `addItem(…, {countsAsViewing:true})`), verified by reading both the old
(pre-image via `git diff`) and new code side by side plus the shipped parity-matrix/hasOnly-emulator tests
rather than an independent PoC — no new rule, no new trust boundary, no new collection. DERIVED, not re-run.

Not re-raised (accepted-deviations): Tillsammans anon-vote forgery, the session-expiry gate, blocking-as-
hygiene, create-only reports, the fail-open `effectiveVisibility` read.

**REVIEW-VERDICT: pass (0 blocking)**

## 2026-08-14 — BIN-655 Batch D, round 2 (both round-1 nits re-verified at bytes)

Re-reviewed the staged Batch D diff after both round-1 nits were applied. Re-read every
staged file this round covers (`watchlistWrites.ts`, `buildAddPayload.ts`, `domain.ts`,
`WatchlistContext.tsx`, `firestore-rules.test.ts`, `watchlistWrites.addWrite.test.ts`,
`accepted-deviations.md`, `data-model.md`).

**Nit 1 (22→32 field count) — confirmed fixed.** `tasks/todo.md`'s Batch D section now reads
"(32 keys, counted; the ticket said 22, which was stale)". Independently recounted
`isValidWatchlistItem`'s `hasOnly([...])` array in `firestore.rules` — 32 entries. Matches.

**Nit 2 (slice-bound `WatchlistCtx` typo) — confirmed fixed, and fixed correctly, not just
silenced.** `watchlistWrites.addWrite.test.ts`'s "and the context no longer OFFERS one" test
now reads:
```
const from = ctxSrc.indexOf('interface WatchlistState');
const to = ctxSrc.indexOf('const WatchlistContext = createContext');
expect(from).toBeGreaterThan(-1);
expect(to).toBeGreaterThan(from);
```
with a comment naming the exact round-1 defect ("the closing bound said `const WatchlistCtx`,
which matches nothing"). Both bounds asserted found before the slice is taken, so a future
rename of either symbol reddens this test instead of silently widening the slice — the
correct fix for the class, not just a corrected string literal.

**Test-reviewer's third nit (addItem-call guard) — confirmed applied.** The offender regex
is now `\baddItem\s*\??\.?\s*\(` (covers optional chaining) and the scan excludes its own
file (`!f.endsWith('watchlistWrites.addWrite.test.ts')`) with a comment explaining why: the
pattern is written out as a literal in this file's own comments and would otherwise match
itself.

**This round's own two lens checks:**

1. **`buildAddWrite` emits only allowlisted keys, every branch, both intents.** Read
   `firestore.rules`' `isValidWatchlistItem` `hasOnly` list (32 keys) against every key
   `buildAddWrite` can emit (`itemFields` via `WatchlistAddPayload`'s `AlwaysWritten |
   Carryable`, `dropped`, `effectiveVisibility`/`isPublic`, `addedAt`, `rewatchCount`,
   `updatedAt`, `watchedAt`, `tmdbFieldsRefreshedAt`, `providersCheckedAt`, `ratedAt`) —
   every one is a member. Backed by a NEW live rules-emulator block in
   `firestore-rules.test.ts` (`describe('BIN-655 — buildAddWrite payloads satisfy the
   hasOnly allowlist')`) that runs the REAL `buildAddWrite` against the REAL deployed-shape
   rules for CREATE (both intents) and MERGE-UPDATE (rewatch-counted + bulk re-mark), plus a
   control (`assertFails` on one extra key) proving the allowlist is actually what's gating
   the `assertSucceeds` cases and not a permissive stand-in. This is exactly the "write a
   live PoC, don't trust a rules-trace" principle, done by the diff's own author before I
   asked — nothing to add to the knowledge file, the existing bullet already covers it.
   Confirmed by reading source (not just running tests): `writeTitle` builds `ref` from
   `uid` (own `useAuth` uid), never from `item`, so ownership is unchanged from pre-refactor.

   **Non-blocking, not filed:** `buildAddPayload.ts`'s `Carryable` type (`Exclude<keyof
   WatchlistItem, ServerOwned | AlwaysWritten>`) includes `tags`, which is NOT in
   `firestore.rules`' `hasOnly` list — structurally the exact `notes`-shaped gap the file's
   own doc comment warns about, one field over. Not exploitable today (the canonical
   `buildWatchlistAddPayload` never populates `tags`; no caller in this diff does either) and
   fails SAFE (`permission-denied`, not a data leak) if it ever were. Pre-existing — this
   diff only renamed comments in `buildAddPayload.ts` (`git diff` confirmed zero logic
   change to `ServerOwned`/`Carryable`), so it is out of scope for THIS review, not newly
   introduced. Worth a follow-up ticket if Malin wants `tags` excluded from `Carryable` the
   same way `notes` is, but not a blocker.

2. **BIN-505 notes strip — unconditional, and before the spread.** `const { notes:
   _strippedNotes, ...itemFields } = item as ...` runs unconditionally (not inside any `if`/
   ternary) as the first statement before the `return`, and `...itemFields` is the FIRST key
   in the returned object literal — no later spread reintroduces `notes` (verified: none of
   `visibilityFields`, `rewatch`, or the stamp fragments carry a `notes` key). Cross-checked
   against `firestore.rules` lines 259–272: `notes` stays IN the `hasOnly` allowlist
   (required — a legacy doc's stored `notes` survives into the post-merge doc that `hasOnly`
   judges) but is value-bound to absent/null on create and absent/null/unchanged on update,
   matching the code comment's claim exactly.

No new trust boundary, no new public-read surface, no rules file touched (this diff only
adds a TEST reading `firestore.rules`, confirmed via `git diff --cached --name-only` — rules
themselves are unchanged so no manual-deploy note is needed). Not re-raised (accepted-
deviations): Tillsammans anon-vote forgery, session-expiry gate, blocking-as-hygiene,
create-only reports, fail-open `effectiveVisibility` read, aborted-deletion marker,
limbo-screen write block.

**REVIEW-VERDICT: pass (0 blocking)**

### 2026-08-15 — BIN-879 cross-device deletion-gap ADR (documentation-only, ADR 0022)

Scope: 7 staged files, comment-only diffs on `functions/src/retentionCleanup/orphans.ts` and
`src/lib/deletionMarker.ts` (verified by full `Read` of both files — no predicate, ceiling or
sentinel line moved, only JSDoc prose), plus `docs/RUNBOOK.md` §5f (new), `docs/data-retention-policy.md`,
`docs/org/adr/0022-cross-device-deletion-gap-accepted.md` (new), `docs/org/adr/README.md`,
`.claude/rules/accepted-deviations.md`. Root + `functions/` `tsc --noEmit` both clean.

**Q1 — is the accept's premise sound?** ADR 0022 / Legal's reasoning says "only the account
holder, on their own credentials, can trigger it." Checked for a different party: no
password-change/session-revoke flow exists in this codebase at all (`grep updatePassword
revokeRefreshTokens reauthenticate src` → zero hits), so there is no "session that outlives a
password change" vector to exploit. The only way a party OTHER than the human account holder
reaches the state is by already holding a live, unexpired, unrevoked session for that uid
(shared/public device, or a device an attacker separately compromised) — and such a party
already has full read/write access to the live account regardless of this bug; the marginal
"gain" from this specific gap is denying the victim their completed erasure, which is exactly
what #6 DPO's recorded dissent already covers from the harm side. Conclusion: not a NEW attack
surface, and not blocking — but the ADR's phrasing is imprecise (it should read as SESSION
possession, not human identity) and I folded that precision note into the knowledge file rather
than filing it, since it doesn't change the accepted risk calculus.

**Q2 — sweep guarantees described correctly?** Verified the new prose in `orphans.ts`,
`deletionMarker.ts`, RUNBOOK §5f/§5d, and `data-retention-policy.md` against the UNCHANGED code:
candidate test ("Auth exists AND profile confirmed absent"), the 7-day age window
(`ORPHAN_AUTH_MIN_AGE_MS`, keyed on Auth `creationTime`, not time-since-profile-loss), and the
two independent ceilings (`ORPHAN_AUTH_MAX_PER_RUN=50`, `ORPHAN_AUTH_MAX_FRACTION=0.25` with
`ORPHAN_AUTH_MIN_CEILING=5` floor) — all accurately described, nothing overstated. "Permanent,
not delayed" is literally true: `isOrphanCandidate`/the candidate query never re-includes a uid
once `users/{uid}` exists again, short of a fresh deletion.

**Q3 — the false-`false` marker-read correction.** Traced `isDeletionStarted`'s catch-path: a
`localStorage` throw returns `false` (looks like "no deletion in progress") → a guarded write
site (`userDocWrite.ts`'s chokepoint, and `syncMyPublicProfile`'s `mergePublicProfileDoc` per
`src/lib/firebase/publicProfile.ts:178-181`) proceeds → `users/{uid}` (and, via the same
chokepoint, `publicProfiles/{uid}`) gets recreated → the account permanently leaves the
orphan-auth sweep's candidate set, exactly the cross-device mechanism. The removed claim ("caught
by the server sweep") was false for the identical reason the cross-device gap is; the new comment
is correct.

**Q4 — RUNBOOK §5f's 3-item Console deletion (`users/{uid}`, `publicProfiles/{uid}`, Auth
account) — safe, and does it leave a credential/grant behind?** Traced `sendPushToUser`
(`functions/src/push.ts:52-56`): it checks `profileSnap.exists` and returns BEFORE ever reading
`users/{uid}/fcmTokens`, so once step 1 of the 3 runs, any leftover `fcmTokens` doc is inert —
no live push grant survives. `publicProfiles/{uid}` is correctly named as needed (confirmed: no
Cloud Function, trigger, or sweep ever touches it — `grep publicProfiles functions/` = zero
hits — matching the rules-file comment "wired explicitly into the GDPR export + erasure paths").
BUT: deleting a Firestore doc via Console does not cascade its subcollections unless the operator
confirms a recursive-delete prompt — this exact behavior is already documented, for a DIFFERENT
manual-deletion runbook, in `docs/moderation.md:119-121` ("Firebase Console raderar automatiskt
subcollections om användaren bekräftar"). RUNBOOK §5f never mentions this prompt. Net effect if
missed: any subcollection created since the cross-device resurrection (a freshly re-registered
`fcmTokens` doc from normal use on the second device, watchlist items, etc.) survives forever
with no sweep able to find it (parent doc AND Auth account both gone). Not a live security
exposure (Console-only, admin-side, and push specifically is independently inert per above) but
a genuine Art. 17 completeness gap in the newly-written prose's implicit "these three are
enough" claim. Rated non-blocking: filed as a one-line fix, folded into the knowledge file
(GDPR export/delete completeness section) rather than as a ticket, since Malin's working
agreement treats this class of gap as a doc fix, not a code change, and the ADR's own scope
(BIN-879) was explicitly documentation-only.

**Other checks:** `.claude/rules/accepted-deviations.md` diff is a pure append (verified against
archive contract — no existing entry edited/removed); `docs/org/adr/README.md` index line
matches ADR 0022's actual content; ADR 0022 itself correctly records the #6 DPO dissent verbatim
rather than resolving it. `docs/data-retention-policy.md`'s claim "25 collections" is consistent
with the 18-entry `KNOWN_USER_SUBCOLLECTIONS` array plus the CG-scoped + top-level collections
(reviews/lists/usernames/publicProfiles/sessions) named elsewhere in the same doc — not verified
to the exact integer but not contradicted by anything in the diff.

Knowledge file: folded the Console-recursive-delete-prompt lesson and the
session-possession-vs-identity premise-check into the existing BIN-816 cross-device bullet under
"Cross-account and cross-session leak classes" (superseding its now-stale "no licence for a doc
sentence overstating the backstop" warning with the fact that BIN-879/ADR 0022 acted on it);
trimmed several other bullets for the 30k character cap.

**REVIEW-VERDICT: pass (0 blocking)**

### 2026-08-16 — BIN-727 condition 4: communityRatings lifted behind AggregateIo, FieldValue.increment dropped — APPROVED

Reviewed the staged diff: `functions/src/communityRatings/index.ts` (trigger + Admin-SDK port,
83→shrunk to a thin `AggregateIo` implementation), new `functions/src/communityRatings/runAggregate.ts`
(admin-free orchestrator: `aggregateDocId`, `runCommunityRatingAggregate`), new
`src/test/rules/community-ratings-orchestrator.test.ts` (15 tests incl. a forced write/write race),
plus the matching `docs/role-responsibilities.md`/`docs/org/ownership-map.json` ownership updates and
`tasks/todo.md` plan rewrite. Same pattern as `retentionCleanup`/`runCleanup.ts` and
`availableNotify`/`runNotify.ts` (steps 1–2 of the same ticket, already approved).

**The one deliberate behaviour change, attacked directly:** `FieldValue.increment` is gone; `count`/
`sum` are now `numberOr0(current) + delta` computed from the SAME `tx.get()` the transaction already
does to check `lastEventId`.

1. **OCC argument verified correct, and re-derived independently, not just re-read.** Firestore
   transactions (both Admin and client SDK) retry the WHOLE callback on a conflicting read — this is
   true regardless of whether the write uses `increment()` or plain arithmetic, because the sentinel's
   only advantage is avoiding a READ before an out-of-transaction write; inside a transaction that
   already reads the doc for `lastEventId`, increment buys nothing OCC doesn't already guarantee.
   Ran the 15-test suite live against a real Firestore emulator (own temp `firebase.sec-review.json`
   on port 8091, project `demo-binge-sec-review`, deleted after) — 15/15 green, including the forced-race
   test asserting `callbackStarts > 2` (proves a genuine retry, not a lucky non-overlap or a buffered
   non-transactional shim). Confirmed via grep that `functions/` and `scripts/` have exactly the two
   writers of `titleRatingsAggregate` (`index.ts`'s port impl + the file being reviewed), matching the
   claim in the header comment and `tasks/todo.md`'s "verified before the build" section; `firestore.rules`
   is unchanged (`read: true, write: false`).
2. **`numberOr0` behaviour-parity checked against Firestore's actual `increment()` semantics, not
   assumed.** Firestore's documented behaviour: incrementing a NON-numeric or absent field SETS it to
   the operand (does not error, does not NaN-propagate) — so old prod docs (always numeric, from prior
   increment writes) are unaffected, and the new code's `numberOr0(v) = typeof v==='number' &&
   Number.isFinite(v) ? v : 0` reproduces exactly that fallback for absent/null/non-numeric. The one
   divergence — a doc holding a stored `NaN` — used to poison the aggregate forever under `increment`
   and now self-heals to 0 under the new code; a behaviour IMPROVEMENT, not a regression, and not
   security-relevant (no attacker path to plant `NaN`; `rating` is rules-bound 0–5). Mutation-proved the
   guard is load-bearing: neutered `numberOr0` to `v as number`, re-ran the suite live — 8/15 red (the
   two contamination/contention tests plus the "skräp i räknarna" test), confirming the guard is not
   vacuous. Restored byte-identical (md5 `a5ae3c09bc34941827999141e5be3c1d` before and after).
3. **Write-payload completeness confirmed.** Old code wrote `{count: increment, sum: increment,
   lastEventId, updatedAt: serverTimestamp()}` merge:true. New split: `runAggregate.ts` returns
   `{count, sum, lastEventId}`; `index.ts`'s `adminIo.set` spreads that and stamps `updatedAt:
   FieldValue.serverTimestamp()` itself, still merge:true. Same three content fields + timestamp,
   nothing dropped. No user-controlled input reaches the payload beyond what already did (rating,
   rules-bound 0–5).
4. **Vote-stuffing invariant (doc-id from PATH, never body) verified preserved verbatim.** `aggregateDocId`
   in `runAggregate.ts` is a straight lift of the pre-diff logic in `index.ts` — `parseMediaTypeFromDocId`
   on `event.watchlistDocId` (== `event.params.tmdbId`, the watchlist doc's own path segment) wins when
   namespaced; the legacy bare-numeric branch takes the PREFIX from the body's `mediaType` but the id
   digits still come from the path. `mediaTypeDocId.ts` and `logic.ts` (`ratingDelta`/`isNoOp`) are
   BYTE-UNCHANGED in this diff (confirmed via `git diff --cached` scope + direct `Read`). The test suite
   exercises the attack directly (`bodyTmdbId: 550` on a `movie_603` path write doesn't touch
   `movie_550`'s aggregate) and passed live.
5. **Swallowed-transaction-failure reasoning checked and correct, not new.** `retry` is genuinely
   unset on `onDocumentWritten('users/{uid}/watchlist/{tmdbId}', handler)` — no options object is
   passed, confirmed against `firebase-functions`' own `options.d.ts:190` doc comment ("Whether failed
   executions should be delivered again") which defaults falsy. So a rethrow today changes only the log
   line, exactly as documented in both the code comment and `tasks/todo.md`'s "villkor 5" writeup — and
   this catch/log-without-rethrow behaviour is UNCHANGED from the pre-diff code, not a new deviation to
   file. The `retry: true` cost question is correctly routed to Malin as a separate ticket rather than
   decided in this one.

No blocking findings. `.claude/rules/accepted-deviations.md` checked — nothing here overlaps the four
listed Tillsammans/blocking/reports entries. `docs/role-responsibilities.md` +
`docs/org/ownership-map.json` diffs matched the code change exactly (role #27 DBA gains the two new
files); `tasks/todo.md` plan matched what was actually built, including the "villkor 5" open question
to Malin.

Knowledge file: added a new bullet under "Admin-SDK sweeps and scheduled writers" generalizing when
`FieldValue.increment` is safe to drop inside an already-reading transaction, and what three things
must be checked before doing so (no other writer; a `numberOr0`-style fallback matching increment's
own non-numeric behaviour; unchanged write payload) — this is a genuinely new class, not a duplicate of
any existing bullet. Trimmed several other bullets (mostly the irreversible-sweep-ceiling one and a
few one-line tightenings) to stay under the 30k cap; no bullet lost a distinct sub-claim, only redundant
words.

**REVIEW-VERDICT: pass (0 blocking)**

### 2026-08-18 — BIN-565 (streamingOffers doc-id backfill, Admin-SDK) + BIN-911 (DeletionLimbo one-line addition) — first security pass, re-verifying after 11 code/test-reviewer rounds

**Scope.** `functions/src/streamingOffers/{backfillIds.ts (new), backfillIds.test.ts (new), index.ts,
logic.ts}`, `functions/src/weeklyDigest/index.ts` (comment only), `functions/src/index.ts` (comment
only), `src/hooks/useStreamingOffers.ts` (comment only), `src/components/layout/DeletionLimbo.{tsx,
test.tsx}`, `tasks/todo.md`, both other agents' knowledge/archive files (skimmed for secrets/context
only, out of security scope). No prior entry for BIN-565 exists in THIS archive — the "eleven passes"
in the dispatch were code-reviewer/test-reviewer rounds (confirmed by grepping their archives), so this
is a from-bytes review, not a re-review of my own prior ruling.

**The three data-safety invariants, verified from the current bytes (`runIdBackfill`,
`backfillIds.ts:180-244`).**
1. *Write-before-delete, no delete-without-durable-write path.* The only branch that deletes without a
   prior write in THIS invocation is the `exists(target.toId)` branch — legitimate, because the
   namespaced doc's existence (written by either a prior backfill pass or the refresh cron) IS the
   durable write; overwriting it would move data backwards. The migrate branch is `writeNamespaced` then
   `deleteBare`, unconditionally, both awaited, nothing between them — pinned by the port split (two
   methods, not one opaque `migrate()`) and asserted on a `calls` sequence log in the test, not a counter.
2. *No overwrite of an existing namespaced doc.* `if (await io.exists(target.toId)) { deleteBare; continue; }`
   runs BEFORE any read of the bare doc's data — the write path is structurally unreachable once the
   target exists. Pinned: `'drops a bare doc WITHOUT overwriting an existing namespaced one'`.
3. *Refusal to guess a media type.* `targetFor` requires `doc.mediaType === 'movie' | 'tv'` on the FIELD;
   `parseMediaTypeFromDocId` is deliberately not imported (comment names why: a bare id carries no type
   by construction, so the fallback could only ever return null here — importing it would invite a future
   "simplification" that quietly re-derives from the id and reopens BIN-523). Verified live in
   `mediaTypeDocId.ts` (unchanged, Read anyway): `parseMediaTypeFromDocId` only matches `movie_`/`tv_`
   prefixes and returns null on a bare numeric id — so even if someone wired it back in, it could not
   silently misattribute; the refusal is belt-and-braces, not the only thing standing between here and a
   guess.

**runIdBackfill placement.** Confirmed the last statement in `streamingOffersRefresh`'s handler body
(`index.ts:471`), after the `logger.info('streamingOffersRefresh done', …)` line, deliberately NOT
wrapped in try/catch (comment: a swallowed throw would make a stuck migration look completed — the
"silence reads as success" shape named as BIN-918's subject). It receives `scanned` from `readExisting()`
— the SAME `.select('checkedAt','offers','tmdbId','mediaType')` scan MOTN-prioritization already pays
for — not a second collection read; the comment's claim to this effect is true because the data
literally flows from one function's return into the other's argument, traced by reading both call
sites, not trusted from the comment alone. No code path between `readWorkSet`/`readExisting` and this
call invokes `fetchOffers`/`motn.ts` — grepped: the only `fetchOffers` call site is inside the per-title
batch loop, which is textually and causally separate from the backfill call at the bottom.

**Cost envelope.** `readExisting()` is one unpaginated `.select(4 fields).get()` over the whole
`streamingOffers` collection — pre-existing pattern (not new to this diff), already the established
public-read-no-PII rollup shape this file's own principles accept at Binge's scale. `BACKFILL_PER_RUN =
200` bounds the migrate/drop loop to ≤400 Firestore ops (200 potential write+delete pairs) per 24h
invocation — negligible against the 25 SEK/mån Blaze cap and independent of the 300/cycle MOTN vendor
cap (zero vendor calls, confirmed: `makeBackfillIo` only touches `db.collection('streamingOffers')`, no
import of `motn.ts`).

**The throttled-cycle parking question, priced rather than assumed.** `index.ts:234-252`'s early return
(`usedThisCycle >= STREAMING_HARD_CYCLE_CAP`) skips `runIdBackfill` too, and the in-code comment (added
this round, integration-review-dated 2026-08-17) is honest that `applyThrottleObservation` on two
consecutive 429s burns `count` to the cap, making this branch true for up to ~31 days (the rest of a
billing cycle). Graded: NOT a safety/data-integrity problem — the migration is idempotent (re-running it
after N days of parking is identical in effect to running it daily; nothing decays or races against a
deadline) and self-terminating (does nothing once the bare-doc population is empty). It is a pure
availability/latency cost: the reader fallbacks (`useStreamingOffers.ts`, `weeklyDigest/readOffers`)
stay load-bearing for longer than the ticket's header implies, which both reader comments already say
explicitly ("stays until an exhaustive query PROVES zero bare docs remain"). Not a new deviation to file
— the existing `communityRatingMaintain` swallowed-transaction accept and the `tmdbTosSweep` cap-gate
precedent both already establish "self-healing delay under vendor throttling, priced and disclosed in a
comment, is an accepted class" on this codebase; this is the same shape, one level up (a whole
sub-feature's completion delayed, not a single record's).

**Two-Scheduler-delivery race, read and graded, not just quoted.** `index.ts:463-470` discloses a real
window: two overlapping `onSchedule` deliveries could interleave so that a stale `writeNamespaced`
(built from the pre-refresh `scanned` snapshot) lands AFTER the other invocation's fresh
`streamingOffers/{mediaType}_{tmdbId}` write, producing one stale overwrite. Bounded correctly: the
stale doc's older `checkedAt` sends the title back to tier-0 in `selectRefreshBatch` on the NEXT run, so
it self-corrects within one more cycle and never compounds. Admin-SDK-only, no client-reachable trigger,
so this is data-freshness noise, not a security boundary. Consistent with the file's own "Admin-SDK
sweeps" cost-not-security framing.

**DeletionLimbo.tsx / BIN-911.** Diff is a pure ADDITION after the existing button row (confirmed by
`git diff` hunk boundaries — every changed line is a `+`, zero `-` in the component). Read the full file:
the PageHeader `title`/`standfirst` and the two `<p>` blocks above the buttons (legally-approved per
BIN-813 condition 4 / BIN-877) are byte-identical to what round upon round of the aborted-deletion
archive entries above already cleared — no textual overlap between the new BIN-911 paragraph and the
locked sentences, and the new copy is careful (per its own comment trail, citing a #19 Customer Support
blind critique) to say "kom tillbaka hit" rather than any word implying an undo path that doesn't exist
(`DeletionLimbo.test.tsx`'s new case asserts `not.toContain('ångra')`/`'avbryt'`). No auth/write-path
change — the component still offers exactly the same two actions (`deleteAccount`, `signOut`); this is
copy-only. Not a trust-boundary change, so out of the "large change" bar for this reviewer's own
domain — reviewed anyway per the dispatch's explicit ask.

**No firestore.rules / firestore.indexes.json in this diff** (`git diff --cached --name-only` confirmed
neither file present) — `streamingOffers` is Admin-SDK write / public-read (`allow read: if true; allow
write: if false`), unchanged, and the migration bypasses rules entirely like every other sweep in this
class, so no manual rules deploy is owed. `functions/**` DID change (`backfillIds.ts` new,
`streamingOffers/index.ts`, `logic.ts`, root `index.ts` comment, `weeklyDigest/index.ts` comment) — per
this repo's standing deploy-order note, `deploy.yml`'s drift guard will fail the push-triggered hosting
job on this commit; a targeted `firebase deploy --only functions:streamingOffersRefresh` ships the new
migration logic, hosting ships separately via `workflow_dispatch`. No new user-owned subcollection
(`streamingOffers` stays global/public, not `users/{uid}/**`), so `collectUserDataSnapshots` needs no
change and this isn't a GDPR-completeness surface.

**V7 writer-guard (`backfillIds.test.ts`), re-verified from bytes, not trusted from the dispatch's
summary of prior rounds' fixes.** Read the full test file. All the fixes the dispatch and the other
agents' archives claim are present ARE present: `COL = `['"\`]streamingOffers['"\`]`` (any-quote-style),
the single-file bound-ref scan spans newlines (`[^;]` not `[^;\n]`, plus the `(?:db\s*\.\s*)?` whitespace
fix for a chain broken across lines), the cross-file scan is newline-spanning and REF-anchored (not
"mentions the collection AND has a .set somewhere," which the file's own comment says used to false-flag
`weeklyDigest`), and a THIRD test asserts — rather than silently passes on — the one shape none of the
regex scans can see (`batch.set(col.doc(id), data)`, an argument-passed ref). This is the file's own
honest-disclosure pattern already generalized in this reviewer's knowledge.md ("read its regex against
the chokepoint's OWN idiom" / residual disclosure), so no new principle to fold — an instance of an
existing one, correctly executed.

**Not re-raised (accepted-deviations, checked):** Tillsammans anon-vote forgery, the session-expiry
gate, blocking-as-hygiene, create-only reports, the fail-open `effectiveVisibility` read, the aborted-
deletion marker's lack of retirement, the limbo screen blocking writes, the cross-device deletion gap
(ADR 0022), the `communityRatingMaintain` swallowed-transaction accept (cited above as the closest
precedent for the throttled-parking finding, not re-filed).

**PoC status.** DERIVED. The destructive logic (`writeNamespaced`/`deleteBare`) is exercised by the
REAL `runIdBackfill` against a fake `BackfillIo` port in `backfillIds.test.ts` (24 tests, order asserted
on a call-sequence log) — that is a live unit-level proof of the safety property, not a rules-emulator
PoC, because there is no rules surface here (Admin SDK bypasses `firestore.rules` entirely). No
independent re-run performed this round; traced the port wiring (`makeBackfillIo` in `index.ts`) against
the tested port interface and confirmed the two match field-for-field.

No blocking findings. No new failure class for this file's principles — this diff instantiates two
already-generalized classes (Admin-SDK sweep safety trio; self-terminating migration under a shared
vendor-budget gate) rather than introducing a new one.

**REVIEW-VERDICT: pass (0 blocking)**


### 2026-08-19 — BIN-766 gap-fill re-review: runAggregate.ts / runAggregate.test.ts (mutated-bytes coverage repair)

**Context.** A prior pass on this same staged diff returned `pass (0 blocking)`, but its coverage was
invalid for two files: a binge-test-reviewer mutation run was live against
`functions/src/communityRatings/runAggregate.ts` concurrently, so the reviewed bytes were a MUTATED
snapshot, and `functions/src/communityRatings/runAggregate.test.ts` was never opened at all. This round
re-`Read` both against the settled, index-matching tree and re-derived the finding from bytes, not from
the prior verdict.

**What changed (BIN-766).** `aggregateDocId()` used to return a namespaced watchlist doc id (`movie_…`/
`tv_…`) VERBATIM. Now it resolves media type from the PATH prefix (body only for a legacy bare-numeric
id — closing a spoofable-body re-bucketing path), and canonicalises the numeric part through the shared,
STRICT `parseTmdbIdFromDocId` (`/^[0-9]+$/`, never `Number()` alone), skipping with a `log.warn` on
non-finite or non-positive. Paired in the SAME commit with `firestore.rules`' new
`canonicalWatchlistDocId` create-only shape guard (`^(movie|tv)_(0|[1-9][0-9]*)$`), mirroring the
existing `canonicalSwipeDocId`.

**Q1 — both halves of `!Number.isFinite(tmdbId) || tmdbId <= 0` load-bearing?** Yes, confirmed by two
DISTINCT test cases: `movie_0` exercises `<=0` alone (`isFinite(0)` true), and `movie_`/`movie_1_2`/
`movie_xyz`/`tv_` exercise `isFinite` alone (`parseTmdbIdFromDocId` returns `NaN`, and `NaN <= 0` is
`false`, so dropping the isFinite half would let `movie_NaN` write to `titleRatingsAggregate` — a
collection Admin-SDK-only and therefore with ZERO rules protection against a malformed id).

**Q2 — does the new code silently skip anything the OLD code attributed, beyond the deliberate alias/
garbage/zero cases?** Traced the actual OLD/NEW diff (not just the current file). OLD code: `if
(pathMediaType != null) return docIdRaw` — returned ANY namespaced-prefixed id verbatim with NO digit
validation at all (`movie_xyz`, `movie_1_2`, `movie_` all "attributed" as garbage doc ids under the old
code). NEW code correctly reclassifies all of those as skips — matches the documented "deliberate"
category, not a new loss. One SUBTLER effect surfaced and is NOT a skip-regression but a NEW (bounded,
non-blocking) collision surface: `canonicalWatchlistDocId`'s digit group `[1-9][0-9]*` has no LENGTH cap,
and `Number(digits)` loses precision past 2^53 — an account could self-create two distinct arbitrarily-
long watchlist doc ids (e.g. `movie_9007199254740993` vs `...992`) that canonicalise onto the SAME
synthetic aggregate doc, self-stuffing a FAKE tmdbId's rating count. Not exploitable against any REAL
title (no real TMDB id is remotely 2^53-scale, and float rounding can't jump a huge string down to a
small real id) — same cost class as the already-accepted `movie_1`…`movie_999999` junk-doc volume
residual (ADR 0015, `canonicalSwipeDocId`), which this very diff's own rule comment cites as precedent
for `movie_0`. Judged NON-BLOCKING: reported as informational, folded into the knowledge.md doc-id-alias
principle rather than filed as a ticket (would need Malin's read on whether the existing accepted
residual is worth revisiting at all — not a defect unique to this diff).

**Q3 — does the test prove WHICH null-return branch each case exits through?** Yes.
`runAggregate.test.ts`'s `it.each` skip-cases and the `movie_0`/`'603'` cases each assert
`log.warn.mock.calls[0][0]` contains the specific message (`'unparseable tmdbId'` vs `'unknown
mediaType'`), and the file's own header comment explains why the body deliberately omits `mediaType` so
only the id-guard branch is reachable for the namespaced garbage cases — verified this reasoning holds
by hand-tracing `aggregateDocId` for each fixture.

**Q4 — is the long comment block factually true against the code as it stands?** Traced every claim
against the diff and against `functions/src/shared/mediaTypeDocId.ts` and `functions/src/
communityRatings/logic.ts`. All confirmed: path-prefix-wins-body-only-for-legacy; strict-digit parse
behavior (`movie_`/`movie_1_2` → NaN, not the `Number('')===0` phantom); the legacy bare-numeric branch
still derives the id from the PATH and canonicalises through the "other door" (`ev('042','movie')` →
`movie_42`, pinned by test); `ratingDelta`'s 4→5 edit genuinely producing `countDelta: 0` (confirmed
against `logic.ts`); the `movie_0`-stays-creatable / aggregate-skips-it pairing matches the rules diff
and its own test. The ONE known imprecision (`firestore.rules`' "WatchlistContext is the sole writer" —
`nextAirReadRepair.ts` also writes, update-only via `batch.set(..., {merge:true})` onto pre-existing
docs) was pre-identified as already found/filed; re-confirmed it's still true and did NOT re-file it.

**Accepted-deviations check.** BIN-915's swallowed-transaction accept covers this exact file's `catch`
block (unchanged by this diff) — not re-flagged. Tillsammans anon-vote/session-expiry accepts are
unrelated to this surface.

**PoC / mutation status.** `aggregateDocId` is a pure function with 10 unit-test cases covering every
branch pairwise (canonical unchanged, alias-collapse, legacy-both-doors, four garbage NaN shapes, zero,
unknown-mediaType, and the anti-spoofing case). The paired rules guard (`canonicalWatchlistDocId`) has a
live-emulator suite in `firestore-rules.test.ts` (10 `it.each` denial cases sharing the exact alias table,
plus create-vs-update grandfathering and a "canonical id doesn't excuse an invalid body" additive-guard
check) — did not re-run the emulator suite this round (no code changed there since the file was already
read in full and traced by hand against the rule text), relying on Read + hand-trace, consistent with
"an unchanged file the diff depends on is exempt from re-reading, never from re-derivation."

**New knowledge folded in place** (not appended raw): extended the existing "A LOOSE doc-id parser makes
ALIASES collide" bullet in knowledge.md with the length-cap/float-precision variant above — same failure
family (parser/writer mismatch → alias collision), new mechanism (unbounded digit count rather than
padding), so merged rather than added as a new bullet, and the file was trimmed elsewhere (~600 chars) to
stay under the 30k cap.

**REVIEW-VERDICT: pass (0 blocking)**


### 2026-08-19 — BIN-766 comment-only re-read: firestore.rules / runAggregate.ts (prose-truth check, not a new code review)

**Context.** Two prior passes on this staged diff both returned `pass (0 blocking)` (see the gap-fill
entry immediately above). Since the second pass, only comment text changed in both files — verified this
myself: `git diff HEAD -- firestore.rules functions/src/communityRatings/runAggregate.ts` shows the entire
delta confined to comment lines (the corrected writer list on `canonicalWatchlistDocId`, the new
cross-reference paragraph on `canonicalSwipeDocId`, and the `AggregateOutcome` header note); `aggregateDocId`,
`runCommunityRatingAggregate`, `canonicalWatchlistDocId`'s regex, `canonicalSwipeDocId`'s regex, and the
`allow create`/`allow update` clauses are byte-identical to what the entry above already reviewed and traced
line-by-line. No mutation probe needed — nothing executable moved.

**Claim 1 — three writers, verified against the tree, not the comment.** Ran a repo-wide grep for the
literal `'watchlist'` collection segment (135 files touch the word; narrowed to actual `doc(db, 'users',
uid, 'watchlist', …)` write call sites) and separately grepped `fsdb()|setDoc|updateDoc|writeBatch` inside
every component the grep flagged as a plausible direct writer (`StatusButton.tsx`, `QuickAddButton.tsx`,
`OnboardingFlow.tsx`, `QuickRateModal.tsx`) — all empty, confirming they go through `useWatchlist()` →
`WatchlistContext.tsx`, not a bypass. Production write sites to `users/{uid}/watchlist/{itemId}` are
exactly three: `WatchlistContext.tsx` (multiple `batch.update`/`setDoc(...,{merge:true})`/`deleteDoc`, all
keyed `mediaTypeDocId(mediaType, tmdbId)`), `nextAirReadRepair.ts:172` (`batch.set(...,{merge:true})`,
`NextAirUpdate.tmdbId: number` confirmed at :57), `backfill.ts:74` (`updateDoc` on `d.id` — reuses an
existing doc's own id, never reaches create). CSV import (`app/settings/import/page.tsx`) is NOT a fourth
writer — it calls `upsertTitle` (`useWatchlist()`), i.e. the same `WatchlistContext.tsx` door, confirmed by
`buildAddPayload.ts`'s own header ("WatchlistContext's two add entry points — upsertTitle (bulk) and
logViewing"). Group watchlist writes (`groups/{id}/watchlist/...`, `src/lib/firebase/groups.ts`) are a
different collection, out of scope for this rule. No fourth writer found — the corrected comment is TRUE
and, as far as a full-repo grep can establish, COMPLETE. The claim it replaced ("WatchlistContext is the
sole writer") was genuinely false, matching what the entry above had already flagged as a known imprecision.

**Claim 2 — regex twin.** `canonicalWatchlistDocId` (firestore.rules:299) and `canonicalSwipeDocId`
(firestore.rules:882) both read `id.matches('^(movie|tv)_(0|[1-9][0-9]*)$')` — byte-identical, confirmed by
Read, not diff. Cross-reference is bidirectional: the watchlist comment names `canonicalSwipeDocId` "in the
sessions block below" (line 297), and the swipe comment names `canonicalWatchlistDocId` "i
users/{uid}/watchlist/{itemId}-blocket ovan" (line 875-876) — both point at BIN-797 as the ticket that will
need to touch both if `movie_0` narrows.

**Claim 3 — `AggregateOutcome`'s `skipped-unknown-media-type` covering two null paths.** Judged
non-blocking. This is a distinct code path from the one BIN-915's accept governs: `aggregateDocId`'s two
null returns are a deliberate early-exit `log.warn` before any transaction opens (garbage/legacy id
shapes), not the transaction `catch` block BIN-915 discusses (which logs `log.error` and returns `{kind:
'failed'}`). The two reasons ARE already distinguishable — by the `log.warn` text, which the new comment
explicitly flags as load-bearing and warns not to remove, the same posture BIN-915 already takes toward its
own `logger.error` line. A hypothetical regression that made `parseTmdbIdFromDocId` return NaN for every
real id would indeed silently zero out the aggregate under this one label — but that is a pre-existing
property of code already reviewed and passed in the entry above (Q3 there confirmed the log text, not the
union member name, is what a test can key on), not something this comment-only diff introduced or
concealed; the comment if anything makes the collapse MORE visible than the previous, incomplete comment
did. Not filed as a ticket — informational only, folded nowhere in knowledge.md since it does not change
what any future review should check (the log-text-is-the-signal principle is already captured under
"Admin-SDK sweeps and scheduled writers").

**Accepted-deviations check.** Re-read `.claude/rules/accepted-deviations.md` in full this round. BIN-915's
scope paragraph ("this accept reaches `communityRatingMaintain` and nothing else") covers this file's
`catch` block, unchanged by this diff — not re-flagged. Tillsammans anon-vote/session-expiry entries
unrelated to this surface.

No blocking findings. No new failure class — this round exercised "verify a corrected comment against the
tree by grep, not just against the diff" and "distinguish a deliberate early-exit skip from the swallowed-
transaction class an accepted deviation actually names", both already covered by the existing "An
attestation is a load-bearing claim" and BIN-915-scope principles.

**REVIEW-VERDICT: pass (0 blocking)**

## 2026-08-19 — BIN-766 writer-inventory paragraph, round 4: comment-only, verified by grep against the whole tree

**Scope.** `firestore.rules` staged blob 559b867 vs the security-reviewer's last-reviewed blob
5a294ae (from `review-ledger.jsonl`). Diffed the two blob objects directly (`git cat-file -p
<sha> > file`, `git diff --no-index`) since the working tree already held the staged content and
`git diff --cached`/`git diff` both showed nothing useful for "since my last pass". Confirmed: the
delta is confined to the `canonicalWatchlistDocId` writer-inventory paragraph, prose only — no
line outside a `//` comment changed. Rule text (`canonicalWatchlistDocId`'s regex, the `allow
create`/`allow update` clauses, `canonicalSwipeDocId`'s twin comment) is byte-identical to the
prior reviewed version.

**Independently re-derived the inventory instead of trusting the paragraph's count**, per the
dispatching agent's own admission that this paragraph had been wrong three times running (false
"sole writer"; false "all three build via mediaTypeDocId" when backfill.ts builds none; a fourth
draft still needed the read-site carve-out). Grepped every write verb (`setDoc`/`updateDoc`/
`deleteDoc`/`batch.set`/`batch.update`/`batch.delete`/`addDoc`/`writeBatch`) against every
non-test file mentioning `'watchlist'`, excluding `watchlistTags`/`watchlistNotes`
(different collections) and `groups/{id}/watchlist` (different collection, different rules
block — the task explicitly warned not to conflate it). Result:

- `src/contexts/WatchlistContext.tsx` has **five** call sites building a watchlist doc id via
  `mediaTypeDocId()`, not one: `writeTitle` (:683, the true create — `setDoc(...,{merge:true})`
  on a doc that may not exist), `setRuntime` (:960), `refreshTmdbFields` (:1005), `updateNotes`
  (:876) — all `setDoc(...,{merge:true})`, technically create-capable — plus `removeItem`'s
  `deleteDoc` (:1015) and two `batch.update` migration sites (:555, :616). The paragraph
  collapses all of this to "WatchlistContext.tsx — the create path", which is accurate only at
  MODULE granularity (one file, one canonical id-builder used everywhere in it) and would be
  wrong if read as a call-site count. It does not overclaim a count anywhere in its actual
  wording (it never says "one call site" or "the only write"), so this is not a fourth factual
  error — but it is the shape the first two errors took, and a future editor tightening this
  paragraph must not "fix" it into an explicit single-call-site claim without re-grepping.
- `src/lib/watchlist/nextAirReadRepair.ts:172` — confirmed `batch.set(...,{merge:true})`,
  `tmdbId: number` at :57, matches the comment exactly.
- `src/lib/taste/backfill.ts:74` — confirmed `updateDoc(doc(...,d.id), update)`, `d.id` read off
  an existing `getDocs()` snapshot, builds no id. Matches.
- `src/hooks/useFriendsWhoSaw.ts:59` — confirmed `getDoc`, read-only. No second read-site found
  building a watchlist doc id (every other read in the tree uses whole-collection
  `getDocs`/`onSnapshot`/`collectionGroup`, never a constructed single-doc path) — so the
  comment's plural "Read sites build this id too" names only one because there is only one;
  loose plural phrasing, not a wrong count.
- `functions/src/**`: zero write verbs anywhere against a literal `'watchlist'` path outside
  `tmdbTosSweep/index.ts:124`'s `batch.update(db.doc(path), ...)` on paths already read via
  `scanPage`, and `communityRatings/runAggregate.ts`'s `tx.set(docId, ...)`, which targets
  `titleRatingsAggregate`, a DIFFERENT collection, not `users/{uid}/watchlist`. Confirms "no
  Cloud Function creates watchlist documents".

No rule-expression, helper-body or allow-clause change to review (comment-only, confirmed by
blob diff). No blocking findings. `.claude/rules/accepted-deviations.md` re-read in full;
nothing here touches Tillsammans anon-vote/session-expiry or any other listed entry.

No new failure class this round — this exercised "verify an attestation's claimed count against
the tree by command, at the granularity the claim is actually made at" (module vs call-site),
already covered by the existing "A number in prose is unverified" / attestation principles. Not
folded into knowledge.md; nothing here changes what a future review should check that isn't
already written down.

**REVIEW-VERDICT: pass (0 blocking)**

### 2026-08-24 — BIN-797: the two `_0` doc-id guards narrowed (staged review, HEAD 9b23aeb)

**Diff.** 6 staged files. `firestore.rules` narrows BOTH copies of the canonical doc-id guard,
`^(movie|tv)_(0|[1-9][0-9]*)$` → `^(movie|tv)_[1-9][0-9]*$`: `canonicalWatchlistDocId` (def 332,
call 362) and `canonicalSwipeDocId` (def 949, call 1065). Plus four comment strikes, two new
emulator tests, one new export test, one comment-only strike in `runAggregate.test.ts`, and a
regex sync in `.claude/rules/data-model.md`.

**Setup note that mattered.** `git show :<f> | md5sum` DIFFERED from `md5sum <f>` on
`firestore.rules` and `firestore-rules.test.ts`. Byte accounting before trusting `Read`:
`git show :<f> | sed 's/$/\r/' | md5sum` == disk md5 for both, i.e. exactly LF→CRLF, no lone CR.
A `tr -d '\r'` normalisation would have MASKED a lone CR — the BIN-891 / `--ignore-cr-at-eol`
trap. Reading the worktree was therefore reading the staged blob.

**Q1 — anything MORE permitted?** No. Char by char: `^` · `(movie|tv)` (alternation bound inside
parens) · `_` · `[1-9]` (excludes 0) · `[0-9]*` · `$`. New language = old minus `{_0}`, a strict
subset. The degrouping trap the plan named is genuinely absent: the numeric alternation is GONE,
not un-parenthesised, so the `^(movie|tv)_0|[1-9][0-9]*$` top-level-alternation widening cannot
occur. Reproduced all four of the author's greps: exact-new-regex = 2, old alternation = 0,
`id.matches('^(movie|tv)` = 2, and the guard-reference grep = 4 lines (2 defs + 2 calls), both
calls under `allow create`.

**Q2 — legitimate write denied?** No. Traced every writer.
- `writeTitle` / `buildAddPayload` — `tmdbId: number` from TMDB search/detail; TMDB ids start at 1.
- `nextAirReadRepair.flushNextAirWrites` — `batch.set(..., buildRepairPayload(...), {merge:true})`
  carries only nextAir* fields, so a create there was ALREADY denied by BIN-942's
  `requiredWatchlistFields` floor. No new denial.
- `backfill.ts` (`updateDoc`) and `cascadeVisibilityToItems` (`batch.update`) cannot create.
- `recordSwipe` (sessions.ts:128) — the decisive one. Its `tmdbId` comes from the swipe DECK, and
  `candidates.ts` builds the deck from `discoverMovies`/`discoverTV`; the library supplies only
  `libraryExclusionIds`, an EXCLUSION set. So a phantom `movie_0` row already sitting in a library
  can never seed a swipe create. This was the one path where a pre-existing phantom could have
  produced a legit-looking create, and it is closed by construction.
- Functions touch `watchlist` only via `collectionGroup(...)` READS (Admin SDK bypasses rules
  anyway). No client-SDK writer outside the files above.

**Q3 — owner locked out?** No, structurally: `allow read, delete: if isOwner(uid)` (257–258) and
`allow update` (365) never reference the guard; swipes `read: if true` (1060), `update` (1078),
`delete` host-only (1085) likewise. Verified no `allow read/update/delete` references either
guard. `removeItem` (WatchlistContext:1332) builds `mediaTypeDocId(mediaType, tmdbId)` and
`docToItem` yields `tmdbId: 0` / `mediaType: 'movie'`, so it targets `movie_0` correctly — a
grandfathered phantom stays self-service deletable. The two new tests seed via
`withSecurityRulesDisabled` (correct — a live seed would be refused by the very guard) and pin
update + delete (watchlist) and a new anon-slot vote key (swipes).

**Q4 — erasure/export blocked?** No, and both are now pinned. `collectDeletionRefs` does
`snaps.watchlistSnap.docs.forEach(d => refs.push(d.ref))` — a REF off the snapshot, never a
re-derived id; `toExportDocs` does `{ id: d.id, data: d.data() }` — raw passthrough. Both claims
in the new comments verified against the unchanged source. The new `account-deletion.test.ts`
case is a real emulator run against the real cascade, seeded like the existing 460-doc chunk test
(minimal `users/{ME}` + the doc), so `runDeletion()` is satisfied.

**Q5 — comments.** The four false sentences are STRUCK, not reworded (correct). The one NEW
substantive claim — "`docToItem(d.data())` never sees the doc id, it reads `data.tmdbId`, so such
a document rendered as an ordinary library item" — is TRUE: WatchlistContext:538 is
`snap.docs.map(d => docToItem(d.data()))` and :122 is `tmdbId: data.tmdbId as number`. That
corrects the ticket's own premise (the phantom was NOT unreadable), so the tightening is better
motivated than filed. No added sentence claims the phantom-id-0 CLASS is closed (plan B6
honoured); a grep of BIN-797 mentions for "creatable"/"still permits" returns nothing.

**Numbers I recounted, and how.**
- "fem andra samlingar nycklade med mediaTypeDocId() har ingen doc-id-spärr alls"
  (firestore.rules:947-948). CORRECT. `grep -rn "mediaTypeDocId(" src | grep -v test`, plus
  resolving the two `const docId = …` indirections at WatchlistContext:980 (`watchlistNotes`) and
  :1044, gives seven CLIENT-WRITABLE collections keyed this way: `watchlist` + `swipes` (guarded);
  `watchlistTags`, `watchlistNotes`, `episodeProgress`, `notInterested`, `groups/{id}/watchlist`
  (unguarded) = 5. Matches the plan's own explicit enumeration under B6. Three more collections
  are keyed by mediaTypeDocId at READ sites only — `titleRatingsAggregate`, `priceHistory`,
  `streamingOffers` — all `allow write: if false`, so "no doc-id guard" there is vacuous. Recorded
  here rather than filed: the sentence is true and panel-measured, and adding a parenthetical
  would carry a NEW unmeasured claim.
- "the file carries no one-digit id at all" (firestore-rules.test.ts:400). **FALSE.** Its twin at
  :1616 says "the block", and the same commit added `tv_1` at :1618 — so removing line 403 leaves
  a one-digit id in the file. Measured: single-digit canonical ids in that file are `movie_1` once
  (403) and `tv_1` once (1618). The CONCLUSION survives — `canonicalWatchlistDocId` and
  `canonicalSwipeDocId` are two SEPARATE functions, so `tv_1` pins neither the other's `*`→`+`
  slip — which is exactly why only a grep catches the premise. Filed non-blocking: strike the
  clause, or align the scope word to the twin's "the block" (directly readable, no counting, so
  in-place correction is allowed under the strike rule).
- "TMDB numbers titles from 1" — a fact, not a count; consistent with `resolveTmdbId`'s
  long-standing `> 0` field branch and `CANONICAL_TMDB_ID = /^[1-9][0-9]*$/`.

**Q6 — scope.** Leaving `functions/src/shared/mediaTypeDocId.ts` alone is right: it is the SERVER
READ side, and per the plan #4 measured that `resolveTmdbId(0, 'movie_0')` still returns 0 there,
feeding six server readers. That residual is unchanged by this diff (it concerns docs that already
exist) and is BIN-624 half 2 — tightening it here would change how six readers resolve
grandfathered docs, a different blast radius. `mediaTypeDocId.parity.test.ts` imports the two
helper modules and never reads `firestore.rules`, so it observes nothing this diff changes;
correctly untouched.

**Mutation.** Not re-run (brief forbade it; sibling reviewers active). The author's control —
old regex restored → exactly 4 red, the four new `_0` denials, 342 others green; restored →
346/346 — is the right shape (it isolates the ONE clause and names the exact expected set).
DERIVED, not reproduced. The `*`→`+` argument holds by inspection: `[1-9][0-9]+` needs ≥2 digits,
so `movie_1` and `tv_1` would each fail their `assertSucceeds`.

**Deploy.** Rules-only diff — no client source changed — so `deploy.yml` (hosting-only) ships
nothing here and `firebase deploy --only firestore:rules` is required MANUALLY. Order is free in
both directions: no new client code depends on the rule, and the tightening denies nothing the
old running client emits (Q2). Plan E3 already gates the command on Malin's explicit yes.

**Rejected as findings.** (a) The `movie_1`…`movie_999999` junk-doc VOLUME residual — unchanged,
still correctly described at firestore.rules:923-926, ADR 0015. (b) Server-side `resolveTmdbId`
permissiveness — BIN-624 half 2, named in the plan. (c) The export test mutating the shared
`collectUserDataSnapshots` mock after `beforeAll` — order-fragile, but no later test in the file
calls `buildUserExport`; nit, not a finding.

**Verdict: pass (0 blocking), 1 non-blocking.**

### 2026-08-24 — BIN-797 r2 (re-review at HEAD 9b23aeb): the corrected scope word is the next falsehood

Re-review after three fixes landed on the staged diff I passed in r1. Brief said my ledger coverage was
stale. Re-`Read` all six files: `firestore.rules`, `src/test/rules/firestore-rules.test.ts`,
`src/test/rules/account-deletion.test.ts`, `src/lib/firebase/dataExport.coverage.test.ts`,
`functions/src/communityRatings/runAggregate.test.ts`, `.claude/rules/data-model.md`. Tree stable across
the whole window (md5 of all six identical at start and end; `git status --porcelain` unchanged;
HEAD 9b23aeb throughout). Staged blob == worktree modulo trailing CR only, proven properly: raw md5
differed by exactly 1378 bytes on `firestore.rules` and 2480 on the test file, which equal each file's
LINE COUNT, so every CR is trailing and there is no lone CR (a `tr -d '\r'` normalisation would have
hidden one; the line-count identity does not).

**Change 1 — my r1 non-blocking finding was "fixed", and the fix is false in two new ways.**
r1: `firestore-rules.test.ts:400` said "the file carries no one-digit id at all" while its twin at :1616
said "the block", and the same commit's `tv_1` at :1618 falsified the file-scoped one. r2 aligned the word
to "the block" in both copies. Measured at HEAD, both halves of the sentence are now false:

- *Premise.* Node scan of each `describe` block's id literals: BLOCK1 (lines 391-587) one-digit ids =
  ["movie_1","movie_0","tv_0"]; BLOCK2 (1608-1686) = ["tv_1","movie_0","tv_0"]. THREE each, not zero —
  `movie_0` and `tv_0` were added to the same block's `it.each` denial table, twenty lines below, by this
  very commit (:422-423, :1637-1638). A one-digit id is a one-digit id whether the row asserts success or
  failure, and the sentence says "at all".
- *Consequent.* "would ... still pass 100% of this suite" is false for the ONE-line removal the sentence
  describes. Read-only `node -e` probe of old / new / slip regexes over 20 fixture ids: `movie_1` and `tv_1`
  are the ONLY two whose verdict moves under `[0-9]*`→`[0-9]+`, one per block. Delete :403 alone and :1618
  still reddens; the suite does NOT pass 100%. Both lines must go. This matches, and re-reads, the author's
  own mutant-B measurement ("exactly 2 red, one per block") — the measurement was right, the sentence
  drawn from it was not.

Filed NON-BLOCKING with the remedy STRIKE, not re-word: this clause has now been re-worded once and the
re-word carried two fresh unmeasured claims. A third pass would carry a third. Proposed surviving text
needs no counting: "BIN-797: the SINGLE-DIGIT boundary — a `*`→`+` slip in the regex would reject every
title numbered 1-9." Drift risk if left: a maintainer checking the comment's premise finds `movie_0`/`tv_0`,
reads it as satisfied, and deletes the only positive single-digit pin in that block.

**Change 2 — the struck "fem andra samlingar" sentence. Nothing load-bearing lost. Verified, not assumed.**
Former `firestore.rules:947-948`. r1 I counted it CORRECT (5 client-writable collections); the test reviewer
counted the same sentence true only under an unstated "client-writable" qualifier (8 by its literal wording).
We disagreed about the SENTENCE, not the code, so the strike rule decides and the strike is right.
Checked what went with it: (a) the half that restated "Gäller BARA create" survives at :927 with both
numbered reasons intact at :928-934; (b) `grep -rn "fem andra"` across the tree returns only the two
knowledge ARCHIVES (append-only audit records — the correct home for it); (c) the surviving block reads
without a dangling connective (624-rationale, form-not-volume, create-only + 2 reasons, sole writer, twin
note, function). The sentence asserted nothing about THIS rule's guarantee — it was context about other
collections — so no security claim was removed. Not a finding.

**Change 3 — `mockResolvedValueOnce`.** Closes my r1 nit (c). Order verified: `beforeAll` sets the
persistent `mockResolvedValue` and calls `buildUserExport` before any `Once` is queued; the new test queues
one `Once`, consumes it, and every later test falls back to the shared fixture. Correct, and the comment
says exactly that.

**r1 security conclusions re-derived on the new bytes — all hold.**
- Q1 counts re-run: the new-regex grep = 2, the old-regex grep = 0, the prefix grep = 2. Guard references
  resolve to 2 defs (:332, :946), 2 calls (:362, :1062) and 3 prose mentions (:269, :330, :940).
- (a) Strict subset: probe says new is a subset of old over the whole fixture set, and the ONLY ids old
  accepts that new rejects are `movie_0` and `tv_0`. No DEgrouping slip (`_0|[1-9][0-9]*` would bind
  alternation at top level and go wider; the shipped regex keeps `(movie|tv)` grouped and the digit part
  unparenthesised).
- (b) Both calls sit under `allow create` only. `allow read, delete: if isOwner(uid)` (:258) and
  `allow update` (:365) never reference the guard; swipes `read: if true` (:1057), `update` (:1075),
  `delete` host-only (:1082) likewise. A grandfathered `_0` doc stays readable, editable, erasable —
  now PINNED live by the two new grandfather tests (:447, :1666) instead of argued.
- (c) No client id builder can emit `_0` on a create. `mediaTypeDocId` template-literals a `number`;
  `docToItem` (WatchlistContext:118) reads `data.tmdbId`, never the doc id, and :538 is
  `snap.docs.map(d => docToItem(d.data()))` — so the new comment's premise-correction is TRUE, and the
  phantom really did render as an ordinary row. `recordSwipe` (sessions.ts:128) builds from the deck, not
  the library.
- Q4 export/erasure re-verified at source, not from r1: `toExportDocs` (dataExport.ts:117-122) is
  `{ id: d.id, data: d.data() }` — raw passthrough; `collectDeletionRefs` (accountDeletion.ts:62) is
  `snaps.watchlistSnap.docs.forEach(d => refs.push(d.ref))` — a snapshot ref, never a re-derived id.
  `parseTmdbIdFromDocId` returns NaN for `movie_0` (`CANONICAL_TMDB_ID = /^[1-9][0-9]*$/`,
  mediaTypeDocId.ts:78), so the client reader really does have the hole the two new tests say the
  export/erasure does not. `removeItem` (WatchlistContext:1332-1341) builds `mediaTypeDocId(mediaType, 0)`
  = `movie_0`, so self-service delete reaches it.

**Numbers in added text I re-counted, and with what.**
- "the block carries no one-digit id at all" (x2) — node block scan gives 3 per block. FALSE (the finding).
- "still pass 100% of this suite" (x2) — node regex probe: only 2 ids move, one per block. FALSE.
- "every title numbered 1-9" — `[1-9][0-9]+` needs two or more digits. TRUE.
- "the two are deliberate copies" / "smalnade av `_0` i båda samtidigt" — guard-reference grep, 2 defs. TRUE.
- "the grandfather test above only covers '603'" (:446) — read :433-440, one id. TRUE.
- data-model.md's regex "sedan BIN-797" — byte-identical to `firestore.rules`. TRUE.
- Pre-existing "The 35 fixtures in this file" (:378) — UNTOUCHED and unaffected: the diff swapped
  movie_0 for movie_1 and movie_0 for tv_1 and added movie_0/tv_0 rows, none of which are bare-numeric.
  Checked precisely because a stale count sitting next to a diff is the trap.
- ":1621 must stay a SUPERSET of `ALIASES_OF_42`" — the 5 aliases are all present; and the two alias tables
  are identical row-for-row (12 each), so the ":408 kept identical on purpose" claim survives the two
  added rows.

**Deploy.** Rules-only; `deploy.yml` is hosting-only, so `firebase deploy --only firestore:rules` is MANUAL.
Order free both ways: no new client code depends on the rule, and the tightening denies nothing the
currently-running client emits.

**Verdict: pass (0 blocking), 1 non-blocking (strike the mutation-justification clause in both copies).**

### 2026-08-24 — BIN-797 r5 (final): three strikes verified, nothing load-bearing lost

Re-review at HEAD `9b23aeb`, BIN-797 staged (not committed). Prior round: pass (0 blocking). Brief said three
pure strikes had landed since, invalidating my ledger coverage of `firestore.rules`.

**Staged-blob alignment first.** `git show :<path> | md5sum` differed from `md5sum <path>` on
`firestore.rules` and `firestore-rules.test.ts`. NOT a sibling edit: CR count == line count on both (1378,
2478), and `tr -d '\r' | md5sum` reproduced the index blob byte-for-byte. Pure CRLF, no lone CR. What I Read
IS the staged blob. Worth keeping as the standard second step after the md5 mismatch, or a CRLF worktree reads
as a contaminated one.

**Counts I recomputed (command → result), not transcribed:**
- `grep -Fc "id.matches('^(movie|tv)_[1-9][0-9]*$')" firestore.rules` → 2 ✓
- `grep -c "(0|\[1-9\]" firestore.rules` → 0 ✓ (old grouping gone from both copies)
- `grep -n "movie|tv" firestore.rules` → only 333 and 947, i.e. no third copy ✓
- `grep -c "inledande nolla" firestore.rules` → 0 ✓; `grep -c "Art. 15" dataExport.coverage.test.ts` → 0 ✓
- guard references: `canonicalWatchlistDocId` used once (line 362, `allow create`); `canonicalSwipeDocId`
  once (line 1062, `allow create`). No `allow read/update/delete` reference → grandfathered `_0` docs stay
  readable, editable, ERASABLE (Art. 17) ✓

**Mutation counts re-derived WITHOUT re-running.** Only 2 of the 6 `src/test/rules/*.test.ts` files load the
real `firestore.rules` (`firestore-rules.test.ts`, `account-deletion.test.ts`); the other four boot an inline
`OPEN_RULES` const and are immune to any rules mutant. So:
- Mutant B (`*`→`+`): the suite holds `movie_1`×14, `movie_2/3/4/5`, `movie_9` — but every one except
  `firestore-rules.test.ts:402` (`movie_1`, watchlist block) and `:1616` (`tv_1`, swipes block) lives in
  `tmdb-sweep-orchestrator.test.ts` under OPEN_RULES. Expected red = 2, one per block. Reported 2 ✓
- Mutant A (old regex restored): only the four `_0` denial rows can move (`movie_0`/`tv_0` × 2 `it.each`
  tables). Every other `_0` fixture is seeded `withSecurityRulesDisabled` and then UPDATED. Expected 4 ✓
That is the generalizable half: bound a rules-mutant's blast radius by which suites load the real rules
before believing any "exactly N red".

**The three strikes, each checked for lost cargo and for a new claim in what survived.**
1. `firestore.rules` BIN-624 header, `(ingen inledande nolla)` struck. Surviving main clause "KANONISKA
   siffror" is a SUPERSET term — it stays true once `_0` is also excluded, with nothing new to measure. This
   is the correct shape: the parenthetical enumerated a SUBSET of the exclusions, so it goes rather than
   getting re-enumerated. Rewording it ("ingen inledande nolla och inte 0") is what starts round six.
2. `account-deletion.test.ts`, `because "the erasure happens to not parse ids" is a property no test held
   before this one` struck — correctly, since the 450-op test seeds `m0`…`m459`, all unparseable, and the
   surviving sentence no longer claims uniqueness. What survives IS measurable and I measured it:
   `accountDeletion.ts:62` is `snaps.watchlistSnap.docs.forEach(d => refs.push(d.ref))`, and
   `grep parseTmdbIdFromDocId|mediaTypeDocId|Number(` over that file → NONE. `userData.ts`'s watchlist read
   is an unfiltered subcollection read (the `where(...)` queries are reviews/likes/comments/reactions/lists/
   sessions/groups). So "walks snapshot docs and their refs, never a re-derived id" holds, and "this pins it"
   is true without being exclusive.
3. `dataExport.coverage.test.ts`, `Art. 15` struck. Checked it was not the repo's only copy of a legal
   framing: zero `Art. 15` anywhere now, and `Art. 20` appears in 8 files including `docs/data-export-format.md`
   and `docs/data-retention-policy.md`. An outlier removed, not a framing lost. Surviving claims verified:
   `mediaTypeDocId.ts`'s `CANONICAL_TMDB_ID = /^[1-9][0-9]*$/` (so `parseTmdbIdFromDocId` does reject
   `movie_0`, BIN-646), and `dataExport.ts:117-122` `toExportDocs` maps `id: d.id` straight through.

**Other added text audited for unmeasured absolutes.** `docToItem(d.data())` — `WatchlistContext.tsx:118`
takes `data` only, call site `:538` is `snap.docs.map(d => docToItem(d.data()))`, returns `data.tmdbId` ✓.
"the pin that reddens under it" ×2 — true per the mutant-B derivation above ✓. runAggregate.test's rewritten
"This floor is what stops it becoming a rating anyone counts" — `runAggregate.ts:172` is
`if (!Number.isFinite(tmdbId) || tmdbId <= 0)` ✓; a rewrite rather than a strike, but the true wording is
directly readable from the function under test and needs no counting, so it is inside the carve-out.
"recordSwipe är enda skribenten" (pre-existing) re-verified: `grep "'swipes'" src/ --include=*.ts*` gives one
write path, `sessions.ts:128`, with `tmdbId: number` (`:118`); the other three hits are a type ref, a
`getDocs` in the erasure cascade, and an `onSnapshot`.

**Prior-round conclusions re-derived on the new bytes.** (a) `^(movie|tv)_[1-9][0-9]*$` ⊂
`^(movie|tv)_(0|[1-9][0-9]*)$` — the suffix alternation was DELETED, not degrouped, so there is no top-level
alternation-binding widening; anchors intact. (b) create-only, no read/update/delete reference. (c) no client
builder can emit `_0`: both watchlist creators and `recordSwipe` pass `tmdbId: number` from TMDB (ids ≥ 1),
`resolveTmdbId`'s field branch has always required `> 0`, and BIN-942's floor now also requires `tmdbId` on
create. (d) export + erasure both pinned — erasure LIVE against the emulator, export via the mocked collector,
which is adequate because the live deletion test exercises the SAME `collectUserDataSnapshots` and proves it
returns the `movie_0` doc.

**Not re-raised (accepted deviations, re-read this run):** anon-vs-anon vote forgery, the missing
session-expiry gate, blocking-as-hygiene, create-only reports, the fail-open `effectiveVisibility` read, and
the 2026-08-20 create-floor entry (a raced merge denied on a canonical id is that entry's accepted cost, not
a BIN-797 regression). The junk-doc VOLUME residual (`movie_1`…`movie_999999`) is unchanged and still its own
ticket — the form guard was never a volume guard.

**Deploy.** Rules-only. `deploy.yml` is hosting-only, so `firebase deploy --only firestore:rules` is MANUAL;
recorded in `tasks/plan-bin797.md` E3 as gated on Malin's explicit yes. Order is free both ways: no new client
code depends on the rule, and the tightening denies nothing the currently-running client emits.
`docs/workflow-map.html` still quotes the old expression and is getting its own commit — known, not re-filed.

**Verdict: pass (0 blocking), 0 non-blocking.** The r4 non-blocking finding (strike the mutation-justification
clause in both copies) is discharged by strike 1.

---

### 2026-08-29 — functions/ TypeScript revert re-run (BIN-1051): pre-commit edits to an
"append-only" log row, and a claim re-verification

Re-run after my prior pass on this same `functions/` revert ended `pass (0 blocking)`. Between
passes the integration reviewer found two blocking defects in PROSE/metadata only — nothing in
`functions/` moved. Verified that directly rather than trusting the brief: `git diff --cached
--name-only -- functions/` still returns exactly `functions/package.json` and
`functions/package-lock.json`, no `functions/src/**`, no `functions/tsconfig.json`. `git
hash-object` on both matches the diff header's post-image blob (`1b0d132`, `a1f430a`) —
working tree and staged index agree, no drift introduced mid-review. Content: pure devDependency
revert, `typescript` `^7.0.2` → `^5.6.0`, lockfile resolves to `5.9.3` (`grep -n
'"node_modules/typescript"' -A2` confirms), zero residual `7.x` typescript entries, only the
`@typescript/typescript-*` platform-native optional deps removed (fewer native binaries in the
lockfile, not more attack surface). No secrets, no runtime dependency touched, no functions
logic touched — lowest-risk shape a `functions/` change can take.

**Question raised by the dispatcher: does editing a row in `docs/org/metrics/events.jsonl`
twice before its first commit violate the file's "append-only, never rewrite past lines"
contract?** Ruling: no. The contract (README + `check_events.mjs`'s whole `correction` design)
protects the SHARED, COMMITTED git history — the scenario it was built for (BIN-918) is four
rows that had already reached a commit and were read by someone before being found false. A row
that has never been committed has never been a fact anyone could have observed or relied on;
there is nothing yet to retire. `check_review_coverage.mjs`'s own commit-msg hook reads the log
from the INDEX, not the commit history, which already treats "staged" as the operative unit
for the gate — but that is about visibility to the gate, not about immutability. Editing a
staged-only line to fix its `ticket`/`timing` before it is ever committed is ordinary drafting,
not a rewrite of history; a `correction` row would be the wrong tool here (it exists to retire a
row that already misled a reader, and this one never did). Re-open this ruling if a future
row is edited AFTER it has been committed and pushed — that is the case the existing mechanism
already covers, unambiguously, with a `correction` row.

**Re-verified the row's own claims rather than transcribing them:**
- `must_haves: 3` — counted three numbered conditions under `**BIN-1051 —
  #25 …**` in `tasks/todo.md`'s newly-added block. Matches.
- `timing: "pre-commit"` — is an EXISTING spelling in the log (`grep -o '"timing":"[^"]*"'
  docs/org/metrics/events.jsonl | sort -u` → 7 distinct spellings including `pre-commit`), and
  it is the true one here: `functions/package.json`/`package-lock.json` mtimes are
  `2026-08-29T05:41Z`, the row's `ts` is `05:54:56.398Z` (code already written, review ran
  before the commit that doesn't exist yet) — consistent with "pre-commit", not "pre-build"
  (which would require the review before the first edit).
- `ran: true`, `outcome: "support"`, `panel: [25]` — match `tasks/todo.md`'s own account ("Alla
  tre uppfyllda. #25 blockerade inte.").
- `claimsReachedMain()` (from `check_events.mjs`) does not fire on this row — no
  committed/pushed/shipped language in `plan`/`note`, and `outcome` isn't `SHIPPED_OUTCOME` — so
  the row asserts nothing about main it can't yet back up.

**README.md's three claimed prose fixes, all confirmed against the actual diff:**
1. The false "Three values are live" enumeration of `timing` (a stale, unmaintained list) is
   struck and replaced with a derive command, matching the sibling `via` cell's phrasing.
2. The pipe inside that new command is escaped `\|`, so it can't split the GFM table row —
   matches the neighbouring `via` cell's existing escape.
3. `SKILL.md:125` (a cross-repo line number, unpinned and therefore guaranteed to go stale) is
   struck down to the bare filename `SKILL.md`, per the strike-not-reword rule for a number that
   needs measuring to stay true.

**Not independently re-run this pass:** `npm ci && npm run build` inside `functions/` (BIN-1051
AC1's literal claim). Module resolution is consistent with success (typescript resolves cleanly
to 5.9.3, no version conflict in the lock), and re-running a full build was judged out of scope
for a security seat re-verifying prose fixes on unchanged code — flagged here rather than
silently skipped. BIN-1050 (the named follow-up ticket for a `functions/` typecheck step in
`pr-checks.yml`'s `quality` job) could not be confirmed to exist from this seat — no ticket-
tracker tool available here; a process claim, not a code-security one.

**Verdict: pass (0 blocking).**

### 2026-09-05 — BIN-1088 r3: fail-open read fixed and mutation-proved; struck claim survives in a sibling file

Re-review of BIN-1088 (the dependency-diff check on Dependabot's PR path, `scripts/check-dependency-diff.mjs`
+ `.github/workflows/pr-checks.yml`). Prior round (r2, not run by me) ended `fail` on two blocking findings:
(1) `readManifest` decided presence by catching a failed `git show`, which collapses "no such path" and "the
read broke" into the same green answer on the head side — exactly the fail-open the check exists to prevent;
(2) the script's own header and `tasks/todo.md`'s twin asserted "Dependabot cannot touch workflow files",
which is false — `.github/dependabot.yml` runs a `github-actions` ecosystem block (monthly, `directory: "/"`)
that opens PRs bumping `uses:` pins in workflow files.

**Finding 1, verified fixed by mutation.** `readManifest` now decides presence by `git ls-tree --name-only`
(empty output = genuinely absent, anything else = throw) and reads via `git show` with nothing caught. Two
new tests: one drives the exact reproduction (ls-tree says present, `git show` throws, assert exit 1 and no
"OK" in the output), one drives the presence branch through `readManifel` itself. I applied the mutation
`const listed = git([...]).trim()` → `const listed = path;` (presence always true) on the staged blob
(worktree hash `bbde4e21eed0ccd2eef30890da3e0d2db3d5d49c`, matched `git rev-parse :scripts/check-dependency-diff.mjs`
before mutating). Result: `19/19` → `1 failed | 18 passed (19)`, the single failure being
`readManifest reports absent for a path the ref does not hold` — the new presence-branch test, exactly as
claimed. Restored from a scratchpad snapshot; `git hash-object` back to `bbde4e2...`, `grep -c MUTANT` → 0.
`npx vitest run scripts/check-dependency-diff.test.mjs --no-cache` re-run clean at 19/19 after restore.

**Finding 2, only PARTIALLY fixed — new blocking finding.** `tasks/todo.md`'s "Vad checken inte gör" section
was corrected: it now says the `github-actions` bumps "kommer in via samma serversidiga merge, och den här
checken tittar inte på dem. Det som begränsar dem idag är att jobbet håller `contents: read` och inga
hemligheter, inte en granskning" — verified true against `.github/dependabot.yml` (the ecosystem block exists)
and `.github/workflows/pr-checks.yml` (`permissions: contents: read` at the job level, no other permissions,
no secrets referenced in any step). But the IDENTICAL false sentence from r1/r2 — "Dependabot cannot touch
workflow files, so reaching that bypass takes exactly the hand-driven commit the local gates already cover."
— is still live in `scripts/check-dependency-diff.mjs` lines 26–28, inside the file's own header JSDoc, in
the second "WHAT IT DOES NOT DEFEND AGAINST" bullet (the one about a PR editing both the check and the
manifest in one commit). A single-line `grep -rn "Dependabot cannot touch workflow"` across the repo found
NOTHING, because the sentence wraps across three comment lines in the script and across a different line
break in `tasks/todo.md` — only a multiline-aware search (`grep -P` with `\n?\s*\*?` between the words, or
just reading the file) surfaces it. This is the exact copy-drift class the lessons digest names repeatedly
(BIN-1040/1002/1038: "en strykning i en commit lämnar kopian i nästa commit stående") — here it crossed a
ROUND boundary, not a commit boundary: the plan doc was corrected, the shipped file's own comment describing
itself was not. Fix is to STRIKE, not reword — delete "Dependabot cannot touch workflow files, so reaching
that bypass takes exactly the hand-driven commit the local gates already cover." from the script header, and
either leave the bullet ending at "it is not new here" or fold in the same honest residual `tasks/todo.md`
now carries (contents:read + no secrets, not review, is what limits a hand-driven bypass PR).

**Also verified this round:** dead `DEP_BLOCKS` constant is gone from both `.mjs` files (grep, zero hits).
`npm test` → 276 files / 4644 passed / 4 skipped, matching the claimed state exactly. `npm run lint` → 0
errors (55 pre-existing unrelated `no-unused-vars` warnings). `node scripts/check-dependency-diff.mjs HEAD~1
HEAD` → exit 0, "OK" message, against real repo history. `docs/org/ownership-map.json` regenerated via
`node docs/org/gen-ownership-map.mjs` and diffed byte-identical against the staged copy (patternCount 544
confirmed, not transcribed). The new §4 Security Architect bullet in `docs/role-responsibilities.md` sits
under the correct numbered section (verified via `awk` header scan, not assumed from position). BIN-1080's
lesson about backtick-harvested directory tokens was correctly applied: the corrected §25 bullet no longer
lists `check-dependency-diff.*` by name in a bullet that doesn't own it, replacing the enumeration with a
pointer to §4 instead — avoids re-creating the exact backtick-ownership bug BIN-1080 was filed to fix.
`scripts/scripts-self-tests-present.test.mjs`'s `REQUIRED` gained `check-dependency-diff.test.mjs` and `MIN`
moved 4→5 in the same commit; `docs/org/route.mjs`'s `TOOLING_CODE_FILES` gained both new files in the same
commit as their `reviewGates` pattern (BIN-830 pairing, verified via `git diff` on both files together).

**reviewGates scope note, stated so it isn't re-litigated:** none of the ten staged paths in this batch
match `binge-security-reviewer`'s own `patterns` array in `.claude/shared-plugin.json` — the diff to that
array (adding `check-dependency-diff` to the tooling alternation) only touches `binge-integration-reviewer`'s
list, per `_note20`'s own design decision (seat chosen was integration + test, not security, for the
mechanical gate). This review is the supplementary security judgment `_note20` records as having already run
pre-build (`#4 Säkerhetsarkitekts blinda kritik`, event row ticket BIN-1088, panel `[4]`), not a re-run of a
gate this batch's files trigger.

**Verdict: fail (1 blocking) — the surviving "Dependabot cannot touch workflow files" sentence in
`scripts/check-dependency-diff.mjs` lines 26–28.**

### 2026-09-05 — BIN-1088 r4: the r3 finding is fixed; a mid-round restore had briefly re-broken it

Re-review of the same 12 staged paths (`git diff --cached --name-only`, run before starting). Cause of the
gap between r3's fail and this pass, as relayed by the orchestrating session: the `tasks/todo.md` strike and
the `scripts/check-dependency-diff.mjs` strike were both applied, but a `cp` restore mid-round — taken from a
snapshot of the file from BEFORE either strike — silently reintroduced both, and only the `tasks/todo.md` half
was noticed and reapplied. So the finding was fixed twice, not once, and the loss was a self-inflicted restore
clobbering uncommitted work, not a missed grep. Folded into the knowledge file's Shared-checkout-hazard bullet
above, since the mechanism (a stale snapshot restore reverting a later edit with no error) generalizes beyond
this ticket.

**Verified fixed, read not trusted.** `scripts/check-dependency-diff.mjs` lines 17–32 (`Read` in full) no
longer contain "Dependabot cannot touch workflow files" in either English wording; the third
"WHAT IT DOES NOT DEFEND AGAINST" bullet now ends with the same residual `tasks/todo.md` carries — "What
limits that today is this job holding `contents: read` and no secrets, not a review" — verified true against
the staged `.github/workflows/pr-checks.yml` (`permissions: contents: read` at job level, no other permission
key, no `secrets.` reference in any step, `Read` in full) and the staged `.github/dependabot.yml` (`Read` in
full: the `github-actions` ecosystem block exists, `directory: "/"`, `interval: "monthly"`).

**Repo-wide sweep, whitespace-collapsed and multiline, per r3's own lesson:**
`git ls-files -z | xargs -0 -I{} sh -c 'tr -d "\r\n" < "{}" | grep -o "Dependabot cannot touch workflow
files[^\"]\{0,140\}"'` returns matches in exactly two files: `.claude/agents/binge-security-reviewer.knowledge.md`
and `.claude/agents/binge-security-reviewer.knowledge.archive.md` — both are this file and its sibling quoting
the struck sentence AS THE FINDING, in the r3 entry directly above and the paired principles bullet, which is
the correct place for a retired false claim to live (the strike-rule's own carve-out for `*.knowledge.md` /
`*.knowledge.archive.md`, never a bare delete). A second grep for a Swedish or reordered phrasing
(`dependabot.{0,80}(inte|cannot|never).{0,80}(workflow|arbetsflöde)`, both directions) returned nothing outside
those two files either. No live copy of the false claim remains anywhere in the tracked tree.

**Finding 1 (fail-open `readManifest`) re-mutation-proved, not re-grepped, per the re-review rule.** Snapshotted
the current worktree bytes to scratchpad immediately before mutating (hash `c99b489b9a2cb455070c06702b6ae145974e6d2f`,
matching `git hash-object scripts/check-dependency-diff.mjs` before the mutation). Applied the same mutation r3
used — `const listed = git([...]).trim();` → `const listed = path;` (presence branch always true) — and ran
`npx vitest run scripts/check-dependency-diff.test.mjs --no-cache` in the same step: `1 failed | 18 passed
(19)`, the failure being `readManifest reports absent for a path the ref does not hold`, matching r3's
reproduction exactly. Restored from the scratchpad snapshot; `grep -c MUTANT` → 0, `git hash-object` back to
`c99b489b...`, `git diff` against both the index and the worktree empty.

**Also verified this round, each by running the command rather than transcribing the prior entry:**
`npx vitest run scripts/check-dependency-diff.test.mjs` (post-restore) → `19/19` passed. Full `npm test` →
`276` files passed, `4644` tests passed, `4` skipped — matches r3's count exactly, re-run rather than assumed
stable. `node docs/org/gen-ownership-map.mjs --check` → exit 0, "ownership gaps: 0". Role ownership of the two
new files confirmed by loading `docs/org/ownership-map.json` and searching every role object, not just the
role r3 named: role `4` (Security Architect) is the only match for both `scripts/check-dependency-diff.mjs`
and its test. `docs/role-responsibilities.md`'s new bullet sits under `## 4. Security Architect` (`awk` header
scan, reproducing r3's method independently rather than trusting its stated result).

**Scope note repeated from r3, unchanged:** none of this batch's 12 staged paths match
`binge-security-reviewer`'s own `patterns` in `.claude/shared-plugin.json`; this review is the supplementary
judgment `_note20` records as already run pre-build, not a mechanical-gate re-run.

**No new finding.** The knowledge-file self-reference in the two `*.knowledge*.md` files is the correct
carve-out (quoting a retired claim as evidence, not restating it live) and is not itself flagged.

**Verdict: pass (0 blocking).**

### 2026-09-05 — BIN-1063 step 1 re-review: ghost-member self-heal claim is false for non-owner ghosts

**Trigger:** re-review of `firestore.rules`, `src/lib/firebase/groups.ts`, `src/lib/firebase/groups.test.ts`
after the push gate found the joinedAt pin (BIN-1063 step 1) breaks the two self-healing mid-states
(ghost member, reverse orphan) in both `joinGroupViaToken` and `acceptGroupInvite`. The fix under review
adds a shared `writeMemberDoc` (create with `joinedAt` when the member doc is absent, `{merge:true}`
omitting `joinedAt` when present) plus explicit ghost/reverse-orphan fall-through branches in both
callers, driven by four states: (uid∈memberUids, doc exists) finished→short-circuit; (uid∈memberUids, doc
absent) ghost→heal; (uid∉memberUids, doc exists) reverse orphan→heal via merge w/o joinedAt; (neither)
plain first accept.

**What held.** The rules half (`groups/{groupId}/members/{memberUid}`'s split create/update/delete with
`selfOrOwner()` + `joinedAt == request.time` on create + `get('joinedAt',null)` pinned unchanged on
update) is unchanged behaviourally from the prior pass — only a comment (a false quantifier replaced by a
derivation command) changed. `writeMemberDoc` is only ever called with `uid = params.uid` (the caller's
own authenticated uid) at both call sites, role hardcoded to `'member'` — no path lets it write or demote
another member. The merge branch omits `joinedAt` entirely, and Firestore's rules evaluate
`request.resource.data` for a merge as the full POST-merge doc, so the omitted field round-trips to its
existing value — `get('joinedAt',null) == get('joinedAt',null)` holds trivially; no forgery route to
backdate. The reverse-orphan and first-accept states genuinely work, confirmed by the emulator-backed
`firestore-rules.test.ts` additions (create/update/delete × owner/self × valid/backdated/future
`joinedAt`, 12 cases, both directions driven) and by re-deriving the update rule by hand.

**What did not hold — verified with a throwaway live PoC, not just a rules-trace.** For a GHOST member
(uid already in `memberUids`, member doc absent) who is NOT the group owner, both functions' "fall
through and let the write heal it" branch reaches
`updateDoc(groupRef, {memberUids: arrayUnion(existingUid), ...})` before ever calling `writeMemberDoc`.
Wrote `src/test/rules/_poc-ghost-arrayunion.test.ts` against the real `firestore.rules` (a temp
`firebase.json`-alike on port 8199 since 8080 was held by a sibling session — the digest's remedy for
that), seeded a group with `memberUids: [OWNER, 'other_uid']` and no `members/other_uid` doc, and called
`updateDoc` as `other_uid` with `arrayUnion('other_uid')`: **`assertFails`**, both with and without a
live `joinAttempts` doc present (control for the token-verified case). All four OR-branches of the
`groups/{groupId}` update rule require either `ownerUid == auth.uid` or a negative
`!(auth.uid in resource.data.memberUids)` — a ghost is already in that array, so none matches. Only an
OWNER-ghost heals (the owner branch has no such negative precondition). Deleted the PoC file and the
temp config before finishing, per the fold-in-place convention.

**Severity call.** Not exploitable — nothing new is granted, the write fails closed exactly as a stock
permission-denied. Not a regression in access control. It IS a false, unverified, security-adjacent
attestation, now baked into: the JSDoc above `writeMemberDoc` and the inline comments in both call sites
("Fall igenom och låt skrivningen läka det", the four-state table), AND a mocked unit test in
`groups.test.ts` (`expect(result).toEqual({ok:true})` for the ghost case) that can never catch this
because `vi.mock('firebase/firestore', ...)` stubs `updateDoc`/`setDoc` to always resolve — it asserts
call SHAPE, never rules outcome. Concretely: `joinGroupViaToken`'s reported reason for a ghost with a
genuinely valid token silently changed from the old, accurate `'already_member'` (immediate, no writes)
to the new, misleading `'invalid_token'` (after writing a throwaway `joinAttempts` doc) or `'transient'`
— worse UX, not worse security. `acceptGroupInvite`'s ghost behaviour is UNCHANGED end-to-end (same
uncaught throw at the same `updateDoc` call, before and after this diff) — the new already-member branch
never actually reaches a non-owner ghost; only the finished-membership short-circuit and the
reverse-orphan heal are real fixes. Rated blocking for THIS gate because the false claim is written into
comments and a positive test that future work (BIN-1063 step 3, the ownerless-group handover keyed on
`joinedAt`) will read as "ghost members always end up with a proper member doc" — they do not, for the
common non-owner case.

**Fix options given, not chosen for the reviewer to pick:** (a) strike the "heals"/"läks" claims in the
JSDoc, the inline comments, and the four-state table for the ghost row, and correct the mocked test's
expectation to match reality (or gate it behind an owner-uid fixture, which DOES heal) — cheapest, ships
the accurate part of the fix as-is; (b) actually close the gap by loosening the join/accept branches of
the `groups/{groupId}` update rule to also permit a true no-op `arrayUnion` (uid already present, array
otherwise identical) for the caller's own uid — a rules change, needs its own review before deploy, and
widens what "self or owner" can already-be-a-member-and-still-write, so should not be done without
tracing every other branch that leans on the current negative precondition.

**Not a re-flag of the accepted 2026-07-19 deviation** ("groups.ts membership-add rollback can strand a
late compensating write... self-locking, same-account-only, do not file without new facts"). That entry
covers a TOCTOU race on the rollback timing. This is a STRUCTURAL rule mismatch, independent of timing —
the ghost-heal branch is unreachable for non-owners on every attempt, not just a raced one. New class,
correctly not blocked by that entry.

### 2026-09-05 — BIN-1063 step 1 re-review #2: the fix for the over-claim above shipped an under-claim, now struck; re-review confirms the fix and finds no third

**Trigger:** re-review of the same three files after fix option (a) above landed. Between the previous
entry and this one, a DIFFERENT false attestation was found and fixed inside the very fix for the first
one: the surviving test title `joinGroupViaToken svarar already_member bara när medlemsdokumentet FINNS`
claimed the `already_member` reply was conditional on the member doc's existence. The guard it describes
(`if (memberUids.includes(params.uid)) return {ok:false, reason:'already_member'}`) never reads the
member doc at all — a ghost (uid in `memberUids`, doc absent) gets `already_member` too. This is the
UNDER-stating mirror of the prior entry's OVER-claim (that state said a ghost "heals"; this one implied a
ghost does NOT get flagged already_member) — same root cause, opposite direction, in the same commit's
fix. Confirms this file's existing principle ("a mutation-justification comment has two measurable
halves... correcting one mints the next falsehood") generalizes to test TITLES, not only inline comments.

**Fix verified in place, not just claimed.** The exclusivity clause was STRUCK (not reworded): title is
now `joinGroupViaToken svarar already_member när uid redan står i memberUids`, directly readable from the
one-line guard. The member-doc seed that the old title's premise needed was removed from that test (it
seeded nothing but the group doc — correct, since the guard never reads the member doc). A comment above
states the true scope: the guard looks at `memberUids` alone, a ghost gets `already_member` too, that is
truer than the `invalid_token` a fall-through produced, and BIN-1097 + the emulator suite carry why a
ghost can't be repaired from the client at all.

**Re-verified this round, don't just re-read:**
- `npx vitest run src/lib/firebase/groups.test.ts` → 28/28, matches the brief's evidence.
- The rules-half of BIN-1063 step 1 (the `members/{memberUid}` create/update/delete split, the
  `joinedAt == request.time` create pin, the `get('joinedAt',null)` update-immutability with defaults on
  BOTH sides) is unchanged from the prior review — confirmed by re-reading, not by SHA equality, since a
  neighbour edit could have falsified a comment about it without touching its own lines. It doesn't grant
  any authorization the old monolithic `allow create, update, delete` line didn't; the extracted
  `selfOrOwner()` function body is byte-identical to that old line (diffed by hand).
- Mutation-proofed the create pin LIVE against the real rules file (temp `firebase.json`-alike, port
  8199 — 8080 held by a sibling session): stripped `&& request.resource.data.joinedAt == request.time`
  from the create rule, reran `-t BIN-1063` → exactly 3 of 15 red (both directions on the member's own
  branch, one on the owner's), the other 12 (owner path, update-immutability, delete-untouched, the two
  ghost/memberUids-reachability cases) stayed green. Restored via `git show :firestore.rules`, verified
  byte-identical by `git hash-object` (not by `git status`/`git diff`, which reported a stale `MM`/warning
  under `core.autocrlf=true` despite matching content — hash is the only check that doesn't lie here).
- Ran the two ghost/reverse-orphan emulator tests (`groups memberUids — ett uid som redan är medlem kan
  inte läggas till igen`) inside the same `-t BIN-1063` pass: both still assert what they name — a
  non-owning member's own `arrayUnion` of their already-present uid `assertFails`, and the same write
  `assertSucceeds` as a control when the uid is genuinely absent yet.
- grep confirmed no `functions/**` writer touches `groups/{id}/members/**` (Admin SDK bypass is not in
  play here) and no other `joinedAt` writer exists outside `createGroup`/`writeMemberDoc` (both via
  `serverTimestamp()`, never a client literal).

**No third false claim found**, in either direction, across all three gated files at these bytes.

**Verdict: pass (0 blocking).**

### 2026-09-05/06 — BIN-1063 step 1 re-review #3: both remaining cuts checked against history, both clean

**Trigger:** re-review after two more cuts since the last pass — `groups.test.ts`'s last surviving copy
of "falling through gave a misleading `invalid_token`" (the claim r2's entry already tracked being struck
from the JSDoc, the inline comments and the first test title) and, in this file's own r1 entry, the
clause "but the shipped comments and test asserted a false self-heal, silently regressing the reported
reason from a clear `'already_member'` to a misleading `'invalid_token'`".

**Checked the second cut against history, not just against the dispatching prompt's word.** `git show
HEAD:src/lib/firebase/groups.test.ts` — HEAD never carried the self-heal wording; the whole BIN-1063 step
1 diff (rules split, `writeMemberDoc`, both ghost/reverse-orphan branches, all of `groups.test.ts`'s new
`describe` blocks) is new in this working tree, never shipped. `git log --all -S"regressing the reported
reason" --oneline` and the same for "silently changed from" and "heals on retry" — no commit, on any
branch, ever introduced or carried that wording. `joinGroupViaToken`'s `already_member` guard
(`if (memberUids.includes(params.uid)) return {ok:false, reason:'already_member'}`) is present verbatim
in `git show HEAD:src/lib/firebase/groups.ts` — it did not arrive with this diff and was never touched by
it. So the struck clause described a defect that existed only in THIS batch's own uncommitted working
tree, under review, and never reached `main` — cutting it removes an unmeasured claim about the repo's
history, not a record of shipped behaviour. Correct to strike, nothing true lost.

**Grepped the whole tracked tree for the claim's distinctive phrases** (`already_member.{0,80}invalid_token`,
`regressing the reported reason`, `silently changed from`, case-insensitive) — the only remaining hit is
this file's own r1 entry, which is the correct carve-out (a knowledge/archive file quoting a retired claim
as the finding, not restating it live). `git diff firestore.rules` (unstaged vs. index) is empty aside
from the CRLF-normalization warning `core.autocrlf=true` always prints — the `MM` status is not a live
second edit.

**Re-verified the four mechanical claims for this pass, each independently:**
- `selfOrOwner()`'s body is the pre-split shared line character-for-character (diffed the two texts by
  hand from `git diff --cached`, not from memory of the prior round) — grants exactly what the old
  `allow create, update, delete` condition granted, nothing wider.
- The create pin (`joinedAt == request.time`) rejects any client-chosen value, including omission
  (accessing a missing `.joinedAt` errors the whole `&&` chain to `false`) — a client cannot backdate on
  create by any route, not just the one `writeMemberDoc` takes.
- The update pin (`get('joinedAt',null) == get('joinedAt',null)`, defaulted on both sides) rejects any
  change to the field's value on update — a client cannot backdate via update either. Together the two
  rules are what block backdating; nothing about `writeMemberDoc` choosing the merge branch is load-
  bearing to that guarantee, since a client could hit `update` directly with any payload and still be
  pinned. Accepting the integration gate's refined framing: it is airtight for any write mediated by
  `firestore.rules` (client SDK, any caller) — the only exception is Admin SDK, which bypasses rules
  entirely and is a separate question already closed (`grep -rn "'members'" functions/src` → no hit;
  confirmed again this round against `groups/{id}/members` specifically, not just `'members'`).
  `delete` carries no reference to `joinedAt` (unchanged from the pre-split line, which also had none) —
  correct, since `delete` has no `request.resource`.
- Article 17: this diff does not touch `accountDeletion.ts`, `removeMember`, or `deleteGroup` — the
  member-doc delete those paths rely on is `selfOrOwner()`'s self-branch, unchanged in substance from the
  pre-split rule. `accountDeletion.ts`'s per-group leave path (`groups/{gid}/members/{myUid}` self-delete,
  read against pre-batch `memberUids` via `get()`) is unaffected by the split.

**No new finding.** Both cuts described in the dispatching prompt are verified correct against `git log`/
`git show`, not just accepted on the prompt's say-so. No fourth copy of either claim exists anywhere in
the tracked tree outside this file's own archive record.

**Verdict: pass (0 blocking).**
