# Sprint 2026-08-29b — fyra biljetter

Träd rent på `main` vid start (`6061a7a`), i synk med origin.

Urvalet gjordes mot 30 öppna ärenden. Mycket av backloggen är antingen (a) arbete som bor i
`C:/claude-plugins` och kräver en egen session där, (b) öppna designfrågor utan vald riktning,
eller (c) frågor som är Malins. Det som återstår som byggbart här är fyra biljetter.

## Step-0-kontroll mot main (premisskoll)

| biljett | premiss vid HEAD | utfall |
| -- | -- | -- |
| BIN-935 | `grep -n "behavioural test" docs/org/metrics/check_review_coverage.mjs` → rad 611, 615 | står kvar → bygg |
| BIN-929 | `grep -n "All 42\|42 of 93\|41 of these" docs/org/metrics/README.md` → rad 208, 221, 237 | står kvar → bygg |
| BIN-938 | ingen nedskriven acceptans hittad | står kvar → bygg |
| BIN-1053 | `grep -c takeNextPath docs/workflow-map.html` → 1 (kartans nod saknar meningen) | står kvar → bygg |
| BIN-1037 | `available-notify-orchestrator.test.ts:897` bär `setTimeout(resolve, 100)`; `no-bare-streaming-offers-id.test.mjs:34` bär `120_000` | står kvar → bygg |
| **BIN-924** | `grep -c audit docs/org/metrics/log_event.mjs` → **0**. `--audit` fanns aldrig vid HEAD; BIN-918 landade i stället som `check_events.mjs` + `check_events.test.mjs`, och testfilen asserterar den LEVANDE `events.jsonl` under `npm test` (README rad 132) | **PREMISSEN BORTA → obsolet, stängs** |

## Routning (körd på varje bunts FAKTISKA filuppsättning, rå utdata)

Arbetaren är denna session, som KAN konvenera kritik. Kritiken körs FÖRE bygget.

**Bunt 1 — OMROUTAD före commit, och den första routningen var FEL.**

Vid urvalet routade jag två filer och fick `panel: [14]` (fallback-sätet för ägarlös kod).
Bunten kom sedan att stage:a SEX filer, och `.claude/rules/accepted-deviations.md` — där hela
BIN-938:s leverans ligger — ägs av `#25 Engineering Manager / Release Manager`. Den rollen
nåddes aldrig av urvalets routning. Det är BIN-1050/1048:s lärdom (`bac5072`, skriven dagen
innan) på min egen körning, i den VIDGANDE riktningen. Hittad oberoende av två håll: push-
grinden och en parallell session.

Rå utdata på buntens FAKTISKA stageade union:

```
node docs/org/route.mjs docs/org/metrics/check_review_coverage.mjs   docs/org/metrics/check_review_coverage.test.mjs docs/org/metrics/README.md   docs/org/metrics/events.jsonl .claude/rules/accepted-deviations.md tasks/todo.md
```

→ `tier: medium`, `reasonCode: owned`, `panel: [25]`, `dropped: ["21 Technical Writer / Documentation", "27 Database Administrator / Data-layer Engineer"]`, `highStakes: []`,
`unownedCode: ["docs/org/metrics/check_review_coverage.mjs", "docs/org/metrics/check_review_coverage.test.mjs"]`.

Kanonisk tier: `single`. `#25`:s blinda kritik konvenerades FÖRE commit och dess villkor är
bindande nedan. Den tidigare `[14]`-routningen står kvar i den här texten med flit: den var
den faktiska grunden bygget startade på, och att stryka den skulle dölja felet.

**Bunt 2** — `node docs/org/route.mjs src/test/rules/available-notify-orchestrator.test.ts eslint-rules/no-bare-streaming-offers-id.test.mjs`
→ `tier: medium`, `reasonCode: owned`, `panel: [13]`, `highStakes: []`,
`unownedCode: ["eslint-rules/no-bare-streaming-offers-id.test.mjs"]`. Kanonisk tier: `single`.

**Bunt 3** — `node docs/org/route.mjs docs/workflow-map.html`
→ `tier: skip`, `reasonCode: doc-only`, `panel: []`. Ingen kritik.

Routningen körs OM strax före varje kritik konvenerar om buntens union ändras — vidgad ELLER
krympt (BIN-1052:s lärdom, `bac5072`).

## Bunt 1 — BIN-935 + BIN-929 + BIN-938 [Tier A] [build] [single, #14]

