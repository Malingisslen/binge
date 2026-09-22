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

### [Security/UX] Daterad efterföljare till posten ovan: BIN-1023:s svep, och vad det inte avgör
Posten ovan motiverar spärren bland annat med att serversopningen `can never see them`.
Originalposten står kvar oförändrad — den är ett beslutsprotokoll, och strykregelns carve-out
säger att den ersätts av en daterad efterföljare, inte av en granskares strykning.

Vad som har tillkommit sedan den skrevs: BIN-1023:s svep landade 2026-08-30. Kedjan är två steg.
Svepet som samlar konton utan profildokument (`collectOrphanedAuthAccounts`) raderar ingen
Firestore-data. För ett uid som är bekräftat borta ur Auth plockar `collectOrphanedUserData` upp
det via `listUserUids()`, som använder `listDocuments()` just för att fånga en spökref där
`users/{uid}` är borta men undersamlingarna står kvar, och `deleteUserTree` kör
`recursiveDelete` över trädet.

Hur långt det räcker för just den här postens läge avgörs inte här. Posten från 2026-08-15 och
ADR 0022 behandlar en enhet utan markör som återskapar `users/{uid}` bara genom att ladda en
inloggad sida, och vad det gör med kandidatmängden. Läs dem; skriv ingen sammanfattning av dem
här.

Vad efterföljaren INTE säger: att fönstret mellan de två stegen är godtagbart, och inte heller
vad beslutet i posten ovan vilar på. Ingendera prövas här, så en granskare som hittar något om
dem har inte hittat något som redan är avgjort. — 2026-09-16

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

---

## BIN-1155: medlemsradens fältuppsättning är låst, och två fält är borta — 2026-09-12

Efterföljare till BIN-1162-posten ovan. Den är append-only och står ordagrant kvar;
den här raden säger vad som inte längre beskriver dokumentet.

BIN-1162-postens punkt 3 räknar upp `role`, `photoURL`, `providers` och
`notifications` som fält fan-outen inte äger. **`role` och `notifications` finns inte
längre på dokumentet**: Malins beslut 2026-09-12, sedan dataskyddsrollen blockerat på
att låsa fast två fält utan läsare i appen på något varje gruppmedlem kan läsa.
Ägarskap härleds ur `group.ownerUid`, och notisflaggan var hårdkodad `true` utan
reglage. Härled fältmängden hellre än att lita på någon uppräkning:

```
grep -n -A 10 "function memberFields" src/lib/firebase/groups.ts
```

**Punkt 3:s accept är oförändrad i sak.** Den säger att fan-outen inte får växa, och
den gäller precis lika starkt över en kortare fältlista — `firestore.rules`
`isValidGroupMember` binder numera nyckelmängden, så en växande patch nekas av regeln
i stället för att bara vara ogillad i prosa.

**Vad som TILLKOM samma dag, och som inte är en accept utan en stängd lucka:**
medlemsdokumentet har nu typ- och längdgränser per fält, `uid` är pinnat mot
sökvägssegmentet, och identitetsfälten binds till skrivarens egen live-profil — på
update bara när fältet faktiskt ändras, just för att inte stänga den läkningsväg
BIN-1162-posten vilar på.

**Re-open when:** ett fält läggs tillbaka på medlemsdokumentet. Då flyttar både
`memberFields()` och regelns nyckellista, i samma commit.

---

## BIN-1180: svepets omkontroll skiljer "fick en medlem" från "gruppen är borta" — 2026-09-14

Efterföljare till en punkt i BIN-1063 steg 3 bunt 3-posten (2026-09-07). Den står kvar
ordagrant; den här posten säger vad som inte längre gäller i den.

Bunt 3-posten säger att omkontrollen "svarar nej ocksa nar gruppDOKUMENTET ar borta, sa dess
redan planerade undertrad hoppas over och blir kvar utan agare". Då följde namnprojektionen
`publicGroups/{gid}` med i det som hoppades över, och den är läsbar för varje inloggat konto.

**Vad som ändrades.** Omkontrollen har tre svar i stället för två. Härled dem:

```
grep -n "PlannedGroupState" functions/src/retentionCleanup/runCleanup.ts
```

På "borta" raderas projektionen. På "fick en medlem" raderas ingenting, som förut.

**Vad som fortfarande är accepterat, oförändrat:** de planerade undertradsraderna under ett
försvunnet gruppdokument raderas inte. Det är bunt 3-postens prisade läge, och det gäller rader
under ett dokument som inte finns, inte ett namn andra kan läsa. En egen medlemskontroll före en
sådan radering övervägdes av #27 och valdes bort här som det mindre konservativa valet.

**Re-open when:** en rapport om föräldralösa gruppRADER utan gruppdokument, som bunt 3-posten
redan säger.

---

## BIN-1113: vänspeglingarnas raderingspass är byggt — 2026-09-15

Efterföljare till tre poster som står kvar ordagrant: BIN-1063 steg 2 (2026-09-06), steg 3
bunt 3 (2026-09-07, punkten **Speglingarna**) och BIN-1147 (2026-09-10, punkt 3). Alla tre
säger att raderingspasset för `friends` och `friendRequestsSent` inte är byggt. Det är det nu.

