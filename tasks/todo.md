# Sprint 2026-09-13b — sessionens värdskap pinnas, gruppens döda lyssnare, exporten får medlemsraden

Rent träd vid start, allt på main. Baslinje mätt vid start: `npm run typecheck` rent,
`npx vitest run` grönt. Talen står i körningens utdata, inte här.

Routningen körs på buntens FAKTISKA filuppsättning före varje kritik och mot
`git diff --cached --name-only` före varje commit.

## Inte valda, med skäl

- **BIN-1182** (radera `getGroupOnce`) — `src/lib/firebase/groups.ts` ensam routar `top`;
  full panel för en radering av en död funktion. Tas när ett annat pass rör filen.
- **BIN-1150** (skickade inbjudningar i avsändarens export) — tolkningsfrågan ställs till
  #5/#6 i bunt C:s kritik. Bygger bara om svaret är entydigt, se bunt C.
- **BIN-1180** (svepets omkontroll) — en tredje regel/funktions-bunt med egen panel; budgeten
  räcker inte till fyra paneler. Lämnad i Backlog.
- **BIN-1179** — kräver en produktionsräkning som nekades förra körningen.
- **BIN-1158** — parkerad med en obesvarad fråga till Malin.
- **BIN-1118 / BIN-521** — etiketten `Feature`/`idea`.
- **BIN-454 / BIN-402** — stående förbud.
- Prosabiljetterna (BIN-1178/1177/1176/1138/1136/1131/1103) — tas inte bredvid kodändringar.

---

## Bunt A — sessionsdokumentet binder vad som får skrivas [Tier C] — BIN-1175

**Disposition: build.** Routning (`node docs/org/route.mjs --md firestore.rules
src/test/rules/firestore-rules.test.ts src/lib/firebase/sessions.ts`): `top` · #27, #5, #4,
#6, #7. Panelen konvenerad blint. Ingen block, ingen konflikt som kräver Malin.

**Konflikt löst i planen:** #27 ville ha en nyckellista per skrivväg; #7 och #4 påpekade att
`request.resource.data` på update är hela dokumentet. Båda tillgodoses: `keys().hasOnly` över
hela fältmängden på båda grenarna, plus `diff(resource.data).affectedKeys().hasOnly([...])` på
update för det som får ändras. #4 kallade typkrav utanför omfånget, #27 krävde dem — tas med,
det konservativa valet.

**Oföränderligheten uttrycks av `affectedKeys`, inte av en separat `hostUid ==`-klausul.** En
explicit klausul bredvid vore en likvärdig mutant som ingen test kan fälla. Muteringen "ta bort
oföränderligheten" är därför att ta bort `affectedKeys`-klausulen.

### Acceptanskriterier (bindande)

1. Värden nekas att peka om `hostUid` på update; fixturen är i övrigt giltig. *(diff)*
2. `deleteField()` på `hostUid` på update nekas. *(diff)* — #4, #7
3. `createdAt`, `expiresAt` och `config` går inte att ändra på update; ett nekande-test per
   fält. `groupId` får nollas (`deleteGroup`s avlänkning går igenom) men inte pekas om eller
   tas bort. *(diff)* — #27, ändrat efter utfallsverifieringen
4. En okänd extra nyckel nekas på create OCH på update. *(diff)* — #7, #6
5. Typkrav: create binder `groupId` sträng-eller-null, `config` map, `status` sträng,
   `candidates` lista, tidsfälten tidsstämplar; update binder `candidates`, `status`,
   `updatedAt`. Ett `expiresAt` som inte är en tidsstämpel nekas på create. *(diff)* — #27
6. Varje verklig skrivväg går igenom: `createSession`s form, kandidatpatchen, statuspatchen,
   etikettpatchen. BIN-1165:s befintliga test står oförändrade. *(diff)* — biljetten, #4, #5
7. En icke-värd nekas fortfarande update. *(diff)* — #4
8. En rad seedad förbi reglerna med ett `hostName` över taket: en kandidatpatch nekas, och
   testet säger att det gäller före och efter. *(diff)* — biljettens tillägg, #7
9. Muteringar en i taget, mutanten hävdad före och efter i samma kommando, återställd ur egen
   ögonblicksbild och verifierad med `git hash-object`: `affectedKeys`-klausulen bort; create:s
   `hasOnly` bort; update:s `hasOnly` bort; varje typkrav bort. Var och en fäller minst ett test.
   *(diff)* — biljetten, #7, #27
10. Fixturerna är syntetiska. Ingen ändring i integritetssidan. *(diff)* — #5, #6
11. Raderingskaskaden hittar värdens sessioner på `hostUid` som förut. *(diff)* — #6

- [x] Regeländring
- [x] Emulatortest per kriterium
- [x] Muteringar. Körda mot en egen emulator med sviten filtrerad till de två sessionsblocken,
  en kontrollkörning grön först. Varje mutant fällde just det test som namnger klausulen;
  `affectedKeys`-mutanten fällde oföränderlighets-, borttagnings- och nyckeltesten på update.
  Filen återställd och verifierad med hash. Utfallet står i körningens JSON, inte räknat här.
- [x] Omroutning på den byggda unionen gav #13, som inte satt i panelen; #13 konvenerad blint,
  support utan villkor.
- [ ] Regeldeploy efter push

## Bunt B — den förlorande fliken startar om sin lyssnare, två testskärpningar [Tier A] — BIN-1181, BIN-1183

**Disposition: build.** Routning utan `groups.ts` (`node docs/org/route.mjs --md
src/components/pages/GroupPageClient.tsx
src/components/pages/GroupPageClient.joinResubscribe.test.tsx
src/test/rules/retention-cleanup-orchestrator.test.ts src/app/grupper/page.tsx`): `medium` · #26.
Kritiken konvenerad. #26: support-with-conditions.

### Acceptanskriterier (bindande)

**BIN-1181**
1. `already_member` startar om prenumerationen; `invalid_token` och `transient` gör det inte. *(diff)*
2. Testet driver hela övergången och hävdar att fliken LANDAR i gruppvyn, inte bara att
   `resubscribe` anropades. *(diff)* — #26
3. Omstarten återfyrar inte joinet. *(diff)* — biljetten
4. Muteringen som tar bort `|| res.reason === 'already_member'` fäller det nya testet och
   inget annat. *(diff)*

**BIN-1183**
1. Muteringen `groupIdOf` → `path.split('/')[0]` fäller omkontrolltestet. *(diff)*
2. ~~Muteringen `??` → `||` fäller minst ett test.~~ **Inte byggd**, se avvikelseloggen. *(diff)*

- [x] BIN-1181 kod + test; muteringen körd: det nya testet föll, de andra i filen stod gröna,
  filen återställd byte-identisk.
- [x] BIN-1183 del 1 + mutering. **Kriterium 1 är INTE uppfyllt som det står.** Muteringen
  `groupIdOf` → `path.split('/')[0]` fällde andra test i filen men inte omkontrolltestet,
  kontrollkörningen grön först, filen återställd byte-identisk. Mekanismen: mutanten gör att
  svepet sparar MER, och en assertion om att projektionen överlever kan inte se det. Det är
  vad BIN-1152:s testgranskning redan sa — fullständighet, inte täckning. Assertionen står kvar
  för att den är sann; biljetten går till In Review med utfallet.

## Bunt C — din egen gruppmedlemsrad ingår i exporten [Tier C] — BIN-1172 (+ BIN-1150 villkorat)

**Disposition: build.** Routning (`node docs/org/route.mjs --md src/lib/firebase/dataExport.ts
src/lib/firebase/userData.ts docs/data-export-format.md`): `top` · #5, #27, #6, #4, #21.
Kritiken konvenerad. Ingen block. BIN-1150:s fråga besvarad (b) av både #5 och #6.

**Placering ändrad av kritiken:** #27 och #6 flyttade oberoende läsningen från
`collectUserDataSnapshots` till `buildUserExport`, samma mönster som hushållsbidragen —
raderingen läser aldrig radens innehåll. #21:s strykningar i `userData.ts` gällde den första
placeringen och faller bort med den. Routa om på den faktiska unionen före commit.

### Acceptanskriterier (bindande)

1. Exporten bär radens FÄLT under ett nytt fält, med `id` = groupId. *(diff)* — biljetten
2. Läsningen görs bara mot den exporterande användarens egen rad; ett test fäller en övergång
   till att lista samlingen eller till ett annat id. *(diff)* — #4, #5, #27
3. En saknad rad och en fallerande läsning hoppas över; exporten fullföljs. *(diff)* — #27, #4
4. Läsningen ligger i `buildUserExport`, inte i den delade hjälparen. *(diff)* — #27, #6
5. Inga fält läggs till utöver de raden bär. *(diff)* — #5, #4
6. `SCHEMA_VERSION` minor-bump med daterad changelog-rad och en rad i README-texten. *(diff)* — #5, #21, #27
7. Nyckeln klassas i täckningstestets grupp-scopade mängd. *(diff)* — #6
8. `docs/data-export-format.md` får fältraden. *(diff)* — #6
9. Tidsstämplar serialiseras råa via `data()`, som övriga. *(diff)* — #27

- [x] Kod + test + dokument
- [x] Muteringar: sökvägen till ett annat id fällde egen-uid-testet och överhoppningstestet;
  borttagen `.catch` fällde överhoppningstestet. Filen återställd byte-identisk.

## Deviation log

- [deviation] BIN-1175: planen sa en explicit `hostUid ==`-klausul → `affectedKeys` uttrycker
  oföränderligheten → ingen separat klausul, och ingen `keys().hasOnly` på update eftersom
  `affectedKeys` redan nekar en ny nyckel.
- [deviation] BIN-1183: del 2 (`??` → `||`) → #26 visade att ett tomt projicerat gruppnamn
  renderas som en tom rad, och reglerna har inget golv på namnet → att pinna `??` låser ett
  synligt val → inte byggd; biljetten tillbaka med #26:s resonemang.
- [deviation] BIN-1172: planen sa den delade hjälparen → kritiken flyttade läsningen till
  exporten → byggd där.
- [discovery] BIN-1175: `MIN_TESTS` i `scripts/run-rules-tests.mjs` höjdes av BIN-1165 till
  sviten uppmätta storlek i samma commit som lade till testen → samma sak görs här, och
  filen routas om före commit.
- [discovery] helsvit: `scripts/prune-map-flag.test.mjs` föll på timeout i en körning medan
  emulatorn och muteringarna gick samtidigt, och var grön ensam direkt efter. BIN-1158:s
  klass; ingen av buntens filer rör skriptet.
- [discovery] BIN-1175, utfallsverifieringen: `deleteGroup` i `src/lib/firebase/groups.ts`
  avlänkar värdens sessioner med `groupId: null` före gruppens egna raderingar. Den första
  regelversionen gjorde `groupId` oföränderlig och hade stoppat en värd från att radera sin
  grupp. Varken planen, panelen eller #13 hittade skrivvägen; regelkommentarens härledning sökte
  bara i `sessions.ts`. → `groupId` får nollas men inte pekas om, test för avlänkningen,
  ompekningen och borttagningen, nya muteringar. Kriterium 3 ändrat därefter.
- [discovery] BIN-1175, andra muteringsvarvet: mutanten som tog bort likhetsledet i
  `groupId`-klausulen överlevde — inget test patchade en gruppstartad session. Det är vägen
  `startSession` i `GroupPageClient` tar före `setSessionCandidates`. Test tillagt;
  `MIN_TESTS` följer sviten.
- [deviation] BIN-1175, testgranskningen (fail, 1 blockerande): typkraven på `candidates` och
  `status` på update gällde hela det sammanslagna dokumentet, så en rad med ett felaktigt värde
  i det ena fältet hade aldrig gått att patcha i det andra — utan att något test visade att det
  var avsiktligt. BIN-1155 valde det villkorade läget för medlemsraden. → villkorade på att
  skrivningen ändrar fältet, två test för läkningsvägen, mutanter i båda riktningarna.
- [deviation] verifieringarna fällde också prosa: en attributionsmening i regeltestet, en mening
  om nyckellistan i legacy-testet, en förklaring i `dataExport.ts` om vad raderingen läser, en
  rad i täckningstestets huvud, fältraden i exportdokumentet (kommandot nådde inte `joinedAt`),
  en bisats i `GroupPageClient.tsx` och ett motsatsled i omkontrolltestet. Alla strukna. Frasen
  "de gör vi bara vid radering" i `userData.ts` struken, så filen går in i bunt C.
- [discovery] BIN-1181, verifieringen: kontrollen att joinet inte återfyras låg efter bytet till
  medlemsvyn, där medlemskollen stoppar ett nytt join ändå. Flyttad till medan vyn är nekad;
  muteringen som tar bort budgetbränningen fäller nu testet.
- [deviation] bunt A: `docs/workflow-map.html` bar meningen att `hostUid`-omskrivningen var
  BIN-1175 och öppen → struken och ersatt med vad regeln binder → kartan committas för sig.


---

# Sprint 2026-09-13 — gruppens medlemslista blir privat, sessionens värdskap pinnas, exporten speglar raderingen

Urval: 4 av 46 backlog-biljetter (BIN-1152 låg redan i Todo). Rent träd vid start
(`git status --porcelain` tomt), allt på main.

**Baslinje, mätt vid start:** `npm run typecheck` rent. `npm test` grönt — 291 filer,
4974 test, 4 hoppade. Basen härleds med `git merge-base --fork-point @{u} HEAD`, aldrig
ur en sha skriven här.

**Routningen körs på de FAKTISKA filuppsättningarna.** Kommandot står vid varje batch.
Kör om det (a) före varje kritik, (b) om en kritik vidgar eller krymper omfånget, och
(c) mot `git diff --cached --name-only` omedelbart före varje commit
(BIN-1050/1052/1122/1165).

## Kända hinder i verktygen (inte biljetter)

**Produktionsräkningen gick inte att köra.** Behörighetsklassificeraren nekade
`node scratchpad/count-prod.mjs` med skälet `[Production Reads]`. Försöket gjordes en
gång och upprepas inte. Senaste mätningen är därför föregående sprints, 2026-09-12,
projektet namngivet `binge-nu`:

```
groups: 0   sessions: 0   users: 4   publicProfiles: 2
```

Det talet är en dag gammalt och **ingen acceptans i den här sprinten lutar sig mot det**
— båda regeländringarna nedan är byggda så att de håller även om en grupp eller en
session har tillkommit sedan dess. Se batch A:s kriterium 9 och batch B:s kriterium 4.
Att kunna köra räkningen igen står under "Needs you".

Port 8080 kan hållas av ett annat projekts emulator. Regeltesterna körs då mot en egen
port: `npm run test:rules -- --port 8123`. Det är skriptets egen dokumenterade väg ut;
`buildAltConfig` härleder konfigurationen ur repots `firebase.json`.

## Inte valda, med skäl

- **BIN-1170** (fler regelgrenar binder vem men inte vad, Low) — fyra `isOwner`-grenar
  plus två valideringsfunktioner, alla i `firestore.rules`. Buntens omfång blir större än
  batch A:s och priorieten är Low; de fyra `isOwner`-grenarna ligger dessutom i ägarens
  eget träd, så ingen främling kan skriva dit. Lämnad i Backlog.
- **BIN-1158** (npm test inte stabilt grön, High) — PARKERAD i sin egen tråd med EN
  obesvarad fråga till Malin. Byggs inte förrän hon svarat. Handbromsen respekteras.
- **BIN-1097** (spöke-medlem) — mätt 2026-09-06 och medvetet lämnad öppen enligt tråden.
- **BIN-1118** (lämna över en grupp) och **BIN-521** (bundle-rådgivare) — etiketten
  `Feature`/`idea`. Produktval, byggs aldrig av en sprint.
- **BIN-1144** (är App Check påslaget?) — Tier D, konsolfråga.
- **BIN-454 / BIN-402** (tmdbFieldsSweep) — stående förbud: `mutateEnabled` flippas
  aldrig av en sprint.
- **BIN-1178 / BIN-1131 / BIN-1176 / BIN-1177 / BIN-1138 / BIN-1136 / BIN-1103** — rena
  prosabiljetter. Lärdomsloggen är entydig: en bunt som nästan bara är prosa konvergerar
  inte (BIN-1028: 41 blockerande fynd över nio varv, noll i koden). De tas i en egen
  körning, inte bredvid tre kodändringar.

---

## Batch A — gruppens medlemslista blir privat [Tier C] — BIN-1152

**Disposition: build.** Malins beslut 2026-09-11 ligger på biljetten: medlemslistan blir
privat, bara gruppnamnet läsbart för icke-medlemmar, mönstret är ett eget litet
projektionsdokument som `publicProfiles`. Handbromsen är lyft.

**Routning, kört på den faktiska unionen:**

```
node docs/org/route.mjs --md firestore.rules src/lib/firebase/groups.ts \
  src/app/grupper/page.tsx src/components/pages/GroupPageClient.tsx \
  functions/src/retentionCleanup/index.ts src/app/integritet/page.tsx \
  docs/data-retention-policy.md src/test/rules/firestore-rules.test.ts
→ Tier top · #27 DBA, #6 DPO, #5 Legal/GDPR, #4 Säkerhet, #26 Informationsarkitekt
```

**Panelen är KÖRD** — på exakt den unionen, i sprinten 2026-09-12, och dess tretton
bindande villkor står på BIN-1152 tillsammans med läsställesinventeringen. Ingen roll
blockerade. Den konvenerades inte om: utfallet ovan är identiskt med det panelen kördes
på. Villkoren är fästa som acceptanskriterier nedan.

### Acceptanskriterier

1. Gruppdokumentet (`ownerUid`, `memberUids`) är läsbart bara för medlemmar; ett eget
   projektionsdokument bär bara gruppnamnet och är läsbart för varje inloggat konto.
   Emulatortest i båda riktningarna. *(kind: diff)*
2. Projektionens skrivregel har `keys().hasOnly(['name'])` plus ett längdkrav — aldrig
   bara ägarbindningen — och en projektion för en grupp som inte finns nekas på create.
   *(kind: diff)*
3. En NEKAD gruppläsning ger skärmen "du är inte medlem", aldrig en oändlig spinner.
   `subscribeToGroup` får `onDenied`/`onError` i samma form som
   `subscribeToGroupHousehold` redan har. *(kind: diff)*
4. "Finns inte" och "finns men du är inte medlem" förblir TVÅ skilda skärmar.
   *(kind: diff)*
5. Förhandsläsningens nekande gatas på `isPermissionDenied` — aldrig en bar catch — och
   rapporteras via `reportGroupWriteError`. `acceptGroupInvite`s
   `groupSnap.data()?.memberUids ?? []` klarar ett SAKNAT dokument men inte ett NEKAT;
   den normala vägen får inte ge en ohanterad rejection. *(kind: diff)*
6. Projektionen raderas på BÅDA raderingsvägarna: klientkaskaden och
   `planGroupHandover` i `functions/src/retentionCleanup/index.ts`. Raderingsgrenen i
   reglerna släpper igenom en projektion vars gruppdokument inte längre finns, så en
   krasch mitt i raderingen inte kan lämna en världsläsbar projektion ingen får radera.
   *(kind: diff)*
7. RaderingsORDNINGEN är pinnad av ett test som fallerar MELLAN de två raderingarna.
   *(kind: diff)*
8. `src/app/integritet/page.tsx` säger att gruppnamnet är läsbart för varje inloggat
   konto; `docs/data-retention-policy.md` får projektionens raderingssteg. *(kind: diff)*
9. En grupp som saknar projektionsdokument (skapad före ändringen) bryter ingenting:
   inbjudningsförhandsvisningen faller tillbaka på det denormaliserade
   `invite.groupName`, och en saknad projektion visas aldrig som ett fel. Test.
   *(kind: diff)*
10. Tre muteringar fäller var för sig minst ett test, körda EN i taget, med
    `grep -c MUTANT` före OCH efter sviten i samma kommando, återställda från en
    scratchpad-ögonblicksbild av ARBETSTRÄDET och verifierade med `git hash-object`:
    (a) läsåtstramningen borttagen, (b) `hasOnly` borttagen ur projektionen,
    (c) projektionsraderingen borttagen ur serversopningen. Utfallen skrivs ned.
    *(kind: diff)*

### Uppgifter

- [ ] Steg 0: läs `match /groups/{groupId}`-blocket, `src/lib/firebase/groups.ts`,
      `useGroups.ts`, `GroupPageClient.tsx`, `src/app/grupper/page.tsx` och
      `planGroupHandover`. Härled projektionens skrivare.
- [ ] Regeländring: gruppdokumentets `read` bindes till medlemskap; ny
      `match /publicGroups/{groupId}` (eller motsvarande namn — härled mönstret ur
      `publicProfiles`) med `hasOnly(['name'])`, längd, och en raderingsgren som
      fungerar när gruppen är borta.
- [ ] Klienthalvan: skriv/uppdatera/radera projektionen där gruppen skrivs; `onDenied`
      i `subscribeToGroup`; förhandsläsningarna gatade på `isPermissionDenied`.
- [ ] Serversopningen: `planGroupHandover` raderar projektionen, ordningen pinnad.
- [ ] Emulatortest + enhetstest per kriterium ovan.
- [ ] Prosahalvan: integritetssidan + `docs/data-retention-policy.md`.
- [ ] Muteringar (a)(b)(c), en i taget, utfall nedskrivna.

## Batch B — sessionens värdskap går inte att skriva om [Tier C] — BIN-1175

**Disposition: build.** En säkerhetslucka, inte ett produktval: `update`-grenen läser
bara dokumentet FÖRE skrivningen, så den som är värd får skriva om hela dokumentet
inklusive `hostUid` till ett godtyckligt uid.

**Routning:**

```
node docs/org/route.mjs --md firestore.rules src/lib/firebase/sessions.ts \
  src/test/rules/firestore-rules.test.ts
→ Tier top · #27 DBA, #5 Legal/GDPR, #4 Säkerhet, #6 DPO, #7 QA
```

**Panelen är INTE körd.** Den konvaneras blint per roll omedelbart före bygget, och
routern körs då om på den union batchen faktiskt fått — inte på den här. Villkoren fästs
som bindande acceptanskriterier.

### Acceptanskriterier

1. `hostUid` går inte att ändra på en update. Emulatortest: värden pekar om `hostUid`
   till ett annat uid och nekas. *(kind: diff)*
2. En nyckellista på efterdokumentet, härledd med ett kommando vars utfall skrivs i
   biljetten. Varje skrivväg koden faktiskt har går fortfarande igenom — en test per
   väg. *(kind: diff)*
3. Ett dokument som redan ligger lagrat med ett `hostName` över taket — seedat FÖRBI
   reglerna med `withSecurityRulesDisabled` — visar vad en vanlig patch gör med det,
   före och efter fixen. *(kind: diff)*
4. Ett vanligt värdflöde (skapa session → byta etikett → avsluta) går igenom oförändrat,
   och kriterium 2:s nyckellista är härledd ur skrivvägarna i koden så att en befintlig
   session inte kan låsas ut. *(kind: diff)*
5. Muteringen som tar bort oföränderligheten och muteringen som tar bort nyckellistan
   fäller var för sig minst ett test, körda EN i taget med `grep -c MUTANT` före och
   efter i samma kommando. *(kind: diff)*

### Uppgifter

- [ ] Kritik: konvenera panelen blint (sonnet, låg ansträngning), en roll per agent.
- [ ] Härled sessionsdokumentets fältunion ur VARJE skrivväg i
      `src/lib/firebase/sessions.ts`, inte ur biljettens uppräkning.
- [ ] Regeländring: `hostUid`-oföränderlighet + `hasOnly` på efterdokumentet.
- [ ] Emulatortest per kriterium.
- [ ] Muteringar, en i taget.

## Batch C — exporten speglar raderingen [Tier C] — BIN-1172, BIN-1150

**Disposition: BIN-1172 build; BIN-1150 build-review.** BIN-1172:s enda öppna fråga är
besvarad på biljetten och är inget produktval — kostnaden är samma läsning
raderingskaskaden redan gör. BIN-1150 bär däremot en genuin juridisk tolkning
("avsändarens andel är namnet, som hen redan har"), så den byggs bara om panelens
Legal- och DPO-roller är eniga; blir de oeniga byggs den INTE och båda sidor skrivs ut
på biljetten för Malin.

**Routning:**

```
node docs/org/route.mjs --md src/lib/firebase/dataExport.ts \
  src/lib/firebase/userData.ts docs/data-export-format.md
→ Tier top · #5 Legal/GDPR, #27 DBA, #6 DPO, #4 Säkerhet, #21 Technical Writer
```

**Panelen är INTE körd.** Konvaneras blint omedelbart före bygget, routern körs om på
den faktiska unionen då.

### Acceptanskriterier

1. `collectUserDataSnapshots` hämtar den egna gruppmedlemsraden, och båda flödena —
   exporten och raderingskaskaden — läser samma hämtning. Ingen ny fråga per grupp
   utöver den kaskaden redan gör. *(kind: diff)*
2. Den exporterade JSON:en bär medlemsradens FÄLT, inte bara nyckeln. Test.
   *(kind: diff)*
3. Ett test fäller om frågan vidgas så att någon ANNANS medlemsrad kan komma med.
   *(kind: diff)*
4. `docs/data-export-format.md` får raden, härledd ur koden, och versionskonventionen
   bumpas. *(kind: diff)*
5. BIN-1150: antingen ett `groupInvitesSent`-fält i exporten med test och dokumentrad,
   ELLER ett daterat skrivet beslut i `.claude/rules/accepted-deviations.md` att
   avsändarens andel inte är personuppgifter som behöver speglas — vilket av de två
   avgörs av panelen, inte av bygget. *(kind: diff)*

### Uppgifter

- [ ] Kritik: konvenera panelen blint.
- [ ] Steg 0: läs `buildUserExport`, `collectUserDataSnapshots`, `accountDeletion.ts`.
- [ ] Koppla in medlemsradsläsningen i den delade hjälparen.
- [ ] Test per kriterium; `docs/data-export-format.md`.
- [ ] BIN-1150 enligt panelens svar.

## Needs you (Tier D)

1. **Produktionsräkningen.** `node scratchpad/count-prod.mjs` nekades av
   behörighetsklassificeraren (`[Production Reads]`). Inget i sprinten lutar sig mot
   talet, men det är värt att kunna köra: lägg en Bash-behörighetsregel för
   Admin-SDK-läsningar, eller kör kommandot själv med `!` i prompten.
2. **Regeldeploy.** Batch A och B ändrar `firestore.rules`. `deploy.yml` deployar bara
   hosting, så reglerna kräver `firebase deploy --only firestore:rules` — du har stående
   tillstånd, så jag kör den efter pushen och rapporterar utfallet.
3. **BIN-1158** väntar fortfarande på ditt svar: räknas ett per-test-undantag från
   5-sekunderstimeouten som samma sak som att höja den?

## Deviation log

- [needs-human] Produktionsräkningen: planen sa "mät om före bygget" → klassificeraren
  nekade `node scratchpad/count-prod.mjs` med `[Production Reads]` → försökte EN gång,
  upprepade inte, och byggde i stället så att ingen acceptans lutar sig mot talet
  (batch A:s kriterium 9). Står under "Needs you".
- [discovery] Muteringen som tar bort `subscribeToGroup`s error-callback ÖVERLEVDE i
  första omgången: `useGroup.denied.test.tsx` mockar just den funktion som bär fixen,
  så hook-testet kan inte se den. Åtgärd: ett direkt test på `subscribeToGroup` i
  `groups.test.ts` som gör `onSnapshot`-mocken observerbar (den slängde bort sina
  argument). Muteringen fäller nu tre test. Samma klass som lärdomen om att fråga
  vilken rad PRODUCERAR signalen man börjat konsumera.
- [discovery] Mitt EGET ordningstest var vakuöst: `indexOf(...)` ger `-1` när mätningen
  förstörs, och `-1 < n` är sant — så testet var grönt för exakt den mutering det fanns
  för. Uppmätt, inte resonerat: mutering C fällde granntestet och inte det. Åtgärd:
  båda indexen pinnas som FUNNA före jämförelsen.
- [deviation] `src/test/rules/retention-cleanup-orchestrator.test.ts` har en EGEN andra
  implementation av samma port, så en ändring bara i produktionen hade varit osynlig
  där. Åtgärd: fixturen speglar produktionen, OCH ett källkodsläsande test i
  `functions/src/retentionCleanup/logic.test.ts` pinnar produktionens egen push-rad så
  de två inte kan glida isär.
- [deviation] `fieldOwnedDocs` i orkestreringstestet gick 16 → 17. Mätt, inte justerat
  för att passa: körningen rapporterade 17, och `publicGroups/solo` är den enda sökväg
  som lagts till i planen.
- [deviation] Två BIN-555-test riktade sitt fel på ANROPSORDNING
  (`mockRejectedValueOnce`). `createGroup` gör två `setDoc` nu, så de hade tyst börjat
  pröva projektionen medan de heter efter medlemsdokumentet. Åtgärd: felet riktas på
  SÖKVÄG, och projektionens egen felgren fick sina två egna test.
- [discovery] `getGroupOnce` har noll anropare (`git grep -n "getGroupOnce" -- src
  functions`) och en signatur som numera ljuger för en icke-medlem. Inte raderad —
  en radering av en exporterad funktion hör till en annan ändring. Kommentar på plats,
  filad som BIN-1179 tillsammans med backfill-frågan.

### Kodgranskningen fällde en ÄKTA regression — den enda i bunten

- [deviation] **En `onSnapshot` som fått permission-denied är DÖD.** Den startar inte
  om när reglerna senare släpper igenom samma läsare — och det är precis vad ett lyckat
  join gör: skrivningen ändrar regelutfallet, inget snapshot-event gör det. Följden av
  MIN egen ändring: den som nyss använt en fullt giltig inbjudningslänk fick skärmen
  "du är inte medlem i den här gruppen" tills hen laddade om sidan. Kommentaren jag
  skrivit intill påstod tvärtom att "ett lyckat join behöver bara att
  grupp-prenumerationen hinner ikapp" — den hinner aldrig ikapp. Struken.
- [discovery] Mönstret och skälet låg redan i repot, en fil bort: `useGroupHousehold`
  bumpar en `epoch` runt opt-in/opt-out mot share-to-see-reglerna, av exakt samma skäl.
  Åtgärd: `useGroup` får samma epoch och exponerar `resubscribe`, som sidan anropar på
  `res.ok`.
- [discovery] **Mitt befintliga test kunde inte se buggen**, och det är lärdomen värd
  att spara: `useGroup.denied.test.tsx`s "ett dokument som landar EFTER ett nekande"
  mockar `subscribeToGroup` och fyrar `onDoc` för hand — något en riktig lyssnare inte
  kan göra efter ett nekande. Det pinnar tillståndsmaskinen och är strukturellt blint
  för om lyssnaren någonsin når det läget. Åtgärd: två test på hooken (en NY
  prenumeration öppnas, den gamla rivs) OCH ett eget test på sidan att anropet görs —
  en `resubscribe` ingen anropar är en permanent no-op med hela sviten grön (BIN-776:s
  form). Muteringarna fäller båda halvorna var för sig.

### Utfallsverifieringen underkände tre kriterier — alla tre åtgärdade

Verifieraren fick bara kriterierna, den skurna diffen och testerna. Den fällde 3 av 10.
Ett av fynden var en ÄKTA koddefekt, och den hade gått till main utan den.

- [deviation] **En TREDJE raderingsväg fanns, och bunten missade den.** Planen och
  panelens villkor 6 namngav två — `deleteGroup` och `planGroupHandover`. Men
  `handOverOwnedGroups` lämnar över bara en grupp som HAR medlemmar kvar, så en ägd
  grupp med ingen annan i den når ägar-grenen i `collectDeletionRefs`
  (`src/lib/firebase/accountDeletion.ts`), som raderade gruppdokumentet och aldrig
  projektionen. `grep -c publicGroups src/lib/firebase/accountDeletion.ts` gav 0.
  Utfallet var exakt det #4 och #6 blockerade på: gruppen borta, namnet kvar. Åtgärd:
  projektionen först i den gruppens refs, plus ett emulatortest med en SOLO-grupp
  (`mygroup` kan inte pröva det — den lämnas över) och muteringen som tar bort raden
  fäller det.
- [deviation] **Villkor 7 var obyggt.** Positionstesterna bevisar KODEN men inget av dem
  drev avbrottet. Åtgärd: ett test som får raderingen att kasta precis på
  gruppdokumentets chunk och visar att projektionen landat och gruppen står kvar. Den
  omvända ordningen fäller det.
- [deviation] **Retentionsdokumentets egen mening var falsk** — den räknade upp två
  vägar och vägen ovan är en tredje. Struken, inte omformulerad: ingen uppräkning, inget
  tal, och backstoppen (regelns `!exists`-utgång) namngiven i stället.
- [deviation] Tre av mina egna publicerade härledningskommandon var osunda, alla mätta
  av verifieraren: `grep -n "name.size() <= 48"` missar `groupName.size()` (stort N) och
  matchar sin egen kommentarsrad; `grep "writePublicGroupName(\|publicGroupRef("`
  namngav en symbol som inte finns i repot och missade varje raderingsställe; och
  `collection(db, 'groups')` missar `AuthContext`, som destrukturerar den som `col`.
  Alla tre bytta mot kommandon jag KÖRT och läst utdatan från.
- [deviation] Två falska uppräkningar av "den enda läsvägen" (regelkommentaren och
  regeltestets kommentar) — verifieraren mätte fler tvärgruppsläsare än jag namngav.
  Strukna; testet pinnar nu FORMEN (`array-contains` mot eget uid), inte en lista.
- [deviation] Den nya testfilen är en ägarkartshändelse (BIN-1013) och fällde två test i
  `docs/org/gen-ownership-map.test.mjs` — men först EFTER `git add`, eftersom kollen
  läser `git ls-files`. Åtgärd: sätet hos #18 Community Manager, där hooken den testar
  redan sitter, och baslinjen regenererad — aldrig `--update-gaps`. Routern kördes om
  efter flytten och gav samma panel.

### Push-grinden: sex blockerande fynd, alla i filer bunten inte rorde

Det ar precis klassen den finns for, och ingen per-fil-granskare kunde se nagot av det.
Fyra granskare hade redan passerat pa exakt de bytes som gick ut.

- [deviation] **Meningen att gruppdokumentet ar lasbart for varje inloggat konto bodde
  pa fler stallen an den forsta granskningen namngav, och ett av dem i PRODUKTIONSKOD
  (`src/components/AuthGuard.tsx`).** Tre tal ar strukna ur den har raden; inget skrivs
  i deras stalle, for jag kan inte skriva ett som ett kommando kan kontrollera — vad som
  raknas som "ett stalle" skiljer sig at beroende pa om man raknar forekomster, filer,
  eller tar med kartan och kunskapsfilen, och ingen lasning gjorde alla talen sanna
  samtidigt. Lydelsen skiljer sig dessutom per fil, sa en enkelradig grep pa en fras
  hittar en delmangd: svepet som fungerade gick pa `memberUids` plus ett andra ord, och
  en kopia stod anda kvar i `firestore.rules`, under den nya lasregeln — den raden bar
  varken `grupp` eller `memberUids` eller `publicGroups`, sa tre olika svep missade den
  av tre olika mekaniska skal. Struket overallt: klausulen om
  MEKANISMEN och orden "and memberUids". Det som overlever ar att en arvd returvag
  laker gruppens NAMN, vilket fortfarande ar sant — via projektionen — sa BIN-669/732:s
  motivering star kvar.
- [deviation] **Rubriken i `firestore.rules` sa motsatsen till raden 22 rader ner.**
  "Group-doc: lasbar for inloggade (unlisted-link-modell)" stod kvar medan samma diff
  band lasningen till medlemskap i samma fil. Struken; grannraden om subkollektionerna
  ar sann och star ensam.
- [deviation] **Integritetssidan lovade en forutsattning regeln inte har.** Den sa
  "lasbart for varje inloggat konto SOM HAR GRUPP-LANKEN". Regeln ar `isSignedIn()` utan
  nagot lankvillkor, och att kanna id:t ar inte atkomstkontroll i det har repot — det ar
  vad hela biljetten handlar om. Struket. Tre systrar sa redan den sanna lydelsen
  (retentionsdokumentet, regeltestet och buntens eget kriterium 8), sa den var dessutom
  motsagd internt.
- [deviation] **Mitt eget tal motsades av mitt eget kommando, igen.** Kommentaren sa att
  strangsvepet nar "de tva stallen som stavar samlingen for hand" och namngav dem;
  kommandot tva rader under returnerar handstavade forekomster i sju filer till,
  daribland emulatorporten som ATERIMPLEMENTERAR sopningens raderingsplan. Struket, utan
  nytt tal.
- [deviation] **Tva ordningstal i `accountDeletion.ts`** ("en tredje vag", "tre vagar")
  lastes som en inventering och var fel i sak: `createGroup`s rollback raderar ocksa ett
  gruppdokument och sin projektion. Strukna, och den harledning som forst stod dar kunde
  anda bara se tva av vagarna — dess pathspec var `-- src`, och sopningen bor under
  `functions/`.
- [deviation] **Sakerhetsgranskarens EGEN kunskapsfil pastod att gruppdokumentets
  `read` inte fragar efter nagot mer an `isSignedIn()`.** Helhetsgranskningen vagrade
  med flit att rora den: `*.knowledge.md` ar ett av strykregelns tre undantag och
  supersederas PA PLATS av agande granskare, med en daterad post i arkivfilen. Den
  agande granskaren gjorde det, och svepte samtidigt sina systerpaastaenden.
- [needs-human] `docs/workflow-map.html` ar osparad och bar TRE konkreta fel (det falska
  lasbarhetspaastaendet; en `createGroup`-nyttolast som raknar tva skrivningar dar det nu
  ar tre, och positionen daremellan ar load-bearing; och svepets lista over det som
  ligger utanfor gruppens undertrad, som namnger bara `publicProfiles/{uid}`). Flaggan
  `.claude/state/workflow-map-stale.json` namnger sju av buntens filer. Tas i EGEN commit
  efter funktionskoden — lardomen 2026-07-10: en funktionsrevert tappar tyst kartprosa
  som ligger i samma commit, och tackningslintern haller sig gron.

  Push-grinden godkande uppdelningen men UNDERKANDE att skulden bara fanns i den
  gitignorerade flaggan: blir foljdcommiten inte av forsvinner arbetsordern med maskinen
  och main bar en falsk flodesbeskrivning medan lintern star gron. Det skulle ha blivit
  en egen biljett — `create_issue` svarade att Linears GRATISTAK ar natt (requestId
  a3a29d307a6ab7a8). Hela fyndet ligger darfor som en fullstandig kommentar pa BIN-1152,
  som LAMNAS I IN REVIEW just for att bara statusen kan bara signalen nu. Taket ar en
  Needs-you-punkt.
- [discovery] En smal lucka i sopningens omkontroll: `isStillEmptyGroup` svarar `false`
  bade nar gruppen fick en medlem OCH nar gruppdokumentet redan ar borta, och i det
  andra fallet filtreras projektionen bort tillsammans med allt annat — varefter uid:t
  aldrig aterkommer. Nara onabar (gruppen maste forsvinna mellan planen och skrivningen
  medan agarens Auth-konto redan ar raderat). Granskningen markte den som valfri. Filad
  som BIN-1180 i stallet for byggd: att skilja de tva fallen ar en beteendeandring i ett
  raderingssvep, alltsa Tier C med panel, natt i femte granskningsvarvet.

### Kriterium 10: de tre muteringarnas utfall, nedskrivna

Villkoret kraver att utfallen SKRIVS NED, inte bara att muteringarna kordes.
Push-grinden pekade ut att ingen sadan uppteckning fanns i buntens filer. Var korning
asserterade mutanten fore OCH efter sviten i samma kommando, aterstallde fran en
ogonblicksbild av arbetstradet och verifierade med `git hash-object`.

| # | Mutering | Utfall |
|---|---|---|
| a | `groups`-lasningen tillbaka till `allow read: if isSignedIn()` | 3 fallda av 573: "en icke-medlem nekas", "en oinloggad nekas", "samma fraga for ett uid som INTE ar medlem nekas" |
| b | `keys().hasOnly(['name'])` borttagen ur `publicGroups` | 1 falld: "ett okant falt nekas" (bade `memberUids`-fixturen och den 5000 byte langa `evil`) |
| c | `publicGroups`-raderingen borttagen ur serversopningens plan | 2 fallda i `logic.test.ts`: den som namnger projektionen och den som pinnar ordningen |

Elva ytterligare muteringar kordes utover de tre. De som ar vart att minnas:

| Mutering | Utfall |
|---|---|
| Ordningen omvand i sopningens plan (projektionen sist) | Falld — ordningstestet |
| Ordningen omvand i `deleteGroup`s refs | Falld — `groups.test.ts`s positionstest |
| Ordningen omvand i sopningens FIXTUR (kortid, inte kalla) | Falld — avbrottstestet mellan de tva raderingarna |
| `publicGroups`-raderingen borttagen ur kaskaden | Falld — emulatortestet med SOLO-gruppen |
| `subscribeToGroup`s error-callback borttagen | **Overlevde forsta forsoket.** Hook-testet mockar just den funktion som bar fixen. Efter ett direkt test pa `subscribeToGroup`: 3 fallda |
| Delningen nekande/transient kollapsad till ett nekande | Falld — "ett TRANSIENT fel gar till onError" |
| Bar catch pa `joinGroupViaToken`s forhandslasning | Falld — "svarar transient nar forhandslasningen faller pa natverket" |
| `updateGroup` slutar skriva projektionen | 2 fallda |
| `epoch` ur `useGroup`s beroendelista | 2 fallda — bada resubscribe-testen |
| `if (res.ok) resubscribe()` borttaget | Falld — sidans anropsstallestest |
| `||` -> `&&` i projektionens delete-gren | 5 fallda, bl.a. bada grenarna i `publicGroups`-blocket |

Tva av fjorton overlevde inte forsta forsoket, och de tva ar hela lardomen: en mockad
granne kan gora fixen osynlig, och `indexOf` ger `-1` sa att `-1 < n` haller ett
ordningstest gront over precis den defekt det finns for.

### Granskningsvarven, och vad de kostade

Fyra granskare, plus utfallsverifieringen. Utfallet per varv:

- **Utfallsverifieringen:** 3 av 10 kriterier underkanda. ETT var en akta koddefekt (den
  tredje raderingsvagen), tva var obyggda eller falska pastaenden. Alla tre atgardade.
- **Kodgranskningen:** 1 blockerande, och det var den enda akta regressionen i bunten —
  den doda lyssnaren. Omkord efter fixen: pass.
- **Sakerhetsgranskningen:** pass, 0 blockerande. Den harledde sin egen skyldiga
  fillista och matte SJU filer dar mitt uppdrag sa sex — mitt tal var inaktuellt,
  eftersom jag stageade `accountDeletion.ts` efter att jag raknat. Ett omatt tal i min
  egen prosa, i ett uppdrag till en granskare vars hela poang ar att inte lita pa
  uppdraget. Den gjorde ratt och matte sjalv.
- **Testgranskningen:** pass, 0 blockerande. Den raknade om `fieldOwnedDocs` 16 -> 17 for
  hand och landade pa samma tal (och redovisade att dess FORSTA rakning var fel, for att
  den glomde att `arrayStrips` raknas mot budgeten).

Fyra ytterligare muteringar foreslogs av testgranskningen. Utfallet:

1. `||` -> `&&` i projektionens delete-gren. **Kord.** Fallde fem test, daribland bada
   grenarna i `publicGroups`-blocket. Tradet aterstallt byte-identiskt
   (`git hash-object` mot ogonblicksbilden) och kontrollkorningen gron: 574.
2. `deleteGroup`s projektion flyttad fran forst till sist. **Redan kord** i den har
   buntens egen muteringsrunda (mutering E) — den fallde ordningstestet.
3. En saknad assertion i "spares a group that gained a member", plus en mutering av
   `groupIdOf`. **Inte gjord:** den kraver en NY assertion, alltsa en kodandring efter
   att tre granskare passerat pa exakt de bytes som gar ut. Filad i stallet — sen
   putsning ogiltigforklarar ledgern.
4. `??` -> `||` i inbjudningsforhandsvisningens fallback. **Inte gjord**, samma skal.
   Filad.

Summa: fjorton muteringar, en i taget, mutanten asserterad fore OCH efter varje korning i
samma kommando, aterstalld fran en ogonblicksbild av ARBETSTRADET och verifierad med
`git hash-object`. Alla fjorton fallde. Tva fallde inte pa forsta forsoket, och de tva ar
det varda att spara: den som tar bort `subscribeToGroup`s error-callback (hook-testet
mockar just den funktion som bar fixen) och mitt eget ordningstest (`indexOf` ger `-1`,
och `-1 < n` ar sant).

## Post-sprint

- [ ] Full `npm run typecheck`.
- [ ] Full `npm test` + `npm run test:rules`.
- [ ] Följdbiljetter filade FÖRE commit.
- [ ] Granskare per `reviewGates` på den stageade diffen; ledgern är beviset.
- [ ] Routa om mot `git diff --cached --name-only` före VARJE commit.
- [ ] Push (= deploy av hosting), sedan regeldeploy.
- [ ] Linear-övergångar parvis med varje commit, aldrig i ett samlat slutsteg.
- [ ] Fold back: lärdomar → `tasks/lessons.md` + digesten i samma redigering.

---

# Arkiv — tidigare sprintar

# Sprint 2026-09-12 — gruppens medlemslista blir privat, och tre fältlås

Urval: 6 av 45 backlog-biljetter (+ BIN-1152 som redan låg i Todo). Rent träd vid start
(`git status --porcelain` tomt), allt på main, `npm run typecheck` rent och `npm test`
grönt: 291 filer, 4974 test. Basen härleds med `git merge-base --fork-point @{u} HEAD`,
aldrig ur en sha skriven här.

**Routningen körs på de FAKTISKA filuppsättningarna.** Kommandot står vid varje batch.
Kör om det (a) före varje kritik, (b) om en kritik vidgar eller krymper omfånget, och
(c) mot `git diff --cached --name-only` omedelbart före varje commit (BIN-1050/1052/1122).

## Kända hinder i verktygen (inte biljetter)

Port 8080 hålls av ett annat projekts emulator (en syskonsession äger processen — döda
den INTE). Regeltesterna körs därför mot en egen port:
`npm run test:rules -- --port 8123`. Det är skriptets egen dokumenterade väg ut, inte en
kringgång; `buildAltConfig` härleder konfigurationen ur repots `firebase.json` så inget
om vilken regelfil som kördes kan glida.

## Mätt i produktion (2026-09-12, föregående sprint, projektet namngivet `binge-nu`)

```
groups: 0   sessions: 0   users: 4   publicProfiles: 2
```

Noll grupper och noll sessioner. **Ingen åtstramning i den här sprinten kan gå sönder
för någon befintlig rad, och ingen migrering behövs.** Det svaret åldras — kör om det
innan någon lutar sig mot det en tredje gång. Kommandot ligger i
`scratchpad/count-prod.mjs` (Admin SDK, projektet namngivet i anropet per BIN-1063).

## Inte valda, med skäl

- **BIN-1158** (npm test inte stabilt grön, High) — PARKERAD i sin egen tråd. Beviskravet
  är tio raka rena körningar av hela `npm test` (~30 min ren körtid, ett `kind: run`-
  kriterium), och release-ansvarige lämnade EN obesvarad fråga till Malin: räknas ett
  per-test-undantag från timeouten som samma sak som att höja den. Byggs inte förrän hon
  svarat. (Sviten var grön i den här sprintens baslinjekörning — flaken är intermittent.)
- **BIN-1097** (spöke-medlem går inte att reparera) — mätt 2026-09-06 och medvetet lämnad
  öppen: noll grupper i produktion, alltså inget spöke. Rekommendationen i tråden är
  "låt den ligga, men behåll den öppen". Respekterad.
- **BIN-1118** (lämna över en grupp du äger) och **BIN-521** (bundle-rådgivare) — bär
  etiketten `Feature`/`idea`. Produktval, listas för Malin, byggs aldrig av en sprint.
- **BIN-1144** (är App Check påslaget för Firestore?) — Tier D, konsolfråga.
- **BIN-454 / BIN-402** (tmdbFieldsSweep) — stående förbud: `mutateEnabled` flippas
  aldrig av en sprint.
- **BIN-1113** (raderingspass för friends/friendRequestsSent) — en helt ny sopmodul under
  `functions/`, större än ett batch-slot i den här sprinten. Lämnad i Backlog.
- **BIN-1131** (falsk mening i AuthContext) — en ren prosastrykning i en high-stakes-fil.
  Lardomsloggen är entydig: en bunt som nästan bara är prosa konvergerar inte. Tas i en
  egen körning, inte bredvid tre regeländringar.

---

## Batch A — gruppens medlemslista blir privat [Tier C] — BIN-1152

> **UTFALL: INTE BYGGD.** Ingen kod skriven, ingenting att återställa. Hela
> panelen är körd och dess tretton bindande villkor står på BIN-1152 tillsammans med
> läsställesinventeringen. Nästa pass routar om på den faktiska unionen — den växte med
> serversopningens fil under functions/ — och bygger därifrån.

Routning (körs om mot den faktiska unionen före kritiken och före commit):
`node docs/org/route.mjs --md firestore.rules src/lib/firebase/groups.ts ...`

Disposition: **build**. Malins beslut 2026-09-11 ligger i tråden: *"gör medlemslistan
privat. Bara gruppnamnet ska vara läsbart för den som inte är medlem... Själva
gruppdokumentet, med `ownerUid` och `memberUids`, blir läsbart bara för medlemmar."*
Handbromsen är lyft och mönstret är utpekat: ett eget litet dokument för den publika
delen, som `publicProfiles` gör för profiler (BIN-505).

Vad som är fel i dag: `allow read: if isSignedIn();` står på
`match /groups/{groupId}`. Varje inloggat konto kan alltså läsa varje grupps `memberUids`
och `ownerUid` — vem som är med i vems grupp går att räkna upp.

Acceptanskriterier:
- [ ] Ett inloggat icke-medlemskonto NEKAS läsning av `groups/{g}`. Emulatortest per
      gren: ägaren läser, en medlem läser, en främling nekas. *(diff)*
- [ ] Gruppens NAMN är fortfarande läsbart för den som inte är medlem, genom ett eget
      projektionsdokument, och inbjudnings-/join-skärmen visar det. *(diff)*
- [ ] Varje läsställe inventeringen namnger är antingen redan medlem vid den punkten
      eller flyttat till projektionen. Ingen skärm läser `groups/{g}` som icke-medlem. *(diff)*
- [ ] Projektionen följer gruppen: den skrivs vid skapande, följer ett namnbyte, och
      raderas när gruppen raderas. Ett test per de tre vägarna. *(diff)*
- [ ] Muteringen som återställer `allow read: if isSignedIn()` fäller minst ett
      regeltest — körd, med utfallet nedskrivet. *(diff)*
- [ ] INTE: ingen profilläsning inne i `firestore.rules`. BIN-609 är CANCELED och den
      fail-open-läsningen är accepterad — föreslå den aldrig igen. *(diff)*
- [ ] INTE: projektionen bär bara namnet. Ingen medlemsräknare, ingen ägare, ingen bild
      — allt sådant är exakt den uppräkning biljetten stänger. *(diff)*

**Tier D (Needs you):** `firebase deploy --only firestore:rules` efter push.

---

## Batch B — sessionsetikettens tak [Tier C] — BIN-1165 (BIN-1170 utdragen)

> **UTFALL: SHIPPAD.** Åtta commitar, 6f55b35 → d54e4c7, pushade. BIN-1170 drogs ut vid
> urvalet; skälet och det härledda fältunderlaget står på den biljetten. Det enda
> blockerande fyndet i koden var ett saknat test på update-grenen; allt annat var prosa.
> Följdbiljetter: BIN-1175, BIN-1177. Tier D kvar: regeldeployen.

Routning: `node docs/org/route.mjs --md firestore.rules src/lib/firebase/sessions.ts ...`

Disposition: **build** båda. Korrekthetsfixar i samma form som BIN-1153/1155 redan
shippat: en gren som binder VEM som får skriva men inte VAD.

BIN-1165: `sessions/{id}` create/update kontrollerar bara `hostUid == request.auth.uid`.
`hostName` har ingen typ- eller längdgräns i reglerna alls — klampningen är bara
klientsidig. Systergrenen `participants/{pid}` kräver redan
`displayName is string && displayName.size() <= 80`.

BIN-1170: `isValidList` och `isValidComment` har noll `hasOnly`-anrop. Härled, lita inte
på meningen: `awk '/^ *function isValidList/,/^ *}/' firestore.rules`.

Acceptanskriterier:
- [ ] `sessions/{id}` create OCH update kräver `hostName is string` och en längdgräns.
      Talet är SAMMA tal som `participants.displayName` redan pinnas mot, inte en andra
      siffra — de två måste flytta i samma redigering. *(diff)*
- [ ] Emulatortest: ett för långt `hostName` nekas; en vanlig sessionsskapning går
      igenom; en vanlig `hostName`-uppdatering går igenom. *(diff)*
- [ ] `isValidList` och `isValidComment` får `keys().hasOnly([...])` + typkontroll per
      fält, härledda ur de vägar som FAKTISKT skriver dokumenten (kommandot skrivs
      bredvid listan i regelfilen, och körs före meningen). *(diff)*
- [ ] Emulatortest per validator: en okänd nyckel nekas, och varje skrivväg koden
      faktiskt har går fortfarande igenom — en test per väg. *(diff)*
- [ ] Mutering PER lås (hostName-gränsen, `isValidList`s nyckellista, `isValidComment`s
      nyckellista) fäller minst ett test. Körd en i taget, utfallen nedskrivna. *(diff)*
- [ ] Strykningen i `createSession`s kommentar i `src/lib/firebase/sessions.ts` som
      BIN-1165:s egen tråd begär görs i samma pass. *(diff)*
- [ ] INTE: de fyra ägar-egna underkatalogerna (`pauseHistory`, `blocked`,
      `notifications`, `fcmTokens`) rörs inte. De har sitt eget omfång i BIN-1170:s
      tråd och skulle vidga den här buntens panel. *(diff)*

**Tier D (Needs you):** `firebase deploy --only firestore:rules`.

---

## Batch C — din egen medlemsrad kommer med i exporten [Tier C] — BIN-1172

> **UTFALL: INTE BYGGD, tillbaka i Backlog.** Premissen är mätt om vid HEAD och
> biljettens "att avgöra" är besvarad på biljetten. Panelen är INTE körd.

Routning: `node docs/org/route.mjs --md src/lib/firebase/dataExport.ts src/lib/firebase/userData.ts`
→ Tier **top** · #5 Legal/GDPR, #27 DBA, #6 DPO, #4 Säkerhet, #18 Community

Disposition: **build**. Raderingen NÅR raden, exporten gör det inte — kontrakten är
alltså inte spegelbilder för data som är personuppgifter. `buildUserExport`s
`groupMemberships` exporterar toppdokumentet `groups/{g}`, aldrig
`groups/{g}/members/{myUid}`, medan `accountDeletion.ts` läser just den raden för
kaskaden. Raden bär visningsnamn, användarnamn, bild, tjänstelista och när du gick med.

Biljettens "att avgöra" är en FORM-fråga, inte ett produktval: kostnaden är en läsning per
gruppmedlemskap, exakt samma läsning raderingskaskaden redan gör. Med noll grupper i
produktion är kostnaden i dag noll, och taket rörs inte.

Acceptanskriterier:
- [ ] Exporten innehåller den anropande användarens egen `groups/{g}/members/{uid}`-rad
      för varje grupp hon är med i. *(diff)*
- [ ] Ett test visar att den exporterade JSON:en bär radens fält — inte bara att nyckeln
      finns. *(diff)*
- [ ] `docs/data-export-format.md` beskriver den nya nyckeln, och beskrivningen härleds
      ur koden i stället för att räkna fält i prosa. *(diff)*
- [ ] Ingen annan användares medlemsrad kan hamna i exporten. Ett test som fäller om
      frågan vidgas. *(diff)*

---

## Batch D — rotens tsconfig.json får en ägare och en granskare [Tier A] — BIN-1130

> **UTFALL: SHIPPAD OCH DONE.** ddfc445, pushad och deployad.

Routning: `node docs/org/route.mjs --md tsconfig.json .claude/shared-plugin.json docs/role-responsibilities.md docs/org/ownership-map.json`
→ Tier **medium** · #25 Engineering Manager / Release Manager

Disposition: **build** (ren bokföring). Mätt, med biljettens egna kommandon:
`node docs/org/route.mjs tsconfig.json` svarar `tier: skip, reasonCode: no-code-paths`
och filen står i `unmapped`, medan `functions/tsconfig.json` svarar `medium` / `[25]`.
Rotens tsconfig står inte i `ACCEPTED_ASYMMETRIES` heller, så det är ingen avgjord
avvikelse — det är ett hål.

Acceptanskriterier — biljettens fyra, plus #25:s sex bindande villkor ur den blinda
kritiken. Rollens villkor 1–4 avgör FORMEN och är därför skrivna som egna rader; de
syns inte i biljetten.

- [x] `node docs/org/route.mjs tsconfig.json` svarar inte längre `no-code-paths`; den
      namnger en ägande roll. *(diff)* → svarar `medium` / `owned` / `[25]`.
- [x] En stagead diff som bara rör `tsconfig.json` NEKAS av commit-grinden med en
      granskare namngiven. Båda riktningarna körda på samma bytes (med mönstret, och
      med det borttaget). *(diff)* → med mönstret nekade grinden och namngav
      `binge-integration-reviewer`; utan det passerade samma stageade bytes rent och
      grinden namngav ingen. Filen återställd efteråt och verifierad med
      `git hash-object`.
- [x] `docs/org/gate-symmetry.test.mjs` är grön UTAN en ny accepterad avvikelse —
      en tystnad där vore hålet en gång till. *(diff)* → `npx vitest run docs/org/`
      grön, ingen ny post i `ACCEPTED_ASYMMETRIES`.
- [x] Båda halvorna i SAMMA commit (routern rådger, grinden blockerar; att vidga den ena
      har aldrig vidgat den andra — BIN-830). *(diff)*
- [x] #25 villkor 1: sätet läggs i §25:s BEFINTLIGA typkontrollsbullet, inte som en ny
      bullet — samma säte och samma storhet som `functions/tsconfig.json`. Ägarkartan
      regenererad i samma commit. *(diff)*
- [x] #25 villkor 2: mönstret läggs i `patterns`, inte i `exact` eller `keyed`. `keyed`
      finns för en fil där bara EN toppnivånyckel ska grinda; den här filen har ingen
      sådan uppdelning. *(diff)*
- [x] #25 villkor 3: `binge-integration-reviewer`, inte `binge-security-reviewer` —
      filen avgör bygg- och typkontrollsomfång, samma klass som `eslint.config.mjs`
      och `lefthook.yml`. *(diff)*
- [x] #25 villkor 4: ankrat exakt `^tsconfig\.json$`, aldrig ett katalogprefix eller en
      glob som också skulle svepa `functions/tsconfig.json` eller en framtida nästlad. *(diff)*
- [x] #25 villkor 5: routern körd om mot `git diff --cached --name-only` omedelbart före
      commit, inte ärvd ur kritiken — att sätta #25 är i sig en omfångsändring. *(diff)*
- [x] #25 villkor 6: båda riktningarna prövade på identiska stageade bytes, och
      symmetritestet kört efteråt. *(diff)*

Granskningsvarv: TRE underkända innan pass. Varje gång satt varje blockerande fynd i
MIN egen prosa och inte i mekaniken, och andra varvets båda fynd satt inne i rättelsen av
första varvets fynd — det mönster lärdomsloggen kallar buntens farligaste prosa. Varv 1:
ett framtidsdatum i noten; "separately-owned" om en fil som ägs av samma roll; och
`package.json` åberopad som precedens för att INTE sätta säkerhetsgranskaren, när
`_note19` gör precis det motsatta för just den filen. Varv 2: en strykning som vidgade ett
sant påstående om ROTENS låsfil till ett falskt om båda, och en pekare till en "blind
spot" vars rubrik säger att den är stängd och beskriver en annan form. Varv 3: den
parentes jag skrev för att BOKFÖRA varv 2:s strykning berättade ett utkastsförlopp som
filens egen historik motsäger — de två meningarna om låsfilerna stod bredvid varandra vid
HEAD, ingen ersatte den andra, vilket `git show HEAD:docs/org/route.mjs` visar. Parentesen
är struken i sin helhet; processberättelsen hör hit, till planen, och inte till koden
(BIN-766/941). Allt struket, inget omformulerat.

Följdbiljetter filade ur granskningen: **BIN-1176** (symmetritestets huvud lovar en
framåtblickande kostnad regeln inte har — förbefintligt, och den här buntens ändring är
beviset).

---

## Batch E — de tre emulatorportarna härleder raderingslistan [Tier A] — BIN-1123

> **UTFALL: UTDRAGEN VID URVALET.** Tillbaka i Backlog; premissen är mätt om på
> biljetten så nästa pass inte behöver göra det.

Routning: körs mot de faktiska filerna före kritiken.

Disposition: **build** (test-gap). Mätt: ingen av de tre EMULATORPORTARNA nämner
`memberTraceWrites` — härled med `git grep -n "memberTraceWrites" -- src functions`,
som visar var den faktiskt nämns, inklusive sin egen enhetstestsvit — medan de tre
emulatorportarna (`src/test/rules/account-deletion.test.ts`,
`group-handover-orchestrator.test.ts`, `retention-cleanup-orchestrator.test.ts`) var och
en bär en identisk handkopierad batch-mock. En ny kategori i `memberTraceWrites` blir
alltså tyst otäckt i alla tre.

Biljettens andra halva (den dubblerade `TraceErasure`-typen) är REDAN lagad —
`logic.ts:17` importerar typen från `runHandover`, en enda deklaration. Bara den första
halvan byggs.

Acceptanskriterier:
- [ ] Mekanismen FÄLLER när en kategori läggs till i `memberTraceWrites` utan att de tre
      portarna följer med. Prövad genom att faktiskt lägga till en kategori och köra,
      med utfallet nedskrivet. *(diff)*
- [ ] Härledningen är inte så total att den blir vakuös: de tre portarna påstår
      fortfarande något om VILKA rader som raderas, inte bara att listorna är lika. *(diff)*
- [ ] `npm run test:rules -- --port 8123` grön, med antalet körda test läst ur utfallet
      (golvet i `scripts/run-rules-tests.mjs` gör en tyst nolla hörbar). *(diff)*

---

## Deviation log

---

# Arkiv — tidigare sprintar

# Sprint 2026-09-12 — namnbytet, gruppens privatliv, och tystnaden när en join nekas

Urval: 6 av 46 backlog-biljetter. Rent träd (`git status --porcelain` tomt) och allt på
main vid start. Basen härleds med `git merge-base --fork-point @{u} HEAD`, inte ur en
sha skriven här — en sha i ett plandokument är falsk i samma commit som den ligger i.

Fyra av de sex är produktval Malin redan avgjort (2026-09-11, ett omvänt 2026-09-12 —
se batch A). Handbromsarna är lyfta. De två övriga är korrekthetsfixar.

**Routningen körs på de FAKTISKA filuppsättningarna, inte på biljetternas meningar om
dem.** Kommandot står vid varje batch. Kör om det (a) före varje kritik, (b) om en
kritik vidgar eller krymper omfånget, och (c) mot `git diff --cached --name-only`
omedelbart före varje commit (BIN-1050/1052/1122).

**Batch 0 går först med flit.** Den ger tre filer i den här sprintens blast radius en
ägande roll. Alla efterföljande paneler routas mot ägarkartan EFTER den ändringen —
gör man tvärtom sitter #14 som fallback på batchar där #18 är den riktiga ägaren.

## Mätt i produktion före bygget (2026-09-12, projektet namngivet: `binge-nu`)

```
groups: 0   sessions: 0   users: 4   publicProfiles: 2
```

Noll grupper och noll sessioner: **ingen åtstramning i den här sprinten kan gå sönder
för någon befintlig rad, och ingen migrering behövs.** Det svaret åldras — kör om det
innan någon lutar sig mot det en andra gång. Kommandot ligger i
`scratchpad/count-prod.mjs` (Admin SDK, projektet namngivet i anropet per BIN-1063).

Att `publicProfiles` (2) är färre än `users` (4) är inte en bugg i sig — projektionen
skrivs först när kontot laddar appen efter BIN-505 — men det är den mätning som gör
batch A:s omvända beslut nödvändigt. Se nedan.

---

## Batch 0 — tre filer utan ägande roll [Tier A] — BIN-1168

Routning: `node docs/org/route.mjs --md docs/role-responsibilities.md docs/org/ownership-map.json`

Disposition: **build** (ren bokföring, inget produktval).

Biljetten namnger `src/app/tillsammans/ny/page.tsx`. Routern namnger två till så fort
den här sprintens övriga filer är med, och alla tre ligger i sprintens blast radius:

```
node docs/org/route.mjs --md src/app/grupper/page.tsx src/components/groups/GroupMembersPanel.tsx src/app/tillsammans/ny/page.tsx
```

→ `⚠ Unowned code path(s)` för alla tre, panel seatad på #14-fallbacken.

**NAMNGE BASLINJEN, annars mäter nästa läsare fel.** Utfallet ovan gäller ägarkartan
FÖRE den här batchen. När batchen väl är committad är den kartan `HEAD~1`, inte `HEAD`,
och ett försök att reproducera mot `HEAD` ger det åtgärdade läget och ser ut som ett
fabricerat protokoll. En granskare gjorde precis det misstaget 2026-09-12. Härled i
stället utan att röra trädet — `fore=0` i vänsterkolumnen är premissen:

```
for p in src/app/grupper/page.tsx src/components/groups/GroupMembersPanel.tsx src/app/tillsammans/ny/page.tsx; do
  echo "$p fore=$(git show 301ee15~1:docs/org/ownership-map.json | grep -c "\"$p\"") efter=$(git show 301ee15:docs/org/ownership-map.json | grep -c "\"$p\"")"
done
```

Sätet följer vad filen HANDLAR om, inte vilken katalog den ligger i (BIN-613):

* `src/app/grupper/page.tsx` och `src/components/groups/GroupMembersPanel.tsx` → **§18
  Community Manager**, som redan äger grupper och sessioner, i dess befintliga bullet
  "Filer som saknade en ägande roll (BIN-871)".
* `src/app/tillsammans/ny/page.tsx` → **§26 Information Architect**. Det är biljettens
  eget förslag och vilar på att systerfilen
  `src/components/pages/TillsammansSessionPageClient.tsx` redan sitter där, satt i
  BIN-871. Samma flöde, samma säte.

Filsökvägar i backticks, aldrig ett katalogtoken — ett backtick-citerat KATALOGtoken
ger rollen hela katalogen (BIN-1080).

Acceptanskriterier:
1. `{diff}` De tre sökvägarna står i sina respektive rollsektioner, var och en som en
   egen backtick-citerad FILsökväg, och `docs/org/ownership-map.json` är regenererad med
   generatorn — aldrig `--update-gaps`, som gör hålet permanent (BIN-1013).
2. `{diff}` Kommandot ovan svarar utan `⚠ Unowned code path(s)` efteråt. Klistra in
   routerns utfall FÖRE och EFTER i commiten; vilka roller som seatas är kommandots
   svar, inte en mening här.
3. `{diff}` Hela sviten körs, inte bara den ändrade buntens test:
   `docs/org/gen-ownership-map.test.mjs` och `docs/org/gate-symmetry.test.mjs` läser
   ägarbaslinjen som INDATA, så en ny ägarrad kan fälla test i filer bunten inte rör
   (BIN-1013).

---

## Batch A — namnbytet når de andra flikarna och gruppmedlemslistorna [Tier C] — BIN-1163, BIN-1162

Routning (kör om efter batch 0):
`node docs/org/route.mjs --md src/contexts/AuthContext.tsx src/lib/firebase/groups.ts`
→ vid urvalet: Tier **top**, full panel.

Disposition: **build** — båda är avgjorda produktval, handbromsarna lyfta.

### Malins beslut, och det ENA som vändes

* **BIN-1163 (2026-09-11):** namnbytet sänds till andra öppna flikar. Inte omläsning
  vid fokus, inte färsk hämtning hos varje skrivare. "Det här ska vara en ren händelse,
  inte ett tillstånd som ska överleva" — ADR 0019 om `localStorage`-flaggor utan
  pensionering.
* **BIN-1162 (2026-09-11):** sluta denormalisera namnet, läs `publicProfiles`.
  **VÄNT 2026-09-12** till motsatsen: skriv om kopiorna. Se nästa stycke.

### Varför BIN-1162:s första svar inte gick att bygga — mätt, inte antaget

Två mätningar mot HEAD, båda 2026-09-12:

1. **En Tillsammans-plats kan sakna konto.** `firestore.rules:1202-1207` tar emot en
   deltagare med `uid == null` på en `anonShapedPid`-väg (32 hex). En plats utan konto
   har inget profildokument att läsa namnet ur — det finns ingen annan plats det kan bo.
2. **En gruppmedlem med privat profil är oläsbar för sina egna gruppkompisar.**
   `publicProfiles/{uid}`s läsregel (`firestore.rules:795-799`) släpper in ägaren, en
   publik profil, eller en vän — ingen av dem beskriver "vi delar grupp". Produktionen
   samma dag: 4 konton, 2 publika profiler.

Båda hade gett TOMT namn i listan. Malin valde därför den andra vägen (2026-09-12):
**skriv om kopiorna vid namnbyte, och lämna Tillsammans orört** (sessioner lever 7
dagar och bär anonyma platser). Se `[[project_bin1162_fanout_decided]]`.

**Följd för BIN-1155:** namnkopian stannar på medlemsdokumentet, så `displayName` hör
kvar i den nyckellistan och identitetsfrågan där löses INTE upp — den besvaras i
stället av att BIN-1163 byggs först.

### BIN-1163 — mekanismen

Mätt före bygget (`src/contexts/AuthContext.tsx`): `user`-state sätts av `setUser`;
`updateDisplayName` skriver Firestore först (`updateUserField`), Auth-posten sedan
(BIN-1154:s avvikelsepost). Filens två `window.addEventListener` bevakar
raderingsmarkören (`storage`) och `emailVerified` (`focus`) — ingen av dem rör
profilfält. Härled i stället för att lita på meningen:

```
grep -n "addEventListener('storage'\|addEventListener('focus'" src/contexts/AuthContext.tsx
```

Fem skrivvägar skickar namnkopian in i en skrivning `isOwnIdentity` binder. Härled
dem — lista dem inte:

```
grep -n "isOwnIdentity(\|matchesOwnIdentity(" firestore.rules
grep -rn "displayName: user" src/hooks src/lib/firebase src/components
```

Acceptanskriterier:
1. `{diff}` Ett lyckat namnbyte når andra öppna flikar i samma webbläsare och
   uppdaterar deras `user`-state, utan att lämna kvar något tillstånd att pensionera.
   `BroadcastChannel` är den form som uppfyller "ren händelse" utan att röra
   `localStorage` alls; väljs något annat ska ADR 0019:s fråga besvaras i koden bredvid.
2. `{diff}` Mekanismen bär **både** `displayName` och `username`. `isOwnIdentity` binder
   båda (`firestore.rules:40-45`), och `updateUsername` har exakt samma inaktuella
   kopia — att bara bära namnet shippar halva fixen.
3. `{diff}` Ett test driver HELA förloppet: håll → sänd → ta emot i en andra
   prenumerant → hävda att skrivningen nu bär det NYA värdet. Ett test som bara pinnar
   att sändningen startar är blint för muteringen som aldrig avslutar den (BIN-645).
4. `{diff}` Kanalen stängs när providern avmonteras, bevisat genom att spionera på just
   den handtaget — inte genom `vi.getTimerCount()` (BIN-790-familjen).
5. `{diff}` En miljö utan `BroadcastChannel` får inte krascha appen; den faller tillbaka
   på dagens självläkande beteende (en omladdning löser det).

### BIN-1162 — mekanismen

Maskineriet finns redan: `updateProviders` (`src/contexts/AuthContext.tsx`) kör
`where('memberUids','array-contains', uid)` med `limit(MY_GROUPS_LIMIT)` och anropar
`updateMemberProviders` per grupp, bäst-möjliga och felsvaljande per grupp. Härled
formen hellre än att lita på meningen:

```
grep -n "MY_GROUPS_LIMIT" src/contexts/AuthContext.tsx src/lib/firebase/groups.ts
```

Reglerna tillåter skrivningen: medlemsdokumentets `selfOrOwner()` täcker en medlem som
skriver sin egen rad, och `joinedAt` lämnas orörd av en patch som bara rör namnfälten
(`firestore.rules:1596-1597` jämför `get(...,null)` på båda sidor).

Acceptanskriterier:
1. `{diff}` Ett namnbyte skriver om `displayName` **och** `username` på varje
   `groups/{g}/members/{uid}` där uid är medlem, med samma tak och samma
   felsvaljande-per-grupp som `updateProviders` — konstanten importeras, kopieras inte
   (samma skäl som står i `updateProviders`' egen kommentar).
2. `{diff}` `joinedAt` rörs inte av skrivningen, bevisat av ett test som fäller om
   fältet kommer med i patchen.
3. `{diff}` `sessions/{id}/participants/{pid}` ändras INTE av den här biljetten. Det är
   Malins avgränsning, och skälet (anonyma platser + 7 dagars livslängd) skrivs i koden
   där avgränsningen syns.
4. `{diff}` Namnbytets EGEN bekräftelse är inte gatad på fan-outen: en grupp som inte
   går att skriva om får inte få användaren att tro att namnbytet misslyckades
   (`updateProviders`' bäst-möjliga form). Men ett fel rapporteras — tyst svaljning är
   det tredje felet (BIN-957-konventionen: `console.error` + `captureError`).

### Panelens bindande villkor (full panel, 2026-09-12)

Fem blinda kritiker: #4 Security Architect, #5 Legal/GDPR, #6 DPO, #27 DBA, #18 Community
Manager. Routningen efter att `GroupMembersPanel.tsx` lades till (villkor 12) ger samma
fem — ingen omkörning behövdes. Villkoren nedan är ACCEPTANSKRITERIER, inte råd.

1. **Nyttolastens nyckeluppsättning är exakt `{uid, displayName, username}`**, pinnad av ett
   test som räknar upp NYCKLARNA — inte av ett test som bara hävdar att de två fälten finns.
   Ett tredje fält ska kräva ett eget beslut, inte glida in genom ett redan öppet rör.
   (#4 blockerande, #5 blockerande, #6 blockerande.)
2. **Mottagaren jämför meddelandets `uid` mot sitt EGET inloggade uid**, läst färskt, innan
   något appliceras. `BroadcastChannel` är scopad på origin, inte på session: ett andra
   konto i en annan flik i samma webbläsare skulle annars adoptera främmande namn — och
   dess nästa egna skrivning nekas av `isOwnIdentity`, alltså exakt den defekt BIN-1163
   finns för, flyttad ett steg. (#4 blockerande, #6 rådgivande.)
3. **Sändningen sker först EFTER att Firestore-skrivningen resolvat**, aldrig optimistiskt
   och aldrig om den kastar. Samma ordning som `updateDisplayName` redan har mot Auth-posten.
   (#4 blockerande, #27 blockerande.)
4. **Ingenting av nyttolasten skrivs till disk** — inte `localStorage`, `sessionStorage`,
   IndexedDB eller någon cache. Bevisat av ett test, inte av prosan. BIN-817 är precedensen:
   profilfält låg i `localStorage` i klartext utan utgång. (#6 blockerande.)
5. **Fan-outen frågar LIVE, aldrig via `myGroupsCache`.** `updateProviders` är syskonet som
   gör rätt; `syncProgressToGroups` är det som läser cachen. Härled var de bor och när
   cachen rivs, i stället för att lita på en mening:
   `grep -rn "const updateProviders" src`, `grep -rn "function syncProgressToGroups" src`,
   `grep -n "invalidateMyGroupsCache(" src/lib/firebase/groups.ts`. (#27 blockerande.)
6. **Fan-outen är gatad på just den skrivning som ändrade fältet.** För namnet: efter att
   `updateUserField('displayName', …)` resolvat, oberoende av Auth-synken, som enligt
   BIN-1154 får fallera utan att fälla namnbytet. För användarnamnet: efter att
   `claimUsername` resolvat. Ett avvisat användarnamn ska ge NOLL gruppläsningar.
   (#27 blockerande.)
7. **Medlemsskrivningen är en smal patch av exakt `{displayName, username}`** via
   `updateDoc`, aldrig `memberFields()` och aldrig `setDoc`. `memberFields()` kräver ett
   `role` som `AuthContext` inte har någon auktoritativ källa för — en omskrivning genom den
   hade kunnat nollställa en medlems roll och stampa över `photoURL`, `providers` och
   `notifications`. Det är också det som håller `joinedAt` orörd: ett fält som utelämnas ur
   patchen uppfyller regelns `get(...,null)`-jämförelse trivialt. (#27 blockerande,
   #6 blockerande.)
8. **`updateDoc`, inte `setDoc(..., {merge:true})`** — båda formerna fallerar säkert om
   medlemsraden hunnit raderas, men bara `updateDoc` fallerar RENT. Merge-formen skulle
   förlita sig på create-grenens `joinedAt`-villkor som en oavsiktlig sista utväg.
   (#27 rådgivande, #6 blockerande: en fan-out får aldrig återuppliva en rad
   raderingskaskaden redan tagit.)
9. **Värdet som skrivs är det REDAN klampade**, samma sträng som gick till `users/{uid}` —
   inte ett omhärlett eller omläst värde. (#27 rådgivande.)
10. **Restens av en halvfärdig fan-out skrivs ned som ett daterat val i
    `.claude/rules/accepted-deviations.md`**, med en re-open-utlösare knuten till ett
    specifikt `captureError`-`kind`. Ett nätverksfel på någon grupp lämnar just de raderna
    med gamla namnet tills nästa namnbyte eller omjoin, och det finns ingen
    avstämningskörning. Samma disciplin som `communityRatingMaintain` redan tvingades till
    av samma säte: tystnad är inget beslut. Posten bär också #27:s punkt 6 — två flikar som
    byter namn SAMTIDIGT kan leverera händelserna i annan ordning än Firestore committade,
    ett smalare återfall av samma klass, självläkande vid nästa namnbyte. (#27 blockerande.)
11. **Kommentaren vid kanalen skriver ut att ingen ändring av integritetspolicyn behövs**,
    med skälet: nyttolasten lämnar aldrig enheten, lagras aldrig, och `isOwnIdentity` läser
    alltid det live-värdet — kanalen är aldrig en auktoritetskälla, bara en kosmetisk
    synk. Annars får nästa granskare härleda om det. (#5 rådgivande.)
12. **Medlemslistan visar användarnamnet som TEXT** (Malins beslut 2026-09-12, mot #18:s
    blockering). Före den här buntens fan-out var namnkopian fryst vid inträdet;
    live-propagering gör ett namnbyte till något som slår igenom i medlemslistan direkt.
    MedlemsRADEN bar redan användarnamnet, men bara som länkmål — komponentens
    inbjudningslista visar det redan som text. En medlem utan användarnamn visar
    ingenting extra, och två sådana kan fortfarande rendera identiskt; resten står i
    komponentens egen kommentar.
13. **Kommentaren vid Tillsammans-avgränsningen beskriver det SYNLIGA symptomet**, inte bara
    det mekaniska skälet: den som är både gruppmedlem och deltagare i en öppen session ser
    sitt nya namn i gruppens medlemslista och sitt gamla i sessionens deltagarlista, potentiellt i
    samma flikbyte. Då läses det som känt och avsiktligt i stället för som en missad fläck.
    (#18 rådgivande.)

**Följdbiljetter panelen namngav — filas i fas 3, byggs INTE här:**

* Medlemsraden `groups/{g}/members/{uid}` ingår inte i artikel 20-exporten;
  `buildUserExport` exporterar toppdokumentet `groups/{g}`, aldrig raden. Luckan är
  förbefintlig, men den här buntens fan-out gör fältet till en UNDERHÅLLEN kopia i stället
  för en bortglömd, vilket är den naturliga utlösaren att fila den. (#5.)
* `users/{uid}/groupInvites/{groupId}.fromDisplayName` och `friendRequests*.fromDisplayName`
  fryser avsändarens namn vid utskick och rörs inte av fan-outen. (#6 och #18 oberoende.)

**Tier D (Needs you):** ingen. Batch A rör inte `firestore.rules`.

---

## Batch B — medlemsraden binder vad som får skrivas, och ett nekande syns [Tier C] — BIN-1155, BIN-1166

Routning, körd på den faktiska filuppsättningen:
`node docs/org/route.mjs --md firestore.rules src/lib/firebase/groups.ts src/components/pages/GroupPageClient.tsx src/app/grupper/page.tsx src/app/grupper/ny/page.tsx src/types/social.ts src/test/rules/firestore-rules.test.ts src/lib/firebase/groups.test.ts`
→ Tier **top**. Vilka roller som seatas är kommandots svar, inte en mening här: kör om
det före varje kritik och mot `git diff --cached --name-only` omedelbart före varje
commit.

Panelen FLYTTADE sig under bygget, och det är själva skälet till att den regeln finns.
Urvalets filuppsättning gav en roster; unionen växte med en medlemslistefixtur och
skapa-grupp-sidan, och den seatade då en roll som inte hade kritiserat något. Den
kritiken kördes före commit, mot den byggda diffen i stället för mot planen, och står
som en egen rad i `docs/org/metrics/events.jsonl`. Den hittade ett blockerande fynd.

**BIN-1152 är UTDRAGEN ur sprinten.** Den kräver ett nytt publikt dokument för gruppnamnet
och en omskrivning av båda inträdesvägarna, eftersom de LÄSER gruppdokumentet innan de går
med — en åtstramning av läsregeln bryter dem. För stort för att hänga på den här batchen.
Beslutet är fattat och står kvar; biljetten bär hela mätningen.

### Vad som är mätt, före bygget

```
awk '/match \/members\/\{memberUid\}/,/^      \}/' firestore.rules | wc -l      → 48
awk '/match \/members\/\{memberUid\}/,/^      \}/' firestore.rules | grep -c hasOnly → 0
```

Kör `wc -l` FÖRE nollan — ett tomt intervall och en frisk nolla ser likadana ut.

Produktion `binge-nu` 2026-09-12: **0 grupper**. Ingen befintlig rad kan brytas, och ingen
migrering behövs. Det svaret åldras.

### Malins beslut 2026-09-12: `role` och `notifications` tas BORT

Dataskyddsrollen blockerade på att låsa fast två fält utan läsare i appen. Mätt: `role`
skrivs och mappas men ägarskap härleds ur `group.ownerUid`, och `notifications` är
hårdkodat `true` på varje skrivväg utan vare sig reglage eller läsare. Malin valde att ta
bort båda hellre än att formellt godkänna dem.

Nyckellistan blir därmed `uid, displayName, username, photoURL, providers, joinedAt`.
Härled den ur `memberFields()` vid bygget — ärv den inte ur den här meningen.

### Acceptanskriterier — BIN-1155

1. `{diff}` `role` och `notifications` skrivs inte längre till medlemsdokumentet, och
   finns inte i nyckellistan. `MemberProfileFields`, `GroupMember` och `memberDocToObject`
   följer med; ingen anropare skickar `role` längre.
2. `{diff}` Nyckellistan är härledd ur `memberFields()` plus `joinedAt`, och kommentaren
   säger hur man härleder om den — aldrig en handskriven uppräkning som kan glida.
3. `{diff}` Värdegränser per fält, och varje tal hämtat från sin EGNA källa:
   `displayName` ≤ `MAX_DISPLAY_NAME` (80 — **inte** gruppnamnets 48; ett snävare tak än
   profilens hade gjort BIN-1162:s omskrivning permanent nekad för den vars namn ryms i
   profilen men inte här, alltså en staleness som aldrig läker), `username` genom den
   befintliga `isValidUsername()`, `photoURL` ≤ 500, `providers` lista ≤ 100.
4. `{diff}` De nullbara fälten accepterar `null`, inte bara sin typ. `memberFields()`
   skriver alltid `username` och `photoURL`, båda `string | null`. Ett bart `is string`
   nekar varje gruppskapande och varje join för ett konto utan avatar eller utan
   användarnamn. Ett emulatortest driver exakt den formen och hävdar att den LYCKAS.
5. `{diff}` `uid` pinnas mot sökvägen: `request.resource.data.uid == memberUid`. Det är
   inte hårdning utan en LIVE lucka — `memberDocToObject` föredrar fältet framför
   dokument-id:t (`data.uid ?? id`) och `GroupMembersPanel` skickar fältets värde till
   `removeMember`, så en förfalskad `uid` får ägarens nästa "ta bort"-klick att radera en
   ANNAN medlem. Samma form som `sessions/.../participants` redan stängde i BIN-509/24.
6. `{diff}` `displayName` och `username` binds till skrivarens LIVE-profil. Panelens
   splittring på den punkten (2026-09-11) är upplöst: databasansvariges invändning var att
   bindningen läser live-värdet medan appen skickade en minneskopia, och den kopian hålls
   färsk sedan BIN-1163. Bindningen stänger samtidigt ägargrenens väg att skriva ett
   godtyckligt namn på en ANNAN medlems rad.
7. `{diff}` BIN-1063 steg 1:s `joinedAt`-villkor på create och update är oförändrade.
8. `{diff}` Ett emulatortest driver en PARTIELL patch — `updateMemberIdentity`s
   tvånyckelsskrivning och `updateMemberProviders`s ennyckelsskrivning — och hävdar att den
   passerar. Vid update är `request.resource.data` HELA efterdokumentet, inte patchen, så
   ett villkor som är snävare än det som redan står lagrat nekar varje sådan skrivning.
9. `{diff}` Ett emulatortest tvingar fram ett schemanekande inne i `joinGroupViaToken` och
   `acceptGroupInvite` och hävdar att `memberUids`-rollbacken fortfarande fyrar. Den
   accepterade avvikelsen om en strandad kompenserande skrivning är skriven för en
   KAPPLÖPNING; den här batchen öppnar en andra, icke-race-orsak för samma väg.
10. `{diff}` Kommentaren vid den nya validatorn säger, som `isValidGroupDoc`s redan gör,
    att en framtida rad som inte uppfyller gränserna blir permanent oredigerbar — och att
    en Admin-SDK-väg som börjar skriva ett fält hit måste vidga listan i SAMMA commit.
    Mätt i dag: `functions/` läser och raderar medlemsraden, den skriver inga fält dit.
11. `{diff}` Emulatortest, inte mockade, och varje nekande-test seedar anroparens profil
    så nekandet kommer från den klausul testet namnger (BIN-1127). Körs med
    `npm run test:rules -- --port 8085` — port 8080 hålls av ett annat projekt och rörs inte.

### Acceptanskriterier — BIN-1166

12. `{diff}` **TRE** skrivvägar klassificerar nekanden, inte två. `createGroup`s
    medlemsskrivning får sitt allra första nåbara `permission-denied` av kriterium 6, och
    dess enda anropare visar i dag ett enda "Försök igen" för varje fel.
13. `{diff}` `acceptGroupInvite` har TVÅ oklassificerade kastställen — `memberUids`-uppdateringen
    (utan try/catch) och `writeMemberDoc`-catchen. De får inte kollapsa till samma svar:
    ett nekande på den första är en inbjudningsfråga, på den andra en schema-/identitetsfråga
    med en annan åtgärd. Att klumpa ihop dem är exakt BIN-942:s misstag.
14. `{diff}` `isPermissionDenied` återanvänds; ingen andra definition, ingen tredje hink.
15. `{diff}` Länkvägen slutar råda till omladdning för ett permanent nekande, och den
    YTTRE texten på sidan lagas också — i dag står "Be ägaren om en inbjudningslänk" kvar
    ovanför felrutan, vilket är fel åtgärd för ett schemanekande. En misslyckad join ska
    peka mot en riktig destination, inte mot att göra om samma sak.
16. `{diff}` Inbjudningsraden får ett tillstånd som ÖVERLEVER toasten. En toast försvinner
    på 2,5 sekunder och raden ser därefter orörd ut, så en användare kan trycka "Acceptera"
    i all oändlighet på ett nekande som är deterministiskt.
17. `{diff}` Texten påstår ingen ORSAK klienten inte kan veta. Den återanvänder inte
    `invalid_token`-strängen (som bär en annan, riktig betydelse) och inte BIN-813:s låsta
    raderingssträngar — juristen svarade uttryckligen att den precedensen INTE når hit,
    så ny text är rätt, den ska bara inte peka ut en orsak.
18. `{diff}` Meddelandet nämner aldrig någon ANNAN användares tillstånd, och exponerar inte
    rått regelfel (som kan röja fältlistan).
19. `{diff}` Nekandena rapporteras med `captureError`. `groups.ts` har i dag noll
    `captureError`-anrop, så en systematisk regelregression här vore osynlig.
20. `{diff}` De två ytorna får LÄSA olika — inbjudningsraden är en liten handling i en
    lista, länksidan är en hel sida man landat på — men ingen av dem får lova ett omförsök
    som inte kan lyckas.
21. `{diff}` Varje producent drivs av ett EGET test; ett test per klausul med en positiv
    tvilling, husets mönster i `src/test/rules/firestore-rules.test.ts`.
22. `{diff}` Hela sviten körs, inte bara buntens test — en ny fil under en katalog
    ägarkartan listar fil för fil är en ägarkartshändelse (BIN-1013).

**Tier D — GJORD 2026-09-12, inte kvar.** Push-deployen gick rött med flit: skyddet i
`deploy.yml` fäller varje push som rör `firestore.rules`, så reglerna inte smygs ut.
Återhämtningen står i skyddets eget felmeddelande och kördes i den ordning som inte kan
gå fel: hostingen först via `gh workflow run deploy.yml` (workflow_dispatch hoppar över
skyddet), sedan Cloudflare-rensningen, sedan `firebase deploy --only firestore:rules`.
Omvänd ordning hade nekat den då live-satta klienten, som fortfarande skriver de två
borttagna fälten.

### Eskalerat till Malin av juristen — egen biljett, inte den här batchen

Medlemsraden bär `providers`, alltså vilka streamingtjänster man har, och den är läsbar för
varje gruppmedlem utan samtyckessteg. Integritetssidan beskriver samtyckesgrindad delning
för Hushålls-kostnadsfunktionen men säger inget om att en bar tjänstelista delas automatiskt
när man går med i en grupp. Ingen av biljetterna skapar luckan och ingen behöver lösa den
för att shippa — men den här batchen låser fast fältet, så det är rätt tillfälle att fila.


## Needs you (Tier D)

1. **`firebase deploy --only firestore:rules`** efter push. Batch B och C ändrar båda
   regelfilen; en deploy räcker för båda. `deploy.yml` shippar bara hosting.
2. **BIN-1158 — npm test är inte stabilt grön.** UTDRAGEN, inte byggd. Två skäl, båda
   ur biljettens egen tråd: beviskravet är tio raka rena körningar av HELA `npm test`
   (~30 minuters ren körtid, ett `kind: run`-kriterium en sprint inte kan producera),
   och release-ansvarige lämnade uttryckligen EN fråga till dig — om ett per-test-undantag
   från timeouten räknas som samma sak som att höja den. Tills dess: en röd deploy som
   bara visar `Test timed out in 5000ms` i `scripts/prune-map-flag.test.mjs` är den
   flaken, inte din ändring. Kör om deployen.

## Känt hinder i verktygen (inte en biljett)

Regeltesterna kräver Firestore-emulatorn, och port 8080 hålls just nu av ett annat
projekts emulator (Butlery). `npm run test:rules` vägrar då köra — det är BIN-1137:s
golv som gör vägran hörbar i stället för tyst grön. Rör INTE den processen; en
syskonsession äger den. Kör i stället batch B och C:s regeltester mot en egen
konfiguration med eget projekt-id och egen port (BIN-1153).

## Deviation log

- [discovery] Den tidigare posten om `src/lib/tabSession.ts` är STRUKEN. Den sa att
  batchen skulle göra filens mening om gruppdokumentets läsbarhet falsk — men BIN-1152
  drogs ut i samma redigering som skrev om batch B, gruppens läsregel är orörd, och
  meningen är alltså fortfarande sann. Lämnad som en anteckning i stället för raderad,
  så nästa läsare inte smalnar en korrekt mening. Mätningen bor på BIN-1152.


---


# Sprint 2026-09-11b — sex biljetter

Urval: 6 av 44 backlog-biljetter. Rena tradet, allt pa main.

Routningen ar kord pa de FAKTISKA filuppsattningarna nedan, inte pa biljetternas
meningar om dem. Kommandot star vid varje bunt; kor om det innan varje kritik och
omedelbart fore varje commit (BIN-1052/1050).

## Bunt A — firestore.rules faltvalidering [Tier C] — BIN-1153, BIN-1155

Routning: `node docs/org/route.mjs --md firestore.rules src/lib/firebase/groups.ts src/hooks/useFollow.ts test/rules/*.test.mjs`
→ Tier **top** · #4 Security Architect, #27 DBA, #5 Legal/GDPR, #6 DPO, #18 Community Manager

Disposition: build (korrekthet/harding, inget produktval).

### BIN-1153 — users/{uid}/following binder inget faltinnehall
Matt fore bygget: `grep -n -A 4 "match /users/{uid}/following/{targetUid}" firestore.rules`
ger `allow read, write: if isOwner(uid);` utan `hasOnly`.

Acceptanskriterier:
1. `{diff}` Grenen binder nyckeluppsattningen och typen pa det falt skrivaren faktiskt
   skriver — harledd ur `src/hooks/useFollow.ts`, inte ur biljetten.
2. `{diff}` Ett nekande-test skriver BADA halvorna (following + followers) i samma
   batch, sa nekandet inte kommer fran en annan klausul an den testet namnger.
3. `{diff}` Befintliga `followers`-villkoren (BIN-1141) ar oforandrade.

### BIN-1155 — groups/{gid}/members/{uid} har ingen faltvalidering
Biljettens premiss "ingen yta kan andra visningsnamnet" FOLL 2026-09-11 (BIN-1154 shippade
en redigeringsyta), sa kedjan biljetten litade pa ar bruten — det gor den mer angelagen.

Acceptanskriterier:
1. `{diff}` Nyckellistan ar harledd ur skrivvagarna i `src/lib/firebase/groups.ts`.
2. `{diff}` Typ och langd per falt; namnlangden matchar det tak `users/{uid}` redan har.
3. `{diff}` BIN-1063 steg 1:s `joinedAt`-villkor pa create och update ar oforandrade.
4. `{diff}` Emulatortest, inte mockade — ett mockat test provar anropets form och
   utvarderar inga regler (BIN-1063).

**Tier D (Needs you):** `firebase deploy --only firestore:rules` gors manuellt.

## Bunt B — Tillsammans namnlangd [Tier A] — BIN-1156

Routning: `node docs/org/route.mjs --md src/app/tillsammans/ny/page.tsx src/components/pages/TillsammansSessionPageClient.tsx src/lib/firebase/sessions.ts`
→ Tier **medium** · #26 Information Architect (+ varning: `src/app/tillsammans/ny/page.tsx` saknar agande roll)

Matt fore bygget: `grep -c maxLength` pa bada falten ger `0`.

Acceptanskriterier:
1. `{diff}` Bada inmatningsfalten har `maxLength` satt till samma tak som regeln kapar vid.
2. `{diff}` `createSession` och `joinSession` klampar namnet som sista skyddsnat.
3. `{diff}` Varje producent drivs av ett EGET test — BIN-1134 visade att en av tre
   klampningar overlever sviten annars.
4. `{diff}` `firestore.rules` ar INTE andrad av den har biljetten.

## Bunt C — inloggning och installningar [Tier B] — BIN-1157, BIN-1161

Routning: `node docs/org/route.mjs --md src/components/settings/UsernameSection.tsx src/components/settings/ProfileSection.tsx src/app/login/page.tsx`
→ Tier **medium** · #19 Customer Support / Success

### BIN-1157 — ett avstangt konto far radet att kolla sin internetuppkoppling
Disposition: **build-review**. Koden ar sjalvklar; texten till nagon som just blivit
avstangd ar Malins att titta pa.

Acceptanskriterier:
1. `{diff}` `auth/user-disabled` och `auth/too-many-requests` far var sitt meddelande.
2. `{diff}` Texten for `user-disabled` sager vad personen kan gora hardnast.
3. `{diff}` `.claude/rules/accepted-deviations.md`s BIN-590-post ar last fore skrivningen.

### BIN-1161 — installningarnas falt saknar etikettkoppling
Harlett svep (inte biljettens mening): de vevande `<label>`-omslagen i
`ContentFilterSection` och `NotificationsSection` ar implicit kopplade och OK;
`ProvidersSection` anvander `aria-label`. Luckan ar `UsernameSection` — anvandarnamn,
bio och radiogruppen "Standardsynlighet", alla med frikopplade etiketter.

Acceptanskriterier:
1. `{diff}` Anvandarnamn och bio far `<label htmlFor>` mot ett `id` pa kontrollen.
2. `{diff}` Hjalptexten under respektive falt nas via `aria-describedby`.
3. `{diff}` Radiogruppen far en gruppetikett en skarmlasare annonserar.
4. `{diff}` `autoComplete` dar det finns ett meningsfullt varde.

## Bunt D — npm test ar inte stabilt gron [Tier A] — BIN-1158

Routning: `node docs/org/route.mjs --md scripts/prune-map-flag.test.mjs .claude/hooks/freshness.test.mjs vitest.config.ts`
→ Tier **medium** · #25 Engineering Manager / Release Manager

Bindande villkor ur biljetten: **hoj inte default-timeouten och ror inte assertionerna.**

Acceptanskriterier:
1. `{diff}` Orsaken ar MATT fore atgarden — hur lang tid en `git`-spawn faktiskt tar,
   och om testen delar en resurs. Matningen star i biljetten.
2. `{diff}` Atgarden ar isolering eller serialisering, inte en hojd timeout och inte
   en forsvagad assertion.
3. `{run}` `npm test` kors om tre ganger i rad med samma utfall.

## Deviation log

- [needs-human] BIN-1155: planen lade den i bunt A med BIN-1153. Panelen gav en
  OLOST KONFLIKT — #4/#5/#6 kraver identitetsbindning av `displayName`/`username`
  och blockerar utan den; #27, som ager faltkontraktet, blockerar PA den (den
  vidgar BIN-1163:s kanda fel till tre nya skrivvagar); #18 blockerar separat pa
  tyst nekande. Biljetten drogs ur, ingen kod skriven, parkerad blockerad av
  BIN-1163. Konflikten star utskriven pa biljetten.
- [deviation] Bunt A KRYMPTE till BIN-1153 ensam. Routern kordes om pa den
  faktiska unionen och gav en ANNAN panel — #7 QA tillkom, #5 foll bort. #7
  konvenerades separat och blockerade pa ett saknat test; testet ar skrivet.
  Kommandot och utfallet:
  `node docs/org/route.mjs --md firestore.rules src/hooks/useFollow.ts src/test/rules/firestore-rules.test.ts`
  → `Tier top · #27, #4, #6, #7, #18`
- [deviation] Bunt B VIDGADES: #26:s villkor drog in `src/lib/clampText.ts`.
  Routern kordes om pa unionen och gav samma tier och samma roll:
  `node docs/org/route.mjs --md src/app/tillsammans/ny/page.tsx src/components/pages/TillsammansSessionPageClient.tsx src/lib/firebase/sessions.ts src/lib/clampText.ts src/lib/clampText.test.ts`
  → `Tier medium · #26`
- [deviation] Bunt C: #19 flaggade ett kontoexistens-orakel i #4:s mandat. #4
  konvenerades pa just den fragan och kravde en HEDGAD lydelse. Den shippade
  texten uppfyller bada roller; lydelsen ar anda Malins att godkanna, sa
  BIN-1157 parkeras i In Review.
- [needs-human] BIN-1158: #25 satte beviskravet till tio raka rena hela
  `npm test`-korningar. Det gar inte att mota inom sprinten. Biljetten drogs ur
  FORE bygget, ingen kod skriven, tillbaka i Backlog med villkoren som rubrik.

- [deviation] Testgranskaren fallde commit A: typkravet hade inget update-fall, sa
  en mutering som tar bort det bara pa update-grenen overlevde alla 526. Samma hal
  fanns i followers-blocket (BIN-1141). Ett update-fall per block tillagt; var och
  en av de tva muteringarna faller exakt sitt eget nya test.
- [deviation] Helhetsgranskaren fallde commit B tva ganger. (1) En kommentar i
  sessions.ts pastod att bada namnen matas av samma inmatningsfalt - falskt for
  GroupPageClient. Struken i koden och i commit-texten; loggraden fick en
  correction-rad. (2) Den nya testfilen saknade agare i agarkartan, vilket hade
  fallt tva test i npm test och gjort deployen rod. Den helt grona korningen fore
  stagningen bevisade ingenting: kontrollen laser git ls-files.
- [discovery] Tva emulatorkorningar dodades av OS:et vid minnesbrist. Bada gangerna
  stod mutanten kvar i firestore.rules; aterstalld fran egen snapshot och
  hash-verifierad mot den granskade versionen.
- [discovery] En loggrad om hur manga test en mutering faller namngav inte
  muteringen: bada htmlFor borttagna ger 5 av 6, bara htmlFor=username ger 4 av 6.
  Ny correction-rad namnger bada.

## Utfall

| Biljett | Byggd | Muteringar korda | Utfall |
|---|---|---|---|
| BIN-1153 | ja | 5 (hasOnly, typkrav, isOwner, typkrav bara pa update-grenen x2 block) | 528/528 regeltest grona |
| BIN-1156 | ja | 4 (vardera klampning + surrogatvakten) | 6/6 nya test |
| BIN-1157 | ja | 1 (felkoden i grenen) | 12/12 i login-sviten |
| BIN-1161 | ja | 2 (etikettkoppling, radiogrupp) | 6/6 nya test |
| BIN-1155 | NEJ | — | olost rollkonflikt, parkerad |
| BIN-1158 | NEJ | — | beviskravet ryms inte, tillbaka i Backlog |

Commitar: BIN-1156 `0b7d284`, BIN-1157 + BIN-1161 `3c5dde8` — pushade tillsammans (`cc5b1a7..3c5dde8`) fore regelandringen, sa att deras deploy inte stoppas av regelvakten. BIN-1153 `d58449b` pushas separat; regelvakten i deploy.yml stoppar den deployen med flit tills reglerna deployats manuellt.

## Needs you (Tier D)

- Manuell `firebase deploy --only firestore:rules` efter bunt A.

## Ej valda — kraver ditt beslut

- **BIN-1162 + BIN-1163** (namnbytet foljer inte med till gruppmedlemslistor /
  andra flikar nekas). Bada ar foljder av BIN-1154. Bada har tva-tre mekanismval med
  olika kostnad mot 25 SEK-taket, och bada ar `top` pa `AuthContext.tsx`. Ett val, inte
  ett bygge.
- **BIN-1152** (gruppdokumentet lasbart for varje inloggat konto). Regelfilens egen
  kommentar sager att det ar en medveten "unlisted link"-modell. Att strama at ar ett
  produktval.
- **BIN-1118** (lamna over en grupp), **BIN-521** (bundle-radgivare) — `Feature`/`idea`,
  byggs aldrig av en sprint.

## Efter sprinten

- Manuell regeldeploy.
- Foljdbiljetter filas FORE commit.

---

# BIN-1154 - visningsnamnet far en redigeringsyta [Tier B/C]

Malins beslut 2026-09-11: bygg ytan. Biljetten var parkerad som ett produktval;
den handbromsen ar nu lyft av henne, i klartext ("ja bygg den").

## Vad som ar matt FORE bygget

- `src/components/settings/ProfileSection.tsx` RENDERAR `user.displayName` men
  har ingen kontroll for att andra det. `grep -rn "displayName" src/components/settings/`
- `updateUserField` finns och ar generisk, men har inget `displayName`-anropsstalle.
  `grep -rn "updateUserField(" src`
- Regeln behover INTE andras. `users/{uid}`s update-gren binder redan
  `displayName` till hogst 80 tecken:
  `awk '/match .users.{uid} {/,/^    }/' firestore.rules | grep -nE 'displayName|bio'`
  Alltsa ingen manuell regeldeploy for den har biljetten.
- Den publika projektionen foljer AUTOMATISKT. Effekten i `AuthContext.tsx` som
  anropar `syncMyPublicProfile` har `user?.displayName` i sin beroendelista, sa
  en lyckad skrivning stammer om projektionen utan extra kod.

## Skarmen

```
+-- Profil ---------------------------------+
|                                           |
|  Namn                                     |
|  +-------------------------------------+  |
|  | Malin                               |  |
|  +-------------------------------------+  |
|  Visas for andra i notiser och pa din     |
|  profil. Max 80 tecken.                   |
|                                           |
|  E-post:  malin@exempel.se                |
|                                           |
|  [ Logga ut ]                             |
+-------------------------------------------+
```

Placeringen ar vald, inte fragad: faltet ligger dar namnet redan visas, i
`ProfileSection`. Alternativet var `UsernameSection`, dar bio och anvandarnamn
redigeras - men da star namnet kvar som dod text en ruta ovanfor, vilket ar
precis det som gor att man inte hittar redigeringen.

Monstret ar bio-faltets: kontrollerat falt, sparar pa blur, toast vid utfall.

## Vad som byggs

1. `updateDisplayName(name)` i `AuthContext`:
   - trimmar, VAGRAR tomt (namnet visas i notiser pa andras lasskarmar; tomt ar
     samre an det gamla),
   - klampar med `clampToCodeUnits(..., MAX_DISPLAY_NAME)` - inte ett bart
     avhugg, av samma skal som resten av BIN-1134,
   - skriver Firestore via `updateUserField`,
   - skriver OCKSA Auth-posten via `updateProfile`. Det ar den andra lagringen
     av samma personuppgift, och BIN-1154 avsnitt 2 handlar om att de tva glider
     isar. En redigering som bara lagar den ena gor asymmetrin varre.
   - KASTAR vid vagran. Skrivvagen kan neka, och en ovillkorlig toast gor
     varje vagran till en logn - se lardomen om det. Den slutliga formen star
     i villkorsavsnittet nedan, som ar det som galler.
2. `ProfileSection`: faltet, `maxLength={MAX_DISPLAY_NAME}`, hjalptext, och en
   bekraftelse som bara visas om await:en inte kastade.
3. Test: klampningen, tomt namn vagras, bada lagringarna skrivs, och en vagran
   toastar inte framgang.

## Acceptanskriterier

1. Man kan andra sitt visningsnamn i installningarna och det syns direkt. *(diff)*
2. Ett namn over taket kortas av redan i faltet, och ett inklistrat langt namn
   likasa - inte tyst vid skrivningen. *(diff)*
3. Ett tomt namn sparas aldrig. *(diff)*
4. Bade Firestore-dokumentet och Auth-posten bar det nya namnet efter en lyckad
   redigering. *(diff)*
5. En vagrad skrivning bekraftas INTE i UI. *(diff)*
6. Muteringen som tar bort klampningen faller minst ett test. *(diff)*
7. Ingen regelandring, alltsa ingen manuell deploy. *(diff)*

## Panelens bindande villkor — infolierade 2026-09-11

Fem blinda kritiker, alla `accept-with-conditions`. Villkoren nedan ar bindande
acceptanskriterier, inte forslag.

### Kontraktet (#14, MUST 1)

`updateDisplayName` returnerar `Promise<void>` och KASTAR vid vagran — inte ett
utfallsobjekt. Skalet: varje annan faltuppdaterare i `AuthContext` signalerar
misslyckande genom att kasta, och anroparens `try/catch` toastar. `ItemWriteOutcome`
finns i `WatchlistContext` bara for att de sex vagarna SVALJER `permission-denied`;
har sväljs ingenting. Tva kontrakt i samma granssnitt ar det som ska undvikas.

`ProfileSection` gatar sin bekraftelse pa att `await` inte kastade. Det ar samma
sak som #19 begarde, uttryckt i husets egen form.

### Skrivordningen (#27 MUST 1, #5 MUST 1)

1. Firestore FORST, via `updateUserField('displayName', klampat)`.
2. Auth-posten ENDAST om steg 1 gick igenom.

Skalet ar inte estetiskt. `mergeUserDoc`/`assertProfileWritable` ar den enda
spärren som stoppar en profilskrivning under en pagaende radering. `updateProfile`
gar inte genom den chokepointen alls. Ett ovillkorligt Auth-anrop hade alltsa
latit ett markerat konto andra sin Auth-post medan Firestore korrekt nekade —
precis det hal ADR 0019 och BIN-816 stangde.

### Det tredje utfallet (#27 MUST 2, #5 MUST 1)

Firestore lyckas, Auth-skrivningen fallerar. Det ar VARKEN en ren framgang eller
en vagran, och tystnad ar inte ett beslut.

**Avgjort: det raknas som FRAMGANG, med en loggad avvikelse.** Den auktoritativa
kopian ar sparad, projektionen foljer den, och anvandaren ser sitt nya namn —
att kasta dar hade sagt "sparades inte" om ett namn som ar sparat. Avvikelsen
rapporteras med `console.error` + `captureError({ scope: 'auth', kind:
'updateDisplayName-authSync' })`, samma konvention som BIN-957:s fyra vagar.

Det upphaver #14:s MUST 2: invandningen var att ett kast efter `setUser` skulle
bekrafta en vagrad skrivning. Med det har utfallet kastas det inte.

### Aterupplivningsresten (#27 MUST 3)

`createProfileWithConsent` bygger `displayName` ur `firebaseUser.displayName`
ensamt. En Auth-post som blivit efter enligt ovan ar alltsa vad som skrivs
tillbaka om `users/{uid}` senare raderas och ateruppstar (avbruten radering,
atersamtycke). Anvandarens eget namn kan tyst falla tillbaka till ett aldre
varde. Eget konto, egen historik, ingen lacka.

Stangs med en daterad post i `.claude/rules/accepted-deviations.md` — den ska
ocksa bokfora att regeln INTE har nagot golv pa `displayName` (`size() <= 80`
saknar undre grans), sa AC3 ar klientsidig (#27 SHOULD).

### Vad anvandaren ser (#19 MUST 1-3, #2 MUST 2)

- Tomt namn: faltet ATERSTALLS synligt till senast sparade namn — aldrig kvar
  som tomt — och en toast sager varfor.
- Vagrad skrivning: egen feltoast, bios lydelse.
- Toasten lever 2,5 sekunder, sa aterstallningen av faltet ar den bestaende
  signalen. Den ar inte valfri.

### Tillganglighet (#2 MUST 1 och 3)

`<label htmlFor>` mot ett `id` pa faltet, `aria-describedby` mot hjalptexten,
och `autoComplete="nickname"` (inte `name`, som betyder juridiskt namn). Kopiera
INTE grannfaltens omarkerade monster framat; deras egen lucka ar filad som
BIN-1161.

### Hjalptexten (#5 MUST 2)

"Visas for andra i notiser och pa din profil" underdriver. Namnet syns ocksa i
recensioner, kommentarer, gruppmedlemslistor, vanlistor, Tillsammans-sessioner,
sokresultat, flodet och avsnittsreaktioner. Rakna INTE upp dem — en uppraekning
gar inaktuell. Lydelsen blir:

    Visas for andra anvandare i appen, till exempel i notiser och pa din profil.

### Exportluckan (#5 MUST 3)

Auth-postens kopia har aldrig ingatt i artikel 20-exporten och gor det inte
heller efter den har andringen — varken skapad eller forvarrad har. Filad som
**BIN-1160**, inte byggd i den har bunten. BIN-1150 tacker den INTE; den handlar
om skickade gruppinbjudningar.

### En mening som var fel i kritiken

#19 SHOULD 3 antog att ett inklistrat langt namn star kvar i faltet tills blur.
Det gor det inte: HTML `maxlength` begransar varje anvandarinmatning i
kontrollen, inklistring inraknad. Matt i BIN-1134. Klampningen i
kontextfunktionen ar darfor ett skydd for anropare som inte kom fran formularet,
inte for inklistringen.

## Routning

Arv aldrig ett routningstal harifran. Urvalet gissade pa en mindre
filuppsattning an den byggda, och `.claude/rules/accepted-deviations.md` bytte
panelen fran #14 till #25. Harled i stallet, fore varje kritik och fore varje
commit:

    node docs/org/route.mjs $(git diff --cached --name-only)

#25 konvenerades blint pa den byggda diffen nar omkorningen visade att rollen
tillkommit.

---

# Sprinten 2026-09-10 - sju biljetter i tva buntar

Urval: 40 oppna biljetter i Backlog, noll i Todo/In Progress. Premisskontrollen
kordes mot HEAD (847d093) for varje kandidat innan nagon valdes - inte mot
biljettexten. Kommentarstradarna pa alla sju ar TOMMA (kontrollerat en och en
med `list_comments`), sa ingen parkerad handbroms galler nagon av dem.

BIN-1142 ar en DUBBLETT av BIN-1134 - samma rad i samma gren, samma fix. Den
byggs inte separat; den stangs mot samma commit.

## Uppmatt mot produktion (binge-nu) 2026-09-10, fore bygget

Kommandot ligger i scratchpad och namnger projektet uttryckligen (lardomen om
ADC och tyst fel databas). Utfall:

- `groups`: **0 dokument**. Ingen legacy-grupp kan lasas ut av en nyckellista.
- `users`: **4 dokument**, langsta `displayName` **13 tecken**, noll over 80.
- `followers` (collection group): **2 dokument**, enda nyckeln `followedAt`.

Det svarar pa legacy-fragan i BIN-1128 (kriterium 3), BIN-1140 och BIN-1134
med en matning i stallet for ett antagande. Svaret aldras: mat om det innan
reglerna deployas om det drojer.

## Routning - kord pa varje bunts faktiska filunion

Ett routningstal far ALDRIG arvas in i ett senare varv. Routa om omedelbart fore
varje kritik och fore varje commit med
`node docs/org/route.mjs $(git diff --cached --name-only)`.

Den har sessionen kan konvenera bade en enskild kritik och en full panel, sa
ingen bunt behover parkeras for utebliven kapacitet.

## Ordningen — RATTAD 2026-09-11, under bygget

Urvalet skrev att bunt 1 gar FORE bunt 2, med skalet att BIN-1137 gor bunt 2:s
bevis otillforlitligt. Den premissen holl inte: `npm run test:rules` MATTES ge
exit 1 med porten upptagen, pa bada CLI-versionerna. Beviset
var alltsa palitligt sa lange nagon laste utdatan.

Commit-ordningen ar i stallet REGLERNA FORST, av ett annat skal: `scripts/test-rules.mjs`
raderas, och de fall som bara fanns dar flyttas till `src/test/rules/firestore-rules.test.ts`.
Raderingen och flytten maste ligga i SAMMA commit, annars finns ett mellanlage
dar tackningen ar borta. Den commiten ar regelbunten. Omslagsskriptet och
grindarna foljer i commit tva; ingenting anropar det raderade skriptet, sa den
ordningen bryter ingenting.

Bada commitarnas filunion routas om omedelbart fore varje commit.

---

## Bunt 1 - regeltesternas trovardighet [Tier A]

Kritik: enskild, `#4 Security Architect`, blint, fore bygget.

### BIN-1137 - regeltesterna kan se grona ut utan att ha kort

Premiss verifierad vid HEAD: `package.json`s `test:rules` ar
`firebase emulators:exec --only firestore --project demo-binge-rules "vitest run
--config vitest.rules.config.ts"`. Inget i kedjan sager till nar emulatorn
aldrig startade.

- [ ] Mat FORST hur `firebase emulators:exec` faktiskt beter sig med porten
      upptagen - exitkod och utdata, bada nedskrivna. Skriv ingen mening om
      det innan kommandot kort.
- [ ] En korning dar porten ar upptagen avslutar med skilt fran noll. *(diff)*
- [ ] En kontroll som faller om vagen nagonsin blir tyst igen. *(diff)*
- [ ] Fragan ledig port kontra hart fel ar BESVARAD i biljetten, inte avgjord
      i forbigaende. *(diff)*
- [ ] Vad CI gor med regeltesterna i dag ar nedskrivet, harlett med ett
      kommando som star bredvid svaret. *(diff)*

### BIN-1145 - `scripts/test-rules.mjs` ar rott och ingen kor det

Premiss verifierad vid HEAD: filen finns (238 rader), inget i `package.json`
eller `.github/workflows/` anropar den.

- [ ] Avgor de tva fragorna i biljetten mot KODEN: ar Tillsammans-fallet fel
      eller ar regeln fel, och ska skriptet finnas kvar. Las
      `.claude/rules/accepted-deviations.md` och ADR 0015 forst - de tva
      accepterade riskerna kan gora fallet inaktuellt.
- [ ] Ingen unik tackning gar forlorad: varje fall som bara finns i skriptet
      ar flyttat till emulatorsviten innan skriptet tas bort. *(diff)*
- [ ] Efter atgarden finns inget regeltest som ingen automatik kor. *(diff)*

## Bunt 2 - firestore.rules: fyra hal i profil, foljare och grupp [Tier C]

Kritik: full panel `[27, 4, 6, 7, 13]`, blint, fore bygget.
Reglerna deployas FOR HAND efterat (Tier D).

### BIN-1134 (+ BIN-1142, dubblett) - create-grenen har ingen grans pa namnet

Premiss verifierad vid HEAD: `match /users/{uid}`s `allow create` kraver bara
att `isAdmin` saknas; `allow update` bar `is string && size() <= 80` pa
`displayName` och 160 pa `bio`.

- [ ] Ett emulatortest visar att ett overlangt `displayName` nekas vid create. *(diff)*
- [ ] Ett emulatortest visar att en vanlig registrering fortfarande gar igenom. *(diff)*
- [ ] Gransen ar SAMMA tal som update-grenen redan anvander, inte en andra siffra. *(diff)*
- [ ] Muteringen som tar bort gransen faller minst ett test - kord, med utfallet
      redovisat. *(diff)*
- [ ] Fragan om trunkering i notistexten ar besvarad i biljetten. *(diff)*

### BIN-1141 - `followers`-create binder inget faltinnehall

Premiss verifierad vid HEAD: enda villkoren ar `isOwner(followerUid)` och
`existsAfter(.../following/...)`.

- [ ] `keys().hasOnly(['followedAt'])` + typkontroll pa `followedAt`. *(diff)*
- [ ] Ett emulatortest visar att en okand nyckel nekas, och ett att en vanlig
      foljning gar igenom. *(diff)*
- [ ] Muteringen som tar bort nyckellistan faller minst ett test. *(diff)*

### BIN-1140 + BIN-1128 - gruppdokumentet har ingen nyckellista alls

De tva ar samma fix sedd fran create- respektive dokumentnivan och byggs
tillsammans.

- [ ] Harled nyckelmangden ur de vagar som FAKTISKT skriver dokumentet
      (`src/lib/firebase/groups.ts`), inte ur biljetten. Racka ocksa
      Admin-SDK-vagarna - de gar forbi reglerna men bestammer vad som ligger
      i dokumentet.
- [ ] Ett emulatortest visar att ett okant toppnivafalt nekas. *(diff)*
- [ ] Varje skrivvag koden faktiskt har gar fortfarande igenom, en test per
      vag - skapa, byt namn, rotera token, sla av token, joina, acceptera,
      lamna. *(diff)*
- [ ] Typ- och langdkontroll pa `name`. Talet 48 finns redan i formularen;
      motivera i regeln varfor regelns tal ar det tal det ar. *(diff)*
- [ ] Muteringen som tar bort nyckellistan faller minst ett test. *(diff)*

### BIN-1135 - tillvaxtgrenarnas pinnar ar oprovade

Premiss verifierad vid HEAD: bada tillvaxtgrenarna pinnar `ownerUid`, `name`
och `defaults`; granskaren matte 448/448 grona med `ownerUid`-villkoret pa
join-grenen nollstallt.

- [ ] Ett nekande test per pinnat falt (`ownerUid`, `name`, `defaults`) pa
      join-grenen. *(diff)*
- [ ] Samma pa accept-grenen. *(diff)*
- [ ] En vanlig anslutning gar fortfarande igenom pa bada grenarna. *(diff)*
- [ ] Muteringen kord PER FALT och PER GREN, en i taget, med utfallen
      redovisade. En mutering som faller ett join-test sager ingenting om
      accept-grenen. *(diff)*

## Panelens bindande villkor — infolierade 2026-09-10

Routningen flyttade sig UNDER arbetet:
kritiken vidgade filunionen, och omkörningen gav

- Bunt 1: `[4]` → **`[7]`** (testfilen kom in i unionen).
- Bunt 2: `[27, 4, 6, 7, 13]` → **`[27, 5, 4, 6, 7]`** (`publicProfile.ts` kom in;
  #13 föll ur, #5 Legal kom in).

Båda de nytillkomna rollerna konvenerades innan bygget. #13:s mätningar behålls
som underlag men är inte längre panelens.

### Mätt av mig, inte av en roll

- `netstat -ano` visar port 8080 LISTENING på PID 15100. Processens kommandorad
  är ett ANNAT repos emulator (`--project_id butlery-recipe-ratings-test --rules
  C:\Butlery\butlery\firestore.rules`). Det är precis BIN-1137:s läge, live.
- `npm run test:rules` med den porten upptagen → **EXIT=1**, med
  `Error: Could not start Firestore Emulator, port taken.` Samma sak via
  `npx firebase-tools@14.27.0`, versionen `deploy.yml` pinnar. Lokal CLI är
  15.26.0.
- **BIN-1137:s premiss om exit 0 går alltså INTE att reproducera här.** Kriterium 1
  är uppfyllt redan vid HEAD, mätt på två CLI-versioner. Det som byggs är
  kriterium 2 — den mekaniska spärren mot att vägen någonsin blir tyst — inte
  exitkoden.
- `#7 QA`:s villkor nr 4 i bunt 2 var FEL: det påstod att `createGroup` inte
  skriver `inviteTokenRotatedAt`. `sed -n '100,112p' src/lib/firebase/groups.ts`
  visar att den gör det. Hade villkoret följts hade varje gruppskapande nekats i
  produktion med hela sviten grön. #27, #13 och #5 räknade upp samma åtta fält
  oberoende av varandra.

### Bunt 2 — bindande

1. `users/{uid}` create får SAMMA klausuler som update redan bär, samma tal.
   Gäller `bio` (160) lika mycket som `displayName` (80) — #6 och #27 oberoende:
   att laga halva asymmetrin i samma redigering är en halv reparation.
2. `followers` får `keys().hasOnly(['followedAt'])` OCH `followedAt is timestamp`
   i SAMMA klausul som täcker både create och update (#6): en nyckellista utan
   typkontroll släpper igenom en godtyckligt lång sträng in i mottagarens
   GDPR-export.
3. Gruppdokumentets nyckellista är EXAKT de åtta fält `createGroup` skriver.
   För snäv → gruppskapande bryts i produktion. För vid → hålet är öppet igen.
   Läggs EN gång, utanför hela update-OR-satsen (#27): fältmängden är fast och
   varje klientskrivning är en `updateDoc` som bevarar orörda fält.
4. `name` binds till samma 48 som `groupInvites.groupName` redan pinnas mot, med
   en kommentar som säger att de två talen måste flytta tillsammans (#5).
   Testet får ALDRIG asserta mot regelfilens källtext (#7) — en kommentar som
   nämner 48 hade uppfyllt en sådan assertion utan att bindningen fanns.
5. En kommentar vid nyckellistan som pekar ut Admin-SDK-vägarna
   (`functions/src/groupHandover/adminIo.ts`) som medskyldiga källor att bredda
   samtidigt (#27, #13): de går förbi reglerna, så ett nytt fält därifrån fäller
   nästa ORELATERADE klientskrivning i stället.
6. `src/lib/firebase/publicProfile.ts` — meningen om att `users/{uid}` saknar
   längdregel vid registrering blir falsk i samma commit och STRYKS (#5, #13).
   Klampningen står KVAR (#5): regler binder
   aldrig retroaktivt, så den är fortfarande det enda som skyddar ett konto vars
   värde skrevs före deployen.
7. Nekande-testerna måste uppfylla varje klausul FÖRE den de prövar (#7):
   `sealJoinAttempt`/`seedInvite` först, en i övrigt giltig medlemsökning, och
   ENDAST det pinnade fältet ändrat. Följarens test måste skriva `following` i
   samma batch, annars nekar `existsAfter` först och maskerar allt efter sig.
8. Sex fristående test för BIN-1135 — `ownerUid`/`name`/`defaults` × join/accept,
   handuppräknade som resten av grupp-sviten (#7). Muteringen körs per fält och
   per gren, en i taget, med utfallen redovisade.
9. En positiv kontroll per verklig skrivväg mot gruppdokumentet (#6): skapa, byt
   namn, rotera token, slå av token, joina, acceptera, lämna.

### Bunt 2 — konflikt, avgjord

#6 punkt 3 ville lägga nyckellistan BARA på create, med skälet att update-grenarna
har olika fältmängder. #27 punkt 1 ville lägga den en gång för hela dokumentet.
Avgjort till #27: `request.resource.data` vid en update är hela dokumentet EFTER
skrivningen, inte patchen, så varje gren ser samma åtta nycklar oavsett vilka fält
den själv rör. #6:s verkliga oro — att en gren bryts — besvaras av villkor 9, inte
av att skopa spärren smalare. Kriteriet är att varje skrivväg har ett eget grönt
test.

### Bunt 1 — bindande

1. Golvet i omslagsskriptet måste fälla åt BÅDA hållen och pinnas så att en
   omdöpning på andra sidan fäller. Formen avgörs av #7:s kritik.
2. Skriptets CLI ligger bakom en entry-point-vakt, annars äter den testkörarens
   argv och hänger vitest utan utdata.
3. Skriptets självtest registreras i `scripts/scripts-self-tests-present.test.mjs`
   och golvet där höjs — annars märker ingen när testet slutar köras.
4. `users/{uid}.bio`-längdvalideringen på update-grenen har NOLL täckning i
   emulatorsviten och finns bara i skriptet som raderas (#4). Den måste flyttas
   över, inte tappas.
5. `isAdmin`-eskaleringsspärren har noll `assertFails`-test i hela repot (#4).
   Den stängs här, eftersom bunten ändå rör testfilen.
6. Vilka av skriptets fall som är verkligt unika härleds fall för fall med
   kommandon, inte på känsla.

### Beslut som var mina att fatta

**Upptagen port: hårt fel, med ett uttryckligt `--port <n>`.** Automatiskt
portval är bortvalt: en grön körning ska inte kunna dölja vilken port och vilken
regelfil den faktiskt använde — det är hela biljettens ämne. Den genererade
temporära konfigurationen pekar på `firestore.rules` med ABSOLUT sökväg, härledd
ur reporoten, så ingen andra kopia av regelfilen kan glida isär. #4 varnade för
att ett ovillkorligt hårt fel gör kommandot obrukbart lokalt när en granne kör
sin emulator; `--port` är svaret på den varningen, och den här sprinten behövde
den själv.


## Needs you (Tier D)

**ORDNINGEN SPELAR ROLL har, och det ar push-grindens fynd.** `deploy.yml`s
skydd gor hosting-jobbet rott pa varje push som rort `firestore.rules`. Den
naiva foljden blir: push -> hosting rod -> regler ut for hand -> hosting om.
Mellan de tva sista stegen ligger den GAMLA, oklampade klienten mot den NYA
regeln - precis det fel BIN-1134 handlar om, natt av en Google-registrering
med ett langt namn.

Steg 1 blev gjort utan att nagon korde det for hand: lardomscommitarna sist i
sprinten ror ingen regelfil, sa deras deploy passerade skyddet och skickade ut
appen fran senaste laget. Matt: korningen pa `4b5650b`, jobbet `deploy`, steget
"Deploy to Firebase Hosting" - gront. Den klampande klienten ligger alltsa ute
mot de gamla, tillatande reglerna, vilket ar den sakra riktningen.

Kvar: ingenting. Reglerna deployades 2026-09-11 pa Malins begaran
(`firebase deploy --only firestore:rules --project binge-nu`), och utfallet
verifierades genom att lasa tillbaka reglerna fran `binge-nu` - samma radantal
som filen pa main, och de tre nya vakterna pa plats.

Att det loste sig var tur, inte plan. Ligger doc-commitarna FORE regelcommiten
nasta gang hjalper det inte.

## Deviation log


---

# Sprinten 2026-09-09 - sju biljetter i fyra buntar

Urval: 26 oppna biljetter i Backlog, noll i Todo/In Progress. Premisskontrollen
kordes mot HEAD for varje kandidat innan nagon valdes. Sex premisser star kvar;
BIN-1124:s ar DELVIS BORTA och biljetten skrivs om fore bygget (se bunt 2).
Kommentarstradarna pa alla sju ar tomma - ingen parkerad handbroms.

## Routning - kord pa varje bunts faktiska filunion

Talen nedan ar fran urvalet. De far aldrig arvas in i ett senare varv: routas om
omedelbart fore varje kritik och fore varje commit med
`node docs/org/route.mjs $(git diff --cached --name-only)`.

- Bunt 1: `tier: top`, `panel: [27, 5, 4, 6, 18]`, `reasonCode: high-stakes`
  (`firestore.rules`).
- Bunt 2: `tier: medium`, `panel: [8]`, `reasonCode: owned`.
- Bunt 3: `tier: medium`, `panel: [5]`, `reasonCode: owned`.
- Bunt 4: `tier: medium`, `panel: [14]`, `reasonCode: owned`.

Bunt 3 och 4 ar SPLITTADE ur en gemensam bunt just for att routningen ska
stamma: unionen av deras filer routar `[14]` och lamnar #5 Legal i `dropped`,
vilket hade byggt en integritetspolicytext utan den agande rollen.

Den har sessionen kan konvenera bade en enskild kritik och en full panel, sa
ingen bunt behover parkeras for utebliven kapacitet.

---

## Bunt 1 - firestore.rules: tre hal i vanner och grupper [Tier C]

Kritik: full panel `[27, 5, 4, 6, 18]`, blint, fore bygget.

### BIN-1125 - den som gar med i en grupp kan skriva bort alla andra

Premiss verifierad vid HEAD: bada vaxtgrenarna kraver att skribenten star i den
NYA listan och inte i den gamla, men relaterar inget ovrigt mellan dem. Harled
dem sjalv med ett kommando som soker efter grenrubrikerna i `firestore.rules`.

- [ ] Villkor som binder den nya listan till den gamla pa bada vaxtgrenarna.
- [ ] Mat formen mot regelsprakets faktiska version innan den skrivs in -
      sarskilt att `removeAll` finns, och att storleksvillkoret inte krockar
      med det befintliga taket.
- [ ] Emulatortest per gren: kan inte ta bort nagon annan i samma skrivning.
- [ ] Emulatortest per gren: en vanlig anslutning gar fortfarande igenom.

Acceptans:
1. Ett emulatortest visar att en som gar med via token inte kan ta bort nagon
   annan i samma skrivning. *(diff)*
2. Samma for invite-accept-grenen. *(diff)*
3. En vanlig anslutning gar fortfarande igenom pa bada grenarna. *(diff)*
4. Muteringen som tar bort det nya villkoret faller minst ett test PER GREN.
   *(diff)*

### BIN-1119 - friendRequests har inga vardegranser

Premiss verifierad vid HEAD: create-grenen har en nyckelbegransning och ett
typkrav pa visningsnamnet, inget mer.

- [ ] Harled gransen ur profilreglernas egen validering i `firestore.rules` -
      skriv ingen andra siffra.
- [ ] Kontrollera mot `sendFriendRequest` i `src/lib/firebase/friends.ts` att
      ingen skarp nyttolast hamnar utanfor gransen.
- [ ] Stall samma fraga till `friends` och `friendRequestsSent`; svara i
      biljetten oavsett vilket svaret blir.

Acceptans:
1. Ett emulatortest visar att ett overlangt `fromDisplayName` nekas. *(diff)*
2. Ett emulatortest visar att den nyttolast `sendFriendRequest` faktiskt bygger
   fortfarande gar igenom. *(diff)*
3. Gransen ar samma konstant profilreglerna anvander, inte en andra siffra.
   *(diff)*
4. Muteringen som tar bort vardegransen faller minst ett test. *(diff)*
5. Samma fraga stalld till `friends` och `friendRequestsSent`; galler den dar
   ocksa sags det, annars sags varfor inte. *(diff)*

### BIN-1126 - en vanforfragan binds inte till avsandarens egen profil

Premiss verifierad vid HEAD: identitetsjamforelsen finns och anvands av
recensioner, kommentarer och reaktioner - men inte av `friendRequests`.

- [ ] Mat kostnaden for bindningsvagen INNAN losningen valjs: ett `get()` per
      skriven vanforfragan. Las den accepterade avvikelsen om
      `effectiveVisibility` i `.claude/rules/accepted-deviations.md`, dar ett
      korsdokument-`get()` avvisades av kostnadsskal.
- [ ] Vag mot cache-vagen: lat notis och UI lasa avsandarens profil i stallet,
      sa falten inte kan ljuga.
- [ ] Kontrollera vilket dokument identitetsjamforelsen faktiskt laser innan en
      mening skrivs om vilket det ar.
- [ ] Skriv ned det valda alternativet och skalet i biljetten.

Acceptans:
1. Ett emulatortest visar att en vanforfragan med ett `fromDisplayName` som
   inte ar avsandarens nekas - eller, om cache-vagen valjs, att UI och notis
   inte langre laser faltet. *(diff)*
2. En akta vanforfragan gar fortfarande igenom. *(diff)*
3. Kostnaden per skrivning ar matt och nedskriven innan losningen valjs.
   *(diff)*
4. Muteringen som tar bort bindningen faller minst ett test. *(diff)*

Bunt 1 avslutas med en manuell regel-deploy - `deploy.yml` skeppar bara hosting.

---

## Bunt 2 - tva grindar som inte nar sina filer [Tier A]

Kritik: en blind fran den roll routern namner for buntens faktiska filunion.

### BIN-1124 - PREMISSEN AR DELVIS BORTA, biljetten skrivs om forst

Biljetten pastar att `functions/package.json` nar NOLL granskare. Vid HEAD ar
det falskt: sakerhetsgranskaren nar den via ett katalogmonster. Kommandot i
biljettkroppen svarar alltsa redan med en granskare, sa dess acceptanskriterium
1 ar uppfyllt utan att nagot byggs.

Det som ar SANT vid HEAD, harlett med samma slags kommando: helhetsgranskaren
nar rotens manifest och funktionernas lasfil, men inte funktionernas manifest.
Det ar asymmetrin som star kvar.

- [x] Skriv om biljettkroppen i Linear till den matta luckan FORE bygget.
- [x] Ge helhetsgranskaren en post som nar `functions/package.json`.
- [x] Stageat prov: bara den filen andrad, och granskaren blockerar. Kort i BADA
      riktningarna mot samma stageade bytes, mot den skarpa commit-hooken.

Acceptans:
1. Helhetsgranskaren nar `functions/package.json`, bevisat med det harledande
   kommandot. *(diff)*
2. Ett stageat prov med bara den filen andrad blockeras av den granskaren.
   *(diff)*
3. Symmetritestet ar gront efter andringen. Router-sidan matt 2026-09-09 med
   `node docs/org/route.mjs` pa vardera manifestet: bada svarar med samma agande
   roll, sa den sidan var REDAN symmetrisk och andras inte. Kriteriets krav pa en
   router-andring ar struket, inte omformulerat - det gick inte att uppfylla.
   *(diff)*
4. Ingen mening som raknar upp vilka nycklar konfigen har - peka pa posten och
   lat listan harledas. *(diff)*

### BIN-1122 - publicerade kommandon kan oppna fel databas

Mangden harleds med ett kommando som soker efter gcloud-formen i sparade
`.md`-filer och filtrerar bort dem som redan namnger sitt projekt. Kor det och
las utdatan innan en rad skrivs; mangden ar daterad, inte permanent.

- [ ] Ett golv som laser SPARADE `.md`-filer och kraver att ett korbart
      kommando som oppnar en Firestore namnger sitt projekt.
- [ ] Formen harleds over bada kommandofamiljerna - Admin-SDK:t namnger
      projektet i ett objekt, gcloud i en flagga. Ett monster som bara kan
      den ena ar samma defekt igen.
- [ ] Prosa faller ingenting: `tasks/lessons.md` beskriver faran och namner
      uttrycket. Bevisa med lardomsfilen som fixtur.
- [ ] `*.knowledge.archive.md` star utanfor.
- [ ] Ratta varje traff kommandot ger.

Acceptans:
1. Ett publicerat, korbart kommando i en sparad `.md` som oppnar en Firestore
   utan att namna sitt projekt faller ett test - bevisat for BADA formerna.
   *(diff)*
2. Muteringen som ateranfor den projektlosa formen i `docs/recaps/RUNBOOK.md`
   faller exakt det testet. *(diff)*
3. Varje traff kommandot ger namnger sitt projekt nar biljetten stangs.
   *(diff)*
4. Prosa som beskriver hazarden faller ingenting - bevisat med lardomsfilen
   som fixtur. *(diff)*
5. Golvet laser sparade filer, sa en osparad kopia gor det aldrig permanent
   rott. *(diff)*

---

## Bunt 3 - integritetspolicyn lovar en radering som inte sker [Tier B]

Kritik: en blind fran #5 Legal / GDPR Counsel. Routa om pa den faktiska
unionen omedelbart fore kritiken - buntens filuppsattning ar inte fastslagen
forran retentionsdokumentet ar kontrollerat.

Disposition: **build-review**. Texten ar publicerad juridik som Malin ager;
den byggs, men parkeras i In Review i stallet for att stangas.

### BIN-1115 - policyn sager att grupper du ager RADERAS

Premiss verifierad vid HEAD: meningen star kvar i
`src/app/integritet/page.tsx`. Beteendet harleds ur `functions/src`, inte ur
biljetten.

- [ ] Las `.claude/rules/accepted-deviations.md`, posterna daterade
      2026-09-07, som beskriver vad de tva dorrarna gor och inte gor.
- [ ] Skriv om halvmeningen sa den beskriver overlamningen.
- [ ] Sag ocksa vad som hander med en agd grupp UTAN kvarvarande medlemmar.
- [ ] Kontrollera `docs/data-retention-policy.md` mot samma fraga; star samma
      pastaende dar rattas det i samma commit.

Acceptans:
1. Avsnittet beskriver overlamningen, inte en radering, for en agd grupp med
   kvarvarande medlemmar. *(diff)*
2. Texten sager ocksa vad som hander med en agd grupp utan kvarvarande
   medlemmar. *(diff)*
3. Ingen ny mening som raknar upp samlingar eller antal. *(diff)*
4. `docs/data-retention-policy.md` kontrollerad mot samma fraga. *(diff)*

---

## Bunt 4 - en falsk sats i WatchlistContext [Tier A]

Kritik: en blind fran #14 Software Architect.

### BIN-1112 - satsen om att ingenting nagonsin hittar dokumentet

Premiss verifierad vid HEAD: satsen star kvar i
`src/contexts/WatchlistContext.tsx`.

- [ ] STRYK satsen. Skriv INGEN ny mening om att BIN-1023 hittar den efter
      sitt fonster - det ar ett nytt pastaende granskaren da maste mata.
- [ ] Halvan fore ar sann och star kvar.
- [ ] Kontrollera att strykningen inte lamnar grannstycket utan subjekt.

Acceptans:
1. Satsen finns inte kvar. *(diff)*
2. Ingen ny mening om vad som hittar dokumentet har lagts till. *(diff)*

---

## Behover dig (Tier D / needs-approval)

- **BIN-1116** - `.agents/skills/recap/` ar en osparad dubblett. Biljetten sager
  sjalv "Kraver ett beslut, inte ett bygge" och att en sprint inte raderar filer
  i ditt arbetstrad pa egen hand. Ligger kvar tills du svarar: radera eller
  spara.
- **BIN-1118** (`Feature`) och **BIN-521** (`idea`) - produktval som ar dina.
  Byggs aldrig av en sprint.
- **BIN-454 / BIN-402** - tmdbTosSweep-utrullningen. Star under "gor aldrig
  detta" i CLAUDE.md; en sprint far inte rora den.
- **BIN-1121** - matning mot skarp produktionsdata.
- `.codex/` ligger osparat i arbetstradet och namns inte av nagon biljett.
  Roras inte av den har sprinten.

## Bunt 5 - BIN-1127: gruppinbjudningarnas create-gren [Tier C]

Tillagd efter urvalet, pa Malins "ta det direkt nu".

Routning pa buntens FAKTISKA union, kord fore commit:

```
node docs/org/route.mjs $(git diff --cached --name-only)
```

Unionen vaxte med tva klientfiler efter kritiken. Las panelen ur kommandots
utdata, inte ur en mening har.

### Bindande acceptanskriterier ur den blinda kritiken

1. Nyckellista och vardegranser pa create: `hasOnly` over de fem falten, `groupId`
   pinnad mot sokvagen, `invitedAt is timestamp`, `fromDisplayName` bunden via
   `isOwnIdentity` plus egen typ- och langdgrans.
2. `groupName` far en EGEN grans, inte bara en pinning (DPO, blockerande; samma
   fynd oberoende fran Security, DBA och QA). Foljdbiljett pa kallan: BIN-1140.
3. Klientens inbjudningsknapp gatas pa den laddade profilen (DBA, blockerande).
   `handleInvite` gatade bara pa `myUid`; `user` ar en getDoc bort, sa ett tidigt
   klick skickade platshallarordet som avsandarnamn - vilket den nya regeln nekar.
   Samma monster som `useFriendActions` redan bar.
4. Grundsvit, inte bara granstester (QA). Varje nekande-test seedar bade
   gruppdokumentet och avsandarens egen profil, sa nekandet bevisligen kommer fran
   den klausul testet namnger. Det handkorda `scripts/test-rules.mjs` hade tva
   egna create-fall; de ar borttagna i samma commit och tacks nu av
   emulatorsviten.

### Bevis

`npm run test:rules`: 467 grona (var 448). Muteringarna nedan korda en i taget, var
och en med mutanten asserterad fore OCH efter sviten, tradet aterstallt fran en
arbetstradskopia och verifierat med `git hash-object`. Tabellen ar protokollet:

| Mutation | Fallda test |
|---|---|
| `hasOnly` borttagen | 1 |
| `invitedAt is timestamp` -> bara nyckelnarvaro | 1 |
| `groupName.size() <= 48` -> `<= 4800` | 1 |
| `isOwnIdentity(...)` -> `true` | 2 |
| `groupName`-pinningen -> `true` | 1 |
| `groupId`-pinningen -> `true` | 1 |
| agarkollen (`ownerUid == request.auth.uid`) -> `true` | 1 |

Den sista raden kom av testgranskarens blockerande fynd: agarkollen gick att
radera med hela sviten gron. Nekande-testet for en utomstaende seedade inte
ANROPARENS egen profil, sa `isOwnIdentity`s `get()` kastade pa ett dokument som
inte finns och nekandet kom darifran - fore agarkollen i `&&`-kedjan. Testet
seedar nu den profilen och skickar en i ovrigt giltig payload, sa agarkollen ar
den enda klausul som kan falla.

Produktionsmatning 2026-09-09: noll grupper i `binge-nu`, sa 48-gransen kan inte
neka nagon befintlig grupp.

### Foljdbiljetter filade fore commit

BIN-1140, BIN-1141, BIN-1142, BIN-1143, BIN-1144, BIN-1145, BIN-1146.

## Bunt 6 - BIN-1143: en inbjudan du SKICKAT ska inte overleva din radering [Tier C]

Malins beslut 2026-09-10, alternativ B: bygg bort restsparet i stallet for att
skriva en mening om det. Bokfort som kommentar pa BIN-1143.

### Vad som ar matt

`users/{target}/groupInvites/{groupId}` bar avsandarens `fromUid` och nas av
INGEN av de tva raderingsdorrarna: `findFieldOwned` har ingen `groupInvites`-gren,
och klientkaskaden nar bara den avgangnes EGNA inkommande inbjudningar.
Bokfort i `.claude/rules/accepted-deviations.md` (2026-09-07) som oppet arbete.

Klienten KAN inte na dem: lasregeln ar `isOwner(uid)`, sa ingen klientfraga kan
spanna over andras trad. Darfor maste bada dorrarna ga via servern.

### Routning

Routa om pa den faktiska unionen fore varje kritik och fore commit - las
utfallet ur kommandot:

```
node docs/org/route.mjs $(git diff --cached --name-only)
```

Unionen flyttade sig flera ganger under arbetet, och varje flytt satte nagon ny
som inte hade horts - senast refuserade routningsgrinden commiten for att en
tillagd fil satte en roll ingen granskningsrad namngav. Varje sadan roll
konvenerades innan bygget gick vidare. Vilka som faktiskt kritiserat star i
`review`-raderna for BIN-1147 i `docs/org/metrics/events.jsonl`; racka dem inte
har.

### Bindande acceptanskriterier ur kritiken

1. **En enda atomar batch** (#13). En andra callable avvisades: en extra inväntad
   rundtur gor det bokforda `RECENT_LOGIN_MAX_AGE_MS`-problemet strikt varre, och
   ett bart kast kan halvradera medan klienten fortfarande klassar korningen som
   "ingenting raderat" - BIN-876/813-klassen. Erasingen viks darfor in i den
   befintliga `handOverOwnedGroups` och skriver i EN batch.
2. **Arv inte den gamla motiveringen** (#4). Callabelns huvud argumenterar att den
   ar ofarlig for att den ar "strikt svagare an den `allow delete` en agare redan
   har". Det galler INTE erasingen: `allow delete` pa den sokvagen ar mottagaren
   ELLER den NUVARANDE agaren, sa efter en overlamning kvalificerar avsandaren inte
   langre. Det ar en akta, om an smal, vidgning och huvudet ska saga det.
3. **Tva dokumentationsposter** (#6, #5). En daterad efterfoljare i
   accepted-deviations som NAMNGER precedensen - `accountDeletion.ts` hardraderar
   redan den speglade `friendRequests`-posten i den andres trad - plus en rad i
   `docs/data-retention-policy.md` for ut-sidan, i samma form som den befintliga
   `friendRequestsSent`-raden.
4. **Ror inte den publicerade juridiska texten** (#5, blockerande). BIN-1143 stangs
   som BYGGD, inte som en textandring.
5. **Deployordning** (#27). Sopningen sjalvlaker pa ett saknat index, callabeln gor
   det inte - deploya indexet FORST, bekrafta att det ar READY, och funktionen
   sedan. Fel ordning fäller varje sjalvbetjanad radering tills indexet byggts.
6. **Deployinstruktionen ar #8:s** (den rollen satte `EXTERNAL_ACTIONS.md`, och
   routningsgrinden refuserade commiten tills den konvenerats). Fyra villkor,
   alla inne i den filen: `firestore:rules` skickas med OBETINGAT, eftersom
   regeldeployer slapar efter commitarna med flit och ingenting rapporterar om de
   live-serverade reglerna matchar `main`; "vanta pa Enabled i konsolen" ersatt av
   ett kommando som gar att kora, eftersom ett `fieldOverrides` inte ar ett
   sammansatt index och inte syns i `indexes composite list`; funktionsnamnen
   harleds i stallet for att kopieras; och en rollback-punkt, som ocksa sager att
   ett kvarlamnat index kostar underhall pa varje skrivning tills det tas bort.

### Bevis

Muteringar, en i taget, mutanten asserterad fore OCH efter varje korning och
tradet aterstallt fran en arbetstradskopia verifierad med `git hash-object`:

| Mutation | Var | Fallda test |
|---|---|---|
| vagran avstangd (`if (false)`) | `eraseSentInvites` | 1 |
| den atomara raderingen ersatt av en loop per sokvag | `eraseSentInvites` | 1 |
| erasingen flyttad EFTER overlamningen | callabeln | 1 |
| sopningens fraga ersatt av en tom lista | emulatorharnesket | 2 |
| `await` OCH `try/catch` strukna | callabeln | 1 |
| `try/catch` struket, `await` kvar | callabeln | 1 |
| predikatet bytt fran `fromUid` till `fromDisplayName` | sopningens harnesk | 1 |
| samma byte | erasingens harnesk | 3 |

Raderna om predikatet kom av #7:s andra fynd: varje fixtur satte de tva falten
LIKA, sa bytet gav identiskt utfall och noll test fallde. Nu bar fixturerna
motpartens namn i namnfaltet. De tva harnesken bar var sin handskriven kopia av
predikatet, sa de muteras var for sig - ett gemensamt tal hade varit en summa och
inte en egenskap hos nagondera.

Hela sviten gron. `npm run test:rules`: 471 over 7 filer.

Typkontrollen tvingade fram nagot #7 bara hann fila: de tre
emulatorharnesken implementerar `HandoverIo`, sa de tva nya metoderna gick inte
att utelamna. `group-handover-orchestrator.test.ts` DRIVER dem mot en riktig
emulator. De tva andra gor det inte - testgranskaren matte att throwing stubbar
dar lamnar hela sviten gron - och deras kommentarer sager det rakt ut i stallet
for att lata implementationen se ut som tackning.

Raderna om `await` och `try/catch` kom av #7:s blockerande fynd: utan `await`
racer erasingen overlamningen i stallet for att grinda den, catch-blocket blir
dod kod en asynkron rejection aldrig nar, och HELA sviten var gron.
Positionstestet bevisade TEXTordning, inte att erasingen grindar nagot.

### Foljdbiljetter

BIN-1147 bar bygget. BIN-1150: en skickad inbjudan raderas nu men har aldrig
ingatt i avsandarens EGEN Art. 20-export - asymmetrin fanns fore bunten och star
kvar efter den. BIN-1149: indexsparren i
`userData.subcollections.test.ts` laser bara klienthalvan, sa den hade inte fallt
om den har bunten glomt sitt index. BIN-1148 (#7) ar kvar men mycket smalare: skrivhalvan bevisas
nu mot en riktig emulator, och det som star kvar ar fallet OVER taket, som kraver
fler seedade dokument an gransen och darfor ar langsamt mot en emulator.

### Ett pastaende i mitt eget uppdrag var falskt

Jag skrev att `fromUid` pinnats mot anroparen "sedan BIN-1127". #4 motbevisade det
och jag verifierade sjalv: pinningen ar OFORANDRAD kontext i BIN-1127:s diff och
kom med `627e24f`, samma commit som skapade samlingen. Det har alltsa aldrig
funnits ett forfalskningsfonster - sopningen kan lita pa faltet for hela
samlingens livstid. Galler bara `groupInvites`; andra samlingar har haft sadana
fonster.


## Efter sprinten

- [ ] Fila foljdbiljetter FORE commit.
- [ ] Commit per bunt, med granskarna den stageade diffen utloser.
- [ ] Push-grinden ar ett EGET granskningsvarv over hela `@{u}..HEAD` - inte
      summan av bunt-granskningarna. Budgetera det darefter.
- [ ] Manuell regel-deploy efter bunt 1.
- [ ] Linear-overgang per bunt, skriven av den som haller shan.

## Deviation log

- [discovery] Bunt 1:s FAKTISKA stageade union routar `panel: [27, 5, 4, 6, 7]`, inte
  urvalets `[27, 5, 4, 6, 18]` - #7 QA bytte plats med #18. Bada har kritiserat: #18
  fran urvalet, #7 pa den stageade unionen fore commit. Kommandot ar
  `node docs/org/route.mjs $(git diff --cached --name-only)`.
- [deviation] BIN-1126: panelen delade sig 2-3 mellan bindning i regeln (a) och att
  lita pa uppslagning i stallet (b). Delningen berodde pa en FAKTAFRAGA, inte pa en
  vardering: #6 och #18 utgick fran att UI:t redan slar upp avsandarens riktiga
  profil, #4 matte att den lasningen ar gatad pa synlighet och alltsa faller tillbaka
  pa det forfalskbara faltet for en PRIVAT avsandare. Byggt: bindningen (a) OCH den
  auktoritativa uppslagningen i notisen, eftersom (a) inte nar dokument skrivna fore
  deployen och (b) inte nar en privat avsandare.
- [deviation] BIN-1119: #6 ville binda `fromUsername` mot teckenmonstret
  `isValidUsername`. Byggt som typ + langd i stallet. Skalet star i regeln: faltet ar
  en visnings-cache, och `users/{uid}.username` valideras inte av nagon regel, sa ett
  monsterkrav hade kunnat neka en akta forfragan. #18:s villkor om att en for snav
  grans ar den dyrare felriktningen vagde tyngre an #6:s.
- [discovery] `sentAt` hade INGEN typkontroll. `hasOnly` slapper igenom nyckeln, sa
  hela nyttolasten kunde ha lagts dar och varje annan vardegrans varit verkningslos.
  Ingen av de fem rollerna namnde den; hittad vid bygget.

- [discovery] BIN-1126: UI:t slar REDAN upp avsandarens riktiga profil i
  `src/hooks/useSenderProfile.ts` och faller tillbaka pa de lagrade falten bara nar
  profilen inte gar att lasa. Uppmatt av #6:s blinda kritik. #4 matte sedan att den
  uppslagningen ar gatad pa synlighet, sa fallbacken gar in for varje PRIVAT
  avsandare - darav bindningen i regeln, inte bara en uppslagning i notisen.
- [correction] Tva pastaenden jag skrev har ar STRUKNA, inte omformulerade, efter
  helhetsgranskningen:
  * att push-notisen var den enda kvarvarande forfalskningsvagen (den ar lagad i
    samma bunt, och UI:ts fallback var den andra);
  * att klienten skrev ett LITTERALT reservnamn som en bindning darfor hade nekat.
    Den grenen var onabar: `UserProfile.displayName` ar typad som en strang och
    sätts med `?? ''`, sa ett konto utan namn bar en TOM STRANG och den gamla
    `??`-grenen kunde aldrig losa ut. Harled det med
    `grep -n "displayName" src/types/domain.ts src/contexts/AuthContext.tsx`.
- [deviation] BIN-1125: den form biljetten foreslog (`removeAll` + storlek + 1)
  gar att kringga med en DUBBLETT. Nya listan `[jag, jag]` mot gamla `[agare]`
  uppfyller alla fyra villkoren och skriver bort agaren. Formen som halls i
  stallet ar `nya.hasAll(gamla)` + `storlek(nya) == storlek(gamla) + 1`, som
  bade utesluter dubbletten och ger #5:s villkor att agaren star kvar.
- [discovery] BIN-1127: tva av fem roller lamnade blockerande villkor som INTE stod
  i biljetten, och bada lag utanfor den filuppsattning biljetten namnde - det ena i
  klientkoden, det andra en niva upp i regelfilen. Buntens union vaxte darfor efter
  kritiken; routern kord om pa den faktiska unionen.
- [discovery] BIN-1127: en kvarglomd Firestore-emulator fran ett tidigare
  granskningsvarv holl port 8080, sa `npm run test:rules` inte gick att starta.
  Felmeddelandet pekar pa porten, inte pa orsaken.
- [correction] Ett pastaende i `src/app/grupper/page.tsx` ar STRUKET, inte
  omformulerat: kommentaren sa att `groupName` och `fromDisplayName` inte valideras
  regel-sidigt och darfor ar forfalskbara. Bada binds nu av create-grenen.
- [deviation] BIN-1127: mina sex forsta muteringar provade de NYA klausulerna och
  missade att den BEFINTLIGA agarkollen blivit otestbar av mitt eget nya test.
  Ett nekande-test bevisar ingenting om vilken klausul som nekade forran fixturen
  nar fram till den. Hittat av testgranskaren, inte av mig.
- [discovery] BIN-1127: `scripts/test-rules.mjs` kors av ingen automatik och ar
  rott redan vid HEAD pa ett Tillsammans-fall som bunten inte ror. Mott bada
  vagarna med samma kommando: 21 passerade / 1 fallde vid HEAD, 19 / 1 med
  bunten (tva farre for att bunten tog bort skriptets tva groupInvites-fall).
  Filad som BIN-1145. Accept-testet dar behovde en inbjudan som de borttagna
  fallen rakade skapa; den seedas nu med reglerna avstangda, sa testet provar
  accept-grenen och inte create-grenen.


---

# Sprinten 2026-09-08 - sju biljetter i tre buntar

Urval: 21 oppna biljetter i Backlog, noll i Todo/In Progress. Premisskontrollen
kordes mot HEAD for varje kandidat innan nagon valdes; alla sju premisser star
kvar. Kommentarstradarna pa alla sju ar tomma - ingen parkerad handbroms.

## Routning - kord pa varje bunts faktiska filunion

Routas om omedelbart fore varje kritik och fore varje commit med
`node docs/org/route.mjs $(git diff --cached --name-only)`. Talen nedan ar fran
urvalet och far aldrig arvas in i ett senare varv.

- Bunt 1: `tier: medium`, `panel: [27]`, `reasonCode: owned`.
- Bunt 2: `tier: medium`, `panel: [27]`, `reasonCode: owned`,
  `unownedCode: ["functions/tsconfig.json"]`.
- Bunt 3: `tier: top`, `panel: [27, 5, 4, 6, 18]`, `reasonCode: high-stakes`
  (`firestore.rules`).

Den har sessionen kan konvenera bade en enskild kritik och en full panel, sa
ingen bunt behover parkeras for utebliven kapacitet.

---

## Bunt 1 - skripten under `functions/scripts/` och `scripts/` [Tier A]

Kritik: en blind fran #27 Database Administrator fore bygget.

### BIN-1107 - recap-skripten kan oppna fel projekts databas

Mangden harleds med kommandot, inte ur biljetten:
`grep -rn "applicationDefault()" functions/scripts/ | grep -v projectId`

- [ ] Kor kommandot. Ge varje traff en `*.helpers.mjs` med `refusalFor(argv)`
      som returnerar `null | string`, i samma form som
      `backfill-mirror-uid.helpers.mjs` redan har.
- [ ] `--project <id>` obligatorisk; id:t vidare till `initializeApp`.
- [ ] Forsta raden varje korning skriver ar vilket projekt den oppnar.
- [ ] Test som ANROPAR `refusalFor` for varje skript, inte kallkodsskannar.
- [ ] Testet pinnar formen `['--apply', '--project']` - en flagga last som
      varde hade riktat korningen mot ett projekt som heter `--apply`.
- [ ] Uppdatera anropsexemplen i filhuvudena, `docs/recaps/RUNBOOK.md` och
      `.claude/skills/recap/SKILL.md` sa inget publicerat kommando vagrar.
      Kor varje publicerat kommando och LAS utdatan.

Acceptans:
1. Varje skript kommandot hittar vagrar utan `--project`, bevisat av ett test
   som anropar vagrandet. *(diff)*
2. Muteringen som tar bort vagrandets `return` faller minst ett test - och
   assertionen far inte kunna traffa en systergren. *(diff)*
3. Varje korning skriver ut projektnamnet forst. *(diff)*
4. Ingen SPARAD, icke-test-`.mjs` under `functions/scripts/` oppnar en Firestore
   utan att namnge sitt projekt. *(diff)*

   Kriteriet ar OMSKRIVET 2026-09-08, efter helhetsgranskningen. Den ursprungliga
   lydelsen var `grep -rn "applicationDefault()" functions/scripts/ | grep -v
   projectId` ger noll traffar, och den gar inte att uppfylla: den traffar bade
   vaktens egen kallkod, dar predikatet star skrivet, och `_check-soa.mjs`, som
   monstret `functions/scripts/_*.mjs` i `.gitignore` haller utanfor repot med flit. Kriteriet och det som
   faktiskt byggdes var alltsa tva olika mangder, och den som bockade av det hade
   skrivit ett falskt pastaende.

   Provet ar VAKTEN, inte en omskrivning av den. Kor

   ```
   npx vitest run functions/scripts/projectArg.helpers.test.mjs
   ```

   och las fallet "every initializeApp call that uses applicationDefault also
   names projectId". Det ar samma kontroll som kors i `npm test`.

   Ett forsta forsok att skriva om harledningen som en egen skal-loop var ocksa
   falskt - `grep -q A && grep -q B || echo` skriver ut varje fil som saknar A,
   sa den listade de tre hjalpmodulerna och meningen bredvid pastod tom utdata.
   Struken. En kontroll som redan finns ska anropas, inte beskrivas en gang till.

### BIN-1105 - golvet ser inte att `REQUIRED` krymper

- [ ] `expect(REQUIRED.length).toBe(MIN)` i
      `scripts/scripts-self-tests-present.test.mjs`. En LIKHET, inte en
      harledning - `const MIN = REQUIRED.length` kan aldrig falla.
- [ ] Prova bada riktningarna: ta bort ett namn ur `REQUIRED` utan att rora
      disken; hoj `MIN` utan att lagga till ett namn. Bada ska falla.

Acceptans:
1. Ett borttaget namn ur `REQUIRED` faller sviten. *(diff)*
2. Ett hojt `MIN` utan nytt namn faller sviten. *(diff)*
3. Diskvaxten ar fortfarande fri: `found.length >= MIN`, aldrig en likhet. *(diff)*

### BIN-1104 - `bundle-report.mjs`s riktiga skrivvag har ingen lyckad gren

- [ ] Vidga den skrivbara fixturen: riktig OBLOCKERAD temp-katalog,
      `GITHUB_STEP_SUMMARY` pekad pa en FORSEEDAD riktig fil.
- [ ] `readFileSync` baslinjen tillbaka, havda att den rundgar till
      `{routes: {...}}`.
- [ ] Havda att den forseedade sammanfattningens innehall star kvar FORE den
      nytillagda texten.

Acceptans:
1. Muteringen som byter `renameSync`s argument faller minst ett test. *(diff)*
2. Muteringen `flag: 'a'` till `flag: 'w'` faller minst ett test. *(diff)*
3. Skriptets fail-open-kontrakt ar orort: `main()` returnerar fortfarande 0 nar
   en riktig skrivning kastar. *(diff)*

---

## Bunt 2 - funktionsbygget [Tier A]

Kritik: en blind fran #27 Database Administrator fore bygget.

### BIN-1110 - testfiler kompileras in i funktionsbygget

- [ ] `functions/src/**/*.test.ts` ut ur det som `npm run build` kompilerar.
- [ ] NAMNGE vilket kommando som fortfarande typkontrollerar testfilerna, och
      kontrollera att det kommandot kors i CI. Faller typkontrollen bort utan
      ersattning byts ett hogljutt fel mot ett tyst.
- [ ] En check faller om ett testfil-monster ater hamnar i byggets `include`.
- [ ] `functions/src/groupHandover/logic.test.ts` far ga tillbaka till
      `fileURLToPath(import.meta.url)`.

Acceptans:
1. Inga `*.test.ts`-artefakter i `functions/lib/` efter `npm run build`,
   verifierat med ett kommando vars utdata lases. *(diff)*
2. Testfilerna typkontrolleras av ett namngivet kommando som CI kor. *(diff)*
3. En check faller pa ett aterinfort testmonster i `include`. *(diff)*

### BIN-1109 - gruppoverlamningens klumpning nar inget test

- [ ] Bryt ut klumpningen till en ren funktion i den admin-fria
      syskonmodulen, eller bygg en testport som klumpar som Admin-porten gor.
- [ ] Fixtur med FLER poster an `BATCH_LIMIT`.
- [ ] Sag i biljetten vid stangning om `retentionCleanup`s motsvarande
      klumpning tacks av samma form, eller att den luckan star kvar.

Acceptans:
1. Ett test driver mer an `BATCH_LIMIT` skrivningar och asserterar att VARJE
   avsedd rad ar borta, inte bara forsta klumpens. *(diff)*
2. Muteringen som tar bort `flush()` mellan klumparna faller minst ett test. *(diff)*
3. Muteringen som later raknaren sta kvar over en flush faller minst ett test. *(diff)*

---

## Bunt 3 - `firestore.rules` [Tier C, top]

Kritik: full panel `[27, 5, 4, 6, 18]`, blint och parallellt, fore bygget.
Reglerna deployas FOR HAND - `deploy.yml` skeppar bara hosting.

### BIN-1106 - `friendRequests` create saknar `hasOnly`

- [ ] HARLED nyckellistan ur `sendFriendRequest` i `src/lib/firebase/friends.ts`
      innan regeln skrivs. En for smal lista nekar varje skarp vanforfragan.
- [ ] `hasOnly` pa create-grenen.

Acceptans:
1. Emulatortest: ett extra falt nekas. *(diff)*
2. Emulatortest: den nyttolast `sendFriendRequest` faktiskt bygger gar igenom. *(diff)*
3. `friends.test.ts` pinnar nyckelmangden exakt, som for de tva andra. *(diff)*
4. Muteringen som tar bort `hasOnly` faller minst ett test. *(diff)*

### BIN-1108 - en agare kan lamna sin egen grupp och frysa den

Lage vid HEAD, last: agar-grenen kraver `resource.data.memberUids.hasAll(new)`
och pinnar `ownerUid`, men kraver inte att `request.auth.uid` star kvar i
`request.resource.data.memberUids`. En delmangd far utelamna agaren.

Det som blockerade fixen ar borta: BIN-1063 steg 3 shippade overlamningen som en
SERVERFUNKTION (Admin SDK, gar forbi reglerna), sa en sparr pa klientgrenen
stanger ingen vag steg 3 behover.

- [ ] Villkor som knyter agarens sjalvborttag till ett samtidigt medlemsuttrade.
- [ ] Kontrollera FORST att `functions/src/groupHandover/` skriver via Admin SDK
      och alltsa inte traffas. Gor den det inte ar planen fel, inte koden.

Acceptans:
1. Emulatortest: en agare kan inte skriva bort sig ur `memberUids` pa
   agar-grenen. *(diff)*
2. Emulatortest: namnbyte, borttag av NAGON ANNAN och tokenrotation gar
   fortfarande igenom. *(diff)*
3. Muteringen som tar bort det nya villkoret faller minst ett test. *(diff)*
4. Overlamningsfunktionens vag ar oberord, bevisat av att dess svit ar gron. *(diff)*

---

## Behover dig (byggs inte)

- **BIN-454** - `tmdbFieldsSweep`s utrullning. Firebase Console + skarp
  torrkorning. Star under "gor aldrig detta" i CLAUDE.md; en sprint far inte
  rora den. Forfaller 2026-11-01.
- **BIN-521** - buntradgivaren. Bar etiketten `idea`, alltsa ditt produktval.
- **BIN-824** - hoj SEO-urvalets tak. Biljetten sager sjalv "byggs inte nu",
  och kraver skarpa GSC-data.
- **BIN-1114** - satt `REFRESH_DERIVE_TIMEOUT_MS`. Kraver en matning mot skarp
  drift (`kind: run`), inte nagot en obemannad bunt kan producera.

## Kvar i Backlog, inte valda den har rundan

BIN-1113, BIN-1112, BIN-1111, BIN-1103, BIN-1097, BIN-959, BIN-658, BIN-624,
BIN-559, BIN-402.

## Efter sprinten

- [ ] Fila foljdbiljetter FORE commit.
- [ ] Commit per bunt, med granskarna den stageade diffen utloser.
- [ ] Push-grinden ar ett EGET granskningsvarv over hela `@{u}..HEAD` - inte
      summan av bunternas. Budgetera det darefter.
- [ ] `firebase deploy --only firestore:rules` for hand efter bunt 3.
- [ ] Linear-overgang per bunt, skriven av den som haller shan.

## Deviation log

- [leverans] Alla tre buntar shippade och pushade 2026-09-08: 68275c9, 103e30d,
  36317c7, plus kartans egen commit 06ee9cb. Deployen ar RÖD med flit -
  skyddet "Guard - rules/functions changed" stoppar hela korningen nar
  `firestore.rules` eller `functions/**` andrats, sa HOSTING deployades INTE och
  cachen ar inte rensad. Malin kor `firebase deploy --only firestore:rules` och
  `--only functions` for hand; darefter kors hosting om.
- [oppet] Push-grinden hittade en falsk mening i `firestore.rules` och en i
  regeltestet: bada pastar att `handOverOwnedGroups` ar en frivillig vag ut for
  en agare. Klientomslaget tar inget gruppargument och anropas bara av
  kontoraderingen. Icke-blockerande, sa den ligger kvar pa main - noterad pa
  BIN-1118 med instruktionen att STRYKA bada.
- [routning] Bunt 3: buntens FAKTISKA filunion routar till panel [27, 5, 4, 6, 7],
  inte till urvalets [27, 5, 4, 6, 18]. `src/test/rules/firestore-rules.test.ts`
  drar in #7 QA/Test, och #18 faller ur. #7 har alltsa inte kritiserat arbetet, sa
  dess blinda kritik konvenerades EFTER bygget och fore commit. BIN-1052:s regel i
  praktiken - routa unionen du faktiskt har, inte den du planerade.
- [kritik] Bunt 2, helhetsgranskningen varv 2: FYRA till, och den forsta ar samma
  fel som forra varvet EN FILKLASS BORT. Att byta CI fran ett bart `tsc` till
  `npm run typecheck` tog bort den enda kontrollen att den SKEPPADE koden
  fortfarande kompilerar som CommonJS - sa ett `import.meta` i en
  PRODUKTIONSfil hade passerat allt och fallit forst i deployen. Skriptet kor nu
  BADA konfigurationerna; mätt genom att lagga `import.meta` i `push.ts` och se
  TS1343.
- [kritik] Bunt 2: min egen `TraceErasureShape` var en andra deklaration av en
  befintlig typ, alltsa tilldelningsbar fran den - en FEMTE raderingskategori
  hade kunnat samlas in och aldrig skrivas, utan att nagot foll. En deklaration
  nu, importerad som typ. Den andra halvan (portarna) ar BIN-1123.
- [rattelse] "den form resten av repot anvander" var omatt. Struket pa bada
  stallen. Talet jag forst skrev hit var ocksa fel, och pa ett larorikt satt: det
  raknade filen den har commiten just flyttat BORT fran idiomet.
- [foljd] `.claude/agents/binge-code-reviewer.knowledge.md` bad granskare kora
  `cd functions && npx tsc --noEmit`. Min andring gjorde det kommandot till
  bygg-konfigen, som hoppar over testfilerna - en instruktion i en fil bunten
  inte ror blev alltsa falsk av bunten. Ersatt pa plats.
- [kritik] Bunt 2, helhetsgranskningen: SEX blockerande, och det forsta var att min
  egen andring FORSVAGADE en befintlig kontroll. `pr-checks.yml`s steg korde ett
  bart `tsc` fran `functions/`, alltsa BYGG-konfigen - den jag just lart att hoppa
  over testfiler. Samma commit som slutade SKEPPA testkod hade alltsa slutat
  KONTROLLERA den pa den enda vag det flodet kor. Lagat, och pinnat sa ett bart
  `tsc` inte kan komma tillbaka.
- [kritik] Bunt 2: bygget uteslot EN suffix, korningen samlar TVA
  (`{test,spec}.ts`). En `.spec.ts` hade skeppats - BIN-1110:s exakta fel en
  bokstav bort. Bada tacks nu.
- [rattelse] Fyra falska pastaenden i min egen prosa strukna: ett antal ("bada
  testportarna" - tre finns), en doc-kommentar min insattning skilt fran sin
  symbol, och tva pastaenden om vad routern svarade fore ett sate fanns.
- [matning] Min forsta mutering av `pr-checks.yml` traffade FEL av tva identiska
  rader och kom tillbaka gron. Spärren var riktig; matningen var trasig. Grep:a
  vilken rad som muterades, alltid.
- [upptackt] Bunt 2, BIN-1110: hålet var bredare an biljetten. Rotens
  `tsconfig.json` EXKLUDERAR `functions`, och `pr-checks.yml` kor bara pa
  `pull_request` (dvs Dependabot). Alltsa typkontrollerade INGENTING Cloud
  Functions-koden pa den vag en manniskas commit tar - bara `firebase deploy`,
  for hand, sist av allt. Typkontrollen ar darfor inkopplad i lefthooks
  pre-commit, inte bara i den PR-vag repot i praktiken aldrig gar.
- [upptackt] Bunt 2: att namnge tva nya filer i `functions/` gjorde katalogen
  "listad fil for fil" i agarkartan, vilket drog fram FEM redan existerande
  filer utan agare (`index.ts`, `push.ts`, `tsconfig.json`, `package.json`,
  `package-lock.json`). De ar seatade: FCM-sandarna hos #13, byggets och
  runtidens konfiguration hos #25. Aldrig `--update-gaps`, som gor halet
  permanent.
- [kritik] Bunt 1, helhetsgranskningen varv 4: TRE fynd till, alla i prosa som
  fanns FORE bunten men som mina egna tillagg gjorde barande. `route.test.mjs`
  pastod att `recap-upload.helpers.mjs` "seats the #14 fallback" - routern svarar
  `panel: [27]`; min nya post citerade just den meningen som kontrast. Golvfilens
  huvud sa att "bada" skripten kors av deployen - `grep` ger tre. Och vaktens
  rubrik lovade "Firestore-opening" medan loopen bara kanner igen ett
  inloggningssatt. Alla tre strukna, inget omraknat.
- [kritik] Bunt 1, helhetsgranskningen varv 2 och 3: TVA fynd till, bada i min egen
  prosa och bada inne i rattelsen av ett tidigare fynd. (a) Ett publicerat
  RADERINGSkommando i driftboken (`node -e`, inline) oppnade en onamngiven databas -
  min forsta svepning var byggd pa skriptnamn och kunde inte se det. (b) Mitt
  ersattningskriterium bar en skalbugg: `grep -q A && grep -q B || echo` skriver ut
  varje fil som saknar A, sa den listade tre filer medan meningen bredvid pastod tom
  utdata. Bada strukna; kriteriet pekar nu pa vaktens EGET testfall i stallet for att
  beskriva den en gang till.
- [rattelse] Min mening att inline-kommandot var den ENDA Firestore-oppnande formen
  utanfor `functions/scripts/` var falsk. Den andra svepningen var nycklad pa
  `applicationDefault()`, och `gcloud`-formen innehaller inte det uttrycket alls - en
  aterstallning av en HEL databas i `docs/RUNBOOK.md` namngav inget projekt. Vidgat in
  i BIN-1122 och lagat dar; radnumret ar struket, det gick inaktuellt i samma commit.
- [kritik] Bunt 1, helhetsgranskningen: TRE fynd, alla i min egen prosa, inget i
  koden. (a) Ett publicerat kommando i `tasks/recap-50-shows-progress.md` - en fil
  bunten inte ror - slutade fungera av min andring; migrerad. (b) "de tva testen
  ovan ar de enda som ror ett riktigt filsystem" var falskt (sex gor det); struket,
  inte omraknat. (c) tva riktningsord ("ovan") pekade at fel hall, och det ena
  namngav ett test som gor precis tvartemot vad meningen pastod; riktningsorden ar
  borta helt, golvet namnges av sin assertion i stallet.
- [kritik] Bunt 1, det viktigaste fyndet: testgranskaren RADERADE vagran ur bada
  skripten och fick hela sviten gron. Hjalparens egna test provar bara hjalparen,
  och argumentskanningen bara texten inne i `initializeApp(...)`. Ingen nadde
  `main()`. En kallkodsskanning ankrad genom EXIT ar tillagd, och raderingen
  faller nu i alla TRE anropande skript. BIN-776:s klass.
- [rattelse] Testets namn sa "varje skript" om en lista med tva av tre. Vidgat till
  alla tre i stallet for omskrivet - granskarens sakrare alternativ. Rostern pinnas
  nu pa MEDLEMSKAP, harlett ur `git ls-files`, inte bara pa storlek.
- [kritik] Bunt 1: sakerhetsgranskaren fallde vakten TVA ganger till. Forst att
  kommentarsstrippning + prov mot HELA filtexten kan rensas av en avslutande
  kommentar var som helst i filen; darefter att reservgrenen provade EXISTENS, sa
  ett andra olasbart anrop akte med bredvid ett korrekt syskon (dess prov var
  7/7 gront). Vakten laser nu ARGUMENTET i varje anrop och jamfor ANTAL, inte
  existens. All kommentarsstrippning ar borta.
- [rattelse] Tva meningar i min egen kommentar ar STRUKNA, inte omformulerade,
  efter att jag motbevisat dem med ett kommando: att en kommentar inte kan sta
  inne i den matchade literalen (den kan - `/* projectId */` inuti klamrarna
  rensar anropet), och att rubriken "citerar" ett anrop i presens (den gor inte
  det langre).
- [kritik] Bunt 1, BIN-1107: min kallkodsvakt flaggade sin EGEN modul sa fort filen
  stagades. Tva orsaker i samma fynd: modulens rubrik citerar det onamngivna anropet
  ordagrant for att forklara vad modulen ar till for, och bade `git ls-files` och
  agarkartans generator laser SPARADE filer - sa `git add` andrade deras svar. Min
  grona helhetskorning gjordes fore stagningen och matte darfor nagot annat.
  Testgranskaren fallde bunten tva ganger; bada fynden var akta.
- [kritik] Bunt 1: forsta rattelsen rackte inte. `if (!src.includes('initializeApp('))`
  ensamt lamnade halet oppet, eftersom rubriken citerar hela anropet. Vakten strippar
  nu blockkommentarer forst och sedan HELRADS-kommentarer med samma ankrade uttryck
  som grannfilen redan anvander. Bada granskarens provformer korda mot en riktig fil:
  bagge namnger nu ratt fil, tidigare var bagge osynliga.
- [avvikelse] `functions/scripts/_check-soa.mjs` och `.agents/skills/recap/` ar
  OSPARADE. Ingen commit kan andra dem, sa de ligger utanfor bunten och gick till
  BIN-1116 for ditt beslut. Vakten laser darfor spårade filer, inte katalogen.
- [kritik] BIN-1108: #4 Sakerhetsarkitekten BLOCKERAR planens omfang. Jag verifierade
  sjalv: "medlem lamnar"-grenen kraver bara `request.auth.uid in resource.data.memberUids`
  och pinnar `ownerUid` - ingenting utesluter agaren, sa agaren kan lamna via DEN grenen
  och frysa gruppen aven om agar-grenen lagas. Fixen maste stanga BADA grenarna.
  Villkoret ar i samma fil, sa routningen andras inte.
---

# BIN-1063 steg 3 - det faltagda halvan + gruppoverlamningen

Routning: harleds med `node docs/org/route.mjs $(git diff --cached --name-only)`
omedelbart fore commit. Vid planeringen gav den `tier: top`, `panel: [27, 5, 6, 4, 7]`.
Alla fem har kritiserat blint fore bygget.

## Malins beslut - avgjorda, fraga aldrig om dem igen

1. En agd grupp med kvarvarande medlemmar LAMNAS OVER till den som varit medlem
   langst. Den raderas inte.
2. Det galler BADA vagarna: svepet (uid borta ur Auth) och knappen (agaren
   raderar sig sjalv).
3. Overlamningen gors av en anropbar serverfunktion, inte av klienten. Servern
   avgor sjalv vem som varit medlem langst, sa garantin ligger dar den gar att
   halla. Klienten far aldrig skriva `ownerUid`.
4. `addedBy` pa gruppens watchlist-poster NOLLAS vid overlamning. Titeln star
   kvar; sparet av vem som lade till den forsvinner, konsekvent med hur
   recensioner och kommentarer redan hanteras.

## Premisskontroll mot HEAD - tva pastaenden i biljetten ar redan falska

- `joinedAt` ar REDAN pinnat. `firestore.rules` kraver `joinedAt == request.time`
  pa create och att faltet ar oforandrat pa update, byggt av steg 1 uttryckligen
  for den har overlamningen. Bygg inte om det.
- `ownerUid` ar pinnat pa VARJE `groups/{groupId}`-update-gren, sa ingen klient
  kan andra det i dag. Det ar skalet till att overlamningen maste ga via en
  serverfunktion - inte en ny regelgren.

## Den farligaste enskilda fallan i hela biljetten

`createGroup` skriver agarens EGET `members/{ownerUid}`-dokument med
`serverTimestamp()` innan nagon annan hunnit ga med. Agarens `joinedAt` ar
darfor per konstruktion tidigast i praktiskt taget varje grupp som finns.

En eftertradarvaljare som inte UTTRYCKLIGEN utesluter den avgaende agaren valjer
agaren sjalv - alltsa ingen overlamning alls, tyst. Fixturen som faller det ar
den NORMALA formen pa en grupp, inte ett kantfall: agaren ar tidigast.

## Villkor fran #27 Database Administrator

- Ingen ny regelgren for `ownerUid`. (Malins beslut 3 gor detta uppfyllt.)
- Las HELA `members`-undersamlingen (taket ar 100 medlemmar, sma dokument, en
  fraga) och valj minsta `joinedAt` bland id:n SKILDA fran den avgaende agaren,
  i kod. Inte `orderBy('joinedAt').limit(1)`, inte ett `documentId() !=`-filter.
- Svepets nya lasningar ar per-uid-riktade fragor, INTE nya `ScanKind`-sidor over
  hela `reviews`/`lists`/`sessions`/`groups`. De befintliga scanningarna
  sidbladdrar hela samlingar och filtrerar i klienten, vilket ar billigt bara for
  samlingar som TTL-begransar sig sjalva. Dessa gor inte det.
- Berakna INTE en andra kandidatmangd av franvarande uid:n. Halvan konsumerar
  exakt den array `withinOrphanCeiling` returnerade for `orphanData.erase`.
- Overlamningsskrivningen ligger INNE i `eraseOrphanedUserData`s try/catch, fore
  raderingen av bevakningsposten - annars gar retry-kontraktet forlorat.
- Overlamningen ar idempotent mot en omkorning: i en transaktion, kontrollera att
  `ownerUid` fortfarande ar den franvarande uid:en. Har en tidigare korning redan
  lamnat over ar det en no-op, aldrig ett nytt val som kan peka pa nagon annan.
- Inga nya index behovs (`reviews.uid`, `lists.uid`, `comments`/`likes`/
  `reactions`.uid finns redan; `groups.ownerUid`, `sessions.hostUid` och
  `lists.editors` tacks av automatisk indexering). Bekrafta med
  `firebase firestore:indexes` mot skarpt projekt fore merge, inte bara genom att
  lasa JSON-filen.

## Villkor fran #6 Data Protection Officer

- Taket raknar KONTON; utflakningen ar obegransad i DOKUMENT. Lagg en
  dokumentbudget per korning, oberoende av kontotaket, med samma
  fail-closed-beteende: logga och vagra fler raderingar for det uid:t, aldrig en
  tyst halv radering.
- Definiera och skriv ned en uttrycklig raderingsORDNING per kategori, med samma
  resonemang som `eraseOrphanedUserData`s kommentar redan ger: det som ar natbart
  oberoende av uid-sokvagen (publikt lasbart, indexlistat) gar forst.
- Varje kategori ar idempotent vid omkorning: radera-om-finns, aldrig anta-finns.
- Per kategori: `checked`, `erased` och `skipped` i `CleanupSummary`, med samma
  minus-ett-sentineldisciplin som redan finns. En manniska ska kunna skilja
  "svepte och hittade inget" fran "nadde aldrig steg 3" pa EN loggrad.
- Rakna upp ovriga uid-barande falt i `groups/`-undertradet. `addedBy` ar det enda
  som ar matt; anta inte att det ar det enda som finns.

## Villkor fran #5 Legal / GDPR Counsel

- Overlamningen far inte bli ett undantag fran den radering medlems-utträdet redan
  gor. Pa SAMMA grupp maste den avgangnes egna spar bort: `members/{uid}` (barer
  denormaliserat `displayName`, `username`, `photoURL`, `providers`),
  `household/{uid}`, och `watchlist/*/progress/{uid}`.
  Kopiera INTE `removeMember` och kalla det tackt: den raderar `members/{uid}`
  och `household/{uid}` men ror aldrig `progress/{uid}`. De tre raderna ovan ar
  listan; harled den harifran, inte ur en befintlig kodvag.
- `lists`: AGD lista raderas; SAMREDIGERAD lista far bara uid:t struket ur
  `editors`. En fraga som `editors array-contains` och sedan raderar dokumentet
  forstor en levande agares lista.
- En kommentar den avgangne skrev pa NAGON ANNANS recension: KRAVS radering,
  ingen ny fraga - policyn klassar allt publikt UGC som hard radering.
- Att radera den avgangnes recension tar med sig ANDRAS likes och kommentarer
  under den. Det ar TILLATET, inte kravt - skriv ut skalet i policyn sa en
  framtida granskare inte laser en forsvunnen like som omfangsglidning.
- Mat att inget levande `members/{uid}`-dokument saknar `joinedAt` innan bygget.
  Ett saknat falt far ALDRIG sortera som "tidigast".
  MATT 2026-09-07 mot binge-nu: noll grupper, noll medlemsdokument. Mangden ar
  tom, sa villkoret ar uppfyllt vakuost - inte for att inget dokument saknar
  faltet, utan for att inga dokument finns. Logiken hanterar fallet anda.

## Villkor fran #4 Security Architect

- Varje ny fraga provas mot emulatorn med ett SYSKONdokument som INTE ska matcha
  (en levande uid:s recension bredvid den franvarandes) INNAN den kopplas in i
  den muterande vagen. Ett inverterat predikat plus batch-radering ar det varsta
  utfall den har biljetten har tillgang till.
- Ateranvand `withinOrphanCeiling`, `ORPHAN_AUTH_MAX_PER_RUN`, den proportionella
  granden och `ORPHAN_DATA_MIN_OBSERVED_MS`. Bygg inget andra tak och ingen andra
  franvarokoll.
- Re-grep faltnamnen mot tradet vid byggtillfallet. Admin SDK upprätthaller
  ingenting - en omdopning mellan nu och da inverterar tyst vilken uid svepet
  litar pa.
- Skriv ALDRIG "overlamningen sker inom 24h" om svepets vag.
  `ORPHAN_DATA_MIN_OBSERVED_MS` ar tre dygn, sa svepets fonster ar minst tre dygn.
  Malins beslut 3 gor knappens vag omedelbar, sa meningen galler bara svepet.
- Pre-existerande hal, filat som BIN-1108 och medvetet INTE lagat har: agar-grenen
  kraver inte att agaren finns kvar i `memberUids`, sa en agare kan skriva bort
  sig och frysa gruppen permanent for alla andra. Steg 3 behover samma skrivform
  for egen rakning, sa sparren maste utformas tillsammans med den.

## Villkor fran #7 QA / Test Engineer

- Varje ny kategori far ETT EGET absent/live/disabled-test som anvander
  `absentUidsFromLookup` (existens, inte heder). Den troligaste defekten i hela
  biljetten ar ett kopierat `revokedUidsInBatches(..., fel predikat)` pa EN av
  kategorierna - vilket raderar ett moddat men levande kontos innehall.
- Testet asserterar pa `checked<X>`-raknaren, inte bara pa att dokumentet
  overlevde. "Hittade inget" och "kunde inte kolla" far inte lasa likadant.
- Ett rosterkrav UTANFOR varje tabelldriven loop, harlett ur kallan (antalet nya
  `ScanKind`-medlemmar eller `case`-armar), sa en borttappad kategori faller.
- De TRE skrivningarna som ror en levande tredje parts dokument -
  `editors`-strykning, `memberUids`-strykning och agarbytet - grindas av ett tak,
  inte lamnade ogrindade for att de "bara ar en array-redigering".
- `src/test/rules/account-deletion.test.ts`s `mygroup`-assertion sager i dag att
  den agda gruppen RADERAS. Den ar nu fel och skrivs om i samma commit - inte
  raderad, inte lamnad rod, och fixturen far inte tyst goras medlemslos sa att
  den gamla assertionen fortsatter passera.
- Nya fixturer: 0 kvarvarande medlemmar (full radering ar fortfarande ratt - en
  eftertradare gar inte att uppfinna), 3+ medlemmar med ICKE-sekventiella
  `joinedAt`, LIKA `joinedAt` (tvingar fram en dokumenterad deterministisk
  tie-break), och en eftertradare som SJALV ar franvarande.
- Eftertradarvalet och overlamningens nyttolast ar VAR SIN rena funktion som bada
  ingangarna importerar - aldrig tva implementationer som ser likvardiga ut.
- Per kategori: seeda ett LEVANDE syskondokument i samma samling och assertera i
  SAMMA test att malet ar borta OCH att syskonet ar oforandrat. Ett test som bara
  kollar att malet ar borta skiljer inte "filtrerade ratt" fran "svepte sidan".
- Framtvinga en flersidig korning (liten `pageSize`, minst tva sidor) per ny
  scanning.
- MANUELL granskningspunkt, ingen automatisk grind kan na den: `index.ts`s
  `.select()`-projektion per ny `case`. Orkestratorns testharness laser hela
  dokument via klient-SDK:n, sa ett saknat projicerat falt ar ett tyst
  produktionsfel. Las det for hand mot predikatets faltbehov.

## Dokumentation som blir FALSK i samma andring

- `docs/data-retention-policy.md` sager i dag att den faltagda halvan INTE tacks,
  och att gruppen "lamnas agarlos" nar agaren raderar sig. Bada blir falska.
  STRYK och ersatt, i samma commit.
- `.claude/rules/accepted-deviations.md`: BIN-1023-posten sager att faltagt
  innehall inklusive agda grupper ar helt utanfor svepet. Lagg en DATERAD
  EFTERFOLJARE som smalnar den, som steg 2 gjorde. Redigera inte den gamla.
- Stycket "Kvarstaende lucka, inte tackt av omforsoket" kan bli falskt som en
  SIDOEFFEKT. Omformulera det inte pa planens ord - MAT det mot den shippade
  koden med en fixtur forst.

## Oppen fraga som bunt 2 maste svara pa, inte arva

En SPOKMEDLEM ar ett uid som star i `memberUids` men aldrig fick nagot
medlemsdokument - den icke-atomiska tre-skrivnings-joinen kan do mellan
skrivningarna. Reglerna behandlar en spokmedlem som fullvardig medlem.

Eftertradarvaljaren returnerar `null` for en grupp dar ALLA kvarvarande
`memberUids` ar spoken, vilket blir `{kind:'delete'}`. Den som mappar `delete`
till en verklig radering forstor da delad data for personer reglerna raknar som
medlemmar - precis den avvagning den har filen sjalv kallar den samre av tva
nar den vagrar radera over ett saknat `joinedAt`.

Noll grupper i produktion i dag, sa utfallet ar tomt. Bunt 2 avgor det, med
skalet skrivet. Arv det inte.

## Ordning

Bygget delas i tre commitar, var och en gron och granskad for sig:

1. Den rena eftertradarlogiken plus overlamningens nyttolast, med sina
   enhetstester. Ingen anropare an. Detta ar den enda delen dar ett fel ar tyst.
2. Serverfunktionen och `accountDeletion.ts`s nya gren, med emulatortesterna.
3. Svepets faltagda halva, kategori for kategori, med raknare och tak.

### Deploy-ordning for bunt 2 (#25:s bindande villkor 1)

FUNKTIONERNA FORST, hosting sedan. Omvand ordning bryter VARJE kontoradering,
inte bara for gruppagare: `handOverOwnedGroups()` anropas ovillkorligt som
forsta rad i `runDeletionCascade`, sa en klient som nar en callable som inte
finns far ett fel och kaskaden stannar.

1. `firebase deploy --only functions`
2. Bekrafta att den lever:
   `firebase functions:list --project binge-nu | grep handOverOwnedGroups`
3. Forst DA hosting via `workflow_dispatch`. Drift-vakten fäller push-deployen
   med flit (`functions/**` andrat), och `workflow_dispatch` hoppar over vakten
   UTAN att kontrollera att funktionerna ar uppe - steg 2 ar den enda
   kontrollen.

Reglerna rors inte av steg 3 - BIN-1108 tar halet i agar-grenen separat.

### Kartcommiten (#25:s bindande villkor 2)

`docs/workflow-map-universe.json` och `docs/workflow-map.html` gar i SAMMA
commit som varandra - aldrig delade - och den commiten kommer EFTER
featurecommiten. Kartans noder pekar pa `src/lib/firebase/groupHandover.ts` och
`functions/src/groupHandover/index.ts`; ligger kartan forst faller
sokvagskontrollen. Featurecommiten har darmed ett rott `npm test` i sig sjalv
(universumet saknar den nya funktionen tills nasta commit) - det ar priset for
regeln att kartandringar aldrig buntas med featurekod, och bada pushas ihop.


# BIN-1063 steg 2 - spegelmigreringen

Routning: harleds med
`node docs/org/route.mjs $(git diff --cached --name-only)` omedelbart fore commit.
Rubrikerna i villkorsblocken namnger de roller som SKREV respektive villkor.
De kritiserade blint fore bygget. Filunionen rorde sig sedan, sa routningen
strax fore commit namner en roll som inte var med da; den kritiserade efterat
och dess villkor star i sitt eget block. Inga blockerande invandningar.

## Mätt i skarp data 2026-09-06 - detta andrar omfanget

1. **Fyra konton finns i produktion.** Fem spegelrader hittade, var och en med
   bara sin tidsstampel. Tva lasningar blockerades av behorighetsspärren, sa
   fem ar ett GOLV, inte en summa.
2. **`followers` sopas redan.** `reclaimOrphanFollows` (BIN-21) kor varje vecka,
   gor en full collection-group-scan pa `following` och `followers`, och
   raderar rader vars agare eller motpart saknar `users`-dokument. Den behover
   inget uid-falt: den laser bada andpunkterna ur SOKVAGEN.
   Funnet oberoende av mig, #5, #6 och #27.
3. **Kostnadsskalet mot en full scan ar delvis motsagt.** Den scan som valdes
   bort kors redan varje vecka, och modulens eget huvud kostnadssatter den:
   "a few hundred ops/week at binge's size - well under the free tier".
   #27 skarper: beslutet gallde den ATERKOMMANDE detektionsfragan, inte
   engangsbackfillens egen enumerering.
4. **`friendRequests` bar redan `fromUid`**, och reglerna pinnar det redan.
   Men det finns INGET collection-group-index pa faltet - nabart i teorin,
   inte i praktiken.
5. **Den verkliga luckan ar smalare an biljetten sa:** `friends` och
   `friendRequestsSent`, och bara for ett konto som raderats i KONSOLEN.
   Sjalvbetjanad radering (`collectDeletionRefs`) tar redan bada halvorna av
   bade `friends` och `friendRequests*` via direkt doc-id-adressering.

## Bindande villkor ur panelen

### Regler (#4, #5, #6, #27 - alla fyra oberoende)
- Pinna det nya faltet mot SOKVAGSVARIABELN, inte mot `request.auth.uid`.
  `friendRequests` create-regel anvander `request.auth.uid` och
  fungerar dar, men samma monster pa `friends` SPRICKER: `acceptFriendRequest`
  skriver spegelsidan `users/{fromUid}/friends/{myUid}` som acceptor, alltsa
  inte som sokvagens agare. #27 skulle blockera just den kopieringen.
- `friends`-regelns create ar `(gren1) || (gren2)`. `&&` binder hardare an
  `||`, sa ett tillagg utan omslutande parentes ger `gren1 || (gren2 && koll)`
  och gren1 slipper pinningen helt. Maste skrivas `(gren1 || gren2) && koll`.
- `followers` tillater UPDATE (de tva andra har `allow update: if false`), sa
  faltet maste vara oforanderligt dar for att pinningen ska halla.
- Ingen av de tre har `hasOnly` i dag. #4 vill lagga till det i samma andring;
  #27 kallar det en befintlig lucka som dubblar regeldiffen utan att kopa
  korrekthet har. AVGJORT I BYGGET till #4:s sida: spegel-grenen later acceptorn
  skapa ett dokument under motpartens trad, sa utan nyckelbegransning kan
  acceptorn fylla motpartens lagring och motpartens GDPR-export med vad som helst.
  `hasOnly(['uid','since'])` och `hasOnly(['uid','sentAt'])` ar tillagda pa de tva
  create-reglerna. `followers` ligger utanfor omfanget efter Malins beslut.

### Backfill (#27, #6, #25)
- Admin SDK. Reglerna nekar `update` pa `friends` och `friendRequestsSent`,
  sa en befintlig radlos rad kan aldrig sjalvlaka via appen.
- `update()`, ALDRIG `set(..., {merge:true})`: en rad kan raderas mellan
  lasning och skrivning, och merge skulle da ateruppliva ett spokdokument med
  bara det nya faltet och ingen tidsstampel.
- Far INTE rora den befintliga tidsstampeln. Skriptet garanterar det genom att
  `patchFor` namnger exakt ett falt, vilket dess test pinnar; skriptet loggar
  dessutom tidsstampelns FORE-varde per rad. Nagon efter-lasning gor skriptet
  inte - den halvan tas for hand i konsolen om du vill se den.
- Enumerera de verkliga collection-grupperna, inte de fem rader jag hittade for
  hand - talet ar ett golv och tva lasningar var blockerade.
- Logga varje sokvag och varde. Ingen rollback behovs: det korrekta vardet ar
  alltid dokumentets eget id, sa en omkorning konvergerar.

### Index (#27, #25)
- En `fieldOverrides`-post per samling, `queryScope: COLLECTION_GROUP`, samma
  form som befintliga `comments.uid` / `likes.uid` / `reactions.uid`.
  Det svarar pa biljettens eget villkor 4.
- `firebase deploy --only firestore:indexes` returnerar nar deployen ar
  MOTTAGEN, inte nar indexet ar BYGGT. En fraga mot ett index som byggs kastar
  `FAILED_PRECONDITION`. Kontrollera att det star "Enabled" fore funktionen.

### Ordning (#25, #27, omvand av #4 vid commit-grinden)
HOSTING FORST, sedan regler + index. Riktningen ar avgorande och gick at fel
hall i den forsta planen:
- Ny klient under GAMLA regler skriver ett extra `uid`-falt. Gamla regeln har
  ingen nyckelbegransning, sa det gar igenom. Ofarligt.
- Gammal klient under NYA regler skriver inget `uid`, och den nya pinningen
  nekar. Bade skicka och acceptera vanforfragan slutar fungera for varje
  session som annu kor det gamla bygget - hela fonstret mellan de tva
  manuella stegen, plus PWA- och Cloudflare-cachens svans.
Sa: push (deployen blir rod med flit) -> hosting via `workflow_dispatch` ->
`firebase deploy --only firestore:rules,firestore:indexes` -> verifiera att
indexen star Enabled -> backfillen.

Backfillen kors fran `functions/` och MASTE namnge sitt projekt:
`node scripts/backfill-mirror-uid.mjs --project binge-nu --dry-run`, sedan samma
kommando med `--apply` i STALLET for `--dry-run`. Utan `--project` vagrar den,
och med bada lagesflaggorna samtidigt ocksa.

#27:s fyra bindande villkor for sjalva `--apply`-korningen, ordagrant ur
kritiken:
1. Kor den NAMNGIVNA torrkorningen en gang till omedelbart fore `--apply`, i
   samma terminalsession, och jamfor dess rad mot det du ar pa vag att skriva -
   korningen far bara rora `uid`-faltet, inget annat.
2. Bekrafta att identiteten bakom `applicationDefault()` fortfarande loser upp
   till `binge-nu` vid apply-tillfallet, pa samma satt som vid torrkorningen -
   anta inte att fixen haller over en ominloggning eller en `gcloud config`-
   andring pa maskinen; felet var just "sag frisk ut, var det inte".
3. PITR och schemalagda backuper ar INTE pa i projektet, och skrivningen gar
   forbi `allow update: if false` via Admin SDK - det finns ingen
   aterstallningsvag om `--apply` beter sig fel. Radien ar liten - ett falt, och
   ingen tidsstampel ror sig - och manuellt reversibel. Antalet rader kommer ur
   torrkorningen i villkor 1, ingen annanstans ifran. Generalisera inte
   skriptets form till en storre backfill innan den luckan ar stangd.
4. Spara `--apply`-korningens hela utdata (touched/skipped/scanned plus
   projektraden) nagonstans varaktigt innan terminalen stangs - det ar enda
   beviset att skrivningen gick till ratt projekt och rorde ratt antal rader.
Inga funktioner andras i denna commit; `functions/**` i diffen ar bara
engangsskriptet, som aldrig deployas.

## Deviation log - BIN-1063 steg 2

- [deviation] 2026-09-06: EN produktionsrad skrevs av misstag, fore denna commit
  och utanfor villkor 1, 2 och 4. Jag korde `--apply --project binge-nu` som ett
  prov av den nya vagran och pipade till `head -1`; en skrivning hann landa innan
  SIGPIPE. Raden ar inspekterad direkt:
  `users/Nm4IdVYWYzMZAGF0x7izbKIhwYJ2/friends/XYXoYI6au5V2kVPIsrANT2aiAJL2`,
  `keys = since,uid`, `uid` lika med dokumentets id, `since` orord pa
  2026-04-27T19:54:27.488Z. Det ar exakt migreringens avsedda slutlage, och
  `candidates()` hoppar over raden i varje kommande svep - ingen rollback ags.
  Foljden att kanna till: torrkorningen sager nu ett lagre tal an planen gjorde,
  och det ar vantat, inte ett matfel. Villkor 4:s bevis finns inte for just den
  raden; denna post ar det narmaste som finns.

### Dokumentation (#5, #6)
- `.claude/rules/accepted-deviations.md` far en DATERAD EFTERFOLJARE som
  smalnar den accepterade luckan. Posten fran 2026-08-30 redigeras inte -
  filen ar append-only.
- `SCHEMA_VERSION` bumpas och `docs/data-export-format.md` far en
  changelog-rad: `toExportDocs` sprider `d.data()` ordagrant, sa faltet hamnar
  i exporten utan kodandring.
- `docs/data-retention-policy.md:338` pastar att `reclaimOrphanFollows`
  "tacker bara foljare och vanner". Modulen namner inte `friends` en enda
  gang. Meningen ar falsk i dag, aldre an den har biljetten, och STRYKS.

### Test (#7, kritiserade efter att filunionen rort sig)
- `friends.test.ts` pinnade bara SOKVAGARNA pa de tre skrivningarna, aldrig
  nyttolasten. Ett framtida bygge som tappar `uid`-raderna hade lamnat sviten
  helt gron medan varje skarp accept nekades. Nyttolasten pinnas nu, och
  muteringen som tar bort de tre falten faller tva test.

## Vad steg 2 INTE gor

Sjalva raderingen. Steg 2 gor raderna hittbara; ingen kod som konsumerar
faltet finns eller byggs har. "Spegelmigreringen shippad" far inte lasas som
"restsparen ar stangda".

## Den enda fragan till Malin

Se rapporten. Omfanget ar en produktfraga eftersom matningen andrade den.

---
# Sprint 2026-09-06

Fyra biljetter valda ur en tunn backlog (12 öppna). Tre mättes bort — se
"Mätta bort" nedan. Routningen är kommandots utdata, inte en mening om den;
kör om per bunt strax före kritiken och strax före commit:

```
node docs/org/route.mjs $(git diff --cached --name-only)
```

---

## Bunt 1 — BIN-1101 [Tier A]

Medlemsdokumentets fältuppsättning har inget test som pinnar VILKA fält den bär.

Routning vid urvalet (`src/lib/firebase/groups.test.ts`):
`tier: medium`, `reasonCode: owned`, `panel: [4]`.

- [ ] Byt `expect(ownerKeys.length).toBeGreaterThan(5)` mot en bokstavlig,
      sorterad nyckellista i `src/lib/firebase/groups.test.ts`.
- [ ] Härled listan ur `memberFields()` genom att köra testet, inte ur läsning.
- [ ] Pröva muteringen: ta bort ett fält ur `memberFields()` → testet ska falla.

Acceptanskriterier
1. `{text: "Testet jämför ownerKeys mot en bokstavlig lista, inte mot ett antal", kind: diff}`
2. `{text: "Ett borttaget fält ur memberFields() fäller testet — mutering körd och redovisad", kind: diff}`
3. `{text: "toBeGreaterThan-golvet finns inte kvar", kind: diff}`
4. `{text: "npm test grön", kind: diff}`

## Bunt 2 — BIN-1102 [Tier A]

Kartans färskhetsflagga kan inte fyra för gruppflödena.

Routning vid urvalet (`.claude/hooks/freshness.mjs`, `docs/workflow-map.html`):
`tier: medium`, `reasonCode: owned`, `panel: [25]`.

- [ ] `stampMap` kommasplittar `node.path` så en nod kan bära flera sökvägar.
- [ ] Lägg `src/lib/firebase/groups.ts` till gruppnodens path i kartan.
- [ ] Testa båda riktningarna: enkel path fungerar som förut; kommalistan
      stämplar på var och en av sina sökvägar.
- [ ] MÄT den bredare frågan innan något byggs på den: hur många flöden
      beskriver en fil ingen nods path bär? Skriv talet och kommandot i
      biljetten. Bygg INTE ett svep på en gissning.

Acceptanskriterier
1. `{text: "En redigering av src/lib/firebase/groups.ts stämplar kartflaggan — prövat, inte resonerat", kind: diff}`
2. `{text: "En nod med EN sökväg beter sig oförändrat — pinnat av ett test", kind: diff}`
3. `{text: "Täckningslintern (node scripts/check-workflow-map.mjs) grön", kind: diff}`
4. `{text: "Den bredare frågans svar är MÄTT och skrivet i biljetten, inte uppskattat", kind: diff}`

Kartändringen committas för sig — aldrig buntad med kodändring (lärdomen 2026-07-10).

## Bunt 3 — BIN-658 [Tier A]

npm audit: High-CVE:er i eslint-kedjan, bara dev.

Routning vid urvalet (`package.json`, `package-lock.json`):
`tier: medium`, `reasonCode: owned`, `panel: [25]`, `unownedCode: [package-lock.json]`.

Premisskontroll vid urvalet: biljetten säger "tio nya High-CVE:er". `npm audit`
vid HEAD ger 5 totalt (3 high). Talet i rubriken är alltså inaktuellt — det
STRYKS ur biljetten, det formuleras inte om. `eslint@10.10.0` finns och
`eslint-config-next@16.3.3` deklarerar `eslint: >=9.0.0`, så uppgraderingen är
peer-tillåten.

- [ ] Bumpa `eslint` till `^10` i `package.json`, kör `npm install`.
- [ ] `npm run lint` måste vara grön utan att någon regel luckras upp.
- [ ] `npm audit` efter: redovisa talen före och efter, mätta.
- [ ] Kvarstår CVE:er efter bumpen: skriv vilka och varför, stäng inte biljetten.

Acceptanskriterier
1. `{text: "eslint är på 10.x i package.json OCH package-lock.json", kind: diff}`
2. `{text: "npm run lint grön utan att en regel avaktiverats eller mildrats", kind: diff}`
3. `{text: "npm audit-talen före och efter står i biljetten, körda", kind: diff}`
4. `{text: "npm test grön", kind: diff}`

## Bunt 4 — BIN-613 [Tier C]

Deployen mäter sidornas laddningsstorlek och jämför mot föregående körning.
Malins beslut 2026-09-03: alternativ 2, RAPPORTERANDE, aldrig blockerande.

Routning vid urvalet (`.github/workflows/deploy.yml`, `scripts/bundle-report.mjs`):
`tier: medium`, `reasonCode: owned`, `panel: [3]`, `unmapped: [scripts/bundle-report.mjs]`.
Malins kommentar namnger #4 Säkerhetsarkitekt; routern vid HEAD ger `[3]` med
#4 i `dropped`. Kritiken körs på routerns utdata — och #4 läggs till, eftersom
hon uttryckligen bad om den.

Bindande villkor ur Malins beslut:
- Mätningen får ALDRIG fälla bygget. Rapporterar, blockerar inte.
- Minnet mellan körningar tar samma form som urvalsmanifestet, som ligger i
  `.tmdb-cache/` och överlever via `actions/cache`.
- `npm run test:rules` viks INTE in i samma ändring. (Den körs redan i ett eget
  jobb i `deploy.yml` — mätt, se biljettkommentaren.)

- [ ] `scripts/bundle-report.mjs`: läs `.next`-manifesten efter bygget, räkna
      First Load JS per rutt, jämför mot en baslinje i byggcachen, skriv en
      tabell till `$GITHUB_STEP_SUMMARY`.
- [ ] Skriptet avslutar ALLTID 0. Ingen baslinje = "första körningen, baslinje
      skriven", inte ett fel.
- [ ] Steget i `deploy.yml` läggs efter Build och bär `continue-on-error` ELLER
      ett skript som inte kan falla — välj en och motivera valet i skriptets huvud.
- [ ] Enhetstest för skriptet: ingen baslinje, oförändrad, ökning, minskning,
      trasig baslinjefil. CLI:n bakom en entry-point-kontroll (lärdomen BIN-802).

Acceptanskriterier
1. `{text: "Skriptet kan inte fälla deployen — pinnat av ett test som ger det trasig indata och kräver exit 0", kind: diff}`
2. `{text: "Baslinjen persisteras i byggcachen, inte i repot, och en saknad baslinje är ett normalt utfall", kind: diff}`
3. `{text: "npm run test:rules rörs inte av den här ändringen", kind: diff}`
4. `{text: "Rapporten syns i en riktig deploy-körnings sammanfattning", kind: run}`

---

## Mätta bort vid urvalet — ingen kod

- **BIN-959** — delarna 2 och 3 är pluginarbete och bokade till en egen session i
  `C:/claude-plugins` (Malins beslut 2026-09-03). Del 4 (granskarens kunskapsfil
  över sitt tak): filen mäter 79 774 tecken, under den delade varningsgränsen på
  80 000 — biljettens "285 469" är inaktuellt. Del 5 (ett "alone" som koden inte
  har): premissen är BORTA. Meningen på `src/contexts/WatchlistContext.test.tsx`
  namnger båda termerna korrekt (`current || listenerFailed`), och ingen sökning
  i trädet hittar påståendet. Inget att bygga i binge den här körningen.
- **BIN-1097** — mätt 2026-09-06: det finns inga grupper i produktion, alltså
  noll drabbade. Rekommendationen på biljetten är att låta den ligga öppen.
- **BIN-559** — Malins handbroms är lyft, men den routar `top` och panelen har
  BYTT sammansättning sedan kritiken 2026-08-30: den kördes på `[5, 27, 2, 14]`,
  routern vid HEAD ger `[27, 5, 14, 19, 26]` för buntens faktiska filunion.
  Två roller har alltså aldrig kritiserat den. En ny full panel plus ~15
  bindande villkor plus emulatortest är ett eget pass, inte en fjärdedel av det
  här. Väljs inte — med skriven orsak på biljetten.

## Needs you (Tier D)

- Inget nytt den här körningen. `BIN-454` (tmdbTosSweep `mutateEnabled`) står
  kvar som din konsolåtgärd och rörs aldrig av en sprint.

## Deviation log
- [needs-human] BIN-613 ar BYGGD, GRON och STAGEAD men INTE committad. Commit-grinden
  kraver att binge-test-reviewer och binge-integration-reviewer laser de stageade bytes.
  Fem granskaragenter i rad hangde i den har sessionen utan att avsluta; en av dem hann
  avsluta en gang, med tre icke-blockerande fynd som ar atgardade. Grinden rundades inte.
  Koden ligger stagead OCH arkiverad som patch i scratchpad:
  batch-BIN-613-2026-09-06.patch, 35823 byte,
  77e885cb86baf15f710539076e1be3430b4a79cb. Bygg inte om den.
- [discovery] BIN-613: nio muteringar korda totalt, alla fallda, ren kontroll gron.
  Tre av dem provade de tre assertions som lades till efter testgranskarens fynd.
- [discovery] BIN-613: forsta versionen av `scripts/bundle-report.mjs` laste
  `.next/app-build-manifest.json`. **Den filen finns inte.** Nexts egen konstantmodul
  (`node_modules/next/dist/shared/lib/constants.js`) deklarerar `BUILD_MANIFEST`,
  `APP_PATHS_MANIFEST` och `APP_PATH_ROUTES_MANIFEST`, och ingenting som heter
  `APP_BUILD_MANIFEST`. `measure()` hade alltsa returnerat null vid varje verklig
  korning och hela rapporten hade varit en permanent no-op. Omskriven att lasa den
  EXPORTERADE HTML:en i stallet -- `output: 'export'` skriver de `<script>`-taggar
  webblasaren faktiskt hamtar, och de beror inte pa vilka manifest en framtida
  Next-version rakar skriva. Provkord mot repots riktiga `out/`: 30 rutter, exit 0.
- [deviation] BIN-613: bunten VIDGADES av en egen spärr. `docs/org/route.test.mjs`
  kraver att ett nytt verktygsskript med test star bade i `TOOLING_CODE_FILES` i
  `docs/org/route.mjs` (den radgivande listan) och i integrationsgranskarens monster i
  `.claude/shared-plugin.json` (den blockerande). Bada andrade i samma commit, per
  BIN-830. Vidgningen ror granskningsmaskineriet, sa rollkritik #25 konvenerades trots
  att routern lagger den i `dropped` -- BIN-917:s lardom.
- [deviation] BIN-613: steget ligger FORE cache-sparandet, inte efter Build och fore
  deploy som bada kritikerna skrev. Baslinjen skrivs till `.tmdb-cache/`, och det ar
  nasta steg som packar den katalogen; efterat hade minnet tappats varje korning och
  varje rad statt som "ny" for alltid.

- [discovery] BIN-1102: atgard (a) i biljetten -- "kommasplitta `node.path`" -- ar REDAN
  SKEPPAD. `mapTokens()` i `.claude/hooks/freshness.mjs` och `checkableTokens()` i
  `scripts/check-workflow-map.mjs` gor bada `.split(',')` pa faltet; landade i `4393344`
  (BIN-989). Verifierat genom att lasa bada funktionerna och kora
  `git log -S"split(',')" -- .claude/hooks/freshness.mjs`. Konservativt val: bygg den
  inte igen, ratta biljetten. Bunten blir en ren kartandring och routar `skip`.
- [deviation] BIN-1102: rollkritiken (#25) visade att "lagg till pa gruppnodens path"
  under-tacker. Harledningen -- varje nod vars flodessteg namnger en export ur
  `src/lib/firebase/groups.ts` -- ger nio noder over tre floden (`flow-groups`,
  `flow-tillsammans`, `flow-gdpr`), inte en. `firestore`-noden utelamnas: dess path
  namnger den fil noden AR, `firestore.rules`.
- [discovery] BIN-1102 (c), den bredare fragan, MATT: atta av kartans floden namnger en
  sparad kallfil som ingen nods path bar. Talet ar ett GOLV, inte en summa -- matningen
  ser bara floden som skriver ut en sokvag, och BIN-1099:s eget fall (en beskrivning av
  `groups.ts` som aldrig namnger filen) syns darfor inte i det.
- [needs-human] BIN-658: premissen ar dubbelt inaktuell. "Tio High-CVE:er" och "kraver
  eslint 9-10" ar bada falska vid HEAD. `npm audit` ger 5 (3 high), och
  `.github/dependabot.yml` bar sedan 2026-08-29 en daterad post som sager att eslint 10
  ar blockerad UPPSTROMS. Postens egna tva avblockeringskommandon kordes om i dag och
  ger samma svar som da: `eslint-plugin-react@latest` deklarerar `eslint: ^3 || ... ||
  ^9.7`, och `eslint-config-next@latest` levererar den fortfarande.
  `npm audit --omit=dev --audit-level=high` ger 0 fynd -- inget nar en besokare.

---

# ARKIV

# Sprint 2026-09-05d

Vald ur Backlog. Fem biljetter byggs i tre buntar; en mättes och byggs inte.

Routningen är kommandots utdata, inte en mening om den. Kör om per bunt strax
före kritiken och strax före commit, på buntens FAKTISKA union:

```
node docs/org/route.mjs $(git diff --cached --name-only)
```

---

## Bunt 1 — strykbunten [Tier A]

Tre biljetter, samma regel: en uppräkning som ingen håller sann stryks, den
formuleras inte om. Ingen ny mening bär ett nytt tal.

Routning vid urvalet (union av de sex filerna nedan):
`tier: medium`, `reasonCode: owned`, `panel: [25]`.

### BIN-1093 — gate-symmetry.test.mjs BIN-919-stycket

- [ ] Stryk offender-talen och filuppräkningen i `docs/org/gate-symmetry.test.mjs`
      (BIN-919-stycket). Meningen om KLASSEN står kvar; talen och namnlistan går.
- [ ] Stryk även kvantifikatorn om tidigare grindvidgningar i samma stycke — samma
      form, samma omätta historik.
- [ ] Efterlämna inget stycke utan subjekt.

Acceptanskriterier
1. `{text: "Ingen mening i BIN-919-stycket påstår ett antal offenders eller räknar upp filnamn", kind: diff}`
2. `{text: "Meningen om vad omnycklingen köper (KLASSEN) står kvar och har kvar sitt subjekt", kind: diff}`
3. `{text: "Ingen ny sifferuppgift införs i stycket", kind: diff}`
4. `{text: "npm test grön", kind: diff}`

### BIN-1095 — deployment.md + RUNBOOK.md räknar upp pr-checks.yml

- [ ] `.claude/rules/deployment.md`: stryk uppräkningen av vad `pr-checks.yml` kör.
      Filen har redan mönstret som håller ("Härled listan i stället för att lita på
      den här meningen: `ls .github/workflows/`") — följ det.
- [ ] `docs/RUNBOOK.md` §6a: stryk BÅDA uppräkningarna i stycket — den om
      `pr-checks.yml` OCH den om `deploy.yml`. Mätt: `deploy.yml` kör betydligt
      fler steg än de tre som står där, så samma påstående är falskt två gånger i
      samma stycke. Härled: `grep -n "name:" .github/workflows/deploy.yml`.

Acceptanskriterier
1. `{text: "Ingen av de två filerna räknar upp vad pr-checks.yml kör", kind: diff}`
2. `{text: "RUNBOOK §6a räknar inte heller upp vad deploy.yml kör", kind: diff}`
3. `{text: "Båda ställena pekar på arbetsflödesfilen i stället, utan att namnge stegen", kind: diff}`
4. `{text: "Felsökningsvärdet i §6a överlever — läsaren får fortfarande veta vilken workflow som är vilken", kind: diff}`

### BIN-1096 — listan över installationstidsskript i prosa

Källan är `INSTALL_TIME_SCRIPTS` i `scripts/check-dependency-diff.mjs`.

- [ ] `.github/workflows/pr-checks.yml`: stryk den parentetiska uppräkningen,
      namnge konstanten. Kommentarens poäng är stegens ORDNING — den överlever.
- [ ] `.claude/agents/binge-security-reviewer.md`: samma strykning.
- [ ] `tasks/todo.md`: samma strykning i BIN-1088-avsnittet (nu arkiverat nedan).
- [ ] Skriv ingen mening om hur många kopior som finns.

Acceptanskriterier
1. `{text: "Ingen av de tre filerna räknar upp skriptnamnen; alla tre namnger konstanten", kind: diff}`
2. `{text: "Yml-kommentarens poäng om ordningen (checken FÖRE npm ci) står kvar", kind: diff}`
3. `{text: "Ingen mening påstår ett antal kopior", kind: diff}`

---

## Bunt 2 — BIN-1092 ägarparet för useServiceValue [Tier A]

Routning vid urvalet: `tier: skip`, `reasonCode: doc-only`, `panel: []`.
Ingen kritik skyldig.

Mätt läge:
```
node -e "const m=require('./docs/org/ownership-map.json'); for(const [n,d] of Object.entries(m.roles)) for(const p of d.patterns||[]) if(p.startsWith('src/hooks/useServiceValue')) console.log('#'+n, p)"
```
Modulen → #24, testet → #26.

Vald ägare: **#24 Monetization / Partnerships Lead, för båda.** Läst modulen:
den rullar ihop månadsvärde per tjänst ur egna abonnemangspriser
(`resolveEffectiveMonthlyCost`, `rollupServiceValue`). Det är #24:s domän, och
testet prövar just den beräkningen. Väg 2 (båda till #26) faller på att hooken
inte är en vy-hook.

- [ ] Flytta `src/hooks/useServiceValue.test.ts` från #26:s lista till #24:s i
      `docs/role-responsibilities.md`.
- [ ] `node docs/org/gen-ownership-map.mjs` — aldrig `--update-gaps`.
- [ ] Kör om mätkommandot: båda ska svara #24.

Acceptanskriterier
1. `{text: "Båda sökvägarna svarar #24 i den regenererade ownership-map.json", kind: diff}`
2. `{text: "ownership-map.json är regenererad av generatorn, inte handredigerad, och ingen lucka är dold med --update-gaps", kind: diff}`
3. `{text: "npm test grön — inklusive gen-ownership-map.test.mjs som läser baslinjen som indata", kind: diff}`

---

## Bunt 3 — BIN-1063 steg 1: lås joinedAt i firestore.rules [Tier C]

Malins beslut 2026-09-05, punkt 1. Biljetten är tre ändringar i strikt ordning;
det här är den FÖRSTA, och de två andra får inte byggas före den.

Routning vid urvalet: `tier: top`, `reasonCode: high-stakes`,
`panel: [6, 4, 27, 21]`. Full panel FÖRE bygget. Routas om på den faktiska
unionen (som också bär `src/test/rules/firestore-rules.test.ts`).

### Vad som byggs

`firestore.rules`, `match /groups/{groupId}/members/{memberUid}`: `joinedAt`
pinnas till `request.time` vid create och görs oföränderligt vid update. Idag är
fältet klientskrivet och godtyckligt, vilket gör "längst medlem ärver gruppen"
till en förfalskningsbar tilldelningsregel.

### Vad som INTE byggs här

- Steg 2 (spegelmigreringen) — schemamigrering på skarp data, kräver egen plan
  och eget go-ahead per arbetsöverenskommelsen.
- Steg 3 (själva överlämningen i `accountDeletion.ts` + svepet).
- Inget andra tak, ingen andra frånvarokoll.

Acceptanskriterier
1. `{text: "En create som sätter joinedAt till något annat än request.time NEKAS av reglerna", kind: diff}`
2. `{text: "En update som ändrar joinedAt NEKAS, medan en update som lämnar fältet orört tillåts", kind: diff}`
3. `{text: "Emulatortest driver båda riktningarna per villkor — den skärpta regeln fäller, och den lagliga vägen står grön", kind: diff}`
4. `{text: "Reglerna är deployade manuellt (deploy.yml gör det inte)", kind: run}`

---

## Mätt, byggs inte

### BIN-1086 — gallringspolicy för sprint-patches/

Vägen som skulle skydda MEKANISMEN (åldersgolv) finns redan. `isHeldSince` i
`scripts/prune-map-flag.mjs` kräver att hållets tidpunkt är `>=` triggerns egen
stämpling, så en gammal patchfil kan inte hålla en nyare trigger vid liv. Det
som står kvar är hushållning (arkivering, janitor-städning) i en gitignorerad
katalog — utanför varje diffbaserad grind. Mätningen kommenteras på biljetten;
den byggs inte blint.

## Needs you (Tier D / produktval)

- **BIN-1063 steg 1 kräver manuell regeldeploy** efter commit:
  `firebase deploy --only firestore:rules`. `deploy.yml` gör bara hosting.
- **BIN-454 / BIN-402** — `tmdbFieldsSweep` mutateEnabled är din konsolåtgärd och
  står under stående "gör aldrig detta". Rörs inte.
- **BIN-189, BIN-521, BIN-170** — bär `idea`-etiketten: produktval som är dina.
  Byggs inte, kommenteras.

## Deviation log


---

# Sprint 2026-09-05c

## BIN-1088 — Dependabots väg in i main får en mekanisk beroendekontroll [Tier B]

Malins beslut 2026-09-03: väg 2 av tre. Inte branch protection, inte en mänsklig
granskning varje vecka — en check i `pr-checks.yml` som läser beroendediffen.

Routning. Kommandot härleder filuppsättningen i stället för att räkna upp den — en
uppräkning i en plan är falsk i samma commit den ligger i, så fort en fil till stageas:

```
node docs/org/route.mjs $(git diff --cached --name-only)
```

### Vad problemet är

Varje granskare i `reviewGates` drivs av en PreToolUse-hook på ett LOKALT `git commit`.
Dependabots veckomerge sker med GitHubs serversidiga knapp och kör aldrig ett sådant, så
den passerar ingen granskningsgrind och rör aldrig push-grinden. Det är inte en lucka i
grindlistan; mekanismen sitter på fel sida. Inget som kör på den vägen tittade på vad
höjningen gjorde med manifesten.

### Vad checken fäller på

- Ett nytt installationstidsskript.
- En flytt ut ur `devDependencies` in i `dependencies`.
- Ett paket som inte stod i något av blocken förut.

En vanlig versionhöjning — vilket i praktiken är varje Dependabot-PR — fäller aldrig.

### Bindande acceptanskriterier från #4 Säkerhetsarkitekts blinda kritik

Kritiken kördes FÖRE bygget, på planen. Verdict: pass-with-conditions, sex villkor.

1. **Fail closed.** En onåbar bas-ref, ett manifest som inte parsar och varje annan
   kastad throw ger exit skild från noll. "Jag kunde inte titta" och "jag tittade och
   hittade inget" får aldrig dela utgångskod. Varje gren drivs av ett test som gör felet
   och kräver rött.
2. **Fetch-stegets utgångskod får aldrig sväljas** — inget `|| true`, ingen
   `continue-on-error`. Skrivet som ett stående villkor i steget självt, inte bara sant
   av en händelse idag.
3. **`check-dependency-diff` läggs till i `binge-integration-reviewer`s mönster i SAMMA
   commit som skriptet skapas.** Utan det når checkens logik main utan granskare medan
   dess testfil har en — den självrensande luckan som `_note`-raderna i den filen
   upprepade gånger bokfört.
4. **Filen får en ägande roll och kartan regenereras i samma commit.** #4, av samma skäl
   som vakten över miljövariablerna: sätet följer vad filen är till för.
5. **`scripts/scripts-self-tests-present.test.mjs` uppdateras** — namnet i `REQUIRED`,
   golvet från 4 till 5.
6. **Commit-texten säger vad checken INTE skyddar mot**, i stället för att låta den läsas
   som ett skydd mot en riktad attack.

Utöver kritikens sex lade bygget till en sjunde, av samma BIN-830-skäl som villkor 3:
skriptet står i `TOOLING_CODE_FILES` i `docs/org/route.mjs` i samma commit. Den ena listan
råder, den andra blockerar, och att vidga den ena har aldrig vidgat den andra.

### Vad checken inte gör, öppet skrivet i stället för underförstått

- **Ett `postinstall` i ett transitivt paket** bor i låsfilen, inte i manifestet. BIN-939
  uteslöt låsfiler från granskning med mätt skäl och BIN-344 håller `npm audit`
  rådgivande. #4 prövade om väg 2 förtjänar sin plats utan låsfilstäckning och svarade ja:
  att öppna den frågan här vore att göra om ett avgjort beslut på samma ämne.
- **En PR som ändrar BÅDE checken och manifestet i samma commit** passerar sin egen grind:
  `pull_request` kör arbetsflödesdefinitionen ur merge-commiten. Det gäller redan lint,
  typecheck och test.
- **Versionshöjningarna av `uses:`-pinnarna** som `.github/dependabot.yml`s
  `github-actions`-ekosystem öppnar. De ändrar arbetsflödesfiler och kommer in via samma
  serversidiga merge, och den här checken tittar inte på dem. Det som begränsar dem idag
  är att jobbet håller `contents: read` och inga hemligheter, inte en granskning.

Checken körs FÖRE `npm ci`, eftersom npm kör installationsskripten själv — ett insmugglat
sådant hade redan exekverat på runnern om steget låg efter.

### Uppföljning, inte byggd här

#4 föreslog att också fälla på en ny `overrides`/`resolutions`-nyckel. Ingen av manifesten
har en idag, så signalen är äkta — men Dependabot lägger själv ibland till `overrides` när
den åtgärdar en sårbarhet, så en hård fällning där har en känd falsklarmskostnad. Det är
Malins val om den ska in, inte något bygget avgör tyst. Filad som BIN-1094.

---

# Sprint 2026-09-05b

Föregående sprintplan arkiverad under `---` längst ned.

## BIN-1080 — de åtta kodfilerna i scripts/ får en ansvarig roll [Tier C]

Följer BIN-871 i strikt följd, som biljetten föreskriver. Malins seating 2026-09-03:
vakten över de publika miljövariablernas inkoppling till #4 Säkerhetsarkitekt, de andra sex till #25 — säkerhetsytan får
inte sättas hos släppansvarig för att spara ett granskningsvarv.

```
node docs/org/route.mjs --md docs/role-responsibilities.md docs/org/ownership-map.json docs/org/route.mjs docs/org/route.test.mjs
```

### Den vassa kanten var min egen backtick, inte katalogärvningen

Första utkastet gav BÅDA rollerna hela `scripts/`, så dev-servern och ikongeneratorn
routade till Säkerhetsarkitekten. Jag läste det som katalogärvning och frågade Malin, som
valde att lära routern att inte ärva i den katalogen.

Innan jag byggde det mätte jag orsaken, och den var en annan: rolldokumentets bullettext
nämnde katalogen inom backticks, och generatorn skördar ett token med avslutande
snedstreck som HELA katalogen. Det är samma fälla som posten om låsfilen i §25 redan
varnar för. Backticken borttagen ⇒ bara de åtta namngivna filerna ägs.

Routerändringen byggdes, mättes mot HEAD:s router och rullades
tillbaka. `route.mjs` ligger i den här commiten, men bara med ändrade självtestfixturer —
ingen routningslogik är rörd. Malin är informerad om att hennes beslut vilade på en
felaktig diagnos från mig.

### Följden för routningen, mätt

```
node -e "const {route}=require('./docs/org/route.mjs'); for (const f of ['scripts/check-public-env.mjs','scripts/check-workflow-map.mjs','scripts/serve-spa.mjs']) { const r=route([f]); console.log(f, r.tier, r.reasonCode, JSON.stringify(r.panel)); }"
```

De åtta namngivna filerna routar `owned` till sin egen roll. Katalogens övriga filer är
inte kodsökvägar för routern och routar `skip`, precis som före ändringen.

### Två pinnar i routern gällde ett läge den här ändringen tar bort

Både `route.test.mjs` och routerns eget självtest pinnade att ett grindskript saknar ägare
och seatar reservsätet #14. Det är precis det biljetten lagar. I `route.test.mjs` är fallet
BORTTAGET; i självtestet är samma rad omskriven till `owned`/#25. Ingen av dem fick en
påhittad fixtur: en sökväg räknas som kod här bara genom att stå i `TOOLING_CODE_FILES`,
och en hypotetisk `scripts/`-fil är ingen kodsökväg alls och routar `skip`. Reservsätets
gren pinnas fortfarande av `src/lib/no-such-dir/brandNew.ts`-fallen i båda filerna, som
ingen roll kan seata bort.

I stället tillkommer ett fall som pinnar det NYA: de två seatingarna, att ingen av dem är
ärvd, och att dev-servern och ikongeneratorn fortfarande routar `skip` — den sista raden är
vad som fäller om katalogtokenet någonsin kommer tillbaka.

Acceptanskriterier:
1. `diff` — de åtta filerna ägs var för sig; hemlighetsskannern av #4, de andra sex av #25.
2. `diff` — ingen roll äger katalogen. Ett test fäller om dev-servern slutar routa `skip`.
3. `diff` — routningslogiken är oförändrad mot HEAD; bara självtestets fixturer rörs.
4. `diff` — hela `npm test` grön, och routerns självtest avslutar 0.

## Deviation log

- [deviation] Jag ställde en fråga till Malin på fel diagnos. Hon valde en routerändring
  för ett problem som inte satt i routern. Ändringen är byggd, mätt och tillbakarullad, och
  hon är informerad — beslutet står kvar på biljetten om ärvningen någon gång blir det
  verkliga problemet.
- [discovery] Backtick-fällan slog till två gånger i samma bunt: först på en fil jag sa att
  #25 INTE skulle äga, sedan på katalogen. Fällan gäller ett token med avslutande
  snedstreck lika mycket som ett filnamn.

---

# Sprint 2026-09-05

Föregående sprintplan arkiverad under `---` längst ned.

## BIN-871 — varje spårad kodfil har en ägande roll [Tier C]

Malins beslut 2026-09-03: **allt på en gång, i ett eget pass**, inte en klunga per sprint.
Säkerhetsyta till säkerhetsrollen även här.

BIN-1080 (de åtta skripten i `scripts/`) ligger INTE i den här commiten. Att seata dem
drar in fler filer via katalogärvning och gör test som pinnar det gamla läget röda; hur
många beror på vilken delmängd som seatas och mäts när den bunten byggs. Den får en egen
commit, i strikt följd.

```
node docs/org/route.mjs --md docs/role-responsibilities.md docs/org/ownership-map.json docs/org/ownership-gaps.json docs/org/route.mjs docs/org/route.test.mjs docs/org/gen-ownership-map.test.mjs
```
→ Tier **medium** · #25 Engineering Manager / Release Manager.

### Baslinjen före ändringen

Talet togs FÖRE, med kommandot biljetten namnger, och står här ordagrant:

```
node -e "console.log(require('./docs/org/ownership-gaps.json').accepted.length)"
→ 298
```

### Tilldelningen vilar på två regler

1. **Ett testfil ärver ägaren till filen den prövar.** Mekaniskt, och det tog en stor del.
2. **Resten sattes per domän**, mot det varje rolls dossier redan namnger. Några exempel,
   inte hela seatingen: TMDB-integrationen till #13, klientens datalager till #27,
   rekommendationsmotorn till #28, sidkompositionen och appskalet till #26.
   Vilka roller som fick en bullet härleds ur rolldokumentet, inte ur den här meningen.

Ägarkartan är REGENERERAD med `node docs/org/gen-ownership-map.mjs`, aldrig handredigerad.

### `--update-gaps` kördes, en gång, med Malins uttryckliga godkännande

Regeln mot flaggan finns för att den annars används för att baslinjera BORT filer som
borde ha en ägare. Här är det tvärtom: varje post i listan fick en ägare först, så det
som skrivs är ett äkta tomt läge. Spärrhaken mäter riktning, inte likhet.

### Rollkritik #25 — bindande villkor (kördes efter bygget, före commit)

Utfall: **pass-with-conditions**, fem must-haves. Kritiken byggde ett eget skript som
jämförde varje nyägd testfil mot ägaren till modulen den importerar, och hittade tre
felsatta. Jag byggde om kontrollen och körde den själv; den hittade en fjärde.

1. `src/lib/watchStatus.migration.test.ts` satt på #9/#11/#17 — ägarna till
   grannfilen `watchStatus.ts` — för att min stam-matchning läste `watchStatus.migration`
   som `watchStatus`. Den prövar schemamigreringen. Omsatt till #14 och #27.
2. `src/lib/tmdb/selectionResolve.test.ts` importerar `selectionManifest.ts`, som #15
   äger — liksom dess två systertester, satta där av den här ändringen. Omsatt till #15.
3. `useSubscriptionAdvisor.helpers.ts` och dess tester låg på två roller inom samma
   ändring. #28 ägde redan förälderhooken, så helpers följer den.
4. Kontrollen körs om efter varje omsättning tills bara en träff står kvar:
   `useServiceValue.test.ts` på #26 mot en modul #24 äger. Testets seating fanns före
   ändringen, men modulen var utan ägare, så PARET är skapat här. Det är alltså inte ett
   tidigare beslut jag låter vara — det är öppet arbete jag skjuter upp, filat som BIN-1092.
5. `route.mjs`s eget självtest bar samma inaktuella fixtur som `route.test.mjs`, och gick
   grönt ändå eftersom det bara prövar `tier` och `reasonCode`. Bytt till samma
   hypotetiska syskonsökväg.

### Två test drivs nu av en egen fixtur i stället för repots dagsform

Båda gick sönder för att BIN-871 tog bort det läge de läste ur det levande repot:

* Ärvningsfallet i `route.test.mjs` använde en VERKLIG olistad fil som fixtur. Den fick
  en ägare, så grenen gick inte längre att nå. Nu en avsiktligt obefintlig sökväg —
  `route()` matchar på strängen och frågar aldrig filsystemet.
* `gen-ownership-map.test.mjs`s sorteringsfall körde `findGaps` mot det levande repot och
  krävde att listan var icke-tom. Det golvet var det som föll när högen nådde noll. Nu en
  spårad mängd med två avsiktliga luckor, i omvänd bokstavsordning, så sorteringen mäts.

Acceptanskriterier:
1. `diff` — noll luckor kvar, och `node docs/org/gen-ownership-map.mjs --check` avslutar 0.
2. `diff` — ägarkartan är regenererad, inte handredigerad; testet som jämför den mot
   rolldokumentet är grönt.
3. `diff` — ingen testfil den här ändringen rör ägs av en annan roll än modulen den
   prövar. Kontrollen finns och kördes.
4. `diff` — hela `npm test` grön.

## Deviation log

- [deviation] BIN-1080 lyftes ur den här commiten. Att ge `scripts/` en ägare gör hela
  katalogen ärvd, vilket drar in fler filer och fäller test som
  pinnar det gamla läget. Beslutet om seatingen står på BIN-1080; det blir en egen commit
  i strikt följd.
- [discovery] Min stam-matchning för testsyskon läste `X.Y.test.ts` som ett test av `X`,
  inte av `X.Y`. Det satte migreringstestet på fel roller. Hittat av rollkritiken.
- [discovery] `src/lib/firebase/accountDeletion.applyPlan.test.ts` satt fel utan att
  kritiken namngav den; den hittades av samma kontroll när jag byggde om den. Den femte
  träffen är bokförd i punkt 4 ovan.

---

# Sprint 2026-09-03c

Föregående sprintplan arkiverad under `---` längst ned.

## Urval

Två biljetter, båda avblockerade av Malins beslutsrunda 2026-09-03 (svaren står som
kommentarer på biljetterna och är bindande). Hon bad uttryckligen om att de två minsta
togs direkt.

Routning, körd före kritiken:

```
node docs/org/route.mjs --md .claude/shared-plugin.json
```
→ Tier **medium** · #25 Engineering Manager / Release Manager.

Routningen körs OM på `git diff --cached --name-only` omedelbart före commit — buntens
filuppsättning växer med ägarkartan och rolldokumentet, och en krympt eller vidgad union
kan flytta panelen (BIN-1052/1050/938).

## BIN-1084 — kodstilsfilen får en granskare [Tier A]

Malins beslut: **alternativ 2**, grinda bara `.claude/rules/code-style.md`, inte katalogen.

### #25:s blinda kritik före bygget — pass-with-conditions, fem must-haves

Kritikens huvudfynd: planen gjorde bara HALVA fixen. `.claude/rules/code-style.md` har
ingen ägare i `docs/role-responsibilities.md`, och det är DÄRFÖR den routar `skip`. Att
lägga till ett grindmönster utan att ge filen en ägare fäller `gate-symmetry.test.mjs`
regel B — "inget som grinden blockerar får routa `skip` på den rådgivande sidan" —
deterministiskt. Samma tvålistefel som nio tidigare biljetter stängt.

Bindande acceptanskriterier:

1. `diff` — mönstret läggs i `binge-integration-reviewer`s `patterns` som ett ankrat
   regex, INTE i `exact` och inte som `keyed`. Skälet: `exact` används av noll levande
   grindar, och `keyed` är till för filer där bara en JSON-nyckel ska grindas — en
   Markdown-fil har ingen sådan nyckel. Daterat `_note` enligt filens konvention.
2. `diff` — SAMMA COMMIT ger filen en ägare under `docs/role-responsibilities.md` §25 och
   regenererar `docs/org/ownership-map.json` med `node docs/org/gen-ownership-map.mjs`.
   Aldrig handredigera JSON:en, aldrig `--update-gaps`.
3. `diff` — hela `npm test` grön, särskilt `gate-symmetry.test.mjs` (alla tre regler),
   `route.test.mjs` och `gen-ownership-map.test.mjs`.
4. `diff` — grinden bevisas i BÅDA riktningarna på BÅDA grindskripten: stagea en ändring
   som bara rör `code-style.md`, kontrollera att commit-grinden och push-grinden kräver
   integrationsgranskarens bevis, ta sedan bort mönstret och kontrollera att samma
   stageade diff går rent. Det är mönstret som ska bevisas, inte något annat.
5. `diff` — JSON:en parsas separat FÖRE något annat körs. Ett trasigt escape i den här
   filen tog `docs/org`-sviten från grön till 149 fällda 2026-08-25, med symptom i filer
   utan koppling till ändringen.

Sätet: **binge-integration-reviewer**, av samma skäl som `CLAUDE.md` och
`accepted-deviations.md` sitter där. Kritiken avvisade uttryckligen ett andra säte:
`_note2`:s dubbelgrindning gäller en agents EGNA spawn-instruktioner, och de fyra
granskarfilerna bär var sin egen kopia av strykregeln — `code-style.md` är en
referensfil för dem, inte deras driftinstruktion.

## BIN-939 — ska säkerhetsgranskaren läsa `package.json`? [Tier A]

Malins beslut: **hon tar inte beslutet.** En blind kritik från #4 Säkerhetsarkitekt avgör,
och svaret skrivs som ett daterat `_note` på grinden OAVSETT utfall. Frågan täcker även
BIN-934 (låsfilerna).

### #4:s utfall: JA för manifestet, NEJ för låsfilerna

**Rot-`package.json` läggs till i `binge-security-reviewer`s `patterns`**, vid sidan av
integrationsgranskaren som står kvar. **Låsfilerna läggs INTE till.**

Rollens skäl, i korthet:

* Det integrationsgranskaren har mandat att leta efter — kontraktsdrift mellan filer — får
  den aldrig att titta på ett nytt install-tidsskript, eller på om ett paket hamnade i
  `dependencies` (går ut i varje besökares webbläsare i en klient-SPA) i stället för i
  `devDependencies`. Det är en kort, konkret checklista, inte en vag riskformulering.
* En låsfil är en maskinlöst upplöst graf utan läsbar avsikt. Den enda fyndklass den bär —
  en känd sårbar version — är redan `npm audit`s jobb, medvetet rådgivande sedan BIN-344.
  Att grinda den blockerande med en språkmodell vore att rangordna om ett verktyg byggt
  för exakt den datatypen.
* `keyed` passar inte: den säkerhetsrelevanta ytan spänner över `dependencies`,
  `devDependencies` OCH `scripts`, och matcharen tar FÖRSTA `{path,key}` för en sökväg — en
  andra post för samma fil är onåbar. En `keyed`-post hade täckt en av tre och tyst missat två.

### Kritikens mekaniska fynd, som ändrade kostnadssidan

Uppdraget till rollen påstod att Dependabots veckovisa PR:er gör grinden till en
återkommande kostnad. Rollen mätte i stället, och jag kontrollerade om det:

```
git log --format='%h|%an|%cn|%s' | grep dependabot
```

Varje sådan commit bär `dependabot[bot]` som författare och **`GitHub` som committer** — de
landar via GitHubs serversidiga merge-knapp och rör aldrig ett lokalt `git commit`. Grinden
är en PreToolUse-hook på just ett lokalt commit, så den kan strukturellt inte fyra på dem.
Det som når den är en handdriven ändring: ett manuellt tillagt beroende, eller en av de
majorer `.github/dependabot.yml` är inställd på att hoppa över. Alltså det sällsynta,
avsiktliga fallet — inte det rutinmässiga.

Acceptanskriterier:
1. `diff` — `^package\.json$` i säkerhetsgrindens `patterns`; låsfilerna orörda.
2. `diff` — beslutet står som ett daterat `_note` på grinden, med både ja-delen och
   nej-delen. Det skulle skrivas oavsett utfall.
3. `diff` — granskaragentens egen `Scope` får en manifestpunkt i SAMMA commit. Utan den
   öppnar det tillagda passet en fil vars instruktioner inte säger vad den ska leta efter,
   och då är grinden en grind som inte vaktar. Rollen ville fila det separat; jag viker in
   det, eftersom en overksam grind är sämre än ingen.

### Utanför bunten, filas

* Dependabots veckomerge går förbi VARJE lokal granskningsgrind i repot, inte bara den här.
  Det som faktiskt körs på dem är `pr-checks.yml`. Vill man ha granskning på den vägen är
  `reviewGates` fel spak — det är en fråga om `pr-checks.yml` och branch protection, och den
  är Malins.

## Deviation log

- [deviation] BIN-939: rollen ville fila granskaragentens `Scope`-punkt som en egen biljett.
  Jag vek in den i samma commit i stället. Skälet: en grind som fyrar på en fil vars
  granskare saknar checklista för den filen är en grind som inte vaktar, och att shippa den
  halvan ensam är precis "bygg den och parkera den".
- [discovery] BIN-1084: planen som gick in i kritiken gjorde bara halva fixen. Utan en
  ägande roll i `docs/role-responsibilities.md` faller `gate-symmetry.test.mjs` regel B av
  konstruktion — ett grindat spår får inte routa `skip`. Fyndet kom från kritiken FÖRE
  bygget, inte från ett rött test efteråt.
- [discovery] BIN-939: Dependabots commits har `GitHub` som committer. Hela
  kostnadsargumentet mot en extra granskare på `package.json` byggde på att de fyrar
  grinden. Det gör de inte.

---

# Sprint 2026-09-03b

Föregående sprintplan arkiverad under `---` längst ned.

## Urval

Backloggen hade 20 öppna biljetter; noll låg i Todo eller In Progress vid urvalet.
Tre valdes. Skälen som dominerar bortvalet:

* **Uttrycklig handbroms i biljettexten** — BIN-1084 ("Kräver Malins beslut", att vidga
  grindlistan är hennes call), BIN-1080 ("beslutet är inte mitt" — sätet för åtta filer i
  `scripts/` är ett org-designval), BIN-871 (väntar på hennes takt), BIN-1075 (vilken punkt
  som pensioneras är ett innehållsval), BIN-939, BIN-1063, BIN-559 (eget designpass).
* **`neverBuildLabels`** — `idea` (BIN-189, BIN-521, BIN-170).
* **Bor i `C:/claude-plugins`** och kräver en egen session i det repot (BIN-959).
* **Ops-blockerad eller uppströmsblockerad** — BIN-454/BIN-402 (pinnade till ~nov, rör den
  förbjudna `mutateEnabled`), BIN-824 (byggs uttryckligen inte förrän spärrhakens luft är
  förbrukad), BIN-624 halva 2 (förutsätter en nollräkning på skarp data som aldrig kördes),
  BIN-658 (`eslint-plugin-react` publicerar ingen version som stöder eslint 10 — biljetten
  är bevakningen, inte arbetet).
* **Vald bort på budget, inte på disposition** — BIN-613 (bundle-baslinjen). Den är
  `build`, men den ändrar `deploy.yml`, alltså kedjan som släpper sajten, och den förtjänar
  en egen bunt med eget granskningsvarv i stället för att åka med på slutet av den här.

Push-grinden budgeteras som ett eget granskningsvarv med samma vikt som en bunt
(lärdomen 2026-09-01, BIN-1059).

## Bunt A — BIN-1081 + BIN-1082 + BIN-1085 [Tier A]

De tre rör samma yta: kartans färskhetsflagga och den grind som beskriver den. De byggs
och committas som EN bunt.

Routning av buntens faktiska filunion:

```
node docs/org/route.mjs --md .claude/agents/binge-integration-reviewer.md .claude/hooks/freshness.mjs .claude/hooks/freshness.test.mjs scripts/prune-map-flag.mjs scripts/prune-map-flag.test.mjs
```
→ Tier **medium** · #25 Engineering Manager / Release Manager · varning om två ägarlösa
kodsökvägar (`scripts/prune-map-flag*`), vilket är exakt BIN-1080 och rörs INTE här.

Routningen körs OM på `git diff --cached --name-only` omedelbart före commit.

### BIN-1081 — stämplingstid per trigger

Disposition: **build**. Ingen produktfråga; biljetten beskriver mekaniken och åtgärden.

I dag bär `.claude/state/workflow-map-stale.json` EN `firstStampedAt` för hela flaggan.
`prune-map-flag.mjs` daterar sitt sökfönster mot det fältet, så en trigger som stämplas
långt senare ärver flaggans ursprungliga fönster och blir svårare att känna igen som spöke.

Åtgärd: `stampMap` i `.claude/hooks/freshness.mjs` skriver ett fält som bär tid per post
vid sidan av `triggers`-arrayen (arrayen är det CLAUDE.md och rensningen läser, och den rörs
inte). `pruneTriggers` daterar fönstret mot postens egen tid, med fallback till
`firstStampedAt` och därefter till "ingen tid ⇒ behåll" — samma konservativa gren som i dag.

Acceptanskriterier:
1. `diff` — en trigger som stämplas EFTER en tidigare rensning daterar sitt fönster mot sin
   EGEN tid, inte mot flaggans äldsta. Pinnat av ett test som fäller utan ändringen.
2. `diff` — en flagga i den GAMLA formen (ingen tid per post) behåller sina triggers; ingen
   migrering krävs.
3. `diff` — `triggers`-arrayens form och sortering är oförändrad.

### BIN-1082 — en HÅLLEN bunt får inte städas bort som spöke

Disposition: **build**. Biljetten räknar upp fyra vägar; väg 1 och 2 (se stashen, se
patchfilerna) är de billiga och byggs båda. Väg 3 rör BIN-969:s daterade beslutsblock och
väg 4 är att ge upp — ingen av dem tas.

Rensningen släpper en trigger när filen är oförändrad mot HEAD OCH ingen commit sedan
stämplingen rört den. En bunt som stashas eller läggs undan som patchfil uppfyller båda,
så dess arbetsorder försvinner i stället för att överleva.

Åtgärd: en tredje BEHÅLL-gren — filen nämns i en stash eller i en patchfil under
`.claude/state/sprint-patches/`.

**Datumgrind, och den är inte valfri.** Katalogen innehåller patchfiler från augusti som
för länge sedan landat. Utan grind skulle varje sådan gammal fil hålla en trigger vid liv
för evigt och BIN-790:s fix vore verkningslös. Därför räknas bara en stash eller en
patchfil vars egen tidpunkt är SENARE än triggerns stämpling — en bunt som drogs undan
måste ha dragits undan efter att redigeringen stämplades.

`freshness.mjs`s beslutsblock om git-apply-luckan (BIN-969) rörs inte.

Acceptanskriterier:
1. `diff` — en trigger vars fil nämns i en patchfil daterad EFTER triggerns stämpling
   behålls.
2. `diff` — en trigger vars fil bara nämns i en patchfil daterad FÖRE stämplingen släpps
   ändå. Pinnat med ett eget test; det är hela poängen med datumgrinden.
3. `diff` — samma två utfall för en stash.
4. `diff` — inga nya subprocesser när flaggan saknas; den tidiga returen står kvar först.

### BIN-1085 — granskarens fillista nämner bara `patterns`

Disposition: **build**. Rättelse på plats, lydelsen är direkt läsbar ur konfigen.

`.claude/agents/binge-integration-reviewer.md` säger på två ställen att grindens fillista
bor i `reviewGates → binge-integration-reviewer → patterns`. Efter BIN-990 är den matchade
mängden `patterns` PLUS `keyed`, och `keyed`s sökväg (`.claude/settings.json`) står inte i
`patterns`. En granskare som härleder sin skyldiga fillista ur meningen hoppar över en
stagead `.claude/settings.json` och underkänns av grinden.

Acceptanskriterier (skärpta av integrationsgranskningen — se avvikelseloggen):
1. `diff` — ingen av de två meningarna räknar upp eller räknar grindens matchningsnycklar.
   De pekar på konfigposten och säger att listan härleds därifrån.
2. `diff` — ingen ny uppräkning av sökvägar i agentfilen; den pekar på konfigen, som förr.

## Rollkritik #25 — bindande villkor (kördes före bygget, 2026-09-03)

En blind kritik från #25 Engineering Manager / Release Manager över buntens hela filunion.
Utfall: **pass-with-conditions**, sju must-haves. De är acceptanskriterier nu.

1. En posts stämplingstid får inte skrivas om av en annan posts stämpling eller av en
   rensning som inget släpper. (BIN-1023:s klass: en spärr som skriver om sitt eget minne
   vid varje kontroll mognar aldrig.) Test: A stämplad, B stämplad senare i samma flagga →
   A:s tid oförändrad; en rensning utan släpp rör ingen tid.
2. HÅLL-grenen prövas i BÅDA riktningarna med bokstavliga datum, och "nämns i patchen"
   härleds ur patchens INNEHÅLL (`+++ b/<sökväg>`) eller `git stash show --name-only` —
   aldrig ur patchfilens NAMN. Namnen i katalogen har tre olika format.
3. Vilken klocka en patchfil dateras mot ska stå i en kommentar vid mekanismen, inte bara i
   biljetten, och jämförelsen ska vara UTC-säker.
4. Kostnaden ska vara O(1) git-anrop per körning, inte O(triggers) — stashlistan hämtas en
   gång och återanvänds. Pinnat med ett räknande test.
5. En HÅLL får inte skriva tillbaka något till flaggan.
6. En flagga i den GAMLA formen faller genom kedjan egen tid → `firstStampedAt` → behåll,
   utan att kasta.
7. BÅDA meningarna i granskaragenten rättas, inte bara den ena — grep båda.
   (Integrationsgranskningen skärpte detta: att skriva ut `keyed` bredvid `patterns` är
   samma defekt en nyckel längre in, eftersom grinden läser fler matchningsnycklar än så.
   Uppräkningen är struken i stället för utvidgad.)

Utanför bunten, filas: `.claude/state/sprint-patches/` har ingen gallringspolicy och
växer obegränsat. Den här ändringen gör katalogens tidsstämplar till indata, och ingen
äger den.


## Deviation log

- [deviation] BIN-1085: planen sa "namnge `keyed` vid sidan av `patterns`" → integrations-
  granskningen visade att grinden läser fler matchningsnycklar än de två → uppräkningen är
  STRUKEN i stället för utvidgad, och meningen pekar nu på konfigposten. Att skriva ut två
  nycklar hade varit samma defekt en nyckel längre in.
- [discovery] BIN-1082: `git stash show` rapporterar inget om filer som stashats som
  OSPÅRADE. Utan `--include-untracked` hade en utdragen bunt som SKAPADE en fil ändå
  släppts som spöke. Flaggan tillagd, med ett eget test som fäller utan den.
- [discovery] `.claude/state/sprint-patches/` har ingen gallringspolicy, och den här
  ändringen gör katalogens tidsstämplar till indata. Filad som BIN-1086, inte byggd.


---

# Sprint 2026-09-02b

Föregående sprintplan arkiverad under `---` längst ned.

## Urval

Backloggen hade 23 öppna biljetter; noll låg i Todo eller In Progress vid urvalet.

Skälen som dominerar bortvalet är fyra:

* **En bindande handbroms i tråden** — biljetten säger själv att Malin måste svara först
  (BIN-1063 gruppfrågan, BIN-871 takten, BIN-990, BIN-939, BIN-1075) eller att den ska ha
  ett eget designpass och aldrig plockas av en obevakad sprint (BIN-559).
* **`neverBuildLabels`** — `idea`/`Feature` (BIN-189, BIN-521, BIN-170).
* **Bor i `C:/claude-plugins`** och kräver en egen session i det repot (BIN-1052,
  BIN-1013, BIN-1035, BIN-959). Lärdomen 2026-08-03: en session som rör delad infra och
  sedan startar subagenter förgiftar dem — och den här sessionen startar granskare.
* **Ops-blockerad eller uttryckligen framskjuten** (BIN-454/BIN-402 är pinnade till ~nov
  och rör den förbjudna `mutateEnabled`;
  BIN-824 byggs uttryckligen inte förrän spärrhakens luft är förbrukad; BIN-624 halva 2
  förutsätter en nollräkning på skarp data som aldrig kördes; BIN-613 väljer mellan tre
  alternativ i deploy-kedjan och är nästa naturliga bunt när budget finns).

Routningen kördes på varje bunts faktiska filuppsättning; kommandot står i buntens eget
avsnitt. Var och en gav `tier: medium` → en blind rollkritik före bygget. Routningen körs
OM på `git diff --cached --name-only` omedelbart före varje commit (BIN-1052/1050/938:s
lärdom), och varje commits filuppsättning måste routa till en kritik som faktiskt kördes.

Push-grinden budgeteras som ett eget granskningsvarv med samma vikt som en bunt
(lärdomen 2026-09-01, BIN-1059).

---

## Bunt A — BIN-1077: de tre TMDB-id:na verifierade mot skarp SE-katalog [Tier A]

Disposition: **build**. Ingen produktfråga — biljetten ber om en mätning och en strykning.

```
node docs/org/route.mjs src/lib/tmdb/providers.ts
```
→ `tier: medium`, `reasonCode: owned`, `panel: [11]` (#11 Localization / i18n).

### Mätningen är gjord, och den står här före bygget

`GET /watch/providers/movie?watch_region=SE` mot skarp nyckel, 2026-09-02, 67 poster:

| id | `provider_name` i SE-katalogen | katalogens antagande | utfall |
| -- | -- | -- | -- |
| 423 | `Blockbuster` | Blockbuster, `type: 'rent'` | stämmer |
| 538 | `Plex` | Plex, `isAds`, kostnad 0 | stämmer |
| 175 | `Netflix Kids` | alias till Netflix (8) | stämmer |

Alla tre stämmer, alltså är åtgärden en strykning — inte en defektlagning.

### Premisskontroll mot HEAD (`9a94f82`)

Klausulen står på tre ställen, alla i `src/lib/tmdb/providers.ts`:

```
grep -n omverifierat src/lib/tmdb/providers.ts
```
→ rad 41, 176, 191. Premissen håller.

### Blind rollkritik #11 — accept-with-conditions, 2 must-haves (inviktna nedan)

Rollen hade RATT pa en punkt jag hade fel om: kontrollen ar TMDB mot TMDB, inte oberoende.
De ovriga `live-verifierat`-noteringarna i filen korsar TMDB mot en EXTERN kalla
(help.netflix.com, tele2.se); den har lasningen fragar samma endpoint som id:na kom ifran.
Att bara stryka ordet "oberoende" hade darfor last som en starkare kontroll an den som
gjordes. Villkoren ar bindande acceptanskriterier 2 och 3.

### Acceptanskriterier
1. Klausulen "ej oberoende omverifierat i den commit som lade in det" finns inte kvar på
   någon av de tre platserna. *(kind: diff)*
2. **#11 villkor 1.** Den text som star kvar innehaller inte ordet "oberoende", och den
   namnger endpointen, datumet 2026-09-02 och vad som faktiskt kontrollerades
   (`provider_name` ur TMDB:s SE-katalog) — inte att aliaset som sadant ar validerat.
   *(kind: diff)*
3. **#11 villkor 2.** Diffen ror bara kommentarstext pa de tre stallena: inget `id`,
   `type`, `defaultMonthlyCost`, `isAds`, `shortName` eller `aliases`-varde andras.
   *(kind: diff, negativt villkor)*
4. `npm run typecheck` och `npm test` gröna. *(kind: diff)*

---

## Bunt B — BIN-790: flaggan städas av en pre-commit-rensning i stället för att överleva [Tier C]

Disposition: **build**. Fjärde gången flaggan städas för hand är ett verktygsfel, och
Malins beslut 2026-08-08 är "bygg". Blockeraren från 2026-08-26/31 är borta: hooken har
sedan BIN-1009 ett test, och BIN-1059 la in commit-msg-maskineriet som läser
`git diff --cached --name-only` (`lefthook.yml` → `check_staged_routing.mjs`).

**Punkt 2 i biljetten byggs INTE här** — "en utdragen bunt ska rensa sina egna flaggor"
bor i sprintmotorn under `C:/claude-plugins`. Den delen står kvar öppen.

```
node docs/org/route.mjs .claude/hooks/freshness.mjs .claude/hooks/freshness.test.mjs \
  lefthook.yml scripts/prune-map-flag.mjs scripts/prune-map-flag.test.mjs
```
→ `tier: medium`, `reasonCode: owned`, `panel: [25]` (#25 Engineering Manager / Release
Manager). `unmapped`: de två nya `scripts/`-filerna. Deras ägarskap är filat som BIN-1080;
aldrig `--update-gaps`.

### Mekanismen, och varför den formen

En trigger är ett SPÖKE när redigeringen som stämplade den drogs tillbaka. Den skiljs från
en trigger vars redigering just committats utan att kartan hunnit med genom att fråga båda
frågorna, inte bara den ena:

* Filen skiljer sig från HEAD i arbetsträdet → **lev**, redigeringen ligger kvar.
* Ingen commit sedan flaggans `firstStampedAt` rörde filen → **spöke**, släpps.
* Annars → **lev**, redigeringen är committad och kartan är ännu inte uppdaterad.

Steget körs som en pre-commit-rensning och **blockerar aldrig** — det skriver om flaggan
eller raderar den när inga triggers står kvar, och avslutar alltid 0. Det är skillnaden mot
den obligation `freshness.mjs`s daterade avstegsblock avvisade: det blocket handlar om
BIN-969:s git-apply-lucka och en BLOCKERANDE skyldighet; den här ändringen är varken.
Avstegsblockets text uppdateras inte — den beskriver en annan lucka.

### Blind rollkritik #25 — accept-with-conditions, 5 must-haves

Rollen sparade bade planens premisser: den spprade tre-stegsscenariot sjalv och bekraftade
att regeln haller genom steg 2, och att luckan ar en ANNAN an BIN-969:s. Men den pekade ut
att "blockerar aldrig" ar sant bara om det ar TESTAT, och att det har blir forsta
pre-commit-kommandot som inte ar glob-gatat — vilket bryter filens egen uttalade regel och
darfor maste motiveras pa plats. Villkoren ar acceptanskriterier 2, 3, 5, 6 och 7.

Rollens tredje risk — att ett steg som aldrig sager nagot ocksa aldrig ger aterkoppling —
antas ocksa: rensningen skriver EN rad nar den faktiskt slapper en trigger, och tiger annars.

### Acceptanskriterier
1. En trigger vars fil är oförändrad mot HEAD **och** som ingen commit sedan
   `firstStampedAt` rört släpps; en trigger vars fil har en commit i det intervallet
   behålls. Båda riktningarna pinnade av var sitt test. *(kind: diff)*
2. **#25 villkor 1.** Rensningen kan aldrig fälla en commit: tva test tvingar fram felen —
   ett trasigt flagg-JSON och ett git-anrop som kastar — och bada haevdar avslutskod 0.
   *(kind: diff, negativt villkor)*
3. **#25 villkor 2.** Vanliga fallet ar gratis: saknas flaggfilen gor skriptet NOLL
   git-subprocesser, och det bevisas genom att RAKNA dem via en injicerad git-korare — inte
   genom att skanna kallan, som inte kan se ett anrop i rot-upplosningen ett steg upp.
   Roten loses darfor upp genom en fs-uppgang efter `.git`. *(kind: diff)*

   **Villkorets andra halva ar MEDVETET inte uppfylld, 2026-09-02.** #25 bad ocksa om en
   MATT kostnadskommentar i `lefthook.yml`-posten. En sadan skrevs, och togs sedan bort:
   tre matningar av samma vag under den har commiten gav tre olika spann, sa talet beskrev
   tillfallet och inte egenskapen. Posten sager nu i stallet att inget wall-clock-tal star
   dar, och VARFOR — och egenskapen den skulle bevisa (noll git-subprocesser utan flagga)
   ar pinnad av ett test som RAKNAR anropen. Villkorets andra halva star alltsa oatgardad
   och namngiven har i stallet for struken.
4. Testfilen körs av `npm test` — dess namn ska synas i den fulla körningens fillista
   (BIN-802:s andra vägg). *(kind: diff)*
5. **#25 villkor 3.** `lefthook.yml` forklarar pa plats varfor det har steget INTE ar
   glob-gatat, i samma form som `review-coverage`/`staged-routing` forklarar sin egen.
   *(kind: diff)*
6. **#25 villkor 4.** Minst ett test SPAWNAR skriptet som barnprocess (som
   `freshness.test.mjs`s `runHook`), inte bara importerar dess hjalpare — annars ar
   inkopplingen otestad och kan raderas gron. *(kind: diff)*
7. **#25 villkor 5.** Minst ett test lagger commiten inom samma minut som `firstStampedAt`
   och bevisar att KEEP/DROP inte glider pa tidszon (BIN-1050:s `%cI`-fotangel).
   *(kind: diff)*
8. `freshness.mjs`s daterade avstegsblock om git-apply-luckan lämnas oförändrat i sak.
   *(kind: diff, negativt villkor)*
9. `node docs/org/gen-ownership-map.mjs --check` grön utan `--update-gaps`. *(kind: diff)*

### Kvarstaende risk rollen namngav, inte atgardad har

`firstStampedAt` ar flagg-niva, inte per trigger. En langlivad flagga dar en tidigare
slappt sokvag stamplas om arver flaggans URSPRUNGLIGA tidsstampel, vilket vidgar
DROP-fonstret och gor en ny spoktrigger mindre trolig att fangas. Riktningen ar saker
(over-keep, aldrig en tyst radering av en levande redigering), sa det byggs inte om nu —
det filas som foljdbiljett.

---

## Bunt C — BIN-826: spärrhaken säger ifrån om sitt eget utbyte [Tier A]

Disposition: **build**. Ren observabilitet på en spärrhake som annars bara märks i Search
Console veckor senare.

```
node docs/org/route.mjs src/lib/tmdb/selectionManifest.ts \
  src/lib/tmdb/selectionManifest.test.ts src/lib/tmdb/selectionResolve.test.ts \
  src/app/titleParams.watchdog.test.ts
```
→ `tier: medium`, `reasonCode: owned`, `panel: [15]`.

### Premisskontroll mot HEAD (`9a94f82`)

* `mergeManifest` skriver ingen utbytesrad — inga `::notice::`/`::warning::` i funktionen.
* En härledning som LYCKAS MED TOM LISTA passerar tyst: `derived.ok` är sant,
  `mergeManifest` returnerar `previous` oförändrat, ingen varning skrivs.
* Ingen varning när `freshIds.length >= SELECTION_CEILING[type]`.
* `src/app/titleParams.watchdog.test.ts` motiverar `STUCK_REPORT_LIMIT` med kömotivet.
* `src/lib/tmdb/selectionResolve.test.ts` pinnar `toContain('&& 175 || 45')`.

Alla fem premisser håller.

### Vad som INTE byggs

`REFRESH_DERIVE_TIMEOUT_MS` rörs inte. Biljetten säger själv att konstanten ska sättas
med några veckors data från just den loggning den här bunten inför — att välja den nu vore
att gissa mellan två enskilda mätningar med tio minuters marginal.

### Blind rollkritik #15 — accept-with-conditions, 4 must-haves

Rollen kontrollerade forst det som ar dess egen insats: ingen av de fem delarna ror
`assertCoverageFloor`, `SELECTION_CEILING`, `SELECTION_ABSOLUTE_FLOOR` eller
evakueringsordningen, sa inget hogljutt fel gors tyst. Den kontrollerade ocksa mot filens
egna matningar att tak-varningen (del 3) inte fyrar pa en normal veckokorning — den ar en
riktig avvikelsesignal, inte brus. Villkoren ar acceptanskriterier 2, 3, 4 och 5.

### Acceptanskriterier
1. En rad på ett refresh-bygge namnger behållna / evakuerade / nytillkomna id:n per typ.
   `mergeManifest` förblir REN — raden skrivs där refresh-sammanhanget är känt. *(kind: diff)*
2. **#15 villkor 1.** Raden rapporterar ANTAL plus ett avgransat urval, aldrig en full
   id-lista: taket for movie/tv ar 15 000 och en radlangd i den storleksordningen ar
   olasbar. Formen ar den `buildFetch.ts` redan etablerat (`… och N till`). *(kind: diff)*
3. **#15 villkor 2.** Diffen mellan foregaende och farsk mangd byggs med `Set`/`.has()`,
   aldrig nastlade `.includes()`/`.find()` — annars ar det O(n²) pa precis den veckokorning
   vars budget redan ar trang. *(kind: diff, negativt villkor)*
4. **#15 villkor 3.** Exakt ETT `mergeManifest(`-anropsstalle i `resolveSelection`; det
   evakuerade harleds ur den enda korningens in- och utdata, aldrig ur ett andra anrop.
   *(kind: diff, negativt villkor)*
5. **#15 villkor 4.** Utbytesraden och tom-harledningsvarningen har SYNBART olika lydelse,
   inte bara olika utlosare — bada intraffar pa samma handelse nar `freshIds` ar tom. Tva
   test pinnar var sin distinkta delstrang. *(kind: diff)*
6. En härledning som lyckas med tom lista skriver en `::warning::` som namnger just det
   fallet, pinnad av ett test med `derive: async () => []`. *(kind: diff)*
7. En `::warning::` när `freshIds.length >= SELECTION_CEILING[type]`. *(kind: diff)*
8. Kommentaren i `titleParams.watchdog.test.ts` som avfärdar STUCK-signalen som kö-brus
   STRYKS (den är falsk: en enbart köad väntare avregistreras före `STUCK_AFTER_MS`).
   *(kind: diff)*
9. `selectionResolve.test.ts` matchar radbundet i stället för på delsträng, så `45 → 450`
   fäller. *(kind: diff)*
10. `REFRESH_DERIVE_TIMEOUT_MS` är oförändrad. *(kind: diff, negativt villkor)*
11. **Testgranskarens villkor.** `evicted` har ett ICKE-VAKUOST test: en fixtur som driver en VERKLIG evakuering genom taket och
    pinnar `evakuerade N` med N > 0. Alla ovriga fixturer ligger under taket, sa `evakuerade
    0` uppfylls dar aven om berakningen ar trasig. *(kind: diff)*
12. `npm run typecheck` och `npm test` gröna. *(kind: diff)*

---

## Bunt D — BIN-658: återöppningsutlösaren prövad, och den har inte fyrat [ingen diff]

Disposition: **build**, men utfallet är en mätning. Malins beslut 2026-08-06 är "vänta";
kommentaren 2026-08-29 gjorde biljetten till bevakningen och namngav exakt två kommandon.

Körda 2026-09-02:

```
npm view eslint-plugin-react@latest peerDependencies
npm view eslint-config-next@latest dependencies
```

→ `{ eslint: '^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7' }` och
`'eslint-plugin-react': '^7.37.0'` står kvar bland `eslint-config-next`s beroenden.

**Ingen av de två utlösarna har fyrat.** Posten i `.github/dependabot.yml` ska alltså inte
röras. Utfallet skrivs som en daterad kommentar på biljetten; ingen kod ändras. Detta
avsnitt finns för att "ingen diff" annars är omöjlig att skilja från "aldrig försökt"
(BIN-707/708:s evaporationsklass).

---

## Inte valda

| Biljett(er) | Skäl |
| -- | -- |
| BIN-1063 | Biljetten kräver uttryckligen Malins svar på gruppfrågan (radera vs lämna över) före bygget. |
| BIN-559 | Malins beslut 2026-08-06: eget designpass, ska inte plockas av en obevakad sprint. Panelen 2026-08-30 har dessutom två villkorat blockerande roller och river premissen. |
| BIN-871 | Väntar på Malins takt ("hur många filer per sprint"). |
| BIN-990, BIN-939, BIN-1075 | Biljetterna säger själva att valet är Malins. |
| BIN-624 | Halva 2 förutsätter en nollräkning på skarp data som #4 mätte aldrig kördes. |
| BIN-1052, BIN-1013, BIN-1035, BIN-959 | Bor i `C:/claude-plugins`; kräver egen session i det repot. |
| BIN-454, BIN-402 | Pinnade till ~nov; rör `mutateEnabled`, som en sprint aldrig får flippa. |
| BIN-824 | Byggs uttryckligen inte förrän spärrhakens luft är förbrukad, och då med GSC-data. |
| BIN-613 | Väljer mellan tre alternativ i deploy-kedjan; nästa naturliga bunt när budget finns. |
| BIN-189, BIN-521, BIN-170 | `idea`-etiketten → `neverBuildLabels`. |

## Behöver dig (Tier D)

Inget kvar.

## Efter sprinten

1. `npm run lint`, `npm run typecheck`, hela `npm test`.
2. Följdbiljetter filas FÖRE commit.
3. Routningen körs om på `git diff --cached --name-only` per commit; buntarna committas
   splittat så att varje commits filuppsättning routar till en kritik som faktiskt kördes.
4. Push (= deploy), invänta grön körning, purga Cloudflare.
5. Linear-transitioner PARVIS med varje commit (BIN-754).

## Bunt E — BIN-1071: de tre prissidorna som krävde en människa [Tier A]

Tillkom EFTER urvalet. Biljetten låg som Tier D — den automatiska prisagenten kom inte åt
tre svenska storefronts 2026-09-02 (Crunchyroll svarade felsida, YouTube Premium
samtyckesvägg, SkyShowtimes flik "Med reklam" gick inte att klicka). Malin öppnade dem i
vanlig webbläsare och skickade skärmbilder, vilket lyfter ops-blockeringen: det som var
omätbart är nu mätt, av en människa, förstahands.

```
node docs/org/route.mjs src/lib/tmdb/providers.ts
```
→ `tier: medium`, `reasonCode: owned`, `panel: [11]` (#11 Localization / i18n).
`dropped`: 3, 5, 10, 13, 15, 24. Samma säte som bunt A, och kritiken kördes före bygget.

### Vad storefronterna visade

| tjänst | katalogen före | storefronten 2026-09-03 |
| -- | -- | -- |
| Crunchyroll Fan / Mega Fan | 85 / 99 | 85 / 99 — oförändrat |
| YouTube Enskild / Familj / Student | 149 / 279 / 95 | 169 / 309 / 109 |
| SkyShowtime reklam | 59 | 69 |

Biljettens sekundärkällor förutsade YouTubes 169 och 309 men uppgav Student som OFÖRÄNDRAD
på 95. Storefronten säger 109, så de hade fel, och höjningen har slagit igenom tidigare än
den oktober de angav. Crunchyrolls befarade höjning har inte nått Sverige.

### Acceptanskriterier — #11:s sex bindande villkor

1. Diffen rör bara `cost`/`defaultMonthlyCost` på YouTube- och SkyShowtime-posterna plus
   kommentarer; noll värdebytes i Crunchyrolls `id: 323`-objekt. *(kind: diff)*
2. YouTube slutar på exakt `student: 109`, `solo: 169`, `family: 309`,
   `defaultMonthlyCost: 169`. *(kind: diff)*
3. SkyShowtime slutar på exakt `ads: 69`, med `standard: 109`, `premium: 159` och
   `defaultMonthlyCost: 109` orörda. *(kind: diff)*
4. Varje ändring bär en `// live-verifierat 2026-09-03 — <url>`-kommentar i
   `docs/price-agent-runbook.md`:s form, och INGEN kommentar övertolkar skärmbilden som
   fullständig. *(kind: diff, negativt villkor)*
5. SkyShowtimes 2026-07-02-notering står kvar och den nya läggs TILL — inte i stället för.
   Det är samma villkor #11 loggade på den här filen dagen före (BIN-1070), och första
   utkastet bröt mot det. *(kind: diff)*
6. `npm run lint`, `npm run typecheck` och hela `npm test` gröna. *(kind: diff)*

### Vad som INTE byggs

Årspriserna och bindningspriserna som skärmbilderna också visade (Crunchyroll 850/990 per år,
SkyShowtime 6 och 12 månader). Katalogen bär ett månadstal per nivå och har aldrig burit en
andra faktureringsdimension; att införa en är en egen ändring. En eventuell tredje
Crunchyroll-nivå eller YouTubes Premium Lite syntes inte i skärmbilderna, och en ny nivå
klassas för hand enligt driftboken — aldrig av ett svep.

## Deviation log

- [discovery] BIN-790, ETT ÄKTA FEL i koden, hittat av utfallsverifieraren: `repoRoot()`
  körde `git rev-parse --show-toplevel` FÖRE den tidiga returen när `CLAUDE_PROJECT_DIR`
  är osatt — vilket är precis vad lefthook gör vid en riktig commit. "Noll git-subprocesser"
  var alltså falskt, och min egen kostnadsmätning dolde det genom att sätta variabeln.
  Fixat: roten löses nu upp genom att gå uppåt efter `.git` i filsystemet. Och testet som
  påstod saken SKANNADE KÄLLAN efter den tidiga returen — det kunde per konstruktion inte se
  ett anrop ett steg upp. Ersatt med en RÄKNING genom en injicerad git-körare, plus ett
  kontrollprov som visar att anropen blir fler än noll när en flagga finns (annars uppfylls
  "noll" lika gärna av en rensning som inte gör något — BIN-1069:s frånvaro-fälla).
- [discovery] BIN-790, ETT ANDRA AKTA FEL i koden, hittat av helhetsgranskningen i det
  sista varvet: `run()` laste `CLAUDE_PROJECT_DIR` inne i kroppen, sa en injicerad `cwd`
  var tyst verkningslos nar variabeln rakade vara satt. De tva raknande testen hade da last
  det RIKTIGA repots flagga, sluppit varje trigger mot en stubbad git, och `unlinkSync`:at
  en akta arbetsorder som sidoeffekt av `npm test`. Flaggan ar gitignorerad, sa ingenting
  hade visat det. Provat: med den gamla formen och variabeln satt fol 2 test OCH flaggan
  raderades; efter fixen 19/19 grona och flaggans hash oforandrad. Roten tas nu som ett
  uttryckligt argument (`projectDir`), med samma foretrade som i produktion.
- [discovery] BIN-1077, hittat av kodgranskaren: min egen `log_event.mjs --help` hade
  skrivit en skräprad `{"type":"--help"}` i `events.jsonl`. Skriptet har ingen `--help`;
  det tar `argv[2]` ordagrant som `type`. Raden borttagen ur det stageade innehållet.
  Rättelse till granskarens formulering: det finns TVÅ sådana rader, och den andra
  (2026-08-30) är REDAN COMMITTAD. Loggen är append-only, så bara den här sessionens rad
  togs bort.


- [discovery] BIN-1077: rollkritiken #11 hittade det mitt eget bygge inte hade stött på.
  Omläsningen är TMDB mot TMDB, inte oberoende — filens övriga `live-verifierat`-noteringar
  korsar mot en EXTERN källa (help.netflix.com, tele2.se). Att bara stryka ordet "oberoende"
  hade därför läst som en STARKARE kontroll än den som gjordes. Ersättningstexten namnger nu
  endpoint, datum och exakt vad som kontrollerades — och säger uttryckligen att aliaset som
  sådant inte är validerat, bara att TMDB:s klassning står kvar.
- [deviation] BIN-826: `REFRESH_DERIVE_TIMEOUT_MS` rörs inte. Biljetten säger själv att
  konstanten ska sättas med några veckors data från just den loggning bunten inför; fönstret
  är 55–85 min och den enda KALLA mätningen 44,5 min, alltså tio minuters marginal mellan två
  ENSKILDA mätningar. Att välja nu vore att gissa.
- [discovery] BIN-790: hela sviten (`npm test`) fällde två test i `docs/org/route.test.mjs`
  som ingen per-bunt-körning kunde se — en ny `.mjs` med test i vitests globs måste stå i
  BÅDE `TOOLING_CODE_FILES` (routern, rådgivande) och `reviewGates` (grinden, blockerande).
  Båda vidgade i samma commit, per BIN-830. Routern kördes om på den vidgade unionen:
  fortsatt `tier: medium`, `panel: [25]` — samma kritik som redan körts.
- [needs-human] BIN-790: att SÄTTA de två nya `scripts/`-filerna i
  `docs/role-responsibilities.md` gav sex NYA ägarlöshetsluckor
  (`scripts/check-{workflow-map,public-env,knowledge-caps}` × 2), eftersom en katalog börjar
  ärva ägare först när något i den ägs — generatorns egen kommentar beskriver just den vassa
  kanten. `--check` gick från 0 till 1, alltså röd deploy. Att sätta även de sex är ett
  org-designval: `check-public-env.mjs` är #4 Säkerhetsarkitektens yta, inte #25:s, och att
  lägga den under släppansvarig för att slippa ett granskningsvarv är precis fel skäl.
  KONSERVATIVT VAL: doc-redigeringen backad, de två nya filerna lämnas oägda som sina sex
  syskon, luckorna kvar på 298. Filat som BIN-1080. ALDRIG `--update-gaps` (BIN-1013).
- [discovery] BIN-790: flaggan i trädet vid sprintens slut namnger
  `src/app/titleParams.watchdog.test.ts` (nod `static-passive-pages`, token `src/app`) och är
  en ÄKTA trigger, inte ett spöke, och den nya
  rensningen behåller den korrekt. Flödet spårades om: ändringen stryker en falsk kommentar i
  en testfil, alltså ingen beteende- eller flödesändring, så kartans prosa behöver inte röras.
  `node scripts/check-workflow-map.mjs` grön (100 noder, 31 flöden, täckning 76/76). Flaggan
  raderas för hand vid avslut — femte gången, och exakt det biljetten finns för.

## Mutationsbevis

Muteringarna kördes en i taget, med `grep -c MUTANT` FÖRE och EFTER sviten i samma kommando,
och återställning från en scratchpad-kopia verifierad med `git hash-object`. `deploy.yml`
muterades ALDRIG på disk — de två formerna prövades mot en strängkopia i minnet, eftersom
filen inte ingår i någon bunt och en samtidig session delar trädet.

| mutation | fil | utfall |
| -- | -- | -- |
| tom-lista-grenen till `if (false)` | `selectionManifest.ts` | 1 test fällt |
| takvillkoret `>=` till `>` | `selectionManifest.ts` | 1 test fällt |
| `45` → `450` (strängkopia av deploy.yml) | — | gamla `toContain`-formen ÖVERLEVER, nya radbundna formen faller |
| sänkt live-rad + citat i kommentar (strängkopia) | — | samma: gamla överlever, nya faller |
| lefthook-posten ersatt med ett `echo` | `lefthook.yml` | 1 test fällt |
| keep-on-throw → drop-on-throw | `prune-map-flag.mjs` | 2 test fällda |
| `after` satt till `before` (evakuering rapporteras alltid som 0) | `selectionManifest.ts` | forst ÖVERLEVDE hela filen gron — testgranskarens fynd. Efter att evakueringstestet lagts till: 1 test fallt | <!-- claim-lint:ok muteringsutfall vid namngivna bytes, inte en repo-rakning; kan bara reproduceras genom att kora om muteringen -->
| `run()` laser `CLAUDE_PROJECT_DIR` i kroppen i stallet for att ta den som argument (den FORSTA formen) | `prune-map-flag.mjs` | med variabeln satt: 2 test fallda OCH den riktiga flaggan RADERAD. Efter fixen: 19/19 grona och flaggans hash oforandrad | <!-- claim-lint:ok muteringsutfall vid namngivna bytes, inte en repo-rakning; kan bara reproduceras genom att kora om muteringen -->
| `if (dropped.length > 1) return;` (rensningen tystnar sa snart TVA spoken ligger i samma flagga) | `prune-map-flag.mjs` | forst ÖVERLEVDE 18/18 — testgranskarens fynd. Efter att flerspokstestet lagts till: 1 test fallt | <!-- claim-lint:ok muteringsutfall vid namngivna bytes, inte en repo-rakning; kan bara reproduceras genom att kora om muteringen -->
| `JSON.parse` utan inre try/catch | `prune-map-flag.mjs` | **ÖVERLEVDE** — och den är EKVIVALENT för kontraktet: entry-pointens yttre catch ger ändå avslutskod 0, och en flagga som inte gick att parsa lämnas orörd i båda fallen. Prövad, inte bortförklarad; den inre vakten är bälte-och-hängslen i en fail-open-fil, inte bärande. |

Kontrollprov: den orörda deploy.yml passerar BÅDA formerna, så den nya regexen är inte
trasig-och-därför-röd.



---

# ARKIV — sprintplan 2026-09-02

# Sprint 2026-09-02 — fyra biljetter, alla `medium`/`single`

Föregående sprintplan arkiverad under `---` längst ned.

## Urval

Fyra biljetter valda ur backloggen; noll låg i Todo eller In Progress vid urvalet. Skälen
till att resten inte valdes står under "Inte valda", ett skäl per grupp. Två skäl dominerar:
en produktfråga som är Malins, och en fix som bor i `C:/claude-plugins` och
kräver en egen session i det repot (lärdomen 2026-08-03: en session som rör delad infra och
sedan startar subagenter förgiftar dem — och den här sessionen startar granskare).

Routningen kördes på varje bunts faktiska filuppsättning; kommandot står i buntens eget
avsnitt. Var och en gav `tier: medium` → en blind rollkritik. Routningen körs OM på
`git diff --cached --name-only` omedelbart före varje commit (BIN-1052/1050/938:s lärdom).
Varje commits filuppsättning måste routa till en kritik som faktiskt kördes; hur många
commitar det blir följer av det, och står under "Efter sprinten" när de finns.

Push-grinden budgeteras som ett eget granskningsvarv med samma vikt som en bunt
(lärdomen 2026-09-01, BIN-1059) — den kräver EN körning som läst varje granskningsbar fil i
hela `@{u}..HEAD`, och per-buntsgranskningarna summerar inte till den.

## Bunt A — BIN-1070: Viaplay Medium 399 → 449 [Tier A]

Disposition: **build**. Prisändringen är mätt och verifierad mot viaplay.se 2026-09-02; det
enda som saknades var en ren commit-väg.

```
node docs/org/route.mjs src/lib/tmdb/providers.ts
```
→ `tier: medium`, `reasonCode: owned`, `panel: [11]` (#11 Localization / i18n).
`dropped`: 3, 5, 10, 13, 15, 24.

Premisskontroll, mätt vid urvalet mot 5ff6204 (dessa rader beskriver det läget, inte nuet): `src/lib/tmdb/providers.ts` har Viaplay-nivån
`{ id: 'medium', name: 'Medium (inkl. sport)', cost: 399, kind: 'sport' }`. Premissen håller.

### Acceptanskriterier
1. Viaplay-nivån `medium` står på `cost: 449` med en `live-verifierat 2026-09-02 — https://viaplay.se`-notering i providerns kommentarsblock. *(kind: diff)*
2. Ingen annan nivås `cost` ändras i samma diff — de priser biljettens svep fann oförändrade rörs inte. *(kind: diff, negativt villkor)*
3. `npm run typecheck` och `npm test` gröna med ändringen inne. *(kind: diff)*
4. Grön deploy + Cloudflare-purge. *(kind: run)*

## Bunt B — BIN-1067: RUNBOOK pekar på en sektionsnumrering som inte finns [Tier A]

Disposition: **build**. En trasig pekare i ett driftdokument.

```
node docs/org/route.mjs docs/RUNBOOK.md
```
→ `tier: medium`, `reasonCode: owned`, `panel: [20]` (#20 Manual / Release QA Tester).
`dropped`: 21.

Premisskontroll, mätt vid urvalet mot 5ff6204 (dessa rader beskriver det läget, inte nuet): `docs/RUNBOOK.md:87` skriver `EXTERNAL_ACTIONS.md §1.2`;
`docs/analysis/EXTERNAL_ACTIONS.md` har bara `##`-rubriker, ingen numrering. Premissen håller.

### Acceptanskriterier
1. `docs/RUNBOOK.md` hänvisar inte längre till ett sektionsNUMMER i EXTERNAL_ACTIONS.md — rubriken namnges, eller hänvisningen stryks. *(kind: diff)*
2. Ingen numrering införs i `docs/analysis/EXTERNAL_ACTIONS.md`. *(kind: diff, negativt villkor ur biljetten)*
3. Ett sökkommando över repot efter andra §-nummerhänvisningar in i den filen körs, kommandot skrivs ned här, och varje träff åtgärdas på samma sätt. *(kind: diff)*

Kommandot, avgränsat till hänvisningar IN i filen enligt #20:s villkor 2 — RUNBOOK:s egna
interna `§`-referenser går mot dess egna numrerade rubriker och ska inte röras:

```
git grep -n "EXTERNAL_ACTIONS.md §"
```

Kört efter rättelsen: de enda träffarna ligger i den här planfilen, som beskriver felet.
Ingen levande pekare bär ett sektionsnummer. Bredare svep över alla hänvisningar in i filen:
`git grep -n "EXTERNAL_ACTIONS" -- docs` — ingen av dem namnger ett nummer.

## Bunt C — BIN-1074: tre prosafynd, alla strykningar [Tier A]

Disposition: **build**. Tre påståenden som inte håller. Alla tre åtgärdas genom att stryka,
inte formulera om (strykregeln, `.claude/rules/code-style.md`).

```
node docs/org/route.mjs vitest.config.ts docs/org/metrics/check_staged_routing.mjs .claude/shared-plugin.json
```
→ `tier: medium`, `reasonCode: owned`, `panel: [25]` (#25 Engineering Manager / Release Manager).
`dropped`: 7, 21.

Premisskontroll, mätt vid urvalet mot 5ff6204 (dessa rader beskriver det läget, inte nuet):
- `vitest.config.ts:33` bär klausulen `--selftest` … `is wired to no gate (BIN-802)`; samma klausul är struken i `docs/org/route.test.mjs:7-11`, som skriver att `gate-symmetry.test.mjs` startar den under `npm test`. Premissen håller.
- `docs/org/metrics/check_staged_routing.mjs:90-104` `loggedPanel` unionerar varje `review`-rad som bär biljettens id, utan test av ålder eller omfång. Syskonet `check_review_coverage.mjs:120-123` redovisar exakt samma begränsning om sig självt. Premissen håller.
- `.claude/shared-plugin.json` → `reviewGates[3]._note13` slutar `"…in the same commit, and the two named files became one afterwards."` Premissen håller.

Punkt 2 är en förgrening i biljetten (pröva åldern, ELLER skriv in begränsningen). **Valet är
att skriva in begränsningen**, av två skäl: felriktningen är enbart under-blockering, aldrig
över, och syskonmodulen redovisar redan sin identiska begränsning i prosa i stället för att
pröva den. Att bygga åldersprövningen kräver ett hållbarhetsbeslut ("hur gammal får en rad
vara?") som ingen svarat på — samma öppna policyfråga syskonet namnger.

### Acceptanskriterier
1. Klausulen om `--selftest` är STRUKEN ur `vitest.config.ts`. Ingen ersättande formulering skrivs. *(kind: diff)*
2. `_note13`:s sista sats är struken; meningen slutar vid `"in the same commit."` och stycket runt den har fortfarande ett subjekt. *(kind: diff)*
3. `loggedPanel`s begränsning — ingen prövning av radens ålder eller omfång, felriktningen enbart under-blockering — står i modulens befintliga `WHAT THIS DOES NOT DO`-block, utan något nytt räknat påstående. *(kind: diff)*
4. `npm test` grön. *(kind: diff)*

## Bunt D — BIN-1069: vakten är blind för ett `await` inuti `${...}` [Tier A]

Disposition: **build**. En källkodsskannande vakt som kan gå tyst sönder.

```
node docs/org/route.mjs functions/src/availableNotify/runNotify.processTitle.test.ts
```
→ `tier: medium`, `reasonCode: owned`, `panel: [13]` (#13 Data / Integrations Engineer).
`dropped`: inga.

Premisskontroll, mätt vid urvalet mot 5ff6204 (dessa rader beskriver det läget, inte nuet): `functions/src/availableNotify/runNotify.processTitle.test.ts:47`
`blankCommentsAndStrings` finns, `:118` `firstAwaitIndex` finns, och raderna 150-156 beskriver
själva den mätta blinda fläcken. Premissen håller.

### Acceptanskriterier
1. `blankCommentsAndStrings` behandlar innehållet i `${...}` inuti en template-literal som KOD, inte som stränginnehåll. *(kind: diff)*
2. Båda riktningarna pinnas: ett `await` i en interpolation ovanför hämtningen FÄLLER vakten; ett `await` i en vanlig sträng eller en kommentar är fortsatt osynligt. Mutanten asserteras närvarande FÖRE och EFTER sviten, i ett kommando. *(kind: diff)*
3. **Ur biljettens kommentarstråd 2026-08-31, mätt av integrationsgranskaren:** samma söm har en ANDRA form som ska lagas i samma pass — en regex-literal med ett obalanserat citattecken (`/'/`) får citat-grenen att skanna fram till nästa citattecken längre ner i kroppen och blanka bort riktig kod på vägen. Båda formerna lagas, båda pinnas. *(kind: diff)*
4. Vaktens docblock NAMNGER kvarvarande blinda fläckar i stället för att påstå att den är komplett. *(kind: diff)*
5. Filens befintliga test är fortsatt gröna, och `npm test` är grön. *(kind: diff)*

**Utanför bunten, ur samma tråd:** `.claude/agents/binge-test-reviewer.knowledge.md` passerade sitt
80 000-teckenstak i BIN-1060:s commit utan kompenserande strykning. Vilken punkt som pensioneras
är ett innehållsval, inte något ett bygge avgör under commit-tryck. Går till "Needs you".

## Bindande villkor ur de blinda rollkritikerna (2026-09-02)

Fyra kritiker, en per bunt, var och en blind för de andra och körd FÖRE bygget. Var och en
läste sin egen dossiersektion och `.claude/rules/accepted-deviations.md`. Alla fyra
loggade i `docs/org/metrics/events.jsonl` med `via: "sprint-execute"`.

### BIN-1070 — #11 Localization / i18n: **accept-with-conditions** (2 villkor)
1. Den nya noteringen ska SÄGA VAD DEN VERIFIERAT — nivån, talet, och att den nivån inte har
   något kampanjpris — inte bara bära datum och URL. Rollen räknade själv att ingen befintlig
   notering i blocket täcker `medium`, så en bar rad hade varit den första i blocket som inte
   säger vad den verifierade. *(kind: diff)* — uppfyllt.
2. Den befintliga 2026-07-02-noteringen om `reklam` och `total` skrivs INTE över; den nya
   läggs till. *(kind: diff)* — uppfyllt.

Rollen läste dessutom `cheapestEntertainmentTier` själv och bekräftade att `kind: 'sport'`
filtreras bort där, i stället för att lita på biljettens påstående om det.

### BIN-1067 — #20 Manual / Release QA Tester: **accept-with-conditions** (2 villkor)
1. Pekaren ska namnge den rubrik som faktiskt är rätt mål för sammanhanget — `Blaze vs Spark`
   — inte strykas till ett hängande "se EXTERNAL_ACTIONS.md". Det är raden en jourhavande
   följer under tryck. *(kind: diff)* — uppfyllt.
2. Repo-sökningen avgränsas till hänvisningar IN i EXTERNAL_ACTIONS.md, inte ett bart
   `§`-svep: RUNBOOK:s egna interna `§`-referenser går mot dess egna numrerade rubriker och
   ska inte röras. *(kind: diff)* — uppfyllt.

### BIN-1074 — #25 Engineering Manager / Release Manager: **accept-with-conditions** (4 villkor)
1. Tillägget om `loggedPanel` ligger i det befintliga `WHAT THIS DOES NOT DO`-blocket och
   påstår ingen mildring. *(kind: diff)* — uppfyllt.
2. `.claude/shared-plugin.json` parsar fortfarande, och HELA sviten är grön — filen läses som
   indata av `gate-symmetry.test.mjs` och `route.test.mjs`, och ett escape-fel där har
   tidigare kaskadat till hundratals orelaterade fel. *(kind: run)* — uppfyllt:
   `node -e "JSON.parse(require('fs').readFileSync('.claude/shared-plugin.json','utf8'))"`
   svarar rent, och `npm test` är grön.
3. `git grep -n "wired to no gate"` efter ändringen ska inte ge några levande kopior.
   *(kind: diff)* — uppfyllt: kvarvarande träffar ligger i
   `.claude/agents/binge-test-reviewer.knowledge.archive.md` (arkivfil, undantagen av
   dok-taxonomin) och i den här planen, som beskriver felet. Ingen av dem är en levande
   kopia av påståendet.
4. Den här commiten är routningskollens EGET dogfood-fall, eftersom
   `check_staged_routing.mjs` ligger i dess filuppsättning: biljetten måste ha en `review`-rad
   som namnger roll 25 före push. *(kind: run)* — uppfyllt, raden är loggad och stageas med
   bunt A.

Rollen noterade också att de tre strykningarna är oberoende gradbara, och att en delvis
landning (2 av 3) inte får läsas som klar. Alla tre landade.

### BIN-1069 — #13 Data / Integrations Engineer: **accept-with-conditions** (5 villkor)
1. Vakten ska fortfarande PASSERA mot oförändrad `runNotify.ts` efter fixen. *(kind: run)* —
   uppfyllt, ren kontrollkörning grön.
2. Ett test som bevisar att den första sömmen är stängd. *(kind: diff)* — uppfyllt.
3. Ett test som stänger den andra sömmen UTAN att öppna en ny: en naiv regexfix som börjar
   läsa varje `/` som regexöppning skulle svälja resten av raden och tysta vakten, vilket är
   BIN-852/1048:s form. *(kind: diff)* — uppfyllt, och det var villkoret som bar mest: en
   mutation som gör exakt det fäller precis divisionstestet.
4. De befintliga negativa kontrollerna passerar i SAMMA körning. *(kind: run)* — uppfyllt.
5. Docblockraden som namnger BIN-1069 som öppen blir falsk i samma commit som stänger den —
   stryk den och namnge i stället de blinda fläckar som faktiskt återstår. *(kind: diff)* —
   uppfyllt.

## Vad kritikerna och muteringarna faktiskt hittade

Ett fynd i koden, och det var i mitt eget första testutkast, inte i produktionskod:

De två sömtesten asserterade först bara `awaitsTheFetch(...) === false`. Den assertionen är
inte avgörande — en skanner som är trasig nog att blanka resten av kroppen ger `-1` ur
`firstAwaitIndex`, och `awaitsTheFetch(body, -1)` är också `false`. "Vakten fäller rätt" och
"vakten är förstörd" uppfyller alltså samma assertion. Muteringen som återställer
citat-rusningen ÖVERLEVDE den. Assertionen pinnar nu vilket index det första `await`:et
hamnar på, vilket skiljer de två fallen åt, och samma mutering fäller nu exakt det testet.

Det är BIN-645:s lärdom i ny förklädnad: ett test som pinnar att något INTE händer är blint
för mutanten som förstör mätningen i stället för att laga den.

### Vad TESTGRANSKAREN sedan hittade — två blockerande, båda äkta

Testgranskaren körde sina EGNA sonder i stället för att läsa min beskrivning, och fällde två
saker jag missat. Båda i koden, inte i prosan.

1. **Den befintliga positiva kontrollen migrerades aldrig.** Den låg kvar på den svaga
   assertionen — och granskaren mätte det: med `firstAwaitIndex` stubbad att alltid svara
   `-1`, alltså vakten helt förstörd, stod det testet kvar grönt medan sex syskon föll.
   Åtgärd: den går nu genom `expectSeenAt`.
2. **`DIVIDES_AFTER` saknade värdeavgränsarna.** Den listade identifierare, tal, `)` och `]`
   men inte den avslutande backticken, citattecknet eller regexens egen snedstreck. Så
   `` `abc` / 2 `` öppnade en regex som blankade till radslutet och svalde ett `await` efter
   sig — vakten rapporterade friskt. Det är den TYSTA riktningen, alltså precis felet hela
   filen finns för att förhindra, återinfört av fixen för det. Åtgärd: de tre avgränsarna in
   i mängden, plus två nya pinnade fall.

Att laga (1) räckte inte heller. `expectSeenAt` hämtar sin baslinje ur samma funktion som
prövas, så under total förstörelse blev det förväntade indexet `-1 + 0` och jämförelsen
uppfylldes av två lika meningslösheter. Hjälparen kräver nu att baslinjen finns
(`at > -1`) innan den jämför — och det är den raden som gör att en förstörd skanning fäller
varje fixtur.

Mitt första strängtest var dessutom grönt av fel skäl: `'abc'.length / 2` har en identifierare
före snedstrecket, så det passerade även mot den avgränsarblinda versionen. Snedstrecket måste
sitta direkt efter citattecknet.

### Muteringsprotokoll (bunt D)

Fem muteringar, en i taget, var och en asserterad närvarande FÖRE och EFTER sin körning,
återställd ur en scratchpad-kopia verifierad med `git hash-object`. Ren kontrollkörning:
10/10 grön, hash `c5a771689c24e25446f504694959406fe4efd75c` före och efter hela svepet.

| Mutering | Fäller |
| -- | -- |
| interpolationen blankas som text igen | interpolationstestet (1 av 10) |
| ingen regexhantering + citat rusar förbi radslutet | regexlitteral-testet (1 av 10) |
| varje `/` läses som regexöppning | de tre divisionstesten (3 av 10) |
| `DIVIDES_AFTER` utan värdeavgränsare | de två avgränsartesten (2 av 10) |
| `firstAwaitIndex` svarar alltid `-1` (vakten förstörd) | 9 av 10 |

Den enda som överlever den totala förstörelsen är testet för kastvägen, som med flit inte
går genom skanningen alls.

## Inte valda

**Produktval som är Malins (needs-approval — kommenteras, byggs inte):**
- BIN-1072 (TV4 Play: tre nya sportnivåer) — biljetten ställer tre frågor rakt ut, och `id`-strängarna fryses så fort de landat.
- BIN-1073 (fyra saknade tjänster i katalogen) — vilka som ska in, och hur Cineasterna och BritBox klassas; varje tillägg är dessutom en färgtoken och ett kortnamn som väljs för hand.
- BIN-990 (`.claude/settings.json` når noll granskare) — öppen fråga: vidga, låt vara, eller bygg nyckelgranskningen.
- BIN-939 (ska #4 också grinda `package.json`?) — en fråga #4 själv ska svara på.
- BIN-189, BIN-521, BIN-170 — bär etiketten `idea`, som aldrig går in i en bunt.

**Bor i `C:/claude-plugins`, kräver egen session i det repot:**
- BIN-1052, BIN-1013, BIN-1035, och pluginhalvan av BIN-959.

**För stora för en bunt i den här körningen:**
- BIN-826 (spärrhakens veckoutbyte) — sex delfrågor i en biljett, varav en väntar på veckor av mätdata.
- BIN-871.
- BIN-613 (ingen First Load JS-baslinje) — tre alternativ, varav det rekommenderade ändrar `deploy.yml`.
- BIN-559 (offlinesäker kontoskapning) — biljetten säger själv "needs its own design work, not a quick patch".

**Blockerad uppströms:** BIN-658 (eslint 9→10) — höjningen är blockerad uppströms, bokfört i `7f40382`.

**Ops / står redan på sin egen klocka:** BIN-454 och BIN-402 (tmdbFieldsSweep-utrullningen) — Tier D, och `mutateEnabled`-flippen är en stående "gör aldrig detta"-punkt i CLAUDE.md.

**Fortsatt utdragen:** BIN-790 — samma skäl som 2026-08-31: punkt 1 som den är skriven raderar arbetsordern mellan funktionskodens commit och kartans egen commit.

## Needs you (Tier D)

Inget i den här bunten är Tier D. Efter push: den vanliga gröna deployen + Cloudflare-purge
(automatisk i den här sessionen), och besluten på BIN-1072/1073/1063/990/939 som listas ovan.

Filade följdbiljetter (före commit, per följdregeln):
- **BIN-1075** — `binge-test-reviewer.knowledge.md` ligger över sitt tak
  (`node scripts/check-knowledge-caps.mjs`). Varning-bara, inget är rött. Vilken punkt som
  pensioneras är ett innehållsval.

## Deviation log

- [discovery] BIN-1069: planen antog att de två sömtesten skulle vara klara med
  `expect(awaitsTheFetch(...)).toBe(false)` → muteringskörningen visade att den assertionen
  också uppfylls av en helt förstörd skanner (`-1` ur `firstAwaitIndex`), och
  citat-rusningsmuteringen överlevde den → testen pinnar nu vilket index det första `await`:et
  hamnar på. Ingen omfångsökning; samma fil, samma bunt.
- [discovery] BIN-1074 punkt 2 var en förgrening i biljetten. Vald gren: skriv in
  begränsningen, bygg inte åldersprövningen. Skälet står i buntens eget avsnitt ovan.
  Konservativt val — det bygger ingen mekanism ovanpå en obesvarad policyfråga.
- [needs-human] Ur BIN-1069:s kommentarstråd: `binge-test-reviewer.knowledge.md` ligger över
  sitt tak (`node scripts/check-knowledge-caps.mjs`). Vilken punkt som pensioneras är ett innehållsval. Filad som BIN-1075,
  inte byggd.
- [deviation] BIN-1070: integrationsgranskningen fällde ett fynd i en fil bunten inte rörde —
  `src/lib/streaming/cheapestPath.test.ts`s testNAMN motiverade sig med "not sport 399/749",
  vilket prisändringen gjorde falskt medan varje assertion förblev grön. Rättat på plats
  (strykregelns undantag: den sanna lydelsen är direkt läsbar ur katalogen). Rättelsen VIDGADE
  den stageade unionen, och en omkörning av routern flyttade panelen från `[11]` till `[24]` —
  #24 låg i `dropped` på den smalare mängden. #24:s blinda kritik kördes före commiten och gav
  `accept`, 0 villkor. BIN-1052/766 i vidgande riktning, fångat av att routa om det STAGEADE.
  Kostnad: ett extra kritikvarv plus en omkörning av alla tre commit-granskare.
- [discovery] BIN-1067 VIDGADES av push-granskningen, och det var rätt: den lagade pekaren
  satt inne i en falsk diagnos. RUNBOOK §2c öppnade med "Vi överstiger Spark-plan-kvoten",
  listade Sparks dygnskvoter, rådde att invänta nollställningen vid midnatt UTC och föreslog
  som förebyggande att uppgradera till Blaze. Binge ligger på Blaze sedan länge — `CLAUDE.md`
  säger det, och molnfunktionerna är deployade, vilket kräver Blaze. En jourhavande hade
  alltså fått veta att hen ligger på en plan hon lämnat och blivit skickad att göra en
  uppgradering som redan är gjord. Allt tre struket. Vad som utlöser `resource-exhausted`
  under Blaze är INTE utrett och ingen gissning skrivs in i dess ställe. #20:s villkor 1
  pekade ut precis den raden som den en jourhavande följer under tryck.
- [discovery] Samma påstående bodde på fler ställen i samma fil, hittat av nästa
  granskningsvarv: §1c sa `(bara om Blaze, vilket vi inte är på idag)` en skärm ovanför
  rättelsen, och §9a angav Sparks MAU-kvot som den gällande gränsen. Båda parenteserna
  strukna, ingen ersättning skriven — det sanna talet under Blaze går inte att läsa ur
  repot. Att laga ett ställe och lämna kopian står är BIN-1040/1002/1038:s form, och den här
  gången satt kopian i samma fil som fixen. Kvarvarande `Spark`-omnämnanden i filen härleds
  med `grep -n Spark docs/RUNBOOK.md`.
- [deviation] Jag redigerade och stageade om filer MEDAN integrationsgranskaren läste dem, så
  dess första dom gällde bytes som inte längre fanns. Granskaren fångade det själv. Push-
  grinden måste läsa exakt de bytes som går ut; efter det stod trädet stilla under varje
  körning. 2026-08-26:s lärdom, med rollerna ombytta.
- [deviation] Två `node -e`-kommandon med escape-tecken kollapsade i skalet (`\n` blev ett
  riktigt radbrott, en anchor slutade matcha på CRLF). Åtgärd: muteringarna kördes ur
  skriptfiler i scratchpad i stället, utan escape-tecken i skalraden. Lärdomen från
  2026-09-01 gällde alltså igen — och gäller `node -e` lika mycket som heredocs.

## Utfallsgradering (Fas 2.7, färska granskare per biljett, skivad diff)

Fyra granskare, var och en med BARA sin biljetts acceptanskriterier och sin egen
diffskiva. 22 pass, 0 fail, 0 unclear, 1 `awaiting-run`.

| Biljett | Utfall |
| -- | -- |
| BIN-1070 | 5 pass, 1 awaiting-run (deployen) |
| BIN-1067 | 4 pass |
| BIN-1074 | 6 pass |
| BIN-1069 | 7 pass |

## Efter sprinten

1. Full `npm run typecheck`.
2. Följdbiljetter filas FÖRE commit.
3. Routningen körs om på det stageade omedelbart före varje commit. Det blev två commitar:
   `7e7bac8` bär BIN-1070 ensam (panel `[24]` efter att push-granskningens rättelse vidgade
   unionen), och den andra bär BIN-1067, BIN-1074 och BIN-1069 tillsammans (panel `[25]`).
   Båda routar till en roll vars blinda kritik kördes före bygget.
4. Push (= deploy), invänta grön körning, purga Cloudflare.
5. Linear-transitioner PARVIS med varje commit, inte i ett efterföljande avslutningssteg (BIN-754).


---

# ARKIV — sprintplan 2026-08-31

# Sprint 2026-08-31 — fyra biljetter, alla `medium`/`single`

Föregående sprintplan arkiverad under `---` längst ned.

## Urval

24 oppna biljetter i backloggen. Fem valda, en (BIN-790) utdragen FORE bygget nar
kommentarstraden lastes — dess punkt 1 som den ar skriven raderar arbetsordern mellan
funktionskodens commit och kartans egen commit. Fyra byggs. Skälen till att resten INTE valdes står
under "Inte valda" nedan, ett skäl per grupp. Ett av dem är att fixen bor i
`C:/claude-plugins` och kräver en egen session i det repot (lärdomen 2026-08-03: en
session som rör delad infra och sedan startar subagenter förgiftar dem — och den här
sessionen startar granskare).

Routningen kördes på varje biljetts filuppsättning; kommandot står i biljettens eget
avsnitt nedan. Var och en gav `tier: medium`. Routningen körs OM på den faktiska stageade
unionen omedelbart före varje commit (BIN-1052/1050:s lärdom).


## Bindande villkor ur de blinda rollkritikerna (2026-08-31)

Villkoren nedan är kritikernas egna och är folded in som acceptanskriterier. Varje kritik
var blind för de andra. Rubrikerna nedan säger vilken roll som svarade på vad, och när.

### BIN-1059 — #25 Engineering Manager / Release Manager: **block** tills 1–5 är uppfyllda

1. **Fasfel i förslaget.** `lefthook.yml` kör `pre-commit` FÖRE `commit-msg`; commit-meddelandet
   — och därmed biljetts-id:t — finns inte när `pre-commit` kör. Kollen måste ligga i
   `commit-msg`, bredvid `review-coverage`. *(kind: diff)* — verifierat själv: `lefthook.yml`
   har ett `commit-msg`-block som kör `check_review_coverage.mjs --message {1}`.
2. **`panel`-fältet i `events.jsonl` skrivs olika på olika rader** — tal på vissa, strängar
   (`"#25 Engineering Manager / …"`) på andra. Härled fördelningen; ett tal här går inaktuellt
   varje gång en rad läggs till:

   ```
   node -e "const fs=require('fs');const c={};for(const raw of fs.readFileSync('docs/org/metrics/events.jsonl','utf8').split(String.fromCharCode(10))){const l=raw.trim();if(!l)continue;const o=JSON.parse(l);if(o.type!=='review')continue;const p=o.panel;const k=Array.isArray(p)?(p.length?typeof p[0]:'empty'):'missing';c[k]=(c[k]||0)+1}console.log(c)"
   ```

   Kollen måste normalisera formerna till samma typ före jämförelse, annars blockerar den
   falskt. Ett testfall matar in strängformatet. *(kind: diff)*
3. **Fällan om `.claude/agents/*.knowledge.md` måste AVGÖRAS och testas**, inte bara nämnas:
   ett test matar in en stageuppsättning där de två valen ger olika paneler och asserterar
   vilket som vinner. Skälet skrivs i koden. *(kind: diff)*
4. **En riktig körning måste visa att spärren fäller**, inte bara enhetstestets egen fixtur.
   *(kind: run)*
5. **Inte ett nytt BIN-1040-hål:** kommandot står i en lista lefthook faktiskt kör. *(kind: diff)*

Icke-blockerande: felmeddelandet ger ett klistrbart kommando (konventionen i `review-coverage`).

### BIN-1060 — #13 Data / Integrations Engineer: **accept-with-conditions**

1. Mutationsprov: ett syntetiskt `await` inskjutet i `processTitle` FÖRE `io.fetchSeFlatrate`
   ska FÄLLA vakten. *(kind: run)*
2. Samma vakt mot HEAD oförändrad ska PASSERA. *(kind: run)*
3. Segmentet får INTE klistras in som literal sträng i testet — det läses från `runNotify.ts`
   och skärs ut mekaniskt. *(kind: diff)*
4. Sökningen efter `await` i preambeln får inte träffa kommentarer eller strängar. *(kind: diff)*
5. Vakten pinnar ENDAST `processTitle`s inre ordning, inte den yttre loopen i
   `runAvailableNotify` — den täcks av det befintliga `entered`-testet. *(kind: diff)*

Väntat felläge, ordagrant: en naiv sökning efter `await` i HELA funktionskroppen träffar ett
senare `await` och rapporterar PASS oavsett var regressionen sitter. Villkor 1 är det som
fångar det.

### BIN-1061 — #14 Software Architect: **accept-with-conditions**

1. Stryk HELA tabellen, alla tre raderna — en tabell med en struken rad läser som att de
   kvarvarande fortfarande gäller. *(kind: diff)*
2. Ersätt inte med nya tal. Om något ska stå kvar som bevis: ett KOMMANDO, inte ett tal.
   *(kind: diff)*
3. Epokens MOTIVERING måste överleva strykningen — `accepted-deviations.md`s BIN-938-post
   pekar hit för just den. Diffen får INTE röra `accepted-deviations.md`. *(kind: diff)*
4. Efter ändringen: `node docs/org/metrics/check_review_coverage.mjs` kör rent, och
   kommentarblocket innehåller ingen ny siffra utan ett kommando bredvid. *(kind: run)*

### BIN-1061, andra varvet — #25 Engineering Manager / Release Manager: **accept**

Bygget VIDGADE filuppsättningen. `.claude/rules/accepted-deviations.md`s BIN-938-post pekade
läsaren mot just den tabell som ströks, så klausulen blev falsk i samma ändring. Routern kördes
om på den faktiska unionen:

```
node docs/org/route.mjs docs/org/metrics/check_review_coverage.mjs .claude/rules/accepted-deviations.md
→ tier medium, panel [25], reasonCode owned
```

#14:s villkor 3 sa "diffen får INTE röra `accepted-deviations.md`" — motiverat med att en
redigering där kräver en egen granskning. Den granskningen konvenerades i stället för att
undvikas: #25, som äger filen, läste diffen och svarade **accept** med två villkor (ingen
kvarvarande hänvisning till tabellen eller dess tal; kommandot måste köra rent). Båda mötta.
Att lämna klausulen falsk hade varit den sämre av de två, och det är precis den situation
BIN-1059 bygger en spärr för.

### BIN-1064 — #8 DevOps / SRE: **accept-with-conditions**

1. Strykningen får inte ta med sig ordningsregeln "deploya functions före hosting" — den är
   självdokumenterad i `.github/workflows/deploy.yml`. Diffen rör bara det batch-bundna
   stycket; IAM-tabellen, permission-kollen, Cloudflare-regeln och secrets-tabellen står kvar.
   *(kind: diff)*
2. Rad 7 i `binge-test-reviewer.knowledge.md` ersätts med ett `grep`-kommando eller stryks —
   ingen uppräkning, ingen ny siffra. *(kind: diff)*
3. Efter patchen: `grep -c "^## Relocated" …archive.md` ger fortfarande fler än 1. *(kind: run)*

Icke-blockerande fynd att fila: `docs/RUNBOOK.md` pekar på "EXTERNAL_ACTIONS.md §1.2" men
filen har ingen numrering alls — referensen är trasig sedan tidigare.

---

## BIN-1059 — routningskollen ska fällas av en maskin, inte av mitt minne

**Tier C** (grind-infrastruktur). Prio Hög.
```
node docs/org/route.mjs lefthook.yml docs/org/metrics/check_staged_routing.mjs docs/org/metrics/check_staged_routing.test.mjs
```

Biljetten pekar ut två möjliga hem: sprintmotorn i `C:/claude-plugins` (kräver egen
session) eller ett repo-lokalt `lefthook.yml`-steg här. **Vi bygger den repo-lokala
varianten** — `docs/org/route.mjs` bor redan här, `lefthook.yml` kör redan
pre-commit-steg, och den delade maskinen slipper röras från en session som spawnar
granskare.

### Acceptanskriterier (biljettens egna, ordagrant)

1. Kollen körs av något som FÄLLER en commit, inkopplad i den kodväg som faktiskt
   kör — inte i en funktion ingenting anropar (BIN-1040:s form). *(kind: diff)*
2. Ett test som källkodsskannar inkopplingen och pinnar ARGUMENTEN, så kollen inte
   kan raderas ur anropsvägen med sviten grön (BIN-852:s form). *(kind: diff)*
3. Prövad i BÅDA riktningarna med mutation: en union som routar en roll utan loggad
   rad → blockerar; en union där panelen matchar → passerar. Mutanten asserteras
   närvarande FÖRE och EFTER sviten, i ETT kommando. *(kind: diff)*
4. Blockmeddelandet namnger den saknade rollen OCH kommandot som reproducerar
   routningen. *(kind: diff)*
5. Ingen befintlig grind försvagas. *(kind: diff)*
6. **Ägarskap:** varje NY fil under en katalog `ownership-map.json` listar fil för
   fil får en ägare i `docs/role-responsibilities.md` och kartan regenereras —
   aldrig `--update-gaps` (BIN-1013). Hela sviten körs före push. *(kind: diff)*

### Fällan biljetten namnger — mätt, och biljettens formulering håller inte

Biljetten skriver att routningen svarar olika beroende på om granskarnas egna
`*.knowledge.md` räknas med i unionen. Mätt 2026-08-31 gör den inte det: en
`*.knowledge.md` är ingen kodsökväg, så den hamnar i `unmapped` och kan aldrig sätta
en roll i panelen.

```
node docs/org/route.mjs .claude/agents/binge-test-reviewer.knowledge.md
node docs/org/route.mjs lefthook.yml .claude/agents/binge-test-reviewer.knowledge.md
node docs/org/route.mjs lefthook.yml
```

Följden för #25:s villkor 3: ett test "där de två valen ger olika paneler" går inte att
skriva, eftersom det läget inte finns. Villkoret återgår till #25. Kollen måste
fortfarande välja EN mängd och skriva ned skälet i koden, och valet pinnas i båda
riktningarna — notesfilen utanför unionen, granskarens INSTRUKTIONSfil kvar i den.

---

## BIN-1060 — pinna invarianten som gör tidstestets signal tillräcklig

**Tier A.** `node docs/org/route.mjs src/test/rules/available-notify-orchestrator.test.ts`
→ `medium`, panel `[13]`.

1. Ett test pinnar att inget `await` står mellan `processTitle`s öppning och
   `io.fetchSeFlatrate`-anropet. *(kind: diff)*
2. Mutationsprövat i BÅDA riktningarna: ett inskjutet `await` före hämtningen fäller
   det; koden som den står gör det grönt. Mutanten asserteras FÖRE och EFTER
   körningen, i ett kommando. *(kind: diff)*
3. Prövat att det källkodsskannande testet fäller av RÄTT skäl, inte på sin egen
   regex. *(kind: diff)*
4. Ingen befintlig assertion försvagas. *(kind: diff)*

---

## BIN-1061 — stryk epoktabellen i `check_review_coverage.mjs`

**Tier A.** `node docs/org/route.mjs docs/org/metrics/check_review_coverage.mjs`

Biljettens egen rekommendation är att STRYKA tabellen, inte skriva nya tal.

1. Tabellen (raderna kring `2026-08-18 (this)`) är struken, inte omformulerad.
   *(kind: diff)*
2. Epokens motivering finns kvar i en form som INTE bär ett omätt tal — annars ett
   kommando som härleder talen. *(kind: diff)*
3. Kontrollerat med grep om något ANNAT ställe citerar tabellens tal; träffar
   åtgärdas i samma commit. *(kind: diff)*

---

## BIN-1064 — två föråldrade meningar i driftdokumenten

**Tier A.** `node docs/org/route.mjs docs/analysis/EXTERNAL_ACTIONS.md .claude/agents/binge-test-reviewer.knowledge.md`
→ `medium`, panel `[8]`.

1. Det batch-bundna stycket i `EXTERNAL_ACTIONS.md` är STRUKET, inte omskrivet.
   *(kind: diff)*
2. Klausulen som pekar ut en enskild arkivrubrik är STRUKEN. Ingen ny uppräkning,
   inget nytt tal. *(kind: diff)*
3. Steg som fortfarande är sanna för vilken `functions/**`-ändring som helst står
   kvar. *(kind: diff)*

---

## Inte valda — och varför

**Kräver en egen session i `C:/claude-plugins`** (fixen bor där; den här sessionen
startar granskare): BIN-1052, BIN-1013, BIN-1035, samt del 1 av BIN-959.

**Väntar på Malin (produktval eller öppen fråga i biljetten):** BIN-990 (vidga
grindlistan, låt vara, eller bygg nyckelgranskning?), BIN-1063 (bär designvalet
"ägd grupp med kvarvarande medlemmar: radera eller lämna över?"), BIN-939 (ska #4
grinda `package.json`?), BIN-189 / BIN-521 / BIN-170 (`idea`-etikett).

**Stående stopp:** BIN-454 och BIN-402 — `mutateEnabled` är Malins konsolåtgärd.
**Kostnadssatt, uttryckligen inte nu:** BIN-824.
**Övriga, valbara nästa körning:** BIN-613, BIN-826, BIN-871, BIN-658, BIN-624,
BIN-559, BIN-959 (delarna 2–5).

## Needs you (Tier D)

- `firebase deploy --only functions` för BIN-1023 (från sprinten 2026-08-30) står
  fortfarande kvar enligt sessionsminnet — bekräfta mot konsolen.

## Deviation log


---

# Sprint 2026-08-30 — BIN-1023 + BIN-590

Föregående sprintplan arkiverad under `---` längst ned.

Urval: 4 appnära biljetter routades och panelgranskades (11 blinda kritiker,
2026-08-30). Malin valde att bygga BIN-590 + BIN-1023. BIN-559 och BIN-624
byggs inte den här körningen — villkoren ligger som kommentarer på biljetterna.

---

## BIN-1023 — serversidig sopning av data vars Auth-konto är borta

**Tier C.** Router: `node docs/org/route.mjs functions/src/retentionCleanup/index.ts
firestore.rules` → `top`, panel `[27, 4, 6]`. Alla tre kritikerna körda före bygget;
villkoren nedan är deras, ordagrant folded in som acceptanskriterier.

### Omfångsbeslut (Malin, 2026-08-30)

Biljetten är skriven om `watchlist`. Panelen visade att det är fel avgränsning.
Malin valde **hela `users/{uid}`-trädet plus det publika**.

Levereras i två steg, och steg 2 filas som egen biljett innan commit:

- **Steg 1 (den här ändringen):** allt som är UID-NYCKLAT och därmed exakt
  adresserbart utan en fråga — hela `users/{uid}`-trädet via `recursiveDelete`,
  plus `publicProfiles/{uid}`. Det täcker hela det privata biblioteket och den
  publika profilprojektionen, som #6 DPO pekade ut som klassens allvarligaste
  post eftersom den är läsbar för alla.
- **Steg 2 (följdbiljett):** innehåll som ägs via ett FÄLT och kräver en fråga —
  `reviews` (+ `likes`/`comments`), `lists`, hostade `sessions`, ägda `groups`,
  och speglingarna på andra användares dokument (`followers`, `friends`,
  `friendRequests*`). Den delen bär ett eget designval (en ägd grupp med kvar-
  varande medlemmar: radera eller lämna över?) som inte ska avgöras inuti den
  här ändringen. #27:s villkor 3 tillåter uttryckligen den uppdelningen,
  förutsatt att luckan filas OCH skrivs in i `.claude/rules/accepted-deviations.md`.

### Klockan — vilken storhet mäts

Systersopningen `orphanAuth` mäter **Auth-kontots egen ålder**
(`ORPHAN_AUTH_MIN_AGE_MS`). Den klockan finns INTE här: kontot är borta, så det
har ingen ålder kvar att läsa. Att återanvända talet vore att mäta fel storhet.

Den här sopningen mäter i stället **hur länge vi själva har observerat uid:t som
bekräftat Auth-frånvarande**. Det kräver ett minne mellan körningar:
`orphanWatch/{uid}` med `firstSeenAt`. Första körningen stämplar, senare
körningar raderar när stämpeln är gammal nog. Kommer kontot tillbaka, eller var
uppslaget fel, städas stämpeln bort och klockan nollställs.

Golvet sätts till **3 dygn**, inte 7. Motivet är att storheten är en annan: 7
dygn i systersopningen skyddar en levande person vars profilskrivning bara
misslyckades, och den personen finns inte här — Auth säger att uid:t inte
existerar. Tre dygn ger minst två dagliga körningar plus slack för en fallerad
körning och en helg, och ligger långt inom Art. 12(3):s månad.

### Acceptanskriterier

Alla `kind: diff` om inget annat står.

1. **(#27:1, #4:1)** Frånvaro bevisas via `getUsers()`s egen `notFound`-lista
   genom befintliga `absentUidsFromLookup` — inte via en `try/catch` där ett fel
   läses som "borta". En fallerad batch bidrar med noll kandidater och räknas
   som överhoppad.
2. **(#27:1, #4:2, #6:1)** Ett `disabled: true`-konto räknas aldrig som borta.
   Följer av `absentUidsFromLookup` och pinnas med ett eget test.
3. **(#27:1, #4:3)** Taket är befintliga `withinOrphanCeiling` — absolut tak
   OCH andelstak med golv. Vid överskridande raderas noll och en `logger.error`
   skrivs; sopningen raderar aldrig ändå.
4. **(#27:2)** Raderingen tar hela `users/{uid}`-trädet via samma
   `recursiveDelete`-primitiv som `sessions/{id}` redan använder — inte bara
   `watchlist`. Ett test hävdar att ett dokument i en ANNAN undersamling än
   watchlist också är borta.
5. **(#27:3, Malins beslut)** `publicProfiles/{uid}` raderas i samma svep.
   Steg 2 filas som egen biljett OCH skrivs som daterad post i
   `.claude/rules/accepted-deviations.md`.
6. **(#27:4, #4:4, #6:3)** Golvet är en namngiven konstant med sitt eget test:
   en färsk observation hoppas över, en gammal nog raderas. Klockan namnges i
   koden.
7. **(#4:4, #27:5)** Beslutspredikaten ligger i `orphans.ts` (ingen
   `firebase-admin`-import) och drivs av rotens vitest; orkestreringen ligger i
   `runCleanup.ts` bakom porten och drivs av emulatortestet.
8. **(#27:6, #4:5)** `-1`-disciplinen: en fallerad genomsökning rapporterar
   `-1`, aldrig ett bart `0`. Summariefälten skiljer "inget matchade" från
   "kunde inte kolla".
9. **(#6:2)** `docs/data-retention-policy.md` rättas i SAMMA ändring — den
   säger i dag att detta är osopat, under "Console-bypass (känd begränsning)".
10. **(#27:5)** Emulatortestet i `src/test/rules/retention-cleanup-orchestrator.test.ts`
    utökas med den nya sopningen.
11. **Premissrättelse:** testerna siktar på en konsolradering av Auth-kontot,
    inte på en avbruten klientkaskad. Två roller visade att kaskaden köar
    watchlist tidigt och `users/{uid}` sent, så den beskrivna orsaken nästan
    aldrig kan ge läget.

### Negativa villkor

- Bygg INTE en andra egen frånvarokoll eller ett andra tak — återanvänd
  `orphans.ts`.
- Rör INTE `reports/{reportId}`: medvetet bevarad under Art. 17(3).
- Rör INTE det separat dokumenterade läget "delvis kaskaderad, Auth vid liv".

---

## BIN-590 — AVGJORD 2026-08-31, byggs inte

Malin valde att acceptera residualen i stället för att bygga servergrinden. Skälet
och alla fyra gränserna står i `.claude/rules/accepted-deviations.md` (posten
daterad 2026-08-31) — det är beslutets enda hem, den här filen är slask.

Villkoren från #19 Customer Support bevarades där, inklusive carve-outen för
inloggningsleverantörer som aldrig sätter ett lösenord.

---

## Behöver dig (Tier D)

- **BIN-624:** nollräkningen på riktig data som du själv satte som villkor har
  inget spår av att ha körts. Utan den får serverdelen inte skärpas.

## Deviation log

- [discovery] BIN-1023: biljettens beskrivna orsak (avbruten klientkaskad) kan
  nästan aldrig ge läget — `collectDeletionRefs` köar watchlist i sektion 1 och
  `users/{uid}` i sektion 9, sekventiellt committat. Verklig källa är en
  konsolradering. Testerna siktar om.
- [discovery] BIN-1023: `ORPHAN_AUTH_MIN_AGE_MS` mäter en storhet som inte finns
  när Auth-kontot är borta. Ny klocka införd (observerad frånvaro), namngiven i
  koden, med eget golv.
- [needs-human] BIN-590: serversidig efterlevnad kräver antingen en
  konsolaktivering eller en omskrivning av registreringsflödet. AVGJORD
  2026-08-31: Malin accepterade residualen; se accepted-deviations.