BIN-935 och BIN-929 bor i `docs/org/metrics/`. BIN-938 gör INTE det — dess leverans är en
post i `.claude/rules/accepted-deviations.md`, och det är den filen som flyttar routningen
från `unmapped-code`/#14 till `owned`/#25. Meningen som stod här sa att alla tre rör samma
två filer; den var falsk, och den var orsaken till att fel roll kritiserade bunten.

⚠ **Konvergensrisk.** Det här är en nästan ren prosabunt, och BIN-1028 tog 41 blockerande fynd
över nio varv med NOLL defekter i koden. Motmedlet är bindande här: **stryk hellre än formulera
om**, och där en mening måste stå, skriv ett KOMMANDO som härleder den — och kör kommandot före
commit.

### BIN-935 — två påståenden i `check_review_coverage.mjs` som är för starka

- [ ] AC1: Ingen mening i filen påstår att något är omöjligt när granskaren visat att det går
      (barnprocess utan `git` i PATH når fallback-grenen). *(kind: diff)*
- [ ] AC2: Ingen mening utser en ensam kontroll när två finns. *(kind: diff)*
- [ ] AC3: `stagedEventsLog`s docblock sitter på `stagedEventsLog`, inte 30 rader ovanför den. *(kind: diff)*
- [ ] AC4: Beslutet att assertera vid import rivs INTE upp; ingen körbar rad ändrar beteende.
      `npm test` grönt på metrics-sviten. *(kind: diff)*

### BIN-929 — nio glidna tal i metrics-README:n

- [ ] AC1: De nio talen är antingen omräknade med ett `as of <sha>` intill, ELLER ersatta av
      ett kommando som härleder dem. *(kind: diff)*
- [ ] AC2: ⚠-varningsrutan tas bort i SAMMA ändring — annars blir den sitt eget inaktuella
      påstående. *(kind: diff)*
- [ ] AC3: Varje tal som blir kvar är producerat av ett kommando som körts i den här sessionen,
      och kommandot står skrivet bredvid. Inget nytt omätt tal införs. *(kind: diff)*

### BIN-938 — tolv ospårbara commits i augusti

- [ ] AC1: Acceptansen av de tolv grandfathered-commitarna är nedskriven där nästa granskare
      läser den, så att fyndet inte filas igen. *(kind: diff)*
- [ ] AC2: Inget nytt antal påstås som inte mätts i den här sessionen. *(kind: diff)*

## Bindande villkor från #25 Engineering Manager / Release Manager (blind kritik, konvenerad EFTER omroutningen, accept-with-conditions)

- [ ] C1: Bunten committas SPLITTAD så att varje commits filuppsättning matchar den kritik som
      faktiskt kördes för den. Verifierat med routern per commit:
      commit A (metrics + accepted-deviations + plan + logg) → `panel: [25]`, kritiserad av #25.
      commit B (`available-notify-orchestrator.test.ts` + testgranskarens kunskapsfiler) →
      `panel: [13]`, kritiserad av #13. commit C (`docs/workflow-map.html`) → `tier: skip`.
- [x] C2: En `correction`-rad i `events.jsonl` bokför att BIN-935/929/938:s rader bär
      `panel:[14]` från ett underskattat urval, och att buntens rätta panel är `[25]`. De
      befintliga raderna är ORÖRDA — loggen är append-only. En `review`-rad med `panel:[25]`
      är skriven för #25:s faktiska pass.
- [x] C3: #25:s accept täcker BUNT 1 (BIN-935, BIN-929, BIN-938). Den täcker uttryckligen INTE
      `available-notify-orchestrator.test.ts`, som varje routning sätter på #13.
- [x] C4: BIN-938:s re-open-villkor är mekaniskt och bär inget hårdkodat tal.

#25:s processdom, ordagrant nog att inte bortförklaras: buntens INNEHÅLL konvergerar — noll
koddefekter över alla granskningsvarv, alla fynd i prosa — men routningsmekanismen omkring den
gör det inte. Panelen har felsatts på fyra olika sätt för samma oförändrade bunt. Rollen pekar
ut att planens egen mening ("de rör samma två filer") var det som gjorde det, och att
`.claude/rules/accepted-deviations.md` är exakt den fil som vänder `reasonCode` från
`unmapped-code` till `owned`.

