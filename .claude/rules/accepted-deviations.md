---
paths:
  - "src/**"
  - "functions/**"
  - "firestore.rules"
  - "docs/org/metrics/**"
  - ".claude/hooks/**"
---

# Accepted Deviations

Deliberate, decided deviations from otherwise-applicable rules. **Every review agent —
binge-code-reviewer, binge-security-reviewer, binge-test-reviewer and
binge-integration-reviewer — MUST read this before filing a finding** — the commit gate
names this file when it blocks, and each agent's definition points here. Do not re-flag
anything listed below.

The integration reviewer was missing from that sentence until BIN-1005, which mattered
because it is the push gate. The names are written out rather than counted on purpose: a
count goes stale the next time a reviewer is added or removed, and this file exists to
stop stale claims, not to add one.

A clause was struck here in the same edit that added this paragraph: it said the
integration reviewer "blocks a commit on `docs/org/metrics/**`". That conflates the two
lists this repo keeps filing tickets about (BIN-830). `paths:` above is a TRIGGER-LOAD
list; `reviewGates` in `.claude/shared-plugin.json` is the BLOCKING one, and widening
either never widens the other. Derive who blocks a given path rather than trusting a
sentence about it.

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

---

## BIN-957: de tre `console.warn`-vägarna rapporterar nu — 2026-08-23

Supersederar **punkt 4** i 2026-08-20-posten ovan, som listar `console.warn`-blindheten på
`setRuntime`, `refreshTmdbFields` och `flushNextAirWrites` som filad och öppen. Den är stängd.
Punkt 4 står kvar ordagrant — posten är append-only — men den beskriver inte längre koden.

Fyra catch-ställen (tre funktioner; `flushNextAirWrites` har två) loggar nu med
`console.error` och rapporterar via `captureError` i Sentry-scopet `watchlist`, med ett eget
`kind` per anropsplats:

- `setRuntime`
- `refreshTmdbFields`
- `flushNextAirWrites-chunk` — en enskild batch nekades
- `flushNextAirWrites-setup` — import eller `fsdb()` föll omkull, ingenting skrevs

**Catcharna är fortfarande BREDA**, inte avsmalnade till `isPermissionDenied`. Skälet, som
skiljer dem från de sex tystade redigeringsvägarna: de här är fire-and-forget, ingen inväntar
löftet, så ett omkast blir ett ohanterat fel användaren varken ser eller kan göra något åt.
Det som saknades var rapporten, inte sväljandet. Sväljandet är oförändrat och varje väg har ett
test som hävdar båda halvorna — att felet rapporteras OCH att det inte kastas vidare.

**Konsekvens för 2026-08-20-postens re-open-kanal:** listan över `kind`-värden som betyder
något i scopet `watchlist` växer med de fyra ovan. De betyder INTE punkt 2 (ett systematiskt
nekande av de sex tystade redigeringsvägarna) — de är best-effort/self-healing-vägar, och en
enstaka träff är väntad. Läs dem som ett eget spår, precis som `kind: 'updateProgress-add'`
(BIN-954) hör till sin egen fråga.

---

## BIN-975: ingen spärr mot `via:"sprint-parallel"` + `ran:true` — 2026-08-23

Ett beslut, inte en öppen punkt. Metrikkontrollerna (`docs/org/metrics/check_events.mjs`,
`docs/org/metrics/check_review_coverage.mjs`) får INTE en regel som underkänner en
`review`-rad för att den bär `via:"sprint-parallel"` tillsammans med `ran:true`. Fila inte
"loggen saknar en spärr mot den kombinationen".

**Why:** paret är två aktörer som svarar på var sin fråga, inte en motsägelse. Sprintens
ORKESTRERARE sammankallar den blinda kritiken i fas 1.4 och skriver raden — den kan starta
subagenter. Dess BATCHAGENTER kan inte, och skriver just det i sina egna kvitton. Båda
utsagorna är sanna samtidigt, så en regel som avvisade paret skulle avvisa precis de rader
motorn skriver när den gör rätt.

**Varför posten behövs ändå:** kvittot `batch-0-20260823-131500.json` skrev
"NOT BUILT, deliberately: the guard the brief asked for. See deviations" och bar ingen
`deviations`-nyckel. Pekaren gick alltså ingenstans, och ett beslut som bara finns som en
hängande pekare är för nästa granskare omtöjbart från en ofilad brist.

**Re-open when:** någon kör om BIN-963:s mätning på en NY sprintrad och antalen inte stämmer
— alltså att `tasks/todo.md`:s sprintblock saknar biljettens invikta villkor, eller att de
inte matchar radens `must_haves`. Då är raden falsk, och frågan om en spärr är en annan
fråga än den här. Att en batchanteckning säger "NOT convened" är däremot inget sådant fynd
— det är vad den här posten handlar om.

---

## BIN-965: `updateProgress` kan svara `'refused'` om en rad som ändå skrevs — 2026-08-26

Ett beslut, inte en öppen punkt. Fila inte "utfallet ljuger" eller "fixen är ofullständig,
den lämnar ett race öppet", och föreslå INTE en kompenserande radering som städar raden.

**Mekanismen (och bara den):** `removeItem` bumpar `removalGenRef` synkront och awaitar sedan
sin `deleteDoc`. Tilläggsvägen i `updateProgress` läser samma generation som sista synkrona
steg före `await upsertTitle(payload)`. Startar raderingen EFTER den kontrollen kan de två
rundturerna landa i endera ordningen. Landar raderingen först blir vår skrivning en ny rad,
medan kontrollen på returraden ser den bumpade generationen och rapporterar `'refused'`.

**Allvarlighet:** en kvarliggande biblioteksrad för en titel användaren tog bort, ägd av
användaren själv och raderbar med samma knapp igen. Utfallet lutar åt `'refused'`, alltså
mot att INTE bekräfta något — ingen anropare toastar en falsk framgång.

**Omfång:** enbart `addIfMissing`-grenen i `updateProgress`. Den ordinarie merge-grenen är
inte berörd: dess payload saknar `tmdbId`/`mediaType`/`status`, så BIN-942:s create-golv
nekar den om dokumentet hunnit raderas.

**Why:** alternativet är att radera det vi just skrev när kontrollen faller. En kompensation
som slår fel raderar en titel användaren hunnit lägga tillbaka i samma andetag; en kvarliggande
rad förstör ingenting. Asymmetrin avgör, inte sannolikheten.

**Fortfarande fileable, alltså INTE tystat av den här posten:** samma race i någon annan
gren än `addIfMissing` (den ordinarie merge-grenen skyddas av BIN-942:s create-golv — faller
det skyddet är det en annan sak); en återuppstådd titel som observerats i skarp drift utan
att någon tagit bort den mitt i ett tillägg; och varje läge där raden blir synlig för någon
ANNAN än ägaren. Posten täcker en självägd rad, i en gren, i ett tvårundturers fönster.

