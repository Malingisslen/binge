---
paths:
  - "src/**"
  - "functions/**"
  - "firestore.rules"
  - "docs/org/metrics/**"
  - ".claude/hooks/**"
---

# Accepted Deviations (index)

Deliberate, decided deviations from otherwise-applicable rules. Each heading below is one entry in
`.claude/accepted-deviations.md`, the ledger. **Before filing a finding, or changing code that a
heading below covers, read that entry in full in the ledger.** Do not re-flag anything it decides.

To add a decision, append the entry to the ledger and copy its heading line here, unchanged, at
the end. `scripts/check-deviations-index.mjs` refuses a commit where this list and the ledger's
headings differ.

### [Security] Blocking is hygiene-level, not a security boundary
### [Moderation] Reports are client-create-only with no in-app admin surface
### [Security] Anonymous Tillsammans votes are link-trust only
### [Security/Cost] Tillsammans write rules have NO session-expiry gate — twice decided
### [Security] groups.ts membership-add rollback can strand a late compensating write
### [Data] groups.ts's myGroupsCache write-after-await race — third iteration, self-healing
### [Security/Cost] The watchlist read rule stays fail-OPEN on `effectiveVisibility`
### [Testing] tmdbTosSweep — coverage is NOT what gates the mutating mode
### [Data] The aborted-deletion marker has no natural retirement — and that is the choice
### [UX] A cascade that fails on its FIRST chunk parks a user with intact data
### [Security/UX] A half-deleted session is blocked from writing, not merely warned
### [Security/UX] Daterad efterföljare till posten ovan: BIN-1023:s svep, och vad det inte avgör
### [Data/Cost] communityRatingMaintain swallows transaction failures — a TRANSIENT one is accepted
### [Data/Legal] The cross-device aborted-deletion gap is accepted — the consent re-stamp is NOT
### [Data/UX] Regelgolvet nekar en samtidig redigering — och de sex tystar just det nekandet
## BIN-957: de tre `console.warn`-vägarna rapporterar nu — 2026-08-23
## BIN-975: ingen spärr mot `via:"sprint-parallel"` + `ran:true` — 2026-08-23
## BIN-965: `updateProgress` kan svara `'refused'` om en rad som ändå skrevs — 2026-08-26
## BIN-969: git-apply-hålet i färskhetsstämplingen — 2026-08-26
## BIN-1010: den kvarliggande radens PUBLIKA halva är stängd — 2026-08-26
## 2026-08-29 — kodändrande commits FÖRE `COVERAGE_EFFECTIVE_FROM` kräver ingen `review`-rad (BIN-938)
## BIN-1023: orphan-datasvepet täcker det UID-NYCKLADE, inte det fältägda — 2026-08-30
## BIN-590: lösenordsstyrkan är klientsidig, och det är ett beslut — 2026-08-31
## BIN-1063 steg 2: `friends` och `friendRequestsSent` är inte längre ofrågbara — 2026-09-06
## 2026-09-07 — BIN-1063 steg 3, bunt 2: ägda grupper lämnas över, inte raderas
## 2026-09-07 — BIN-1063 steg 3, bunt 3: svepets dorr ar byggd
## 2026-09-10 — BIN-1147: inbjudningar du SKICKAT overlever inte langre din radering
## BIN-1154: visningsnamnets tva lagringar kan glida isar, och regeln har inget golv — 2026-09-11
## BIN-1162: en gruppmedlemsrad kan behålla det gamla namnet, och ingen städar den — 2026-09-12
## BIN-1155: medlemsradens fältuppsättning är låst, och två fält är borta — 2026-09-12
## BIN-1180: svepets omkontroll skiljer "fick en medlem" från "gruppen är borta" — 2026-09-14
## BIN-1113: vänspeglingarnas raderingspass är byggt — 2026-09-15
## BIN-1187 + BIN-1188: gruppnamnets golv har två kanter som inte byggs — 2026-09-15
## BIN-1129: blockering stoppar en vänförfrågan i reglerna — 2026-09-15
## BIN-1194: `deleteGroup` rör inte `joinAttempts`, och svepet är mekanismen — 2026-09-16
## BIN-1208: en samredigerares listinnehåll får ingen upphovsmärkning — 2026-09-17
## BIN-1150: en skickad gruppinbjudan speglas inte i avsändarens export — 2026-09-17
## BIN-1207: taket på `lists.items` binder ANTAL, aldrig byte — 2026-09-17
## BIN-1211: `list` som anmälningsbar yta är PARKERAD, inte avgjord — 2026-09-17
## BIN-1227: underlaget för `maxListItems()` — 2026-09-17
## BIN-1205: driftbokens pekare till "Blaze vs Spark" får stå kvar — 2026-09-17
## BIN-1240: anmälningar har en admin-yta i appen — 2026-09-19
## BIN-1234: ett feltypat lagrat `items` lagas eller raderas — 2026-09-20
## BIN-1193: en hangd skanning halls tillbaka av FUNKTIONENS timeout, inte av en egen klocka — 2026-09-20
## BIN-1120: utträdets FELHANTERING är omskriven, inte bara flyttad — 2026-09-21
## BIN-1254: notisernas `-refused` skiljer inte raderingskapplöpningen från en utloggad session — 2026-09-22
## BIN-1097: en spöke-medlem lagas genom att lämna och gå med igen — 2026-09-23
## BIN-624: serverns tolkning av dokument-id är mer tillåtande än klientens, med flit — 2026-09-23
## BIN-1267: en förlorad överlämning kan vägra efter att ägarens egna spår raderats — 2026-09-23
## BIN-559: registrering utan anslutning stöds inte, och det är ett beslut — 2026-09-23
## BIN-1260: spårraderingen efter ett utträde är ett eget serversteg, utträdet är oförändrat — 2026-09-23
## BIN-1174: ett namnbyte når skickade vänförfrågningar, inte gruppinbjudningar — 2026-09-23
## BIN-1261: bekräftelsedialogens avbrottsvägar är ogrindade, med flit — 2026-09-23
## BIN-1296: ägarens borttagning raderar den borttagnas spår — 2026-09-23
## BIN-1294: svepet raderar spåren i grupper ett konsolraderat konto bara var medlem i — 2026-09-23
## BIN-1297: `handOverOwnedGroups` utanför en radering tar bort anroparens medlemsrader — 2026-09-24
## BIN-1298: gruppens titelrader har en fältspärr — 2026-09-26
## BIN-1305: partial-märket kan skickas utan sammanfattning — 2026-09-27
## BIN-1313: BIN-1306:s eskalering är återfunnen, dataskyddsrollens pass är Malins beslut — 2026-09-27
## BIN-1317: rensningen larmar själv när en körning dör eller uteblir — 2026-09-27
## BIN-1342: deltagande i någon annans Tillsammans-session exporteras och raderas inte — 2026-09-28
## BIN-1313 avgjord: dataskyddsrollens pass är kört, och dess villkor är byggda — 2026-09-28
## BIN-1349: en blockering avslutar vänskapen och drar tillbaka förfrågningar — 2026-09-29
## BIN-1367: en pushad commit utan biljett-id kopplas till sin biljett via sin sha — 2026-09-30
## BIN-1422: BIN-1193-postens klock-sökning träffar nu backupkontrollen — 2026-10-02
## BIN-1442: tre nya profilfält är ägarskrivbara utan regelgolv — 2026-10-06
## BIN-1426 del 3: en kodändrande commit är skyldig en granskningsrad bara i de känsliga delarna — 2026-10-06
## BIN-1450: paket P:s commits utan biljett-id kopplas via sin sha — 2026-10-06