**Vad som ändrades.** `retentionCleanup` har en kategori till i det fältägda svepet, med samma
skyddsräcken som de andra och inget eget tak. Härled vad den frågar efter:

```
git grep -n -A 14 "case 'friendMirrors'" -- functions/src/retentionCleanup/index.ts
```

Den raderar tre sorters rader om ett uid som bekräftats borta, i andra användares träd:
`friends` och `friendRequestsSent` på fältet `uid`, och inkommande `friendRequests` på
`fromUid`. Den tredje fanns inte i biljetten. #27 krävde den: en kvarliggande förfrågan kan
fortfarande accepteras, och accepten skriver en ny vänrad under det raderade uid:ts egen
sökväg.

**Före deploy mättes fältet** mot produktionen:
`cd functions && node scripts/backfill-mirror-uid.mjs --project binge-nu --dry-run` gav
2026-09-15 "0 row(s) need the field, 0 skipped, 3 scanned across friends + friendRequestsSent".

**Fortfarande utanför, oförändrat:** `followers`, som `reclaimOrphanFollows` sveper.

**Re-open when:** en rapport visar en kvarliggande `friends`-, `friendRequestsSent`- eller
`friendRequests`-rad om ett konto som inte längre finns i Auth, efter en körning som passerat
observationsgolvet.

---

## BIN-1187 + BIN-1188: gruppnamnets golv har två kanter som inte byggs — 2026-09-15

BIN-1184 (`568e506`) lade golvet `hasVisibleName` i `firestore.rules`.
Ingen regeländring, ingen kodändring och ingen deploy följer av den här posten. Två skilda
beslut med två skilda skäl; det ena skälet bär inte det andra.

### BIN-1188: en grupp som redan är lagrad med tomt namn

Om en sådan grupp finns ger en sparning av inställningarna en nekad projektionsskrivning
(Sentry-brus medan skärmen säger att det gick), och en inbjudan nekas med det allmänna
felbeskedet.

**Skälet att inte bygga är en mätning, och den förfaller.** 2026-09-15 listades samlingarna i
projektet `binge-nu` med Firebase MCP-verktyget `firestore_list_documents`
(`parent: projects/binge-nu/databases/(default)/documents`): `groups` och `publicGroups` gav
tomt svar, och kontrollsamlingen `users` gav dokument — läsvägen fungerade, så tomheten var
verklig. Det är en ögonblicksbild. Den säger ingenting om grupper skrivna efter mätningen.

**Re-open when:** en `updateGroup-publicGroup`-rapport i Sentry, eller en ny mätning som hittar
en grupp vars `name` saknar synliga tecken.

### BIN-1187: ett namn av bara osynliga tecken

`hasVisibleName` kräver `\S`. I RE2:s syntax, som Firestore-reglerna använder, är `\s` bara
ASCII-blanksteg, så hårt blanksteg (U+00A0) och nollbreddstecken (U+200B) räknas som synliga
och ett namn av bara sådana tecken går igenom. **Det är läst ur RE2:s syntaxbeskrivning, inte
prövat mot emulatorn** — inget test driver ett sådant namn.

Bara gruppens ägare kan sätta namnet. Följden för den som ser det är en rad som ser tom ut, inte
åtkomst till något. Att vidga golvet är en regeländring med full panel och manuell deploy.

**Ingen automatisk upptäckt finns.** Skrivningen LYCKAS, så ingen felrapport kan fyra för den.

**Re-open when:** en användarrapport om en grupp utan synligt namn, eller att golvet ändå rörs
av annat skäl — då prövas U+00A0 och U+200B med emulatortest på alla tre ytorna i samma ändring.

---

## BIN-1129: blockering stoppar en vänförfrågan i reglerna — 2026-09-15

Efterföljare till "[Security] Blocking is hygiene-level, not a security boundary" (2026-06),
som står kvar ordagrant. Den här posten smalnar av den för EN skrivväg.

**Vad som ändrades (Malins beslut 2026-09-15).** Skapandet av
`users/{mottagare}/friendRequests/{avsändare}` nekas nu av `firestore.rules` när
`users/{mottagare}/blocked/{avsändare}` finns. Härled klausulen:

```
grep -n "blocked/\$(request.auth.uid)" firestore.rules
```

**Vad som fortfarande är hygien, oförändrat:** blockering döljer recensioner, kommentarer och
flödet genom filtrering i klienten, och den filtreringen går att kringgå. Den delen av
2026-06-posten gäller fortfarande.

**Inte byggt:** blockering stoppar inte gruppinbjudningar, och den tar inte bort en förfrågan
som redan landat innan blockeringen.

**Re-open when:** en rapport om att en blockerad person når någon via en annan yta.

---

## BIN-1194: `deleteGroup` rör inte `joinAttempts`, och svepet är mekanismen — 2026-09-16

Malins beslut 2026-09-16, efter att full panel mätt att den planerade fixen inte gick att
bygga. Fila inte "ägarens raderaknapp lämnar kvar inbjudningsspåren" eller "gruppens
undersamlingslista är ofullständig i `deleteGroup`". Ingen kod ändrades; det här är
bokföringen av att ingen ska ändras.