**Re-open when:** `removeItem` slutar bumpa generationen synkront, före sin första await.
Också om en rapport visar en verklig återuppstådd titel i skarp drift: då är det inte
det här fönstret utan något annat, och det ska mätas för sig.

---

## BIN-969: git-apply-hålet i färskhetsstämplingen — 2026-08-26

Ett beslut, inte en öppen punkt. Fila inte "hooken missar kod som kommer in via `git apply`,
`git stash pop`, `git checkout`, en merge eller en heredoc".

**Beslutet självt står i** `.claude/hooks/freshness.mjs`, i kommentarsblocket över `stampMap`.
Läs det där. Den här posten är en pekare, inte en kopia — två exemplar av ett beslut är två
saker som kan glida isär, och koden är den som står bredvid mekanismen.

**Varför posten behövs ändå:** den här filen är den enda liggare varje granskaragent måste
läsa innan den filar något. Ett beslut som bara står vid mekanismen når ingen granskare av
en framtida relaterad ändring, och nästa som råkar hitta hålet filar om det. Samma ärende
vidgade `paths:` ovan med `.claude/hooks/**`, så filen nu också triggerladdas när någon rör
hookarna.

**Re-open when:** en commit som applicerat en hållen bunt (`git apply` av en patchfil under
`.claude/state/sprint-patches/`) rör en fil som flödeskartan listar som en nods `path`, och
varken den commiten eller nästa rör `docs/workflow-map.html`. Det är procedurens faktiska
utfall. Åtgärden då: spåra om just de flödena och uppdatera kartans prosa — INTE att
ompröva själva accepten, som är avgjord i BIN-969.

---

## BIN-1010: den kvarliggande radens PUBLIKA halva är stängd — 2026-08-26

Ändrar en av BIN-965-postens punkter ovan. Posten är append-only, så den står kvar
ordagrant; den här posten säger vad som inte längre gäller.

BIN-965-posten listar under *Fortfarande fileable*: **"varje läge där raden blir synlig
för någon ANNAN än ägaren"**. Det läget fanns: raden skrivs av `buildAddWrite` med
`visibilityFields: effectiveVisibilityNow()`, så för ett konto vars `defaultVisibility` är
`'public'` landade den `isPublic: true` och serverades av `firestore.rules`' publika
läsklausul tills användaren raderade titeln en andra gång.

**MEKANISM.** När den residuala kontrollen faller skriver `updateProgress` en
synlighets-ENDAST merge på samma dokument — `{ effectiveVisibility: 'private',
isPublic: false }`, hårdkodade, inte hämtade ur `effectiveVisibilityNow()`.

Det är en ENGÅNGSSTÄMPEL, ingen låsning, och den skillnaden är hela poängen: skrivningen
sätter det denormaliserade paret men ingen per-titel-`visibility`, så
`shouldStampVisibility` förblir sann för raden. Nästa synlighetsstämplande skrivning — och
`cascadeVisibilityToItems` i `AuthContext`, som väljer just raderna utan override — sätter
tillbaka kontots standard. Det som stängs är alltså fönstret direkt efter att användaren
bett titeln försvinna, inte radens synlighet för all framtid.

**ALLVARLIGHET.** Två skilda utfall, och de har olika pris:

* Den kvarliggande raden blir privat i stället för publik. Det är fixens syfte, och den
  kostar ingenting — ingen har bett om den raden.
* Fönstret är smalnat, inte stängt till noll: en genuint samtidig återläggning kan lägga
  sig mellan att kontrollen faller och att nedgraderingen landar. Då nedgraderas en LEVANDE
  titel som användaren nyss lade tillbaka från publik till privat. Det är en annan sak än
  BIN-965:s övergivna rad — det rör en titel någon faktiskt vill ha — men det läker via
  samma stämpling som stycket ovan beskriver, och felriktningen är mot mer privat, aldrig
  mot mer publikt.

**OMFÅNG.** Enbart `addIfMissing`-grenen i `updateProgress`, och enbart den residuala
returvägen. Ingen annan skrivväg rörs, ingen granskare hoppas över, `firestore.rules`
ändras inte — den tvåfältsmerge:n är redan tillåten av `isValidWatchlistItem`s allowlist
som en UPDATE.

Rader som hann bli publikt läsbara FÖRE den här fixen backfillas inte. De läker på samma
sätt som allt annat i posten: nästa gång användaren rör titeln, eller nästa kaskad.

**Vad som INTE ändrades, och inte får ändras:** BIN-965:s beslut att inte kompensera med
en `deleteDoc` står orört. Nedgraderingen är ingen radering.

**Vad som fortfarande är accepterat:** själva den kvarliggande, PRIVATA raden. Den är
självägd och raderbar med samma knapp igen, precis som BIN-965-posten säger.

**Vad som fortfarande är fileable:** de andra punkterna i BIN-965-postens lista — samma
kapplöpning i någon annan gren än `addIfMissing`, och en återuppstådd titel observerad i
skarp drift.

**Konsekvens för 2026-08-20-postens skrivvägsinventering.** Den posten räknar `merge:
true`-skrivarna i `WatchlistContext` och hur många av dem som sväljer nekandet via
`guardedItemWrite`. Den här ändringen lägger till en skrivare och ett `guardedItemWrite`-
anropsställe, så de talen beskriver inte längre koden. Posten ovan är append-only och
rättas inte; härled i stället mängderna när du behöver dem:

```
grep -c "merge: true" src/contexts/WatchlistContext.tsx
grep -n "guardedItemWrite('" src/contexts/WatchlistContext.tsx
```

Den nya skrivaren är INTE en av "de sex tystade redigeringsvägarna" den posten handlar om
— den är fire-and-forget och har ingen anropare som bekräftar något.

**RE-OPEN WHEN:** `kind: 'updateProgress-leftoverVisibility-failed'` dyker upp i
Sentry-scopet `watchlist`. Den strängen betyder att nedgraderingen inte gick igenom av
något annat skäl än det väntade, och den har medvetet ett eget namn: det VÄNTADE fallet
rapporteras som `updateProgress-leftoverVisibility-refused`, och en enstaka träff där är
godartad — har användaren raderat titeln en andra gång innan nedgraderingen landar är
skrivningen en create för Firestore, och BIN-942:s create-golv nekar den, vilket är rätt
svar när det inte finns någon rad kvar att skydda. Återkommande träffar på `-refused`
betyder något annat och är också en re-open.

---

## 2026-08-29 — kodändrande commits FÖRE `COVERAGE_EFFECTIVE_FROM` kräver ingen `review`-rad (BIN-938)

