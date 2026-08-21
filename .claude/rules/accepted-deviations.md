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

### [Data] The aborted-deletion marker has no natural retirement — and that is the choice
`src/lib/deletionMarker.ts` writes `binge:deletionStarted:<uid>` to `localStorage` and
clears it in exactly one place: after `deleteUser()` resolves. There is deliberately no
"cancel". BIN-748 (`src/lib/tabSession.ts`, `0b078db`) rejected a `localStorage` flag for a
structurally identical problem precisely because a flag with no retirement can never be
safely cleared, and the Codebase Archaeologist flagged this as a repeat. It is a conscious
departure, not an unwitting one. **Why:** the state it describes is genuinely terminal —
the cascade has already run, so an "undo" would restore an account that no longer holds
the data anyone wants back — and the server sweep in `retentionCleanup` finishes the
erasure even for a device that never returns. ADR 0019 conflict 1 + condition 8. Do not
file "this flag is never retired", and do not move the marker to Firestore for cross-device
reach: a document under `users/{uid}` recreates exactly what is being erased (#5 Legal,
ADR 0019). — 2026-08-13

### [UX] A cascade that fails on its FIRST chunk parks a user with intact data
The marker goes down immediately before the cascade (ADR 0019 condition 2), so a failure on
the very first commit leaves a marked session whose data was never touched: the limbo
screen appears and profile writes are refused until the user retries. **Why:** there is no
safe later moment. Between the first commit and the last, a tab that dies must ALREADY be
marked or the next load resurrects the profile with a fresh consent record — the whole
defect BIN-816 was filed about. The escape is one button away on the limbo screen, and the
settings page's own message for that case still truthfully says nothing was deleted. Do not
file "a transient failure locks the user out"; it is the accepted cost, and moving the
marker later reopens the resurrection window. — 2026-08-13

**Narrowed 2026-08-16 (BIN-813 / BIN-921).** That last clause covers the first-chunk
failure ITSELF, which `applyDeletionPlan` leaves untagged so it lands in the `untouched`
branch and its literal "Ingenting har raderats". It does NOT cover a later attempt from a
session older than `RECENT_LOGIN_MAX_AGE_MS`: the marker is already down, so
`AuthContext`'s freshness gate throws BIN-813's second message, `classifyDeletionFailure`
answers `recent-login`, and the user is told the deletion has been started but not
finished. Nothing there is false — that text never claims data is gone — but it
deliberately stops reassuring, and the reassurance is exactly what BIN-813 took away.
Do not "restore" the nothing-was-deleted wording to that branch, and do not file the pair
as a contradiction. — 2026-08-16

### [Security/UX] A half-deleted session is blocked from writing, not merely warned
`AppShell` replaces the entire app with `DeletionLimbo` for a marked session, so a user
whose connection merely dropped mid-deletion cannot save anything until they retry or sign
out. **Why:** Malin's call 2026-08-13 (ADR 0020, question 3) against the panel's finding
that `isOwner(uid)` in `firestore.rules` never requires `users/{uid}` to exist — so a
half-deleted session could keep writing new owner-scoped documents, and the server sweep
(which looks for accounts *without* a profile) can never see them. A screen that only
narrates the state lets every failed retry GROW the orphaned data. Gating individual write
paths was rejected for the same reason per-call-site profile guards were: it leaves the
next one. Do not file "the limbo screen is too aggressive" or "block writes at the write
site instead". `deleteAccount()` and its retry are never gated — that part is ADR 0019
condition 3 and is separately tested. — 2026-08-13

### [Data/Cost] communityRatingMaintain swallows transaction failures — a TRANSIENT one is accepted
`functions/src/communityRatings/runAggregate.ts` catches every transaction error, logs it
and returns normally, so Cloud Functions records a successful delivery.

