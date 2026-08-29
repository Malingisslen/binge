# Sprint 2026-08-29 — fem biljetter, tre buntar

Urval kört 2026-08-29. Träd rent på `main` vid start (`7f40382`). Varje premiss kontrollerad
mot HEAD med grep/körning, inte mot biljettexten.

## Routning (körd på buntunionerna, rå utdata)

| Bunt | Filuppsättning | tier | reasonCode | panel |
| -- | -- | -- | -- | -- |
| A | `.github/workflows/pr-checks.yml`, `docs/org/rules-id-client-symmetry.test.mjs` | medium | owned | 4 |
| B | `src/components/onboarding/OnboardingFlow.tsx` (+test), `src/hooks/useMarkSeen.test.tsx`, `src/components/pages/MoviePageClient.test.tsx`, `src/components/layout/ReconsentGate.test.tsx` | medium | owned | 26 |
| C | ingen fil — en mätning mot produktionsdatabasen | (ingen kod) | — | — |

Kanonisk tier för A och B: `single`. Arbetaren är denna session, som KAN konvenera en blind
kritik — kritiken körs alltså FÖRE bygget, den parkeras inte som skuld.

`unownedCode` bunt A: `[]`.

**Panelen i rad A rättad efter push-grindens fynd 2026-08-29.** Den sa `25`. Skriv ingen
orsaksberättelse här — kör de två kommandona. Det första är vad urvalet FAKTISKT körde, när
BIN-790 fortfarande ingick; det andra är buntens verkliga union efter att BIN-790 drogs ur:

```
node docs/org/route.mjs .github/workflows/pr-checks.yml docs/org/rules-id-client-symmetry.test.mjs .claude/hooks/freshness.mjs .claude/hooks/freshness.test.mjs
node docs/org/route.mjs .github/workflows/pr-checks.yml docs/org/rules-id-client-symmetry.test.mjs
```

De svarar olika. Routern kördes aldrig om när unionen krympte, så #25:s kritik kördes i stället
för den ägande rollens. Åtgärd: #4:s blinda kritik kördes före commit — villkoren står som
AC-4.1–AC-4.4 nedan. #25:s kritik står kvar — den är inte ogiltig, bara inte den skyldiga.

Lärdomen: en KRYMPT filuppsättning ogiltigförklarar routningen precis som en vidgad gör, och
vilken enskild fil som "flyttar panelen" är inte en fråga att besvara i prosa — kombinationerna
svarar olika och varje mening om dem är ett omätt påstående. Push-grinden skrev ett sådant och
hade fel; det här stycket skrev ett och hade fel. Kör kommandot.

`unownedCode` bunt B: `OnboardingFlow.tsx`, `OnboardingFlow.test.tsx`.

---

## Bunt A — grindarna som inte grindar

### BIN-1050 — ingen check typkollar `functions/` [Tier A] [build]
Premiss kontrollerad mot HEAD: rotens `tsconfig.json` har `"exclude": ["node_modules","functions"]`;
`pr-checks.yml`s `quality`-jobb kör lint + typecheck + test och `cd`:ar aldrig till `functions/`;
`functions/package.json` står på `typescript: ^5.6.0` efter reverten `760df5a`.

- [x] AC1: `pr-checks.yml`s `quality`-jobb typkollar `functions/`, och ett typfel där fäller checken. *(kind: diff)*
- [ ] AC2: Prövat i skarp körning att en avsiktlig typfel gör `quality` röd. *(kind: run)* — en obevakad
      körning kan inte producera den; markeras `awaiting-run` och landar under "Behöver dig".
- [x] AC3: Rotens typecheck är oförändrad — `functions` är fortfarande exkluderad där. *(kind: diff)*
- [x] AC4: Ingen befintlig check försvagas. *(kind: diff)*

### BIN-1048 — id-symmetrispärren läser bara en av reglernas två vakter [Tier A] [build]
Premiss kontrollerad mot HEAD: `docs/org/rules-id-client-symmetry.test.mjs` har
`const GUARD_FUNCTION = 'canonicalWatchlistDocId'` — ett enda namn.
Vald åtgärd: biljettens alternativ 2 (pröva båda regelfunktionerna direkt), inte alternativ 1
(en mening om beroendet). Skälet är strykregeln: en mekanisk prövning kan motsägas av en körning,
en mening kan det inte.

- [x] AC5: Filen prövar BÅDA regelfunktionerna — `canonicalWatchlistDocId` och `canonicalSwipeDocId`. *(kind: diff)*
- [x] AC6: Golven (extraktion, korpusstorlek, accepterade, refuserade) gäller per regelfunktion, före
      varje jämförelse — ingen väg får jämföra ingenting med ingenting. *(kind: diff)*