**Beslutat, permanent. Fila inte om det.**

`docs/org/metrics/check_review_coverage.mjs` grindar på att varje kodändrande commit namnger
en biljett som har en `review`-rad i `events.jsonl`. Regeln har en epok,
`COVERAGE_EFFECTIVE_FROM`, och den är MEDVETET icke-retroaktiv — skälet står i konstantens
egen kommentar i den filen. Läs det där; det upprepas inte här.

Följden är en permanent mängd äldre commits som saknar biljett-id i ämnesraden och som regeln
aldrig kommer att nämna. **Den mängden är accepterad.** Att kräva rader i efterhand bevisar
ingenting om vad som faktiskt granskades då, och en kontroll som är permanent röd blir
avstängd.

Detta ÖPPNAR INTE epokbeslutet. Posten bokför bara att den grandfathering beslutet medför är
avsedd, så att nästa granskningsvarv inte filar den en gång till — vilket redan har hänt.

Ingen uppräkning av de berörda commitarna står här: en lista går inaktuell nästa gång någon
kör samma svep. Härled mängden i stället. Notera att robotens beroendehöjningar är undantagna
via FÖRFATTARSKAP (`dependabot[bot]`), inte via ämnesraden — filtret nedan speglar det.
Datumet jämförs i UTC, som regeln själv gör (`check_review_coverage.mjs` jämför med
`Date.parse`); `%cI` ensamt bär en lokal offset och skulle lista en commit gjord strax efter
midnatt lokal tid på epokdagen som om den låg efter epoken.

Kommandot som det står skrivet svarar på RE-OPEN-frågan: det listar kodändrande commits PÅ
eller EFTER epoken som varken namnger en biljett eller är robotens. Tom utdata är det friska
läget, och var utdatan när posten skrevs.

Byt datumet mot `2026-08-01` för att reproducera BIN-938:s ursprungliga augustifynd. Det är ett
UTSNITT av den accepterade mängden, inte hela den — mängden sträcker sig bakåt så långt
historiken gör. Ta bort `awk`-raden för att se hela.

```
TZ=UTC git log --no-merges --date=iso-strict-local --format='%cd|%an|%s' |
  grep -E '[|](feat|fix|refactor|perf|test|build|ci)[(:!]' |
  grep -Ev 'BIN-[0-9]+' |
  grep -v dependabot |
  awk -F'|' '$1 >= "2026-08-18"'
```

**RE-OPEN WHEN:** en kodändrande commit som ligger PÅ eller EFTER epoken saknar både ett
biljett-id och robotundantaget. Det är regeln som fyrar, inte den här posten.

---

## BIN-1023: orphan-datasvepet täcker det UID-NYCKLADE, inte det fältägda — 2026-08-30

Ett omfångsbeslut, inte en öppen brist. Fila inte "svepet missar reviews/lists/
sessions/groups" eller "kaskaden och svepet täcker olika mycket".

`retentionCleanup`s BIN-1023-svep raderar data vars ägar-uid är bekräftat borta ur
Firebase Auth. Det tar **hela `users/{uid}`-trädet** (`recursiveDelete`) plus
**`publicProfiles/{uid}`** — allt som är adresserbart direkt ur uid:t.

**Utanför svepet, med flit:** innehåll som ägs via ett FÄLT och kräver en fråga per
samling — `reviews` (och deras `likes`/`comments`), `lists`, hostade `sessions`,
ägda `groups`, avsnittsreaktionerna i `episodeReactions/*/reactions/*`, samt
speglingarna på ANDRA användares dokument (`followers`, `friends`,
`friendRequests*`). Klientkaskaden i `collectDeletionRefs` täcker dem; svepet gör
det inte. Lita inte på uppräkningen — härled mängden ur `collectUserDataSnapshots`
i `src/lib/firebase/userData.ts`, som är den enda plats som måste vara komplett.

**Why:** Malins omfångsbeslut 2026-08-30, efter #27 DBA:s villkor 3, som uttryckligen
tillåter uppdelningen förutsatt att luckan filas OCH bokförs här. Den fältägda halvan
bär ett produktval som inte får avgöras inuti ett svep: en ägd grupp med kvarvarande
medlemmar ska antingen raderas eller lämnas över, och policydokumentet självt har
den överlämningen som en öppen TODO sedan tidigare. Att bygga halvan blint hade
avgjort den frågan i förbigående.

**Varför posten behövs:** utan den läser nästa granskare skillnaden mellan kaskadens
räckvidd och svepets som en ofullständig implementation. Den är avsedd, och den andra
halvan har en egen biljett.

**Vad som INTE är accepterat:**
1. Att svepet skulle täcka MINDRE än `users/{uid}`-trädet + `publicProfiles/{uid}`.
   Biljetten var skriven om `watchlist` ensam; att bara städa den lämnar ett
   sämre läge än i dag — allt föräldralöst UTOM den enda samling svepet rörde.
2. Att `publicProfiles/{uid}` skulle raderas EFTER trädet. Den ligger utanför trädet,
   så när trädet är borta slutar uid:t dyka upp i genomsökningen och projektionen
   blir onåbar — världsläsbar, permanent.
3. Att observationsgolvet skulle harmoniseras med systersvepets sju dygn. De mäter
   olika storheter; se `ORPHAN_DATA_MIN_OBSERVED_MS`ʼ egen kommentar.

**Re-open when:** den fältägda halvan byggs, eller en rapport visar publikt innehåll
som står kvar attribuerat till ett konto som raderats i konsolen. Det senare är
utfallet den här uppdelningen medvetet lämnar öppet.

---

## BIN-590: lösenordsstyrkan är klientsidig, och det är ett beslut — 2026-08-31

Fila inte "lösenordskravet går att kringgå" eller "scorePassword saknar en serversidig
motsvarighet". Malins beslut 2026-08-31, efter #19 Customer Success blinda kritik.

**MEKANISM.** `scorePassword` (`src/lib/passwordStrength.ts`) kräver minst 8 tecken, avvisar
en blocklista på kända läckta lösenord och kräver score ≥ 2. Den utvärderas på exakt ett
ställe — registreringsgrenen i `src/app/login/page.tsx` — före
`createUserWithEmailAndPassword`. Firebase Auth själv kräver bara 6 tecken — appen påstår det redan på två ställen
(`minLength={mode === 'register' ? 8 : 6}` och `auth/weak-password`-grenens text i
`src/app/login/page.tsx`); talet kommer därifrån, inte från en mätning här. En kontoskapande
väg som inte går genom formuläret (ett direkt SDK-anrop mot den publika webbnyckeln, ett
skript) får därför bara Firebases eget golv.

Härled anropsställena, lita inte på meningen ovan:
```
grep -rn "scorePassword" src functions
```