**Accepted:** a TRANSIENT failure costing ONE rating on ONE title. Do not re-file "a
transient swallowed transaction failure drifts the aggregate by one rating", and do not
re-propose `retry: true`. **Why:** Malin's call 2026-08-16 (BIN-915, closed as decided), on
#27 Database Administrator's condition 5 from the BIN-727 critique, which refused to let the
behaviour ship implicit — "silence isn't a decision" — and named a dated line here as what a
"swallow it" answer requires. The only fix CONSIDERED (a failed-docId repair marker and a
reconciliation pass were never weighed) is `retry: true` on the trigger, which is opt-in in
firebase-functions v2 and unset, so a bare rethrow buys nothing here beyond a Cloud
Monitoring execution-status flip that nothing in this project consumes — no Sentry on the
functions side, no dashboard. That trigger fires on EVERY watchlist write (status changes,
notes, instant-week read-repair), so redelivery is a real cost against the 25 SEK/mån cap,
and a poison event would retry for up to 7 days — to protect a display-only average. Risk
accepted over cost.

**NOT accepted, still fileable — all three:**
1. **A SYSTEMATIC failure of this path.** The `catch` is bare and swallows a permanent
   condition identically to a transient one: a bug thrown inside the callback, denied Admin
   credentials, a port that throws on every delivery. Then every rating on every title is
   lost while Cloud Functions reports 100% success, and per the above nothing would say so.
   That finding's remedy is a HEALTH SIGNAL, not `retry: true`. Never priced here.
2. **Removing or downgrading the `logger.error`** on that path. The drift is invisible in
   the data — every count looks plausible — so that log line is the only place this failure
   exists at all. It is now asserted by the "när transaktionen misslyckas" test rather than
   merely asked for here: when this entry was first written the call could be deleted with
   the whole suite green, which the test reviewer found and which made this paragraph a
   boundary nothing enforced.
3. **The other drift mechanisms** `runAggregate.ts`'s header names — e.g. the dedup check
   leaving the transaction, removing the `tx.get`, a second writer outside it. Non-exhaustive
   list; all remain must-catch regressions.

**Scope:** this accept reaches `communityRatingMaintain` and nothing else. Never cite it to
wave through swallow-and-log elsewhere — it says nothing about how any other function
handles errors, good or bad. Each is judged on its own stakes, and an unfinished Art. 17
erasure is not a display-only average. Generalising a narrow accept is exactly how BIN-748's
rejected `localStorage` flag came back as a shipped one.