**VARFÖR DEN INTE KAN BYGGAS KLIENTSIDIGT.** `firestore.rules` ger
`groups/{groupId}/joinAttempts/{uid}` `allow read: if false` och
`allow delete: if isSignedIn() && uid == request.auth.uid`. Härled båda:

```
grep -n -A22 "match /joinAttempts" firestore.rules
```

Ägaren kan alltså varken lista undersamlingen eller radera någon annans rad. Mönstret som
`deleteGroup` använder för `members`, `watchlist` och `sessionHistory` — ett `getDocs` in i
samma `Promise.all` — kan inte återanvändas här. Och eftersom en lyckad join självraderar
sin egen rad tillhör de rader som FINNS kvar vid en gruppradering så gott som alltid en
annan uid än ägarens, så den enda radering reglerna tillåter är i praktiken en no-op.

Värre än verkningslös: Firestore-batchar är atomära, och `deleteGroup` committar i chunkar om
450. Ett nekande fäller hela chunken, alltså potentiellt raderingen av medlemmar, watchlist,
den publika projektionen OCH gruppdokumentet. `GroupPageClient.tsx` anropar
`void deleteGroup(...).then(...)` utan `.catch`, så användaren hade sett knappen göra
ingenting. Det är en regression mot dagens läge, inte en förbättring.

**MEKANISMEN SOM TÄCKER DET.** `retentionCleanup` kör
`db.collectionGroup('joinAttempts').select('createdAt')` och reapar via `isStaleJoinAttempt`.
En collection group-fråga ser barndokument oavsett om föräldern finns, så svepet når raden
vare sig gruppen står kvar eller är raderad. Härled frågan och golvet:

```
grep -n -A2 "case 'joinAttempts'" functions/src/retentionCleanup/index.ts
grep -n "JOIN_ATTEMPT_MAX_AGE_MS =" functions/src/retentionCleanup/logic.ts
```

**ACCEPTERAT:** att raden ligger kvar fram till svepets nästa körning. Det är SAMMA fönster
som redan gäller varje `joinAttempts`-rad — en övergiven join, ett konto raderat i konsolen —
och den här posten skapar alltså inget eget. Läs fönstret ur golvet plus svepets `onSchedule`;
skriv inte ett tal här, det vore ett nytt omätt påstående om något golvet och schemat redan
svarar på.

**Vad raden innehåller under fönstret:** `token` och `createdAt`, inget annat — regelns
`hasOnly` binder nyckelmängden. `read: if false` gäller permanent, så ingen klient kan läsa
den; det här är alltså en fråga om dataminimering, att en förbrukad hemlighet ligger kvar
lite längre än den behöver, inte om läsbarhet.

**Why:** alternativen är en regeländring som öppnar läsning eller radering av en rad som bär
ett inbjudningstoken i klartext — full panel och manuell deploy — eller en ny anropbar
serverfunktion att underhålla. Båda för att korta en väntan som redan är bunden av golvet
och schemat, på rader ingen kan läsa, i en grupp som just raderats. Priset står inte i
proportion.

**INTE accepterat, alltså fortfarande fileable — tre saker:**
1. **Att svepets fråga någonsin villkoras på förälder-gruppens existens.** Det är precis den
   egenskap accepten vilar på. Blir `joinAttempts`-grenen en fråga under ett gruppdokument i
   stället för en collection group-fråga, faller hela beslutet.
2. **Att den här posten citeras för något ANNAT som `deleteGroup` missar.** Den gäller
   `joinAttempts` och ingenting annat.
3. **Att fönstret växer utöver golvet plus svepets schema** utan ett eget beslut. En höjning
   av endera konstanten är en ändring av den här accepten, inte en justering bredvid den.

**RE-OPEN WHEN:** raden `retentionCleanup: joinAttempts scan failed` dyker upp i Cloud
Functions-loggarna. Den kanalen behövs därför att scanet sväljer sitt fel och returnerar en
tom lista — en trasig körning ser annars ut som en frisk. Utlösaren är medvetet INTE en
rapport om en läst token: `read: if false` gör den observationen onåbar, och en accept vars
utlösare ingen kan nå är permanent by construction, samma fälla som BIN-590-posten skriver
ut. Raden gäller scanet; en raderingsomgång som fallerar loggar sin egen, mindre specifika
rad i `deleteInBatches`.

`docs/data-retention-policy.md` ändras INTE av det här beslutet. En ny mening där hade varit
en oprövad formulering i ett dokument av en annan klass.

---

## BIN-1208: en samredigerares listinnehåll får ingen upphovsmärkning — 2026-09-17

Malins beslut 2026-09-17, efter #6 Dataskyddsombudets fynd i BIN-1195:s blinda panel.
Biljetten är stängd som Canceled — inte byggd, med avsikt.

**Läget, mätt före beslutet.** `UserListItem` i `src/types/domain.ts` bär `tmdbId`,
`mediaType`, `title`, `posterPath` och `addedAt`. Härled att det saknas ett upphovsfält i
stället för att tro på den här meningen:

```
grep -rn "addedBy" src/types/domain.ts src/hooks/useLists.ts
```

