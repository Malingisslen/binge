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
- BIN-1063 (orphan-svepets fältägda halva) — biljetten säger uttryckligen att gruppfrågan (radera vs lämna över) måste besvaras innan något byggs.
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