**Re-open when:** a `communityRatings: aggregate update failed` line appears in the function
logs. That log line IS the observation channel, and it is the only one — the two triggers
this entry first named ("observed drift on a real title", "a support report about a wrong
average") cannot fire, because the drift is invisible in the data and `MIN_SAMPLE = 5` means
no badge renders at today's user count. An accept whose re-open facts are unreachable is
permanent by construction, which was not the intent.

**What the user sees, precisely:** a WRONG "Binge-snitt" on one title, in EITHER direction —
a lost rating below the mean skews the shown average high, not low. The count is one short of
truth, and it can get worse without a second failure: if that user later REMOVES the rating,
`ratingDelta` applies `countDelta: -1` for a rating that was never counted and nothing floors
the result at zero, so a low-count title can reach a stored count of zero or below.
`useCommunityRating.ts` hides the badge at `count <= 0`, so it can stay hidden even once five
real raters exist. The "när transaktionen misslyckas" test pins the swallow itself; note its
`docId` assertion also depends on `aggregateDocId`, so a red there is not by itself evidence
the failure path moved — read which assertion failed before treating it as grounds to
reopen. — 2026-08-16

### [Data/Legal] The cross-device aborted-deletion gap is accepted — the consent re-stamp is NOT
A user who aborts a deletion on one device and merely LOADS an authenticated page on
another has no marker there: `ensureUserProfile` recreates `users/{uid}`, and
`retentionCleanup`'s orphan-auth sweep candidates on "Auth account exists AND profile
confirmed absent" — so that account leaves the candidate set PERMANENTLY, not for a while.
**Why:** Malin's call 2026-08-15 against two blind critiques (ADR 0022). Only the account
holder on their own credentials can trigger it, no third party gains anything, the 25
collections are already erased by the time the state is reachable, and deleting again
restarts the chain. **#6 DPO dissented** — it reads the accept as falsifying the very
precondition ADR 0019 question 2 rests on (a delay that is real and swept) — and the
dissent is preserved verbatim in ADR 0022 rather than argued away. Do not re-file "the
marker doesn't reach other devices", and do not propose moving it to Firestore: ADR 0019's
ban is reaffirmed as covering this ticket explicitly. **Not covered by this accept, and
still open work:** `ensureUserProfile` stamping fresh `termsAcceptedAt`/`ageConfirmedAt`
with no consent step shown — that is a manufactured compliance record, both roles named it
independently as the part with real legal teeth, and it is filed separately. A fix confined
to `userDocWrite.ts` is a NO-OP for it (those sites read the marker, which is by definition
absent on the second device). Re-open trigger: a real support case showing an account in
this state — treat it as an overdue Art. 17 request completed by hand, not as normal
operation (`docs/RUNBOOK.md` §5f). This EXTENDS the 2026-08-13 "no natural retirement"
entry above (same root cause, different consequence); it does not supersede it. — 2026-08-15

### [Data/UX] Regelgolvet nekar en samtidig redigering — och de sex tystar just det nekandet
`firestore.rules` kräver sedan BIN-942 att varje **create** i `users/{uid}/watchlist/{itemId}`
bär `tmdbId`, `mediaType` och `status` (`requiredWatchlistFields`). Golvet är create-only.

Följden: en `setDoc(…, { merge: true })` mot ett dokument som hunnit raderas är en create,
och nekas nu. **Tio skrivvägar** kan träffas — nio av de tio `merge: true`-skrivarna i
`WatchlistContext` plus `flushNextAirWrites` i `nextAirReadRepair.ts`. Den tionde,
`writeTitle`, kan aldrig nekas: `buildAddPayload`s `AlwaysWritten` är en äkta övermängd av
golvet, så varje äkta tillägg passerar. Räkna aldrig av `writeTitle` från de tio och tro att
nio är ett fel — de är två olika mängder.

Sex av dem sväljer nekandet (`guardedItemWrite`): `updateVisibility`, `updateStatus`,
`updateWatchedAt`, `updateRating`, `updateProgress`, `updateTmdbStatus`. De fångar **bara**
`permission-denied` via den delade `isPermissionDenied`, loggar med `console.error` +
`captureError({ scope: 'watchlist', kind: '<anropsplats>' })`, och kastar allt annat vidare.

**Accepted:** att de sex tystar exakt det här nekandet, utan notis till användaren.
**Why:** golvet är create-only, så de kan bara nekas när måldokumentet inte finns — alltså
just den kapplöpningen. Titeln ÄR raderad, och snapshot-lyssnaren tar bort raden ändå, så det
finns ingenting att berätta och ingenting att göra om. Alternativet — att låta felet bubbla —
ger en ofångad promise-rejection per vanlig redigering utan att användaren kan göra något åt
den. Malins beslut 2026-08-20, efter panelrundan på A+B+C och en fokuserad omkritik från #6,
#4, #27 och #7 när skrivvägsinventeringen visade sig vara tio i stället för sju.

**"Utan notis" gäller kontexten, inte anroparna — och det är en skillnad som kostade ett
underkänt granskningsvarv.** `WatchlistContext` kan inte nå en notis (`Providers.tsx` nästlar
`ToastProvider` INUTI `WatchlistProvider`), men två anropare HAR en egen bekräftelse:
`VillSePickerPage` toastar "Markerad som sedd", och `QuickRateModal` pensionerar kortet. Ett
sväljt nekande resolvar löftet, så båda hade bekräftat en skrivning Firestore vägrade — samma
falska besked BIN-895 stängde för tilläggsvägen. Därför returnerar de sex numera ett utfall
(`ItemWriteOutcome`), och varje anropare som säger något är gatad på det. Det som är accepterat
är alltså TYSTNAD, aldrig en osann bekräftelse. Lägger du till en anropare som bekräftar i ord
eller i UI-tillstånd: grinda den på utfallet.

**Ett undantag, medvetet:** `useMarkSeen`s `trackEvent('rate_on_sedd')` avfyras ovillkorligt
efter `void updateRating(...)`. Det är inte samma sak som `status_changed`, som namnger en
dataändring — `rate_on_sedd` mäter att betygsfrågan BESVARADES, och det gjorde den. Ingen
påstår något om vad som lagrades, och användaren ser ingen bekräftelse. Skulle händelsen
någon gång läsas som "ett betyg finns", grinda den då.

**Riktningsasymmetri — "kaskadfel" får aldrig stå som en odifferentierad risk.** Mekaniskt är
`cascadeVisibilityToItems` symmetrisk, men konsekvensen är det inte. En misslyckad
**publik→privat**-kaskad lämnar objekt kvar i det ÖPPNARE läget — det är 2026-07-30-postens
farliga riktning, och den mitigeras av `visibilitySyncPending` (BIN-587), inte av den här
posten. En misslyckad **privat→publik** gör bara titlar mer privata än användaren bad om:
irriterande, aldrig ett läckage.

**NOT accepted, still fileable — fyra saker:**
1. **`writeTitle` som sväljer tyst.** Tillägg-vägen rapporterar sitt utfall till anroparen
   (BIN-895), så ett nekande MÅSTE avvisa; annars säger knappen "tillagd" om en titel
   Firestore vägrade. Den är avsiktligt utanför `guardedItemWrite` och har ett eget test.
2. **Ett SYSTEMATISKT nekande av de sex** — en regelregression, eller en klientbugg som gör
   varje merge-skrivning till en create. Då tystas varje redigering i appen och användaren
   ser en app som tar emot allt och sparar ingenting. Samma klass som
   `communityRatingMaintain`-postens punkt 1: den smala accepten säger ingenting om den breda.
3. **`updateNotes`.** Den är exponerad och är INTE tystad — den har en befintlig catch som
   avmarkerar `migratedNotesRef`, nu även taggar Sentry, och kastar vidare. Skälet att inte
   tysta den: dess item-doc-skrivning ligger i samma ATOMÄRA batch som användarens egen
   anteckningstext i `watchlistNotes`, så ett nekande kastar bort texten hen just skrev — inte
   bara en synlighetsstämpel. En sparning som misslyckas får inte se ut som en sparning som
   lyckades. Vad användaren ser idag: ingenting. `NotesBlock`s `onChange` returnerar `void`,
   så ingen inväntar löftet; texten ligger kvar i fältet. Det är fileable, inte accepterat.
4. **`console.warn`-blindheten på de tre återstående vägarna** — `setRuntime`,
   `refreshTmdbFields` och `flushNextAirWrites`. De fångar redan, men med `console.warn`, som
   Sentrys `globalHandlers` inte ser. Golvet gör nekanden vanligare där. Filad separat; att de
   "fångar redan" är inte samma sak som att de rapporterar.

**Scope:** den här accepten når `WatchlistContext`s sex tystade redigeringsvägar och ingenting
annat. Citera den aldrig för att vinka igenom svälj-och-logga någon annanstans — varje väg
bedöms på sina egna insatser, och `updateNotes` i samma fil är exemplet på att svaret blir ett
annat när det som går förlorat är användarens egen text. Att generalisera en smal accept är
precis hur BIN-748:s avvisade `localStorage`-flagga kom tillbaka som en shippad.

**Re-open when:** en `watchlist`-scope dyker upp i Sentry med ett `kind` från listan ovan.
Det är observationskanalen, och den är den enda — nekandet är osynligt i datan (raden är
borta ändå) och användaren har inget att rapportera. Tre olika signaler, samma kanal:
`kind` = en av de sex → punkt 2 om den återkommer systematiskt; `kind: 'updateNotes'` → punkt
3; `kind: 'updateProgress-add'` (BIN-954) är en annan sak och hör inte hit. Utan taggarna hade
den här posten haft en re-open-utlösare som inte går att nå, vilket är permanent by
construction — samma fel `communityRatingMaintain`-posten skrevs för att undvika.

Supersederar 2026-08-19-posten om synlighetskaskadens nekande, som är retirerad ordagrant till
`.claude/accepted-deviations.archive.md`. Den accepterade nekandet på ett gammalt
bara-numeriskt id och sa själv att samma kapplöpning på ett kanoniskt id var öppen; BIN-942
stängde den halvan. — 2026-08-20