**ALLVARLIGHET.** Den som utnyttjar det sätter ett svagt lösenord på **sitt eget** konto,
och gör det medvetet — hen måste själv gå runt formuläret. Ingen annans konto blir svagare.
Ingen användare som går genom appen påverkas, eftersom formuläret stoppar dem först.

Men skadan stannar inte vid kontot om det sedan knäcks. `firestore.rules` serverar
watchlist-poster med `effectiveVisibility == 'friends'` till den som ligger i ägarens
`friends`-samling, så den som tar över det svaga kontot läser också det VÄNNERNA delat dit.
De personerna har inte valt det svaga lösenordet. Det ska inte skrivas bort. Watchlist-posterna
är inte det enda som når dit — härled vad en övertagning läser bortom kontot självt:

```
grep -n "friends/\$(request.auth.uid)" firestore.rules
```

**OMFÅNG.** Accepten når kontoSKAPANDE och ingenting annat. Den säger ingenting om
inloggning, och får aldrig citeras för att motivera att någon annan validering flyttas till
klienten. Den täcker inte heller ett framtida lösenordsBYTE eller en återställningsväg — se
nedan.

**TID.** Gäller tills re-open-utlösaren nedan inträffar. Ingen kalenderfrist: hålet växer
inte av sig självt.

**WHY.** Den enda vägen till serversidig efterlevnad som inte skriver om inloggningen är en
blockeringsfunktion (`beforeUserCreated`), och Firebases dokumentation säger rakt ut: "To use
blocking functions you must upgrade your Firebase project to Firebase Authentication with
Identity Platform." Uppgraderingen är gratis vid Binges storlek och kräver ingen
kodmigrering — men Google dokumenterar ingen väg tillbaka. Att det inte går att ångra är en
slutsats ur en frånvaro, inte något någon här kunnat kontrollera; vill man luta sig mot den
måste den kollas mot Google Cloud Support först. Det räcker ändå för beslutet: att byta
produkt under inloggningen på oklara villkor står inte i proportion till ett hål som kräver
att kontoägaren själv kringgår formuläret. Alternativet — att lägga registreringen bakom en anropbar
funktion med custom token — skriver om hela `AuthContext`s inloggningsväg, där varje bugg
låser ute riktiga användare, för samma vinst.

**Om servergrinden ändå byggs någon gång**, gäller #19:s tre villkor oförändrade:
1. Ett serversidigt avslag måste mappa till ett meddelande som redan finns i
   `passwordStrength.ts` — inte till `handleSubmit`s catch-all, som skyller på nätverket.
2. Serverkollen återanvänder `COMMON_PASSWORDS`/`scorePassword`, aldrig en andra lista. Två
   listor som glider isär betyder att mätaren visar "Bra" om något som ändå avvisas.
3. Endast vid kontoskapande. En `beforeSignIn`-hook skulle låsa ute befintliga användare vars
   redan satta lösenord senare hamnar på listan — en supportkris, ingen säkerhetsvinst.

**INTE accepterat, fortfarande fileable:**
1. **En lösenordsÅTERSTÄLLNING eller ett lösenordsBYTE som inte går genom samma kontroll.**
   Ingen sådan väg finns i dag, vilket är just därför den här accepten är billig — härled det
   med kommandot nedan, som ska ge tom utdata:

   ```
   grep -rnE "sendPasswordResetEmail|updatePassword|confirmPasswordReset" src
   ```

   Bygger någon en, öppnas luckan på ett andra ställe och den halvan är inte avgjord här.
2. **Att blocklistan eller längdgolvet försvagas eller tas bort ur formuläret.** Accepten
   gäller att kontrollen bara finns på ETT ställe, inte att den får bli svagare där.
3. **En andra kontoskapande väg i APPEN som hoppar över `scorePassword`.** Accepten gäller en
   väg utanför appen; en ny knapp inuti den som kringgår mätaren är en vanlig bugg.

**RE-OPEN WHEN:** Identity Platform slås på av något ANNAT skäl (tvåfaktor, SAML,
granskningsloggar). Då kostar blockeringsfunktionen ~30 rader och ingen produktändring, och
accepten har inget motiv kvar.

Det är MEDVETET den enda utlösaren. Ett utkast här hade också "ett konto observeras med ett
lösenord ur blocklistan" — den kan aldrig fyra: Firebase lagrar hashar, ingenting i repot kan
visa ett lösenord i klartext, och den som kringgått formuläret rapporterar det inte. En accept
vars re-open-fakta är onåbara är permanent by construction, precis som
`communityRatingMaintain`-posten ovan skriver ut. Utlösaren som står kvar är skönsmässig, och
det ska läsas som att accepten gäller tills någon aktivt öppnar dörren för något annat.

**Historiska konton — mätt av Malin 2026-08-31, luckan är tom.** Lösenordskravet landade
`d1b1adb` (2026-04-24); registrering med lösenord fanns redan `009a936` (2026-03-27). Konton
skapade däremellan prövades aldrig mot kravet, och utan återställningsväg kan de inte stärkas
inifrån appen. Malin läste Firebase-konsolens Authentication-lista och **inga konton finns i
det fönstret**. Accepten täcker därför bara framtida kringgåenden, inte en kvarvarande
population — vilket den inte hade gjort om svaret varit ett annat. Mätningen går inte att
göra om ur repot; svarar någon på frågan igen måste den komma från konsolen.

---

## BIN-1063 steg 2: `friends` och `friendRequestsSent` är inte längre ofrågbara — 2026-09-06

Smalnar BIN-1023-posten ovan. Den posten är append-only och står kvar ordagrant;
den här säger vad som inte längre gäller i den.

BIN-1023-posten räknar `followers`, `friends` och `friendRequests*` bland de
speglingar svepet inte når. **Två av dem bär nu motpartens uid som ett FÄLT**
(`uid`, samma värde som dokumentets id), pinnat i `firestore.rules` mot
sökvägsvariabeln och indexerat med `COLLECTION_GROUP`-scope. De går alltså att
fråga efter.

**Vad som INTE följde med, och varför — mätt, inte antaget:**

* **`followers` lämnades utanför med flit.** `reclaimOrphanFollows` (BIN-21) kör
  varje vecka, gör en full collection-group-scan på `following` och `followers`
  och raderar rader vars ägare eller motpart saknar `users`-dokument. Den läser
  båda ändpunkterna ur SÖKVÄGEN och behöver inget fält. Malins omfångsbeslut
  2026-09-06: att lägga fältet där också hade gett två oavstämda raderingsvägar
  över samma rader, vilket är två svar på frågan när något faktiskt är borta.
  Fila inte "followers saknar uid-fältet" — det är avgjort, inte förbisett.