Raderingsvägarna säger samma sak oberoende av varandra: klientkaskaden i
`src/lib/firebase/accountDeletion.ts` och fältsvepets `case 'lists'` i
`functions/src/retentionCleanup/index.ts` stryker uid:t ur `editors` och rör inte `items`.

**Vad som accepteras.** Att det en avgången samredigerare lade till står kvar i ägarens lista
utan uppgift om vem som lade dit det.

**Varför.** Elementen bär inget uid, så det som står kvar är redan oidentifierat — det finns
ingen koppling till personen kvar att radera. Ett `addedBy` skulle SKAPA personuppgiften i
stället för att ta bort den: ett uid per element på ett dokument som kan vara världsläsbart.
Ägaren har redan vägar ut: ta bort elementet, ta bort redigeraren. Skrivvägen genom appen
hämtar elementen ur TMDB-sökningen, så det som en samredigerare lägger till där är en titel.

**INTE accepterat, alltså fortfarande fileable — tre saker:**
1. **Att en delad lista får FRITEXT som en samredigerare kan skriva** — en notis per titel, en
   redigerbar beskrivning. Då är det användarinnehåll, och accepten vilar på att det inte är
   det. Det är den utlösare som vänder beslutet.
2. **Att posten citeras för något annat än upphovsmärkning av `items`.** Den säger ingenting om
   elementens form eller om deras antal.
3. **Att samredigering öppnas för någon ägaren inte har bjudit in.** Accepten vilar på att
   kretsen som kan skriva är inbjuden av ägaren.

**RE-OPEN WHEN:** någon av de tre ovan inträffar. Det finns ingen loggrad att bevaka här —
utlösaren är en produktändring, inte ett driftläge, vilket är skälet till att den står
utskriven som en egenskap hos listan och inte som ett larm.

---

## BIN-1150: en skickad gruppinbjudan speglas inte i avsändarens export — 2026-09-17

**Avviker från** utgångspunkten att artikel 20-exporten bär de uppgifter kontot självt
har lämnat ifrån sig. **Avvikelsen:** `BingeExport` får ingen `groupInvitesSent`-nyckel,
och `src/lib/firebase/dataExport.ts` ändras inte. En inbjudan du SKICKAT raderas när ditt
konto raderas — posten daterad 2026-09-10 ovan beskriver den raderingen — men den går
inte att få ut. Den postens stycke **Kvar som oppet arbete** bokför just den
här asymmetrin som olöst och namnger biljetten BIN-1150; det är det stycket den här
posten avgör. Stycket
står kvar orört, eftersom filen är append-only.

**Vilka fält det gäller.** Inbjudan bär `groupId`, `groupName`, `fromUid`,
`fromDisplayName` och `invitedAt`. Härled listan hellre än att lita på den här meningen:

```
git grep -n -A 18 "export async function inviteMemberByUid" -- src/lib/firebase/groups.ts
```

`invitedAt` säger NÄR du bjöd in någon. `groupMemberships` i ditt eget träd säger att du
är medlem i gruppen, inte när du skickade en inbjudan.

**Why:** dokumentet ligger i MOTTAGARENS träd, och läsregeln är
`allow read: if isOwner(uid)` på `users/{uid}/groupInvites/{groupId}`. Avsändaren har
ingen läsväg dit. Det är inte en kostnadsavvägning utan en förmåga klienten saknar —
samma skäl som posten ovan ger för att raderingen ligger på servern. En export av
skickade inbjudningar kräver alltså antingen en ny speglad samling i avsändarens eget
träd eller en ny serversidig exportväg. En klientfråga skulle dessutom kräva en läsning
filtrerad på ett DATAFÄLT över andras träd. Härled läsregeln:

```
grep -n -A 4 "match /users/{uid}/groupInvites/{groupId}" firestore.rules
```

**Vem som avgjorde.** Frågan ställdes blint till #5 Legal / GDPR Counsel och #6 Data
Protection Officer den 2026-09-13. Båda svarade oberoende av varandra att en skriven post
räcker, och ingen av dem eskalerade. #6:s villkor var att posten ska vara medundertecknad
av #5 och inte vara ett ensidigt dataskyddsbeslut; det är uppfyllt av att båda svarade,
och båda namnges här av just det skälet.

**Omfång.** Gäller SKICKADE `groupInvites`. Inget annat exportfält berörs, den här posten
bär ingen `SCHEMA_VERSION`-bump, ingen fil under `src/lib/firebase/` ändras av den, och
`firestore.indexes.json` får ingen ny rad.

**Re-open when:** en frågbar väg till skickade inbjudningar byggs i avsändarens eget träd
av andra skäl — då finns läsvägen redan och invändningen ovan är borta — eller en
registerutdragsbegäran efterfrågar tidpunkten för en skickad inbjudan.

---

## BIN-1207: taket på `lists.items` binder ANTAL, aldrig byte — 2026-09-17

Ett omfångsbeslut, inte en öppen brist. Fila inte "taket löser inte kostnadsargumentet"
eller "en samredigerare kan fortfarande svälla dokumentet".

**Vad som byggdes.** `firestore.rules` binder antalet element i `lists.items` på create,
på ägarens update-gren och på samredigerarens update-gren, genom en hjälpare som tar
före-antalet som parameter. Härled talet och grenarna hellre än att lita på den här
meningen:

