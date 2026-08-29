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