#25 lyfter EN sak som inte är ett villkor utan en fråga till Malin, och den förs vidare orörd:
den här instabiliteten har slagit till i tre sprintar i rad enbart på filuppsättnings-slarv.
Rollen föreslår att "routa på `git diff --cached --name-only` omedelbart före commit" görs till
ett faktiskt pre-commit-steg i stället för en ihågkommen disciplin. Det är en ändring i den
delade grindmaskinen och byggs inte här.

## Bunt 2 — BIN-1037 [Tier A] [build] [single, #13]

Biljetten samlade observationer utan åtgärd. Två av dess kommentarer namnger nu TVÅ
reproducerade, förstådda flakes med egna acceptanskriterier, och den första har fällt två
skilda deploy-körningar. Biljettens egen tröskel ("öppna som eget arbete om det händer igen")
är passerad.

- [ ] AC1: `titelloopen är sekventiell` asserterar inte längre mot väggklockan — förloppet drivs
      håll → observera → släpp med en styrbar promise, och ORDNINGEN på anropen är det som
      hävdas. *(kind: diff)*
- [ ] AC2: En `Promise.all`-mutant på titelloopen FÄLLER fortfarande testet, bevisat genom att
      mutanten faktiskt appliceras och sviten körs — i ETT kommando, med assertion på mutanten
      före och efter. *(kind: diff)*
- [ ] AC3: En överskriden uppstartsbudget i `no-bare-streaming-offers-id.test.mjs` gör sviten
      RÖD, inte tyst kortare. *(kind: diff)*
- [ ] AC4: Ingen befintlig assertion försvagas, och antalet överhoppade test i en full körning
      är oförändrat (4). *(kind: diff)*

## Bunt 3 — BIN-1053 [Tier A] [build] [skip]

Egen commit, skild från all funktionskod (lärdomsdigesten, `e2cf608`).

- [ ] AC1: Kartans `onboarding-flow`-nod beskriver att den ihågkomna vägen konsumeras av
      `OnboardingFlow`s `finish()` och pushas. *(kind: diff)*
- [ ] AC2: Meningen är HÄRLEDD ur koden läst i den här sessionen, inte inklistrad ur biljetten. *(kind: diff)*
- [ ] AC3: Ändringen ligger i en egen kartcommit utan funktionskod. *(kind: diff)*

## Behöver dig (Tier D / bunden handbroms / produktval)

- **BIN-613** — bär ditt beslut 2026-07-29: *"Får INTE plockas av en obevakad sprint."* Bunden
  handbroms, dras ur urvalet. Väntar på ett bevakat pass.
- **BIN-1052, BIN-1013, BIN-1035, BIN-959** — bor i `C:/claude-plugins`. Kräver en egen session
  i det repot; en session som redigerar delad infrastruktur och sedan startar subagenter
  förgiftar dem (lärdomen 2026-08-03).