```
grep -n "maxListItems\|itemsWithinCap" firestore.rules
```

**Vad taket INTE gör, och det är hela posten.** Regelspråket kan inte inspektera ett
element inuti en array, så per-element-storlek går inte att binda. En samredigerare som
skriver direkt mot SDK:t, förbi appens TMDB-härledda form, kan fylla varje element med
långa strängar. Dokumentets övre gräns är då Firestores egen, precis som före taket.
Taket binder alltså ORGANISK tillväxt genom appen; det sänker inte det värsta fall en
motiverad samredigerare kan nå, och det säger ingenting om hur ofta dokumentet läses.

**Why:** #4 Säkerhetsarkitektens villkor 3 i den blinda panelen 2026-09-17, som krävde
att det skrivs ned daterat i stället för att taket shippas som en underförstådd
fullständig lösning på kostnadsfrågan. Alternativet — att binda per-element-storlek —
finns inte i regelspråket, och kretsen som kan skriva är inbjuden av ägaren.

**INTE accepterat, alltså fortfarande fileable — tre saker:**
1. **Att elementens FORM skulle vara oprövad i en yta som tar emot fritext.** Accepten
   vilar på att det appen skriver är en TMDB-härledd titel. En notis per titel eller en
   redigerbar beskrivning per element vänder beslutet, precis som BIN-1208:s post säger
   om upphovsmärkning.
2. **Att posten citeras för något annat än `lists.items`.** Den säger ingenting om något
   annat fält och ingenting om titellängd, som är BIN-1170.
3. **Att samredigering öppnas för någon ägaren inte har bjudit in.**

**Re-open when:** någon av de tre ovan inträffar. Det finns ingen loggrad att bevaka —
utlösaren är en produktändring, inte ett driftläge.

---

## BIN-1211: `list` som anmälningsbar yta är PARKERAD, inte avgjord — 2026-09-17

Läs det här som ett uppskjutet val, inte som ett beslut emot. Fila gärna om
förutsättningarna ändras; fila inte "listor borde gå att anmäla" som ett fynd.

**Läget.** Servern tar emot fler måltyper än appen kan skapa. Härled båda sidorna i
stället för att lita på en uppräkning här:

```
git grep -n "REPORT_TARGET_TYPES" -- functions/src/submitReport/logic.ts
git grep -n "targetType=" -- src
```

**Vad som byggdes 2026-09-17.** Profilen fick en anmälningsväg, på Malins beslut samma
dag ("profilen först"). Skälet hon valde på: en anmälan mot en person har tydligast
innebörd för den som gör den, och en delad lista har redan en ägare som kan ta bort
innehållet själv.

**Vad som INTE är avgjort.** Om en publik lista ska gå att anmäla. Frågan ligger öppen på
biljetten; ingen sprint får läsa den här posten som klartecken åt något håll.

**Why:** utan en post här skulle nästa granskare läsa den saknade ytan som en ny brist och
fila den igen, och `src/lib/moderation/reportTargetCoverage.test.ts` skulle inte ha något
att peka på när den släpper igenom måltypen.

**Re-open when:** Malin svarar på listfrågan, eller en användare faktiskt ber om att få
anmäla en lista.

---

## BIN-1227: underlaget för `maxListItems()` — 2026-09-17

Ett spår, inte en öppen brist. Fila inte "taket är godtyckligt valt".

**Vad talet valdes mot.** Mätt 2026-09-17 med `firestore_list_documents` mot produktionens
`lists`-samling: hela den lagrade populationen var ett dokument,
`lists/jbdJCyVZ7l1XctISXsnG`, vars `items` bar ett element. Taket sattes som en
övre gräns mot den ögonblicksbilden, inte härlett ur en formel.

**Mätningen åldras.** Den beskriver läget vid den tidpunkten och ingenting annat. Läs om
den mot produktionen innan den citeras som fortfarande generös.

**Vad posten INTE säger.** Ingenting om innehållet i `items`. Taket binder antal; vad det
inte binder står i posten `## BIN-1207` ovan.

**Why:** #27 DBA:s och #25 Engineering Managers blinda kritiker 2026-09-17 krävde att
underlaget bor i ett beslutsprotokoll med mätmetoden inskriven, inte i en sprintplan —
`code-style.md` klassar `tasks/` som engångsmaterial som raderas när planen är byggd.

**Re-open when:** taket ändras, eller en ny mätning motsäger ögonblicksbilden ovan.

---

## BIN-1205: driftbokens pekare till "Blaze vs Spark" får stå kvar — 2026-09-17

Ett beslut, inte en öppen brist. Fila inte "pekaren går i ring" eller "jourhavande skickas
tillbaka dit hen kom ifrån".

**Läget.** `docs/RUNBOOK.md` §2c pekar vidare till rubriken "Blaze vs Spark" i
`docs/analysis/EXTERNAL_ACTIONS.md`. Efter BIN-1198 svarar den rubriken inte längre på
plan- eller takfrågan utan pekar tillbaka. Härled:

```
grep -n "Blaze vs Spark" docs/RUNBOOK.md docs/analysis/EXTERNAL_ACTIONS.md
grep -n -A 8 "## Blaze vs Spark" docs/analysis/EXTERNAL_ACTIONS.md
```