* **`friendRequests` (inkommande) rördes inte i koden.** Den bar redan `fromUid`
  och reglerna pinnade det redan. Det som saknades var index-scopet, och det är
  tillagt här. Härled hellre än att lita på meningen:
  `grep -n "fromUid" firestore.rules`

**Vad den här ändringen INTE gör:** den raderar ingenting. Den gör raderna
HITTBARA. Ingen kod som konsumerar fältet finns ännu. "Spegelmigreringen är
shippad" får aldrig läsas som "restspåren är stängda" — själva raderingspasset
är kvarvarande arbete.

**Fortfarande accepterat ur BIN-1023-posten, oförändrat:** `reviews` (och deras
`likes`/`comments`), `lists`, hostade `sessions`, ägda `groups` och
avsnittsreaktionerna. Härled mängden ur `collectUserDataSnapshots`, aldrig ur en
uppräkning.

**Re-open when:** raderingspasset som konsumerar fältet byggs, eller en rapport
visar en kvarliggande `friends`- eller `friendRequestsSent`-rad för ett konto som
raderats i konsolen efter att backfillen körts.

---

## 2026-09-07 — BIN-1063 steg 3, bunt 2: ägda grupper lämnas över, inte raderas

Efterföljare till BIN-1023-posten och till posten ovan, som båda ställer ägda
`groups` utanför svepet. Den här buntet tar dem för den ena av de två dörrarna.
Posterna ovan redigeras inte.

**Vad som byggdes.** En anropbar serverfunktion, `handOverOwnedGroups`, som
kontots raderaknapp anropar FÖRE kaskaden. Den lämnar över varje grupp kontot
äger till den medlem som varit med längst, i stället för att radera den. Malins
beslut 2026-09-06, båda dörrarna — den andra dörren, svepet, är bunt 3.

**Varför en serverfunktion och inte en regelgren.** `ownerUid` är pinnad
oförändrad på varje `groups`-update-gren, och reglerna kan inte iterera
medlems-undersamlingen för att kontrollera VEM som varit med längst. En gren lös
nog att tillåta skrivningen hade lämnat garantin i klientkoden. Både #27 och #4
avvisade den formen oberoende av varandra.

**Vad som fortfarande INTE görs, och det är avsiktligt:**

* **Svepets dörr är inte byggd.** Ett konto raderat i Firebase Console lämnar
  fortfarande sin ägda grupp orörd — `retentionCleanup` når inte det fältägda
  innehållet alls. Det är bunt 3, och tills den finns är detta halva ändringen.
* **`sessions` där `hostUid ==`, `reviews`, `lists` och reaktionerna** ligger kvar
  utanför båda dörrarna. Härled mängden ur `collectUserDataSnapshots`, aldrig ur
  en uppräkning här.
* **En spökmedlem ärver gruppen.** Ett uid som står i `memberUids` utan
  medlemsdokument — den icke-atomiska joinen kan dö mellan skrivningarna — räknas
  som fullvärdig kandidat, rankad under alla med `joinedAt`. Alternativet var att
  radera gruppen, och att radera delad data för någon reglerna räknar som medlem
  är det sämre av två fel. Avgjort i bunt 2, inte förbisett.
* **Redan förfalskade `joinedAt` går inte att laga i efterhand.** Pinningen kom i
  steg 1; rader skrivna före den kunde bära vad som helst. Noll grupper fanns i
  produktion 2026-09-07, så mängden är tom — men det står här för att det är mätt,
  inte antaget.

**Tva saker om vad anvandaren FAR LASA nar overlamningen fallerar:**

* **En dodad funktion klassas som "ingenting raderat".** Markoren som gor ett
  delvis fel till `partial` kan bara skickas av kod som kor klart och returnerar
  en sammanfattning. Slas instansen ihjal mitt i loopen — deadline, omstart —
  finns ingen sammanfattning, ingen markor, och klienten sager "Ingenting har
  raderats" over skrivningar som landat. `timeoutSeconds` ar hojd till 300 for
  att smalna fonstret; den kan inte stanga det. Accepterat: raderingen ar
  idempotent, ett omforsok konvergerar, och alternativet — att alltid varna for
  delvis radering — hade ljugit i det vanliga fallet dar ingenting skrevs.
* **`partial`-strangen skyller pa ett anslutningsfel.** En serversidig
  overlamningsvagran ar inte det. Strangen ar en av de fyra lasta, juridiskt
  godkanda lydelserna (BIN-813 villkor 4) och skrivs inte om i ett
  granskningsvarv. Den barande halvan — "En del av din data kan redan vara
  borttagen" — ar sann, och att dirigera felet hit ar strikt battre an att lamna
  det i `untouched`. Orsaksledet ar alltsa ibland fel, med flit.

* **Friskhetsmarginalen tacker inte langre kaskadens varsta fall.**
  `RECENT_LOGIN_MAX_AGE_MS` ar 2 minuter, valt 2026-08-05 med argumentet att
  marginalen mot Firebases ~5-minutersgrans skulle DOMINERA allt som ligger
  mellan kontrollen och `deleteUser`. Overlamningen ligger nu dar, och klienten
  vantar pa den upp till funktionens hela `timeoutSeconds`. Argumentet ar
  darmed falskt och ar struket i koden. Utfallet: `deleteUser` kan neka pa
  requires-recent-login EFTER en lyckad kaskad — data borta, identiteten kvar.
  Accepterat: det ar precis det fall BIN-796/876 gav en egen arlig lydelse
  ("Raderingen har paborjats men inte slutforts"), omforsoket konvergerar, och
  bada de andra vagarna ar samre — ett lagre tal loser ut spärren oftare utan
  att gora marginalen sann, ett hogre pressar en grans som inte ar ett
  publicerat kontrakt.
* **En inbjudan fran den avgangne agaren overlever.**
  `users/{target}/groupInvites/{groupId}` bar `fromUid` och `fromDisplayName`
  och ligger utanfor gruppens undertrad, sa ingen av de tva dorrarna ror den.
  Forr raderades gruppen och inbjudan pekade pa ingenting; nu overlever gruppen,
  och listan faller tillbaka pa det denormaliserade namnet — "<raderat namn>
  bjod in dig" till en grupp som gar att ga med i. Kvarhallning, inte ett
  trasigt flode. Tas i bunt 3 eller nar nagon rapporterar det.

**Re-open when:** bunt 3 byggs, eller en rapport visar en grupp vars `ownerUid`
pekar på ett konto som inte längre finns i Auth.

---

## 2026-09-07 — BIN-1063 steg 3, bunt 3: svepets dorr ar byggd