- [x] AC7: `firestore.rules` är orörd. *(kind: diff)*
- [x] AC8: Ingen befintlig assertion försvagas. *(kind: diff)*

---

## Bunt B — vad användaren får för besked när en skrivning vägras

### BIN-1047 — OnboardingFlow har två catchar kvar som ger fel råd [Tier B] [build-review]
Premiss kontrollerad mot HEAD: filen importerar redan `isDeletionInProgressError` och
`DELETION_IN_PROGRESS_MESSAGE` och använder dem på EN väg (`handleAdd`). Två catchar till
(`finish()` och `StepProviders.save()`) faller igenom till en `SaveError` som säger
"Kontrollera anslutningen och försök igen".

- [x] AC9: `finish()`s och `StepProviders.save()`s catchar går genom `isDeletionInProgressError`
      och visar `DELETION_IN_PROGRESS_MESSAGE`. *(kind: diff)*
- [x] AC10: Rådet "försök igen" visas inte för en vägran på någon av de tre vägarna. *(kind: diff)*
- [x] AC11: Ett test per väg, plus ett KONTROLLTEST per väg som visar att ett vanligt fel fortfarande
      får återförsöksbannern (BIN-659:s beteende får inte tas bort). *(kind: diff)*
- [x] AC12: Ingen befintlig assertion försvagas. *(kind: diff)*

### BIN-1049 — testfiler som skriver felkoden för hand [Tier A] [build]
**Omskopad mot trädet.** Biljetten namnger TVÅ filer (`useMarkSeen.test.tsx`,
`MoviePageClient.test.tsx`). `git grep "binge/deletion-in-progress" -- src` ger en tredje med
samma handskrivna literal: `src/components/layout/ReconsentGate.test.tsx`. Och
`toContain('raderas')` finns i två filer (`ReconsentGate.test.tsx`, `useMarkSeen.test.tsx`),
inte en. Omfånget är trädets, inte biljettens.

- [x] AC13: Varje `new Error('binge/deletion-in-progress: …')`-literal under `src/` komponeras ur
      `DELETION_IN_PROGRESS`. Härled mängden: `git grep -n "binge/deletion-in-progress" -- src`
      efteråt får inte träffa någon `new Error(`-rad. *(kind: diff)*
- [x] AC14: `useMarkSeen.test.tsx`s `toContain('raderas')` skärps till `DELETION_IN_PROGRESS_MESSAGE`.
      **Rescopad under bygget:** `ReconsentGate.test.tsx` har samma lösa form men får INTE samma
      skärpning — den skärmen visar avsiktligt en EGEN text med supportadressen, och `ReconsentGate.tsx`
      säger uttryckligen "do not consolidate the two". Den assertionen lämnas orörd; dess grannrader
      (`not.toContain('anslutningen')`, `not.toContain('försök igen')`, `toContain('hej@binge.nu')`)
      pinnar redan just den textens särdrag. *(kind: diff)*
- [x] AC15: Ingen befintlig assertion försvagas, och inget produktionsbeteende ändras. *(kind: diff)*

---

## Bunt C — mätningen

### BIN-999 — finns det `movie_0`/`tv_0` i produktion? [Tier A] [build]
Ingen kod. En läsning mot `binge-nu`: per uid, `users/{uid}/watchlist/movie_0` och `tv_0`.
Bara läsningar; ingenting raderas oavsett resultat (biljetten säger uttryckligen att en radering
kräver ett eget beslut).

**Beviset för AC16/AC17 ligger UTANFÖR trädet, och kan inte graderas ur diffen.** Bunt C
stagear inga filer. Kryssen nedan står för en körning vars enda spår är BIN-999:s kommentar i
Linear (postad 2026-08-29, med metod, uid-tabell och datum) och biljettens stängning. En
granskare som bara ser repot kan inte kontrollera dem — det är ett medvetet undantag, inte en
bock satt på känsla, och det står här just för att skillnaden ska synas.

- [x] AC16: Talet står skrivet på biljetten, med metoden och datumet. Svaret är 0 av 6.
      *(kind: run — bevis: kommentar på BIN-999, ej i trädet)*
- [x] AC17: Ingenting raderades eller ändrades i produktionsdatabasen; enbart `list` + `get`.
      *(kind: run — bevis: kommentar på BIN-999, ej i trädet)*

---

## Utdragna före bygget (inte byggda, inte stängda)