Den första faller om pekaren slutar namnge rubriken. Den andra skriver ut avsnittets
kropp, så ett avsnitt som börjat svara på plan- eller takfrågan igen syns i utdatan.

**Varför det inte är blockerande.** §2c:s egen mening bär uppgiften INNAN pekaren — den
som läser stycket har svaret utan att följa någon länk. Följd ändå tar pekaren slut på ett
sant svar i `CLAUDE.md` i ett hopp; den dinglar inte och den snurrar inte vidare.

**Varför den inte lagas.** #20 Manual/Release QA avvisade 2026-09-02 i BIN-1067 att
pekaren stryks till en dinglande filhänvisning, med skälet att det är raden en jourhavande
följer under rate-limit-spelboken. Det villkoret är fortfarande uppfyllt: pekaren NAMNGER
rubriken. Att i stället rikta om §2c mot tabellen "Open infra items" prövades och avvisades
av #8 DevOps/SRE i den blinda kritiken 2026-09-17 — den tabellen svarar inte på plan- eller
takfrågan alls, så en jourhavande hade landat ännu längre från sitt svar.

**Vad den här posten INTE gör:** den skriver ingen ny mening om vilken plan projektet
ligger på, och den ändrar ingen av de två filerna.

**Omfång.** Accepten gäller pekaren från `docs/RUNBOOK.md` §2c till rubriken "Blaze vs
Spark" i `docs/analysis/EXTERNAL_ACTIONS.md`, och ingenting annat. Den får inte citeras för
någon annan korsreferens mellan dokument i repot — varje sådan bedöms på sina egna
förutsättningar.

**INTE accepterat, alltså fortfarande fileable:**
1. Att pekaren i `docs/RUNBOOK.md` slutar NAMNGE rubriken — då faller #20:s villkor och
   det här beslutet med det.
2. Att rubriken "Blaze vs Spark" raderas ur `docs/analysis/EXTERNAL_ACTIONS.md`.
3. Att §2c:s egen mening — den som bär uppgiften före pekaren — stryks. Hela accepten
   vilar på att läsaren har svaret utan att följa länken.

**Re-open when:** någon av de tre ovan inträffar. Det finns ingen loggrad att bevaka;
utlösaren är en dokumentändring.

---

## BIN-1240: anmälningar har en admin-yta i appen — 2026-09-19

Efterföljare till `[Moderation] Reports are client-create-only with no in-app admin surface`
(Sprint 5), som står kvar ordagrant. `/admin/reports` finns. Härled sidan:

```
git ls-files src/app/admin
```

Där listar admin anmälningarna per status, ändrar en anmälans status, och ser för en
användaranmälan den anmälda profilen via den anropbara funktionen `getProfileForModeration`
(BIN-1244). Att radera innehåll eller konton sker fortfarande i Firebase Console enligt
`docs/moderation.md`.

---

## BIN-1234: ett feltypat lagrat `items` lagas eller raderas — 2026-09-20

`itemsWithinCap` provar `d.items is list` pa `request.resource.data`, alltsa hela
efterdokumentet och inte bara det falt som andras. Harled grenarna:

```
grep -n "itemsWithinCap" firestore.rules
```

For ett dokument vars LAGRADE `items` ar feltypat nekas darfor agaren varje skrivning som
inte samtidigt skickar ett giltigt `items` — en titelandring, att gora listan privat, att
lagga till eller ta bort en samredigerare.

**Vad som accepteras.** Att agaren maste LAGA eller RADERA ett sadant dokument, i stallet
for att kunna andra ett orelaterat falt forst.

Lagningsvagen ar provad: `cap-b4` i `src/test/rules/firestore-rules.test.ts` driver en
skrivning med en riktig lista inom taket och visar att den gar igenom. `cap-b5` i samma fil
driver det som NEKAS — en ren titelandring pa ett feltypat dokument — och ar alltsa
avvikelsen sjalv, inte en av vagarna ut.

Raderingsvagen ar inte provad av nagot test. Den ar i stallet direkt lasbar ur regeln:

```
awk '/match .lists.{listId} {/,/^    }/' firestore.rules | grep -n "allow delete"
```

Klausulen som kommer ut namnger bara agaren, ingen `isValidList`.

**Var rackvidden gar.** Ingen klientskrivvag kan producera ett feltypat lagrat `items`.
Harled producenterna:

```
grep -n "items" src/hooks/useLists.ts
```

De tre skrivningarna ar `items: []` vid skapandet, en `arrayUnion` vid tillagg och en
filtrerad array vid borttagning. Alla tre ar listor, och BIN-1207:s egna create- och
update-grenar kraver dessutom `d.items is list` nar faltet finns. Att na det tillstand den
har posten accepterar kraver alltsa en Admin-SDK- eller konsolskrivning, eller ett dokument
aldre an BIN-1207.

**Varfor den inte lagas nu.** En reparationsgren som later agaren andra ett orelaterat falt
utan att skicka ett giltigt `items` ar en regelandring pa agarmodellen, och den routar till
`top` med full panel. Biljetten sager sjalv att produktionen ska matas forst: finns inget
sadant dokument ar grenen betald for ingenting. Matningen kraver en lasning mot skarp
databas, som en obemannad session inte gor, sa laget skrivs ned i vantan pa den.