Efterfoljare till TRE poster, som alla raknar det faltagda innehallet som
oatkomligt for svepet: BIN-1023-posten (2026-08-30), BIN-1063 steg 2-posten
(2026-09-06) och BIN-1063 steg 3 bunt 2-posten (2026-09-07) ovan.
De ar append-only och redigeras inte; det ar den har posten som beskriver
koden.

`retentionCleanup` sveper numera ocksa det faltagda innehallet for ett uid som
bekraftats borta ur Auth: recensioner med sina likes och kommentarer, den
avgangnes UGC pa andras recensioner, avsnittsreaktionerna, listor, hostade
sessioner, och grupperna. Grupperna gar genom SAMMA `runGroupHandover` som
raderaknappen — aldrig ett andra val.

**Vad som fortfarande INTE tacks, och det ar avsiktligt:**

* **Speglingarna.** `followers` sveps av `reclaimOrphanFollows` varje vecka.
  `friends` och `friendRequestsSent` gjordes fragebara av steg 2, men
  raderingspasset for dem ar inte byggt — steg 2:s egen post sager det, och den
  meningen star kvar.
* **En samredigerad lista raderas inte**, uid:t stryks bara ur `editors`. Att
  radera den hade forstort tredje parts data pa grund av nagon annans radering.
* **Dokumentbudgeten ar allt-eller-inget per uid.** Ett konto som ager fler an
  `FIELD_OWNED_MAX_DOCS_PER_UID` dokument far ingenting raderat alls, korning
  efter korning, tills nagon tittar. Det ar avsiktligt: en radering som stannade
  mitt i hade lamnat en godtycklig halva kvar utan spar av vilken. Vagran loggar
  hogljutt och behaller bevakningsposten.
* **En misslyckad gruppoverlamning stoppar korningen dar den star.** Grupperna
  ar SIST i ordningen, sa tidigare kategorier ar redan raderade nar den fallerar
  — utfallet ar inte att ingenting rors, utan att uid:t star kvar pa bockerna:
  den privata halvan (`users/{uid}`-tradet) ar orord, bevakningsposten lever, och
  varje skrivning ar idempotent sa omkorningen konvergerar.
* **Overlamningen kostar mot dokumentbudgeten men raknas som en uppskattning.**
  Planeringssteget laser vad den SKULLE rora och budgeten ser det; sjalva
  skrivningen sker forst efter att budgeten slappt igenom. Talet ar gruppens eget
  dokument plus den avgangnes egna rader under den, inte namnfalten som bara
  redigeras. Taket ar grovt: de oraknade skrivningarna vaxer med gruppens
  watchlist och sessionshistorik, som `eraseMemberTraces` visar.
* **En grupp som far en ny medlem mellan planen och skrivningen raderas inte.**
  Fonstret ar litet men malet ar en LEVANDE tredje parts data, sa varje tom grupp
  kontrolleras om precis fore raderingen och hoppas over om nagon hunnit ga med.
  Samma omkontroll svarar nej ocksa nar gruppDOKUMENTET ar borta, sa dess redan
  planerade undertrad hoppas over och blir kvar utan agare. Kanda foljden av att
  lata omkontrollen vara det som avgor; en rapport om foraldralosa gruppRADER
  utan gruppdokument ar en re-open.
* **Inbjudan fran den avgangne agaren overlever, aven har.** Bunt 2-posten
  parkerade `users/{target}/groupInvites/{groupId}` med "tas i bunt 3 eller nar
  nagon rapporterar det". Bunt 3 tar den inte: `findFieldOwned` har ingen
  `groupInvites`-gren, och `deleteUserTree` nar bara den avgangnes EGNA
  inkommande inbjudningar. Kvarhallning, inte ett trasigt flode — gruppen finns
  och gar att ga med i, listan faller tillbaka pa det denormaliserade namnet.
  Kvar som oppet arbete, inte som accepterat for gott.
* **En grupp som TOMS mellan planen och skrivningen stoppar korningen.** Spegeln
  av punkten ovan: den sista andra medlemmen gar ur, sa gruppen ar inte med i
  planen och ingen budget har prisat den. Att radera den anda hade varit en
  obudgeterad radering; att lata den sta hade lamnat den for alltid, eftersom
  samma korning raderar agarens `users/{uid}` och uid:t sedan aldrig kommer
  tillbaka i `listUserUids()`. Korningen stannar i stallet: bevakningsposten
  lever, och nasta korning planerar gruppen som tom fran borjan.
* **En grupp kontot bara var MEDLEM i ror svepet inte alls.** Fragan stalls pa
  `ownerUid`, aldrig pa `memberUids`, sa uid:t star kvar i medlemslistan och
  `groups/{g}/members/{uid}` behaller sitt denormaliserade `displayName` och
  `photoURL` for gruppens ovriga medlemmar. Permanent, eftersom uid:t inte
  aterkommer i `listUserUids()` efter att samma korning raderat `users/{uid}`.
  Klientkaskaden nar dem; svepet gor det inte. Det ar samma omfangsval som
  BIN-1023-posten gor for de ovriga faltagda samlingarna.

**Re-open when:** speglingarnas raderingspass byggs, eller en korning loggar en
budgetvagran — den betyder att ett verkligt konto ar storre an taket och att
talet behover ett beslut, inte en hojning i forbigaende.

---

## 2026-09-10 — BIN-1147: inbjudningar du SKICKAT overlever inte langre din radering

Narmar TVA poster ovan, bada daterade 2026-09-07: "BIN-1063 steg 3, bunt 2" och
"BIN-1063 steg 3, bunt 3". Bada ar append-only och star kvar ordagrant; den har
posten sager vad som inte langre galler i dem. Ingendera retireras till arkivet
— de tacker mycket mer an den har punkten, och att arkivera dem hade tagit bort
sant och barande innehall tillsammans med den enda mening som blivit fel.

**Punkten som stangs.** Bunt 2 skrev "En inbjudan fran den avgangne agaren
overlever" och parkerade den med "tas i bunt 3 eller nar nagon rapporterar det".
Bunt 3 tog den inte och upprepade den: `findFieldOwned` hade ingen
`groupInvites`-gren, och `deleteUserTree` nadde bara den avgangnes EGNA
inkommande inbjudningar. Bada dorrarna gor det nu.

**Vad som byggdes.** Erasingen ligger i `handOverOwnedGroups`, den anropbara som
raderaknappen redan kor fore kaskaden, och i `retentionCleanup`s faltagda svep
som kategorin `groupInvitesSent`. Bada hittar dokumenten med en collection
group-fraga pa `fromUid`, men de SKRIVER olika: den anropbara i en enda atomar
batch, sopningen i chunkar under sitt eget tak. Harled anroparna hellre an att
tro pa en mening: `git grep -n "eraseSentInvites(" -- functions/src`.