| Biljett | Skäl, mätt |
| -- | -- |
| BIN-790 | Kommentaren 2026-08-26 mäter att punkt 1 som den är skriven skulle radera arbetsordern mellan funktionskodens commit och kartans egen commit. Verklig konflikt i förslaget, inte kapacitet. Står kvar för omskrivning. |
| BIN-852 | Obesvarad handbroms från 2026-08-12 ("säg ja, buntas ihop / strunta i den"). En parkerad biljett är bindande. |
| BIN-590 | Malins beslut 2026-08-16: PLAN först, ihop med BIN-909, och får inte plockas av en sprint. |
| BIN-1013, BIN-1035 | Fixen ligger i `C:/claude-plugins`. En session som redigerar delad infrastruktur och sedan startar subagenter förgiftar dem (2026-08-03). Kräver egen session i det repot. |
| BIN-1023 | Tre riktningar, ingen vald, ingen prissatt; rör GDPR-raderingsvägen. Behöver ett eget pass. |
| BIN-624 | Gatad på BIN-999:s nollräkning (Malins val B). Blir byggbar om mätningen ger noll. |
| BIN-189, BIN-521, BIN-170 | `idea`-etiketten — hennes produktval, byggs aldrig av en sprint. |
| BIN-454, BIN-402, BIN-824 | Stående "gör inte detta"; BIN-824 säger själv "byggs inte nu". |
| BIN-419, BIN-829 | Search Console — Tier D, hon måste titta. |

## Obsoleta

- BIN-1051 — reverten ligger på main som `760df5a`; `functions/package.json` står på `^5.6.0`. Stängs.

## Deviation log

---

## Blind rollkritik #4 Security Architect — bunt A (den ÄGANDE rollen; körd före commit)

Konvenerad efter push-grindens fynd, se routningsavsnittet ovan. Utfall:
**accept-with-conditions**, noll blockerande. Rollen mätte att alla fyra villkoren redan höll i
det stageade trädet, så ingen kod ändrades av den här kritiken. Villkoren är bindande FRAMÅT —
de är tripwiren nästa gång någon rör den här workflowen.

- [x] AC-4.1: Triggern förblir `pull_request`, aldrig `pull_request_target`. Skillnaden är hela
      skyddet: `pull_request` kör med en läs-bara `GITHUB_TOKEN`, medan `pull_request_target`
      skulle ge en dependabot-kontrollerad låsfil ett token med skrivrättigheter.
- [x] AC-4.2: Jobbets `permissions: contents: read` täcker de två nya stegen (de ligger i samma
      jobb, ingen per-steg-override). Ett framtida steg med `write-*` eller `secrets.*` under den
      här triggern kräver ny säkerhetsgranskning.
- [x] AC-4.3: Ingen hemlighet finns i jobbet. Det är vad som gör "ingen build → inga hemligheter"
      sant även efter den här diffen: `npm ci` och `tsc` kör lokal låsfilskod, men det finns
      ingenting på runnern värt att stjäla. Den dag jobbet behöver en hemlighet krävs ett eget pass.
- [x] AC-4.4: `npm ci`, inte `npm install`, i båda de nya stegen — låsfilen är dependabot-skriven,
      och `ci` kan inte skriva om den mitt i körningen.

Rollens icke-bindande notering, värd att bära: det här är första gången något i CI installerar
`functions/`s eget beroendeträd. Nettoeffekten är en säkerhetsFÖRBÄTTRING — en dålig bump kör sina
install-skript på en engångsrunner utan credentials i stället för på Malins maskin med hennes
Firebase-CLI-inloggning. `--ignore-scripts` övervägdes och avvisades som villkor: rotens `npm ci`
några rader upp har det inte heller, så att kräva det bara av det nya steget vore en ojämn ribba.
Att införa det på båda är ett policyval för Malin, inte en blockerare på den här diffen.

## Blind rollkritik #25 Engineering Manager / Release Manager — bunt A (körd FÖRE bygget)

Utfall: **accept-with-conditions**, inga blockerande fynd. Villkoren är bindande acceptanskriterier.

- [x] AC-25.1: Steget ligger i det BEFINTLIGA `quality`-jobbet, inte i ett nytt jobb. `quality` är namnet
      grenskyddet på main kräver; ett nytt jobb hade behövt en inställning bara Malin kan göra.
- [x] AC-25.2: `npm ci` mot `functions/package-lock.json` — aldrig `npm install`, som tyst kan skriva om
      låsfilen i CI. Egen installation, inte hopslagen med rotens.
- [x] AC-25.3: `--noEmit`, inte `npm run build` (som emitterar till `functions/lib/`).
      **Avviker i FORM från villkorets ordalydelse, med flit.** #25 skrev `tsc --noEmit -p functions`.
      Det som shippade är `working-directory: functions` + `npx tsc --noEmit`. Skälet: `-p functions`
      körd från roten använder ROTENS tsc, och en versionsskillnad där är precis den felklass
      BIN-1050 finns för. Villkorets avsikt (`--noEmit`, ingen emit) är uppfylld; dess bokstav är det inte.