- **BIN-990, BIN-939** — öppna frågor till dig (vidga grindlistan? ska #4 grinda `package.json`?).
- **BIN-1023, BIN-559, BIN-590, BIN-826** — öppna designfrågor utan vald riktning eller
  prissättning.
- ~~BIN-419, BIN-829~~ — stängda som Done 2026-08-29 19:39 av en parallell session medan
  den här sprinten byggde. Kontrollerat i Linear, inte antaget.
- **BIN-454, BIN-402** — `mutateEnabled` är din konsolåtgärd och rörs aldrig av en sprint.
- **BIN-658** — fixen (eslint 9→10) är blockerad UPPSTRÖMS, bokfört i `7f40382`. Ingen åtgärd finns.
- **Linear-taket** är fullt igen — nya fynd kan inte bli egna biljetter och hamnar som
  kommentarer på befintliga ärenden.

## Deviation log

- [discovery] BIN-924: premissen borta. `grep -c audit docs/org/metrics/log_event.mjs` → 0.
  BIN-918 landade som `check_events.mjs` + `check_events.test.mjs`, och testfilen asserterar
  den LEVANDE `events.jsonl` under `npm test`. Stängs som obsolet, ingen kod skriven.
- [needs-human] BIN-613: biljettens kommentar 2026-07-29 är Malins eget beslut — "får INTE
  plockas av en obevakad sprint". Dragen ur urvalet före bygget.
- [deviation] BIN-935/929/924/930 bär "Behöver ditt beslut"-kommentarer från 2026-08-22.
  De skrevs av den överflaggning Malin ERSATTE samma dag (097d358/6d3d4a8: bara produktval
  hålls tillbaka). Behandlade som upphävda av det nyare beslutet — inget av dem är ett
  produktval. BIN-613:s kommentar är hennes egen och respekterades.
- [deviation] BIN-938: biljetten säger tolv commits utan biljett-id. Ommätt vid HEAD ger 16,
  varav 4 är dependabot-commits regeln undantar via FÖRFATTARSKAP. Den grandfathered mängden
  är alltså fortfarande 12, men buntens text räknar om den i stället för att ärva talet.
- [deviation] BIN-1037 flake 2: premissen mätt FALSK. En sprängd `beforeAll`-budget i
  `no-bare-streaming-offers-id.test.mjs` ger `Test Files 1 failed (1)` och `EXIT 1` — den är
  inte tyst. Hookens verkliga kostnad mättes till 2,0–2,4 s mot en budget på 120 s. Ingen
  mekanism byggd; det är #13:s villkor C5 och ett legitimt utfall, inte en utebliven åtgärd.
- [discovery] Ett dokumenterat kommando kan gå sönder i själva skrivningen: `\r`/`\n` kollapsade
  till RIKTIGA styrtecken när det skrevs via en heredoc. Det upptäcks bara genom att extrahera
  det committade kommandot och köra det ordagrant. Push-grinden hittade dessutom en form den
  metoden inte fångar — ett `git show <sha> -- <fil>` som KÖR men ger tom utdata, där jag hade
  kört kolonformen och publicerat pathspec-formen. Att kommandot kör räcker alltså inte; dess
  utdata måste läsas.


---

# BIN-852 — lintern går grönt när innehållsbaslinjen är för låg

Malins beslut 2026-08-29, live i sessionen: **höj ribban nu OCH bygg varningen.** Alternativen
"bara höj ribban", "vik in i nästa verktygspass" och "strunta i den" valdes bort.

Träd rent på `main` vid start (`bac5072`).

## Routning (körd på den faktiska filuppsättningen, rå utdata)

```
node docs/org/route.mjs scripts/check-workflow-map.mjs scripts/check-workflow-map.test.mjs docs/workflow-map-content-baseline.json
```

→ `tier: medium`, `reasonCode: unmapped-code`, `panel: [14]`, `highStakes: []`,
`unownedCode: ["scripts/check-workflow-map.mjs","scripts/check-workflow-map.test.mjs"]`.

Kanonisk tier: `single`. `#14 Software Architect` är FALLBACK-sätet för kod ingen roll äger —
väntat här, inte en lucka: `docs/role-responsibilities.md` bokför `scripts/`-kontrollskripten som
medvetet ägarlösa, och `route.test.mjs` hänger på att det förblir sant.

Arbetaren är denna session, som KAN konvenera. Kritiken kördes FÖRE bygget.

## Mätningen som motiverar biljetten

Kört 2026-08-29 mot HEAD. 7 av 31 flöden bär ≥20 % slack:

| flöde | baslinje | uppmätt | slack |
| -- | -- | -- | -- |
| `flow4` | 1919 | 6175 | 68,9 % |
| `flow-rating-community` | 1285 | 3204 | 59,9 % |
| `flow-gdpr` | 4897 | 10358 | 52,7 % |
| `flow5` | 1170 | 2402 | 51,3 % |
| `flow-static` | 1902 | 2690 | 29,3 % |
| `flow-hygiene` | 4481 | 5849 | 23,4 % |
| `flow1` | 8864 | 11122 | 20,3 % |

Närmast under: `flow-available` 16,5 %. Gapet är 3,8 procentenheter, och det är där tröskeln läggs.

Biljettens egen text säger FYRA släpande flöden. Mätningen 2026-08-29 ger sju. Byggt mot
mätningen, inte mot biljettexten.

## Acceptanskriterier

- [ ] AC1: Lintern VARNAR per flöde när baslinjen ligger mer än tröskeln under uppmätt innehåll,
      och namnger flödet plus BÅDA talen. *(kind: diff)*
- [ ] AC2: Varningen fäller INTE bygget. Returvärdet/exit-koden styrs fortsatt enbart av
      `problems.length`. *(kind: diff)*
- [ ] AC3: Tröskeln är en namngiven konstant, inte ett tal utspritt i koden. *(kind: diff)*
- [ ] AC4: Test i BÅDA riktningarna med bokstavliga fixturtal — ett flöde strax under tröskeln
      (tyst) och ett strax över (varnar, namnger flödet och talen) — plus ett fall utan baslinje. *(kind: diff)*
- [ ] AC5: Ingen befintlig assertion försvagas, och ingen befintlig kontroll ändrar beteende. *(kind: diff)*

## Bindande villkor från #14 Software Architect (blind kritik, accept-with-conditions, noll blockerande)

- [ ] AC-14.1: `BASELINE_STALE_PCT = 20`, formel `(curr - base) / curr * 100 > BASELINE_STALE_PCT`.
      Strikt `>`, för biljetten säger "mer än X %". Ligger i gapet mellan `flow1` (20,3 %, ska varna)
      och `flow-available` (16,5 %, ska tiga). `curr === 0` → hoppa över (fångas redan av det hårda
      innehållsgolvet; undviker `NaN%`).
- [ ] AC-14.2: Ny exporterad `checkBaselineStaleness(actions, baseline, warnings)` direkt efter
      `checkContentRatchet`, samma iterationsform. Skriver till en EGEN `warnings`-array, aldrig
      till `problems`. Ett flöde som saknas i `actions` varnas inte — det är redan ett hårt fel.
- [ ] AC-14.3: Anropas i `main()` inne i det befintliga `existsSync(baselinePath)`-blocket, direkt
      efter `checkContentRatchet`. Varningarna skrivs med `console.warn` OAVSETT om `problems` är
      tom, och antalet läggs till på `OK`-sammanfattningsraden — en varning begravd ovanför en vägg
      av `OK` är just "ingen läser den"-felet.
- [ ] AC-14.4: Konstanten dokumenteras som filens övriga trösklar gör: en DATERAD mätning, inte ett
      påstående formulerat som permanent sant, och kommandot som återskapar talen namnges.
- [ ] AC-14.5: **Bevis före omgenerering.** Att regenerera först gör varje flöde 0 % i samma körning,
      så enhetstestet blir det ENDA beviset att mekanismen någonsin fyrar. Ordningen är bindande:
      **Steg A** — med dagens inaktuella baslinje kvar, kör lintern med varningen inkopplad och
      fånga att den ger exakt de sju raderna ovan, med rätt namn och rätt tal. Utdatan sparas i
      commit-texten eller på biljetten, inte bara körs och kastas.
      **Steg B** — därefter `--update-baseline` och committa den omgenererade baslinjen.
- [ ] AC-14.6: `.claude/shared-plugin.json` ändras INTE. Villkor 4 i biljetten (att skriptet ligger
      under en granskargrind) är redan uppfyllt vid HEAD — `binge-integration-reviewer`s mönster
      matchar `scripts/check-workflow-map.mjs`. Härled: `node -e` över `reviewGates`.

## Rollens svar på de fyra frågorna

Varning är rätt instrument, ingen invändning att lyfta till Malin. En hård grind hade tvingat fram
en reflexmässig `--update-baseline` på varje commit som växer ett flödes prosa — alltså straffat
precis det hälsosamma beteendet filen vill uppmuntra, och upphävt kodens egen uttalade avsikt att
omgenerering ska vara ett "conscious, reviewable step".

## Steg A — beviset att varningen fyrar mot VERKLIG inaktuell data

Kört FÖRE `--update-baseline`, per AC-14.5. Ordagrann utdata:

```
workflow-map linter: WARNING — flow 'flow1': baseline is 20% below current content (8864 vs 11122 chars) — …
workflow-map linter: WARNING — flow 'flow4': baseline is 69% below current content (1919 vs 6175 chars) — …
workflow-map linter: WARNING — flow 'flow5': baseline is 51% below current content (1170 vs 2402 chars) — …
workflow-map linter: WARNING — flow 'flow-rating-community': baseline is 60% below current content (1285 vs 3204 chars) — …
workflow-map linter: WARNING — flow 'flow-hygiene': baseline is 23% below current content (4481 vs 5849 chars) — …
workflow-map linter: WARNING — flow 'flow-gdpr': baseline is 53% below current content (4897 vs 10358 chars) — …
workflow-map linter: WARNING — flow 'flow-static': baseline is 29% below current content (1902 vs 2690 chars) — …
workflow-map linter: OK — 100 nodes, 31 flows, all referenced paths exist, coverage 76/76, 7 baseline-staleness warning(s) above
```

Sju varningar, `exit=0`. Exakt de sju flöden mätningen förutsade, med rätt tal, och bygget
passerar — signal, inte grind.

## Steg B — omgenereringen

`node scripts/check-workflow-map.mjs --update-baseline` → 31 flöden skrivna. Lintern därefter:
`OK — 100 nodes, 31 flows, …, coverage 76/76`, noll varningar.

Kontrollerat att omgenereringen bara HÖJDE: 13 höjda, **0 sänkta**, 18 oförändrade av 31. En
sänkt baslinje hade betytt att prosa gått förlorad; ingen sänktes.

## Muteringsbevis

| mutation | utfall |
| -- | -- |
| `slackPct > BASELINE_STALE_PCT` → `>=` | exakt tröskeltestet (20,0 % ska tiga) faller |
| `warnings.push(` → `problems.push(` inne i funktionen | testet "warns just over the threshold" faller |

**Rättat efter testgranskarens omkörning.** Den här tabellen sa först "två test faller OCH lintern
går från `exit=0` till `exit=1`". Båda talen var omätta av mig:

* Det är ETT test, inte två.
* Exit-kodspåståendet är BASLINJEBEROENDE. Det höll mot den inaktuella baslinjen, alltså före
  `--update-baseline`. Mot den omgenererade baslinjen som ligger i SAMMA diff når mutationen
  aldrig sin rad, och CLI:t stannar på `exit=0`. En mutation som "bevisar" något mot en datafil
  som ändras i samma commit bevisar det bara för det ena tillståndet.

Vad som faktiskt håller AC2 (varningen får inte fälla bygget) är wiring-testen nedan, som pinnar
argumentet vid anropsstället. Den är oberoende av vilken baslinje som ligger i trädet.

Filen återställd från scratchpad-kopia och hash-verifierad (`de1a0b7c…`) efter varje mutation.

## Deviation log

- [discovery] Biljetten säger FYRA släpande flöden (skrivet 2026-08-11). Mätningen 2026-08-29 ger
  SJU över 20 %. Byggt mot mätningen. Talen i biljettens brödtext lämnas orörda; den färska
  mätningen står i kommentaren på biljetten.
- [deviation] AC-14.1:s formel prövas mot tre bokstavliga fall (19,9 % tyst, 20,0 % tyst, 20,1 %
  varnar), inte två som biljetten ber om. Skälet: "mer än X %" är exakt där ett off-by-one bor, och
  gränsfallet 20,0 % är det enda som skiljer `>` från `>=`.
- [blocking-fixed] **Testgranskaren fällde bunten, och hade rätt.** Två fel, båda mina:
  1. Anropet i `main()` hade INGEN test. Hela funktionen kunde raderas därifrån med sviten grön —
     verifierat: 54/54 passerade med anropet borttaget. Filen har redan idiomet för det (check 6
     och check 7 har var sin "WIRED INTO main()"-test); check 5b saknade sin.
  2. Testet `never writes to problems` var VAKUÖST: det deklarerade en egen lokal `problems` som
     funktionen aldrig får, så dess assertion var sann oavsett vad koden gjorde. Struket, inte
     omformulerat — den nya wiring-testen täcker den verkliga risken.
  Ny test pinnar ARGUMENTET, inte bara anropet, så både en radering och en `warnings`→`problems`-
  swap fäller den. Muteringsprövat i båda riktningar (se tabellen nedan).
  Samma blindfläck som check 6 och 7 dokumenterar för sig själva — `if (false) …` fångas inte —
  och det står i den nya testens kommentar i stället för att slätas över.
- [discovery] Den nya wiring-testens regex tappade sina escape-tecken när den skrevs, och testet
  FÄLLDE direkt på sin egen trasiga regex. Det är testet som gör sitt jobb, men värt att notera:
  ett källkodsskannande test kan gå sönder på ett sätt som ser ut som ett fynd.

## Muteringsbevis, wiring-testen

| mutation | utfall |
| -- | -- |
| anropet borttaget ur `main()` | wiring-testen faller (före fixen: 54/54 gröna) |
| `…, baseline, warnings)` → `…, baseline, problems)` | wiring-testen faller |
| `…, baseline, warnings)` → `…, warnings)` (mittargumentet borttaget) | wiring-testen faller |

Den tredje raden är testgranskarens andra fynd, och den var giltig: den första versionen av regexen
ankrade bara FÖRSTA och SISTA argumentet, så `[^)]*` svalde ett borttaget `baseline` och funktionen
blev en permanent no-op med sviten grön. Verifierat själv före rättelsen: 54/54 passerade. Regexen
ankrar nu varje argument, och `[^,)]*` kan inte svälja ett kommatecken.

Fil återställd från scratchpad-kopia och hash-verifierad (`de1a0b7c…`) efter varje mutation.