**Varfor servern och inte klienten.** Lasregeln pa
`users/{uid}/groupInvites/{groupId}` ar `isOwner(uid)`, sa ingen klientfraga kan
spanna over andras trad. Det ar inte ett val utan en formaga klienten saknar.

**HARDRADERING, inte nullning av namnfalten — och vilken precedens det foljer.**
`collectDeletionRefs` hardraderar redan den speglade `friendRequests`-posten i
den ANDRES trad nar avsandaren raderar sitt konto (avsnitt 2c). En vantande
social handling som initiatoren tar tillbaka genom att forsvinna raderas alltsa
helt i det har repot, och `groupInvites` foljer samma regel i stallet for att
uppfinna en andra. Bade #6 och #5 vagde nullning mot radering och landade i att
den avgorande invandningen inte ar vilket som ar mildast, utan att tva nastan
identiska objekt inte far behandlas olika utan att nagon skrivit ned varfor.

**Vad som INTE ar accepterat, och alltsa fortfarande fileable:**
1. Att erasingen skulle kunna halvkoras PA KNAPPENS VAG. Dar ar den EN atomar
   batch, och over taket raderas ingenting alls. En delvis erasing som klienten
   anda klassar som "ingenting har raderats" ar BIN-876/813-klassen och far inte
   aterinforas. Sopningens vag ar en annan mekanism med ett annat tak och ett
   annat felbeteende — dess delvisa korning ar redan accepterad i bunt 3-posten
   ovan, och den accepten ar oberord.
2. Att vagran skulle bara delvis-markoren. Erasingen kor FORE overlamningen just
   for att en vagran ska vara en korning som inte skrivit nagot.
3. Att en annan spegling skulle vinkas igenom med den har posten som stod.
   `followers` sveps av `reclaimOrphanFollows`; `friends` och
   `friendRequestsSent` gjordes fragebara i steg 2 men deras raderingspass ar
   fortfarande inte byggt. Den posten star kvar och ar oberord.

**Kvar som oppet arbete:** en skickad inbjudan raderas nu men har aldrig ingatt i
avsandarens EGEN Art. 20-export. Asymmetrin fanns fore det har och finns kvar
efter; den ar #21:s iakttagelse och har en egen biljett, BIN-1150.

**Re-open when:** en rapport visar en kvarliggande `groupInvites`-rad vars
`fromUid` pekar pa ett konto som inte langre finns i Auth, eller en korning
loggar `groupHandover: sent-invite erasure refused` — det senare betyder att ett
verkligt konto ligger over taket och att talet behover ett beslut, inte en
hojning i forbigaende.

---

## BIN-1154: visningsnamnets tva lagringar kan glida isar, och regeln har inget golv — 2026-09-11

Tva beslut, inte oppna brister. Fila inte "Auth-posten kan bli efter" eller
"tomt visningsnamn nekas bara av klienten".

Sedan den har biljetten gar `displayName` att andra i installningarna.
`updateDisplayName` i `AuthContext` skriver **Firestore forst** och Auth-posten
bara om den skrivningen gick igenom. Ordningen ar inte estetisk:
`mergeUserDoc`/`assertProfileWritable` ar den enda sparren som stoppar en
profilskrivning under en pagaende radering, och `updateProfile` gar inte genom
den chokepointen alls.

### 1. En fallerad Auth-skrivning raknas som FRAMGANG, med en loggad avvikelse

Firestore-kopian ar den auktoritativa: den ar bunden av reglerna, den ligger i
artikel 20-exporten, och den publika projektionen foljer den. Fallerar
Auth-skrivningen efter att den lyckats ar namnet sparat och anvandaren ser det
pa skarmen — att kasta dar hade sagt "sparades inte" om nagot som ar sparat.

Avvikelsen rapporteras med `console.error` + `captureError({ scope: 'auth',
kind: 'updateDisplayName-authSync' })`, samma konvention som BIN-957:s fyra
vagar. Tyst svaljning vore det tredje felet och ar inte accepterat.

**Resten det lamnar:** `createProfileWithConsent` bygger `displayName` ur
`firebaseUser.displayName` ensamt — det finns inget Firestore-dokument att falla
tillbaka pa vid den punkten. En Auth-post som blivit efter ar alltsa vad som
skrivs tillbaka om `users/{uid}` senare raderas och ateruppstar (avbruten
radering, atersamtycke, BIN-909:s kantfall). Anvandarens eget namn kan da tyst
falla tillbaka till ett aldre varde.

**Why:** eget konto, egen historik, ingen korsanvandarlacka, och laget kraver
bade en fallerad Auth-skrivning OCH en senare radering-plus-aterupplivning.
Alternativet — att kasta och saga att ingenting sparades — ar en osanning i det
vanliga fallet for att undvika en osanning i det sallsynta.

**Re-open when:** `kind: 'updateDisplayName-authSync'` dyker upp i Sentry-scopet
`auth`. Divergensen ar inte helt osynlig i appen - `buildExistingProfile`s
fallback och `tryAutoClaimUsername`s backfill laser bada Auth-kopian - men
ingendera skriver ned att den gjorde det, sa Sentry-raden ar det som gar att
bevaka.

### 2. Golvet pa `displayName` ar klientsidigt, med flit

`firestore.rules` binder `displayName` till `size() <= 80` pa bade create och
update. Den har **ingen undre grans**, sa ett tomt namn nekas av klienten och
aldrig av regeln - bade vid registreringen och i installningarna. Den som gar
forbi bada kan blanka sitt eget namn for alla som ser det.

Harled bada halvorna:
```
awk '/match .users.{uid} {/,/^    }/' firestore.rules | grep -nE 'displayName|bio'
grep -n "displayName-empty" src/contexts/AuthContext.tsx
```

**Why:** att stanga det i regeln kraver en regelandring och en manuell deploy
for ett lage dar den enda som drabbas ar den som sjalv kringgatt sitt eget
formular. Samma avvagning som BIN-590 gor for losenordsstyrkan, och av samma
skal: kontoagaren skadar bara sin egen visning.

**INTE accepterat, fortfarande fileable:** att klientgolvet tas bort ur
`updateDisplayName`, och att en ANNAN skrivvag till samma falt laggs till utan
samma kontroll. Harled var golvet star:
```
grep -rnE "Ange ditt namn|displayName-empty|kan inte vara tomt" src
```
Accepten galler att golvet ar klientsidigt, inte att det far forsvinna fran en
vag som har det.

**Re-open when:** ett konto observeras med tomt visningsnamn i produktion, eller
en andra skrivvag till faltet byggs.

### Kvarvarande oppet arbete ur BIN-1154