- [x] AC-25.4: Rotens `tsconfig.json` orörd, och de två typkollarna hålls som TVÅ separata steg så att en
      läsare ser vilken som föll.
- [x] AC-25.5: Omfånget är dependabot-PR-blindfläcken. `deploy.yml` rörs inte — dess drift-vakt fäller redan
      en push som rör `functions/**`.
- [x] AC-25.6: AC2 förblir `awaiting-run`. Ingen ersättningsevidens får hittas på.
- [x] AC-25.7: Golven (extraktion, korpus ≥40, accepterade ≥10, refuserade ≥10) dupliceras PER regelfunktion
      och körs före varje jämförelse för den funktionen — aldrig en gång mot en hopslagen korpus.
- [x] AC-25.8: `firestore.rules` orörd; ingen assertion i någon av de två testfilerna försvagas eller byts
      mot en lösare jämförelse för att få den andra regelfunktionen att passera.

## Blind rollkritik #26 Information Architect — bunt B (körd FÖRE bygget)

Utfall: **accept-with-conditions**, inga blockerande fynd. Villkoren är bindande acceptanskriterier.

- [x] AC-26.1: Beskedet visas via `toast(DELETION_IN_PROGRESS_MESSAGE)` följt av `return` FÖRE någon
      `saveFailed`-flagga sätts — samma form som filens egen `handleAdd` och `useMarkSeen.ts`. Att i stället
      rendera meddelandet inne i `SaveError` är INTE en likvärdig stavning: `SaveError`s egen definition i
      filen är "samma knapp är återförsöket", vilket motsäger en vägran som aldrig kan lyckas.
- [x] AC-26.2: `useToast` kopplas in i BÅDA scopen — varken `OnboardingFlow` (för `finish`) eller
      `StepProviders` anropar den i dag.
- [x] AC-26.3: Kontrolltesten hävdar att ett vanligt fel fortfarande renderar `SaveError`-bannern OCH att
      `saveFailed` aldrig sätts på vägransvägen — inte bara att en toast avfyrades.
- [x] AC-26.4: BIN-1049 byggs mot TRÄDETS tre filer, inte biljettens två. (Rollen mätte om det och kom fram
      till samma tre.)
- [x] AC-26.5: Ingen ny formulering införs — `DELETION_IN_PROGRESS_MESSAGE` är avsiktligt vaktagnostisk och
      är rätt text även på profil-skrivvägen.

## Deviation log

- [discovery] BIN-1049: biljetten säger TVÅ filer med den handskrivna literalen; `git grep -n
  "binge/deletion-in-progress" -- src` ger TRE (`ReconsentGate.test.tsx` är den tredje). Byggt mot
  trädet. #26 mätte om det oberoende och kom fram till samma tre.
- [deviation] BIN-1049 AC14: `toContain('raderas')` finns på två ställen, men bara det ena skärps —
  `ReconsentGate` visar en annan text med flit. Se AC14 ovan.
- [deviation] BIN-1048: valde biljettens alternativ 2 (pröva båda regelfunktionerna) framför alternativ 1
  (en mening om beroendet). En mening kan inte motsägas av en körning.
- [discovery] BIN-1048: `describe.each([])` registrerar noll test och rapporteras som pass, så en tömd
  eller halverad `GUARD_FUNCTIONS` hade tystat hela filen utan att fälla något. Lade ett rosterkrav
  UTANFÖR loopen som härleder namnen ur `firestore.rules` själv. Muteringsprövat: en halverad roster
  fäller det.
- [deviation] **Routningen för bunt A var fel, och det upptäcktes först av push-grinden.**
  Routern kördes aldrig om när BIN-790 lämnade urvalet, så #25 kritiserade i stället för #4.
  Rättat: #4:s kritik kördes före commit; villkoren står som AC-4.1–AC-4.4. De två kommandona som
  visar skillnaden står i routningsavsnittet — skriv ingen mening om VILKEN fil som flyttar
  panelen, kombinationerna svarar olika. BIN-766 skrev regeln bara för en VIDGAD filuppsättning;
  en krympt ogiltigförklarar routningen lika mycket.
- [deviation] AC-25.3 shippade i annan FORM än villkorets ordalydelse, med flit. Se AC-25.3 ovan.
- [discovery] Två meningar gjordes falska av bunten: `.github/dependabot.yml`s
  typescript-kommentar och `.claude/rules/deployment.md`s workflow-mening sa båda att ingenting
  typkollar `functions/`. Båda strukna, inte omformulerade — och båda filerna ingår därmed i
  commiten. Hittade av helhetsgranskningen.
