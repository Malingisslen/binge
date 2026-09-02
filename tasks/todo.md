# Sprint 2026-09-02b — tre byggbuntar + en mätning utan diff

Föregående sprintplan arkiverad under `---` längst ned.

## Urval

Backloggen hade 23 öppna biljetter; noll låg i Todo eller In Progress vid urvalet.
Tre byggs, en avgörs med en mätning som inte producerar någon diff, resten står under
"Inte valda" med ett skäl per grupp.

Skälen som dominerar bortvalet är fyra:

* **En bindande handbroms i tråden** — biljetten säger själv att Malin måste svara först
  (BIN-1063 gruppfrågan, BIN-871 takten, BIN-990, BIN-939, BIN-1075) eller att den ska ha
  ett eget designpass och aldrig plockas av en obevakad sprint (BIN-559).
* **`neverBuildLabels`** — `idea`/`Feature` (BIN-189, BIN-521, BIN-170).
* **Bor i `C:/claude-plugins`** och kräver en egen session i det repot (BIN-1052,
  BIN-1013, BIN-1035, BIN-959). Lärdomen 2026-08-03: en session som rör delad infra och
  sedan startar subagenter förgiftar dem — och den här sessionen startar granskare.
* **Ops-blockerad eller uttryckligen framskjuten** (BIN-1071 kräver en människa med
  webbläsare; BIN-454/BIN-402 är pinnade till ~nov och rör den förbjudna `mutateEnabled`;
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
| BIN-1071 | Tier D — tre prissidor kräver en människa med vanlig webbläsare. |
| BIN-454, BIN-402 | Pinnade till ~nov; rör `mutateEnabled`, som en sprint aldrig får flippa. |
| BIN-824 | Byggs uttryckligen inte förrän spärrhakens luft är förbrukad, och då med GSC-data. |
| BIN-613 | Väljer mellan tre alternativ i deploy-kedjan; nästa naturliga bunt när budget finns. |
| BIN-189, BIN-521, BIN-170 | `idea`-etiketten → `neverBuildLabels`. |

## Behöver dig (Tier D)

* **BIN-1071** — Crunchyroll, YouTube Premium och SkyShowtimes reklamnivå gick inte att
  läsa maskinellt. Öppna de tre sidorna i en vanlig webbläsare och skriv priserna i
  biljetten, så tar nästa körning in dem.

## Efter sprinten

1. `npm run lint`, `npm run typecheck`, hela `npm test`.
2. Följdbiljetter filas FÖRE commit.
3. Routningen körs om på `git diff --cached --name-only` per commit; buntarna committas
   splittat så att varje commits filuppsättning routar till en kritik som faktiskt kördes
   (A → [11], B → [25], C → [15]).
4. Push (= deploy), invänta grön körning, purga Cloudflare.
5. Linear-transitioner PARVIS med varje commit (BIN-754).

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