**INTE accepterat, fortfarande fileable.** Det viktigaste i den har posten.
`isOwnIdentity` jamfor det `displayName` en skrivning bar mot det LIVE vardet i
`users/{uid}`, och skrivarna skickar `AuthContext`s kopia i minnet, som inte
synkas mellan flikar. Fore den har biljetten var faltet oforanderligt efter
registreringen, sa en inaktuell kopia var onabar; nu kan en andra flik fa sina
recensioner, kommentarer, reaktioner, vanforfragningar och gruppinbjudningar
NEKADE tills den laddas om. Spärren byggdes mot forfalskning i BIN-1126 och
faller nu pa vanlig anvandning. Filat som **BIN-1163**; mekanismen och
atgardsalternativen star dar, inte har. Vinka inte igenom det med den har
posten som stod.


---

## BIN-1162: en gruppmedlemsrad kan behålla det gamla namnet, och ingen städar den — 2026-09-12

Ett beslut, inte en öppen brist. Fila inte "fan-outen är best-effort" eller
"namnet kan bli inaktuellt i en grupp", och föreslå INTE en avstämningskörning
som jagar drift.

**MEKANISMEN.** `updateDisplayName` och `updateUsername` skriver om MIN egen
`groups/{g}/members/{uid}`-rad i varje grupp jag är med i, genom samma bundna
fråga som `updateProviders` redan använder. De två är också de enda som sänder —
härled anroparna hellre än att tro på meningen, och notera att
`tryAutoClaimUsername` inte är en av dem:

```
grep -n "publishIdentityChange(" src/contexts/AuthContext.tsx
```

Härled formen:

```
grep -n "publishIdentityChange" src/contexts/AuthContext.tsx
grep -n "MY_GROUPS_LIMIT" src/contexts/AuthContext.tsx src/lib/firebase/groups.ts
```

Faller skrivningen mot en enskild grupp — nätverk, en regeländring, raden hunnit
raderas — behåller just den gruppens rad det gamla namnet. Det finns ingen
avstämningspass och ingen flagga som `visibilitySyncPending` (BIN-587), så raden
läker först vid nästa namnbyte, en omjoin, eller någon annan skrivning som råkar
röra dokumentet.

**ACCEPTERAT:** att grupprader blir inaktuella — både en enskild rad som fallerar
(`identityFanOut-group`) och fallet där importen eller frågan faller så att INGEN
rad ens försöks för det namnbytet (`identityFanOut-query`). Båda har samma form och
samma botemedel: nästa namnbyte. Den syns för användaren —
medlemslistan renderar namnet från medlemsdokumentet, även för raden som är ens
egen — så det här är en synlig inaktualitet utan egen felnotis, inte en osynlig
drift. **Why:** namnet ÄR sparat i `users/{uid}` och den publika
projektionen följer med; det som fallerar är en kosmetisk kopia.
Alternativet — att fälla namnbytet på en
grupprad — hade sagt "sparades inte" om ett namn användaren ser på skärmen, och
det är precis det fel BIN-1154:s Auth-post-avvikelse avgjorde åt andra hållet en
biljett tidigare. Samma avvägning, samma svar.

**NOT accepterat, fortfarande fileable:**

1. **Att rapporten tas bort.** Sentry-raden är den kanal som går att BEVAKA;
   `console.error` bredvid den når ingen som inte redan sitter med konsolen öppen,
   och ett gammalt namn i en lista ser inte ut som ett fel för den som råkar se det.
   Samma gräns som `communityRatingMaintain`-postens punkt 2.
2. **Ett SYSTEMATISKT nekande** av medlemsskrivningen — en regelregression, eller
   en klientbugg som gör varje patch ogiltig. Då slutar varje namnbyte nå varje
   grupp, och den smala accepten säger ingenting om det breda fallet.
3. **Att fan-outen börjar skriva fler fält än de två.** Accepten gäller att en
   tvåfältspatch får fallera, inte att patchen får växa. `role`, `photoURL`,
   `providers` och `notifications` ägs inte av den anroparen, och `joinedAt` hålls
   oföränderlig just genom att utelämnas (BIN-1063 steg 1).
4. **Tillsammans-deltagarnas namn.** De rörs inte alls, och det är en egen
   avgränsning (Malin 2026-09-12): en sessionsplats kan vara anonym — reglerna tar
   emot en deltagare med `uid == null` — så det finns inget konto att läsa ett
   aktuellt namn ur, och sessioner går ut efter 7 dagar. Vad användaren SER:
   den som är både gruppmedlem och deltagare i en öppen session läser sitt nya
   namn i gruppens medlemslista och sitt gamla i sessionens deltagarlista. Känt och
   avsett.

**Två smalare rester i samma mekanism**, båda accepterade på samma grund som ovan,
och ingen ny mekanism byggs för någon av dem:

* Två flikar som byter namn SAMTIDIGT kan leverera sina meddelanden i en annan
  ordning än Firestore committade skrivningarna, så en mottagande flik kan
  kortvarigt hålla det äldre av två namn. Det kräver att en och samma person
  aktivt byter namn från två öppna flikar.
* Ett meddelande som landar medan den mottagande flikens EGEN profilladdning är i
  luften skrivs över av den laddningens `setUser(profile)`, så fliken står kvar
  med den inaktuella kopian. Samma form som raderingsmarkörens kapplöpning som
  `AuthContext` redan dokumenterar bredvid, men dess åtgärd — att läsa om källan
  vid appliceringen — finns inte här: kanalen ÄR källan, den gör med flit ingen
  läsning. Fönstret är en profilladdning brett.

Båda läker vid nästa namnbyte eller omladdning.

**BIN-1163 ÄR BYGGD, och det SMALNAR en paragraf längre upp i den här filen — det
stänger den inte.** BIN-1154-postens avsnitt "Kvarvarande oppet arbete" beskriver
den inaktuella flikens nekade skrivningar som öppet arbete, märkt "INTE accepterat,
fortfarande fileable". Den posten är ett beslutsprotokoll och står ordagrant kvar.

Vad som täcks nu: andra flikar i SAMMA webbläsare. Mekanismen är en
`BroadcastChannel`, och den räckvidden är direkt läsbar ur konstruktorn i
`src/lib/profileIdentityChannel.ts` — den upprepas inte här.

Vad som INTE täcks, och alltså fortfarande är öppet arbete precis som BIN-1154-posten
säger: en session i en ANNAN webbläsare eller på en annan enhet. Den håller kvar sin
kopia och får sina skrivningar nekade tills den laddas om, exakt som före den här
biljetten. Skriv inte av den halvan.

**RE-OPEN WHEN:** `kind: 'identityFanOut-group'` eller `kind: 'identityFanOut-query'`
dyker upp i Sentry-scopet `auth`. En enstaka träff är väntad och godartad;
återkommande träffar betyder punkt 2 och är en annan fråga än den här posten.