**Omfang.** Accepten galler `itemsWithinCap` och `lists.items`, och ingenting annat. Den
sager INGENTING om hur manga andra hjalpare i filen som delar formen "validera hela
efterdokumentet" — `isValidWatchlistItem` och `isValidPublicProfile` gor det ocksa, pa sina
egna falt, och varje sadant fall bedoms pa sina egna forutsattningar. Harled formen:

```
grep -c "!('" firestore.rules
```

**INTE accepterat, alltsa fortfarande fileable:**
1. Att `allow delete` pa `lists/{listId}` borjar anropa `isValidList` — da forsvinner
   raderingsvagen och hela accepten vilar pa den.
2. Att `cap-b4` slutar ga igenom — da forsvinner lagningsvagen.
3. Att en klientskrivvag borjar kunna producera ett feltypat `items`. Da ar tillstandet
   inte langre bara nabart via Admin-SDK, och avvagningen om produktionen ar en annan.

**Re-open when:** nagon av de tre ovan intraffar, ELLER nar en lasning mot skarp databas
visar att sadana dokument finns. Da byggs reparationsgrenen, `cap-b5` vands, och den har
posten far en daterad eftertradare — den redigeras inte.

---

## BIN-1193: en hangd skanning halls tillbaka av FUNKTIONENS timeout, inte av en egen klocka — 2026-09-20

Malins beslut 2026-09-20, efter #25 Engineering Manager / Release Managers blinda kritik.
Fila inte "en hangning i en skanning svalter syskonen" eller "parallellblocket saknar en
tidsgrans".

**Vad som redan ar atgardat, och inte hor till accepten.** Biljettens tre falska meningar ar
strukna ur koden. Harled att de ar borta:

```
grep -rn "only sweep" functions/src/retentionCleanup
grep -rn "three newest" functions/src
grep -rn "cannot starve" functions/src/retentionCleanup
grep -rn "timeout default" functions/src
```

Tom utdata pa alla fyra ar det friska laget. Den fjarde stod i `functions/src/index.ts` och
var den av dem som handlade om just den har funktionens tidsbudget; den namns inte i
biljetten men stroks i samma commit, sa den hor till samma kontroll. Det som stod kvar var
ett VAL, och det ar det har posten avgor.

**Mekanismen.** Varje skanning i `runRetentionCleanup` bar sin egen `.catch` som loggar och
returnerar en tom lista. En `.catch` hanterar ett AVSLAG. Den hanterar inte ett anrop som
aldrig svarar, och ingen gren har en egen klocka. Harled bada halvorna:

```
grep -c "\.catch((err) =>" functions/src/retentionCleanup/runCleanup.ts
grep -rn "AbortController\|Promise.race\|setTimeout\|withTimeout" functions/src/retentionCleanup/
```

Den forsta raknar grenarna som bar formen — bade de som kor i `Promise.all` och de
Auth-berorande som kor efter det. Den andra soker efter en klocka i sopningens egen kod:
tom utdata ar laget posten beskriver, och en trafflista betyder att nagon lagt in en och att
posten inte langre beskriver koden. Vad som da ater ar kvar:

```
grep -n "timeoutSeconds" functions/src/retentionCleanup/index.ts
```

**Vad som accepteras.** Att en hangd skanning haller tillbaka syskonens raderingar fram till
den gransen, i stallet for att falla for sig sjalv. Accepten galler varje gren som bar
formen ovan, inte bara de parallella.

Den galler SKANNINGSfasen. Skrivfasens awaits — `deleteSessions`, `deleteInBatches`,
`deleteAuthAccounts`, `eraseOrphanedUserData`, `stampOrphanWatch` — bar inte den formen och
ligger utanfor. De har samma avsaknad av klocka; att de ar utanfor ar en avgransning, inte
ett forbiseende.

**Why:** sopningen ar idempotent och schemalagd, sa nasta korning tar det som blev kvar.
Ingen anvandare ser en fordrojd stadning. Alternativet ar en egen klocka per gren i en
funktion som `recursiveDelete`:ar hela anvandartrad — harled den blast-radiusen med
`grep -n "recursiveDelete" functions/src/retentionCleanup/index.ts` — alltsa mer kod i
den kansligaste vagen, for ett lage ingen har observerat. Avvagningen ar kostnad mot en
ohandd risk, och den vagen valdes bort.

**VAD ACCEPTEN VILAR PA, OCH SOM INTE ar pa plats i dag.** En korning som dor mitt i en
sopning larmar INGEN. `docs/RUNBOOK.md` §5d sager det sjalvt, med BIN-468 namngiven som
den oppna biljetten. Signaturerna finns i Cloud Logging men ingenting lyfter dem, sa
utlosaren nedan ar MANUELL tills BIN-468 shippar. Att stanga BIN-1193 stanger inte den
luckan.

**TVA signaturer, inte en — och det ar den halvan jag forst missade.** Bada loggraderna
ligger EFTER sitt eget avsnitt, vilket gor frånvaro till signalen. Harled ordningen:

```
grep -n "await Promise.all\|scheduled sweeps done\|retentionCleanup done" functions/src/retentionCleanup/runCleanup.ts
```

Utdatan visar `await Promise.all` forst och `scheduled sweeps done` efter den. Hanger en av
de PARALLELLA skanningarna skrivs alltsa ingen av raderna — inte heller den som en utlosare
byggd pa "den forsta finns, den andra saknas" kraver. §5d beskriver bara den senare halvan,
sa den manuella kontrollen svarar "inget att se" for precis det fall den har posten handlar
mest om.

**INTE accepterat, alltsa fortfarande fileable:**
1. Att en skanning slutar bara sin egen `.catch`. Accepten galler en HANGNING, inte ett
   avslag som far falla igenom och ta hela korningen med sig.
2. Att den schemalagda funktionens timeout tas bort eller hojs utan eget beslut. Den ar
   taket accepten vilar pa.
3. Att sopningen slutar vara idempotent. Da konvergerar inte omkorningen, och hela skalet
   faller.
4. Overvakningsluckan sjalv. Den ar BIN-468 och stangs inte av den har posten.
5. Att §5d bara beskriver den ena signaturen. Den halvan ar inte lagad har, och en
   driftbokstext som svarar "inget att se" for en hangning i parallellblocket hor till
   BIN-468:s omfang.
6. Meningen om ett svep som rekursivt raderar ett bibliotek, i `CleanupSummary`s
   `orphanDataUids`-kommentar i `functions/src/retentionCleanup/runCleanup.ts`.
   Commit `61a5d9dc` lamnade den medvetet orord och bokforde den pa BIN-1193; den stryks
   alltsa inte av den commit som stanger biljetten, och far en egen atgard.

**Re-open when:** nagon av TVA signaturer, och bada maste kontrolleras for hand:

1. En schemalagd korning som loggar `scheduled sweeps done` men aldrig `retentionCleanup
   done` — en hangning i den Auth-berorande svansen. Det ar fallet §5d beskriver.
2. En schemalagd korning som loggar INGEN av raderna — en hangning i parallellblocket.
   Utan den har punkten kan utlosaren inte fyra for den halvan av accepten.

Nar BIN-468 shippar blir bada larmade i stallet for manuella, och den har posten bor da fa
en daterad eftertradare som sager det.

---

## BIN-1120: utträdets FELHANTERING är omskriven, inte bara flyttad — 2026-09-21

Läs det här som ett avgjort val, inte som en öppen avvikelse. Fila inte "lämnarlogiken
skrevs om trots villkoret".

**Villkoret.** Panelen inför BIN-1118/1120/1259 band, genom #4 Security Architect och #12
Trust & Safety, att `LeavePanel` får flyttas in i gruppsidans åtgärdsmeny **utan att
lämnarlogiken skrivs om**. Skälet var #12:s: utträdet ska förbli en klientåtgärd som inte
går via gruppens medlemslista, så att en medlem kan lämna en grupp vars ägare beter sig
illa utan att passera något den ägaren kontrollerar.

**Vad som håller, och hur du kontrollerar det.** Skrivvägen är oförändrad — samma
`leaveGroup(groupId, uid)`, samma `removeMember`-batch på klienten, ingen serverväg,
ingenting routat via medlemslistan. Härled i stället för att lita på den här meningen:

```
git grep -n "leaveGroup(" -- src
git grep -n -A 12 "export async function removeMember" src/lib/firebase/groups.ts
```

**Vad som DÄREMOT skrevs om.** Bekräftelserutans felhantering. Den gamla panelen stängde
i ett `finally`, alltså även när skrivningen föll. Det var uthärdligt när en alltid synlig
knapp satt kvar bakom den; efter flytten ligger omförsöket två klick in i menyn, och en
tyst stängning lämnar inget spår av att något misslyckades. Rutan står nu kvar och byter
text vid fel.

Samtidigt flyttades `onLeft()` och `onCancel()` ut ur skrivningens `try`, med en egen
fångst runt navigeringen. Utan det rapporterades ett kast från `router.push` som att
utträdet misslyckades — över ett `leaveGroup` som redan gått igenom.

**Malins beslut 2026-09-21:** felhanteringen stannar som den är. Villkorets substans är
uppfylld; det var ordalydelsen "utan att lämnarlogiken skrivs om" som inte förutsåg att
just felhanteringen behövde ändras när knappen flyttade.

**INTE accepterat, alltså fortfarande fileable — två saker:**

1. Att SKRIVVÄGEN ändras. Går utträdet någon gång via en serverfunktion eller via
   gruppens medlemslista är #12:s villkor brutet, och den här posten säger ingenting till
   dess försvar.
2. Att `ConfirmDialog`s egna avbrottsvägar är ogrindade. Escape och bakgrundsklicket där
   anropar `onCancel` ovillkorligt medan `busy` bara grindar knapparna. Det är
   förbefintligt och gäller varje användare av komponenten, inte något den här bunten
   införde — men det är samma klass som BIN-1261 och hör dit, inte hit.

**Re-open when:** utträdets skrivväg ändras, eller `ConfirmDialog` får grindade
avbrottsvägar och den här postens punkt 2 därmed faller bort.
