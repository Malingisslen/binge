# BIN-917 + BIN-919 — 2026-08-18

Vald av Malin i ett `--pick`-pass. Båda är verifierat trasiga vid HEAD (`6d157c5`), båda
routar `medium`, och båda kritikerna är **körda före första Edit/Write** — det är precis den
regel BIN-917 finns för att laga, så den gäller den här körningen först av alla.

| Biljett | Router (rå, körd på den FAKTISKA filuppsättningen) | Kritik | Utfall |
| -- | -- | -- | -- |
| BIN-919 | `tier: medium`, `reasonCode: owned`, `panel: [25]` | #25 Engineering Manager / Release Manager | SUPPORT WITH CONDITIONS |
| BIN-917 | `tier: medium`, `reasonCode: unmapped-code`, `panel: [14]` | #14 Software Architect | SUPPORT WITH CONDITIONS |

Ingen tier ärvd från en plan, en biljettkommentar eller en tidigare körning (BIN-787/788).
Båda kritikerna körde sina egna mätningar och #25 reproducerade urvalspassets siffror exakt.

**Basläge, mätt före första ändring:**

* `git status --porcelain` → tomt.
* `npm test` → 256 filer, 4167 passerade, 4 skippade, exit 0.
* `node docs/org/metrics/check_events.mjs` → exit 0, `4 claim(s) checked — 0 evidenced, 4 retired by a correction, 1 grandfathered`.
* `node scripts/check-workflow-map.mjs` → OK, 100 nodes, 31 flows, coverage 76/76.

---

## Vad som INTE byggs, och varför — läs det här före allt annat

BIN-917 har fyra kriterier. **Två av dem kan inte ge en diff i det här repot, och ett tredje
kan det inte heller — vilket biljetten ännu inte visste.**

* **Kriterium 2** (kapacitetsregeln ska bo i sprintens URVAL) — urvalsmotorn ligger under
  `C:/claude-plugins`, utanför det här git-trädet. Biljetten säger själv detta.
* **Kriterium 3** (en uttagen biljett bär ett skrivet skäl) — samma motor, samma repo.
* **Kriterium 4** (en batch får inte nå COMMITTERAREN utan en `events.jsonl`-rad) — **BYGGT.
  Se avvikelseloggen längst ned.** Planen sa först att det var omöjligt här, på två prober som
  båda var sanna (`ls .husky` tomt, inget `precommit` i package.json) och en slutsats som var
  falsk: `lefthook.yml` ÄR repots commit-tidsmekanism och har legat här sedan 2026-08-08.
  Kriteriet uppfylls nu av ett `commit-msg`-block som kör modulens `--message`-läge.

Kontrollen har därför TVÅ lägen, och skillnaden mellan dem måste sägas rakt ut varje gång:

* `--message` — **commit-tid.** Bedömer ämnesraden på committen som håller på att skrivas och
  vägrar den. Det är kriterium 4 ordagrant, och det är vad `commit-msg`-hooken kör.
* utan flagga — **historik.** Går igenom varje gjord commit och kör under `npm test`, alltså
  grindar den DEPLOYEN. Backstop för allt som slank in innan hooken fanns, eller med
  `LEFTHOOK=0`.

Det historiska läget ensamt hade INTE uppfyllt kriterium 4, och den första versionen av den
här planen påstod att det var det bästa som gick att göra. **Ingenstans får det påstås att en
mekanism uppfyller ett krav den inte uppfyller** — det är fortfarande regeln; den gällde bara
åt andra hållet än jag trodde.

---

## Batch 1 — BIN-919: `package.json` når noll blockerande granskare

### Vad som är fel

Routern kallar `package.json` KOD (`docs/org/route.mjs:173`, `CODE_ROOT_FILES`) och routar
den `medium` / `unmapped-code`. Ingen `reviewGates`-post matchar den. Ett beroendebyte, en
scriptändring eller ett Next-versionslyft kan alltså committas utan en enda granskare.
Symmetrikollen ser det inte: regel A1 filtrerar på `reasonCode === 'owned' || 'high-stakes'`,
och `unmapped-code` är ingendera. Kollen skriver ut det som "Known blind spot 1" — den enda
platsen det stod.

### Mätning (kört av urvalspasset OCH oberoende reproducerat av #25)

```
TRACKED total: 1003
kodvägar: 859   medium/owned 556   medium/unmapped-code 294   top/high-stakes 9
A1 som den står idag (owned|high-stakes):  0 offenders
A1 nycklad på tier !== 'skip':             1 offender — package.json
unmapped-code: 294 totalt, 293 har redan en grind, 1 har ingen — package.json
```

Ombyggnaden av A1 kostar alltså **noll** nya röda fall utöver den fil biljetten handlar om.

### Acceptanskriterier (biljettens tre + #25:s sex villkor, alla bindande)

- [x] **A1.** `^package\.json$` läggs till i `binge-integration-reviewer`s `patterns`.
      **Rot-ankrat** — får inte också matcha `functions/package.json` eller någon nästlad
      `package.json`. *(#25 must-have 1)* *(kind: diff)*
- [x] **A2.** Bevis: `blockingGates('package.json')` är icke-tom OCH
      `blockingGates('functions/package.json')` är oförändrat `['binge-security-reviewer']`.
      Körs och klistras in. *(#25 must-have 1)* *(kind: diff)*
- [x] **A3.** #25 namnges som ägare av `package.json` i `docs/role-responsibilities.md` §25 —
      **tillagt på den BEFINTLIGA "Dependabot grouping + framework upgrades"-punktens
      pilrad**, som redan bär `.github/dependabot.yml`. Ingen ny punkt: det är samma sak.
      `docs/org/ownership-map.json` regenereras med `node docs/org/gen-ownership-map.mjs`.
      *(#25 must-have 2)* *(kind: diff)*
- [x] **A4.** Bevis: `node docs/org/route.mjs package.json` svarar `reasonCode: "owned"`,
      `panel: [25]` — inte `unmapped-code` / `[14]`. *(#25 must-have 2)* *(kind: diff)*
- [x] **A5.** En daterad `_note9` på integrationsgrindens post säger VARFÖR `package.json`
      går till integration och inte till security, och tar uttryckligen upp att
      `functions/package.json` redan når `binge-security-reviewer` — men bara **av en
      slump**, via prefixet `^functions/`, inte via ett beslut om leveranskedjan.
      Inkonsekvensen får inte shippas outtalad. *(#25 must-have 3)* *(kind: diff)*
- [x] **A6.** A1 nycklas om till `tier !== 'skip'`. *(#25 should-have 1, uttryckligen
      stödd)* *(kind: diff)*
- [x] **A7.** Ett GOLV som gör den vidgade regeln icke-vakuös: antalet kodvägar med
      `reasonCode === 'unmapped-code'` assertas `>= 230` (uppmätt: 295; golvet var 100 i en
      runda, vilket granskaren korrekt kallade slappare än de golv commiten själv skärper). Utan det
      passerar A1 tyst om `route.mjs` någonsin slutar avge `unmapped-code`.
      *(#25 must-have 4 — spärrhake-behöver-golv, BIN-838/823/850)* *(kind: diff)*
- [x] **A8.** Både "Known blind spot 1" OCH A1:s egen beskrivning i filhuvudet skrivs om.
      Huvudet säger idag ordagrant "that is reasonCode `owned` AND `high-stakes`" — den
      meningen blir falsk i samma stund A1 nycklas om. *(#25 must-have 6, biljettens
      kriterium 3)* *(kind: diff)*
- [x] **A9.** Efter ändringen: censusen körs om och visar **0 offenders under BÅDA
      nycklingarna**, och `npx vitest run docs/org/gate-symmetry.test.mjs` är grön.
      *(#25 must-have 5)* *(kind: diff)*
- [x] **A10.** De två slappa tomhetsgolven i samma fil skärps. Uppmätt av #25:s
      RETROAKTIVA kritik av `851696d` (batch 2:s arbete, men fyndet ligger i den här filen):
      `tier !== 'skip' >= 400` mot verkliga **883** (golvet är 45 %) och
      `gates.length > 0 >= 400` mot verkliga **875** (46 %). Ett golv på under halva
      värdet fångar inte en regression som halverar routerns utdata — precis den klass
      BIN-926 är filad om. Höjs till 700. De tre övriga golven är redan snäva (1003/800,
      17/15, 9/7) och lämnas. *(kind: diff)*

### Vad Malin behöver veta (#25 should-have 1, ordagrant vidarefört)

A1-omnycklingen är en beteendeändring på en rad: en **ny** rotfil av config-typ
(`.nvmrc`, `renovate.json`, en TOML-fil) som varken ägs eller grindas kommer nu att fälla
`npm test` tills någon ger den en ägare eller en grind. Det är bromsen som är meningen — men
den ska inte komma som en överraskning nästa gång något sådant läggs till.

### Öppen fråga som EN roll inte kan avgöra (#25 should-have 2)

`ROLE_WORLD_MODEL.md:712` listar #4 Säkerhetsarkitekt som medintressent för
Dependabot/beroendebevakning vid sidan av #25. Routern satte bara `[25]`. Om svaret på A5 är
"security borde också grinda `package.json`" är det en andra-roll-fråga som den här
enrollskritiken inte får avgöra ensam. **Lyfts till Malin i slutrapporten, byggs inte här.**

---

## Batch 2 — BIN-917: de två uteblivna kritikerna, och tystnaden efter dem

### Acceptanskriterier

- [x] **B1.** Kritiken från #19 Customer Support körs retroaktivt på `049f21b`:s diff av
      `src/components/settings/DeleteAccountSection.test.tsx`. *(biljettens kriterium 1)*
      *(kind: diff)*
- [x] **B2.** Kritiken från #25 Engineering Manager körs retroaktivt på `851696d`:s fyra
      filer. *(biljettens kriterium 1)* *(kind: diff)*
- [x] **B3.** Båda utfallen skrivs till `docs/org/metrics/events.jsonl` med `ran: true`,
      via `node docs/org/metrics/log_event.mjs review '{…}'`. Varje rad bär
      `commit_sha` (`049f21b` / `851696d`) — deras prosa säger "shipped", vilket
      `claimsReachedMain` fångar, så en rad utan sha vore en ny obevisad utsaga i samma fil.
      *(kind: diff)*
- [x] **B4.** Varje rad bär ett `timing`-fält. Ingenting i dagens schema skiljer "kritiken
      kördes innan koden fanns" från "kritiken kördes efteråt mot redan mergad kod".
      **RÄTTELSE:** planen sa först att `/org-retro` poängsätter på fältet. Det är falskt —
      utfallsgranskaren grep:ade hela `role-org`-pluginen efter `timing`, `retroactive` och
      `pre-build` och fick noll träffar, och skillens dokumenterade fältlista nämner det
      inte. Fältet läses av ingenting idag. Det är fortfarande rätt att skriva — utan det är
      de sju raderna omöjliga att skilja från sju granskningar som löste ut i tid — men
      motivet är framtida mätbarhet, inte en befintlig konsument. Fältet är nu dokumenterat
      i `docs/org/metrics/README.md`:s schematabell, vilket är precis vad den tabellen finns
      för. *(#14 must-have 7)* *(kind: diff)*
- [x] **B5.** De två nya raderna får inte kollidera med eller dubblera de fyra
      `correction`-rader som redan ligger i filen från `9d53349`. Kontrolleras före
      skrivning. *(#14 must-have 7)* *(kind: diff)*
- [x] **B6.** `node docs/org/metrics/check_events.mjs` är fortfarande grön efteråt, och
      `evidenced` har gått från 0 till **5**. *(Planen sa först "till 2" — det var en gissning
      skriven innan raderna fanns. Fem av de sju nya raderna bär `commit_sha` och gör en
      nå-main-utsaga (BIN-908, 880, 906, 565, 911); de två sista är förbygges-rader som
      ingenting påstår om main. Kört: `9 claim(s) checked — 5 evidenced, 4 retired by a
      correction, 1 grandfathered`.)* *(kind: diff)*

### Täckningskontrollen — kriterium 4:s svagare syskon

- [x] **B7.** Byggs som en **egen modul**, `docs/org/metrics/check_review_coverage.mjs` +
      `check_review_coverage.test.mjs`. Inte inbakad i `check_events.mjs`: den filens huvud
      är snävt formulerat kring en helt annan regel (utsagor som saknar bevis, inte
      tystnad), och att bulta in en andra regel där är precis den huvud-glidning filen
      själv varnar för. `historyIsAvailable`/`gitCommitDate` **importeras** från
      `check_events.mjs`, dupliceras inte. *(#14 must-have 6)* *(kind: diff)*
- [x] **B8.** Nämnaren: commits vars ämnesrad är `feat(...)` eller `fix(...)` OCH namnger ett
      `BIN-\d+`. **Endast ämnesraden**, aldrig meddelandekroppen — `6d157c5` är en ren
      docs-rättelse som namnger BIN-565 bara i kroppen, och en kropps-läsande regel skulle
      kräva en rad för varje uppföljande kommentarsfix. `docs`/`chore`/`test` kräver ingen
      rad. *(#14 must-have 2)* *(kind: diff)*
- [x] **B9.** En `feat`/`fix`-commit UTAN biljett-id i ämnesraden klassas som **överträdelse**,
      inte som tyst hoppad. En ospårbar feat/fix är själva tystnaden regeln finns för.
      (Uppmätt: 8 sådana av 55 feat/fix sedan 2026-08-01 UTC; 12 av 74 under den vidgade nämnaren.) *(#14 must-have 2)*
      *(kind: diff)*
- [x] **B10.** Egen epok, skild från `RULE_EFFECTIVE_FROM`. Att återanvända 2026-08-16 ger
      **8 kvalificerade commits, 4 utan rad** — alltså rött på dag ett (planen sa först
      "~46 historiska feat/fix", vilket var fel epok-fönster; modulens egen tabell har
      rätt siffror). Epoken pinnas till den
      commit som shippar regeln eller senare, och antalet grandfathered SKRIVS UT vid varje
      körning. *(#14 must-have 3)* *(kind: diff)*
- [x] **B11.** `historyIsAvailable()` ärvs villkorslöst. `ci.yml` och `preview.yml` checkar ut
      på djup 1 medan `deploy.yml` kör `fetch-depth: 0` — en `git log`-vandring i en grund
      checkout ser i praktiken en commit. I det läget rapporteras `unverified`, aldrig tyst
      grönt och aldrig tyst rött. *(#14 must-have 4)* *(kind: diff)*
- [x] **B12.** Nollgolv: matchar vandringen NOLL kvalificerade commits i fönstret är det i sig
      en överträdelse, inte en ren körning. Identiskt med `claimsChecked === 0` i syskonet.
      *(#14 must-have 5, BIN-838/823/850)* *(kind: diff)*
- [x] **B13.** Varje körning skriver ut sin egen omfattningsrad i syskonets stil — N commits
      undersökta, M krävde en rad, K hittade, J grandfathered — så att "ren" aldrig kan
      läsas som "allt är granskat". *(#14 should-have 1)* *(kind: diff)*
- [x] **B14 (OMSKRIVET — gäller nu HISTORIKLÄGET; commit-läget grindar committen).** Modulens filhuvud, commit-meddelandet och biljettkommentaren säger alla rakt ut
      att den grindar **deployen, inte committen**, och att kod utan granskningsrad
      fortfarande når `main`. *(#14 must-have 1 — den enskilt viktigaste raden i planen)*
      *(kind: diff)*
- [x] **B15.** Ett test som driver hela beslutsträdet mot fixturer, inte bara det gröna
      fallet: kvalificerad commit med rad, kvalificerad utan rad, docs/chore som inte
      kräver rad, feat/fix utan biljett-id, grund checkout, och nollgolvet.
      *(kind: diff)*

### Vad som INTE ingår, uttryckligen

Kriterium 2 och 3. **Inte kriterium 4** — den raden stod kvar här efter att kriterium 4 hade
byggts, och var därmed den sista platsen i planen som fortfarande sa emot avsnittet högst upp
och avvikelseloggen. Integrationsgranskningen hittade den. Att en rättelse når fyra av fem
ställen är exakt hur ett falskt påstående överlever.

De två som står kvar väntar på en session i `C:/claude-plugins` — och enligt lärdomen från
2026-08-03 får det repot **aldrig** redigeras från en session som startar subagenter, vilket
den här gör.

---

## Behöver dig (Tier D)

* **Kör `npx lefthook install` en gång på varje maskin du committar från.** Den nya
  `commit-msg`-hooken är den mekanism som uppfyller BIN-917:s kriterium 4. Repot har inget
  `prepare`-skript, så en NY hooktyp installeras inte av sig själv — konfigurationen finns,
  men grinden är oskarp tills kommandot körts. Kört här. Det är exakt BIN-849:s felform (ett
  värde inkopplat i konfigurationen men aldrig i bygget), och därför står det här och inte
  bara i en kodkommentar.
* **Sprintmotorn kommer att bli NEKAD av den nya hooken vid sina batch-commitar.** Grinden
  läser INDEXET (avsiktligt — annars kan en oscenad rad släppa igenom en commit som sedan
  fäller deployen), medan motorn i `C:/claude-plugins` skriver sina rader **oscenade** och
  sedan stagear per uttrycklig sökväg. Dess `git add -A`-väg är oskadd; batch-vägen är det
  inte. Felmeddelandet säger rakt ut vad som ska göras ("STAGE it"), så det blir högljutt och
  inte tyst — men motorn kan inte redigeras från den här sessionen, och det är en ändring du
  vill veta om innan nästa obevakade körning. Hör ihop med kriterium 2 och 3, som ändå väntar
  på ett pass i det repot.
* **Linear-arbetsytan är full.** `create_issue` svarade "You've exceeded the free issue
  limit" i post-sprinten 2026-08-16. Varje uppföljning nedan skrivs därför som en fullständig
  kommentar på närmaste öppna ärende i stället för som egen biljett — och taket är något bara
  du kan åtgärda.
* **Frågan om #4 Säkerhetsarkitekt på `package.json`** (se batch 1). En enrollskritik får
  inte avgöra den.

## Uppföljningar att fila som kommentarer (Linear-taket)

1. Rot-`package-lock.json` är inte kod för routern (`isCodePath` false) medan
   `functions/package-lock.json` är det och redan når security. Osynligt för
   symmetrikollen under BÅDA A1-nycklingarna, eftersom båda kräver `isCodePath` först.
   Ett router-sidigt hål, inte något BIN-919 rör. *(#25 out-of-scope 1)*
2. Kodändrande commits sedan 2026-08-01 utan biljett-id i ämnesraden: **12** under den
   levererade sjutypsnämnaren (8 om man bara räknar `feat`/`fix`, av 55 sådana). De kommer
   **inte** att flaggas — alla ligger före epoken 2026-08-18 och är grandfathered; den
   levande körningen rapporterar 2 kvalificerade och 0 överträdelser. Planen sa först att de
   skulle flaggas varje körning, vilket var fel åt båda hållen: fel antal och fel utfall.
   *(#14 should-have 2, rättad av integrationsgranskningen)*

## Deviation log

- [discovery] BIN-917: planen antog att kriterium 4 kunde byggas här i någon form.
  #14:s kritik visade att det inte kan det ens i princip — repot har ingen commit-tidsmekanism
  (`ls .husky` tomt, inget `precommit` i `package.json`). Konservativt val: bygg det svagare
  syskonet, märk det som sådant på fyra ställen (modulhuvud, route.mjs-kommentar, plan,
  biljettkommentar), och dra ut kriterium 4 tillsammans med 2 och 3.
- [deviation] #14:s must-have 5 sa att golvet ska fälla när NOLL kvalificerade commits hittas,
  som syskonet gör. Byggt annorlunda, med skälet i modulens egen kommentar: epoken är i dag,
  så det finns per konstruktion inga commits efter den när regeln landar — en bokstavlig
  implementation hade shippat RÖD på dag ett och fällt just den commit som inför regeln.
  Golvet ligger därför på VANDRINGEN (en trasig läsning), och antalet kvalificerade commits
  redovisas i utskriften i stället. Båda halvorna är pinnade i testet så ingen "rättar"
  tillbaka det.
- [discovery] Den nya täckningskontrollen hittade två verkliga luckor på sin FÖRSTA körning:
  `634d62e` (BIN-565) och `2e5993a` (BIN-911) shippade utan granskningsrader. Kritikerna hade
  KÖRTS — sprintplanen vid `6d157c5` redovisar #18/#27 och #19/#5 med domar och villkor — de
  loggades bara aldrig. Backfillade som två rader märkta `pre-build-logged-late`. Inte i planen.
- [deviation] A10 tillagt efter planen skrevs: #25:s RETROAKTIVA kritik (batch 2:s arbete) hittade
  ett blockerande fynd som bor i batch 1:s fil. Två av fem tomhetsgolv låg på 45–46 % av sina
  verkliga värden. Konservativt val: höj dem i samma pass, eftersom filen ändå var öppen och ett
  känt trasigt golv i en fil man just härdat är sämre än att fila det. Stänger halva BIN-926;
  den andra halvan (kollen speglar grinden för hand) står kvar.
- [discovery] Probe mot A1-omnycklingen motsade min egen planformulering. Att ta bort den nya
  grindraden fäller `package.json` under BÅDA nycklingarna — ägarhalvan ensam hade räckt för
  just den filen. Omnycklingens värde ligger i KLASSEN: med verktygsalternationen borttagen ser
  den gamla regeln 2 filer och den nya 7. Både mätningen och rättelsen står i filhuvudet, så
  meningen "omnycklingen fångar package.json" inte kan överleva som en obevisad sammanfattning.
- [deviation] **Utfallsgranskaren underkände batch 1 och hade rätt på tre punkter.** Alla
  åtgärdade, ingen krävde omtag: (a) A8 var inte uppfylld — testets NAMN och felmeddelande
  beskrev fortfarande den gamla nyckeln ("every owned CODE path"), vilket är rakt falskt för
  en `unmapped-code`-överträdare och dessutom utelämnade botemedlet "ge sökvägen en ägare";
  (b) tre tal i kommentarer var mätta FÖRE ändringen och skrivna i presens — "293 av 294 …
  idag" är 295 av 295 på det träd som shippas, och det nya golvet stod som "uppmätt 294" mot
  ett verkligt 295; (c) `_note9` öppnade med "det första hål en kontroll namngav i stället
  för en granskare" — falskt, och exakt den självsmickrande formen `_note8` rättades för en
  not tidigare. Det var BIN-880:s handskrivna "Known blind spot 1"-prosa som namngav det.
- [deviation] **Min egen spärrhake spärrade ingenting, och granskaren bevisade det med en
  mutation.** Testet deklarerade en LOKAL kopia av A1:s predikat och assert:ade mot kopian —
  produktionsregeln rördes aldrig. Med regeln återställd till den gamla nyckeln gick sviten
  9/9 grön medan testets egen kommentar lovade att den skulle bli röd. Fixat genom att bryta
  ut `a1Offenders(verdicts)` och låta både regeln och testet köra DEN. Omprövat: kontroll
  9/9 grön, mutant fäller rätt test med rätt meddelande, återställd och verifierad mot hash
  `6c32b7eb…`. Detta är precis den klass den här commiten finns för att stoppa, en nivå upp.
- [deviation] Golvet för `unmapped-code` höjdes 100 → 230. Granskaren påpekade att 100 var
  34 % av det verkliga värdet (295) — alltså slappare än de två golv samma commit höjer för
  att 45 % är dekoration. Ett golv skrivet mot en regel commiten själv underkänner är inget golv.
- [discovery] Att SKRIVA att en fil inte ägs ägde den. Meningen "lockfilen namnges medvetet
  INTE här — `package-lock.json` är maskingenererad" seatade #25 på `package-lock.json`,
  eftersom generatorn skördar varje backtick-citerad spårad sökväg i en sektion. A2 gick röd
  med "package-lock.json (owned by #25, blocking gate: none)". Fångat av testet, inte av mig.
  Avbacktickad; samma fälla som §25:s nästa punkt redan dokumenterar för kataloger.
- [discovery] **Utfallsgranskaren av batch 2 godkände alla 15 kriterier men hittade ett hål
  som var värre än något kriterium: nämnaren missade halva incidenten.** `OWES_REVIEW` täckte
  bara `feat|fix` — och `049f21b`, den ena av de TVÅ commitar biljettens rubrik handlar om, är
  `test(radering): … (BIN-908)`. Kontrollen hade fångat `851696d` och seglat rakt förbi den
  andra halvan. En kontroll som missar fallet den skrevs för är sämre än ingen. Nämnaren är
  vidgad till `feat|fix|refactor|perf|test|build|ci`. Uppmätt kostnad: NOLL nya kvalificerade
  commits idag (båda varianterna ser samma 2 sedan epoken), 74 i stället för 55 över hela
  augusti — alla grandfathered. Det som medvetet står utanför (`docs`/`chore`/`style`,
  `revert`, och commits utan prefix) står nu skrivet i modulhuvudet som en GRÄNS, inte som en
  fullständighet.
- [deviation] Tre mindre fynd från samma granskning, alla åtgärdade: (a) "66 av 132 är
  docs/chore/test" var 67 vid HEAD. Alla tal är ommätta med metoden utskriven bredvid. (Den
  här raden bar en förklaring till skillnaden — "`--since` läser LOKAL tid" — som senare
  drogs tillbaka som fel; subtraktionen nedan nådde modulen men inte hit förrän sjätte
  granskningsrundan.); (b) `timing`
  var ett nytt schemafält som ingenting läser, och planen motiverade det med att `/org-retro`
  poängsätter på det — falskt, verifierat med grep över hela plugin-katalogen. Fältet är rätt
  att skriva men av ett annat skäl, och är nu dokumenterat i `README.md`:s schematabell;
  (c) `must_haves` räknades på två olika grunder i grannrader (4 = ogjorda villkor för
  BIN-565, 5 = totalen för BIN-911). Enhetligt nu: totalen. Raderna skrevs om från grunden
  i stället för att rättas med `correction`-rader — de hade aldrig committats, så det finns
  ingen post någon sett att korrigera, och append-only skyddar en post, inte ett utkast.
- [deviation] **KRITERIUM 4 BYGGDES ÄNDÅ — hela skälet att dra ut det var falskt.**
  Integrationsgranskningen underkände batchen på detta: `lefthook.yml` ligger spårat i repot
  sedan 2026-08-08, har ett `pre-commit`-block med två levande kommandon, `lefthook` är en
  devDependency och `.git/hooks/pre-commit` är installerad. Mina två prober (`ls .husky`,
  `precommit` i package.json) var båda SANNA och slutsatsen ändå fel. "Jag hittade inte X" och
  "X finns inte" är olika meningar — och att blanda ihop dem inuti fixen för just den klassen
  av fel är så illa det kan bli. Byggt: `--message`-läget i modulen + ett `commit-msg`-block i
  `lefthook.yml`. Prövat på fyra meddelandeformer (godkänd, ogranskad biljett, kod utan
  biljett-id, docs-commit) — rätt utfall på alla fyra. Hooken är installerad här med
  `npx lefthook install`. Kriterium 4 är därmed UPPFYLLT, inte utdraget; kriterium 2 och 3 står
  kvar utanför repot.
- [deviation] A3 kryssades av men byggdes tvärtom mot sin egen formulering. Villkoret sa
  "tillagt på den BEFINTLIGA Dependabot-punktens pilrad. Ingen ny punkt" — det blev en ny
  punkt med egen pilrad. Routningsutfallet är identiskt (`owned`/[25]) och därför är det en
  avvikelse och inte ett fel, men den saknades i den här loggen, vilket granskaren korrekt
  kallade defekten. Skälet den byggdes så: motiveringen blev fem meningar lång, och att klämma
  in den mitt i en befintlig semikolonlista gjorde meningen ogrammatisk (första försöket var
  det, och granskaren fällde även den).
- [deviation] Tre tal till, alla ommätta och alla fel i första versionen: "66 av 132" (ingen
  metod ger 66 — UTC-jämförelsen ger 61 av 135, `TZ=UTC` med bart datum 59 av 132), "109
  oprefixade i historien" (verkligt 129 under modulens egen grammatik — och eftersom en
  granskare mätte 142 och en annan 146 står nu FYRA definitioner med var sitt tal i huvudet i
  stället för ett bart tal), och en mening i `README.md` som den HÄR commiten gjorde falsk ("0
  evidenced … ingen rad bär en commit_sha ännu" — nu 5). Metoden står utskriven bredvid varje
  tal, eftersom metoden ÄR en del av talet. Den här raden har dessutom burit TRE olika
  förklaringar till varför `--since` ger ett annat tal, och två av dem var fel: först "git
  läser lokal tid", sedan "TZ=UTC plus bart datum". Den fjärde versionen räknade upp "de" möjliga
  värdena och utelämnade det värde kommandot faktiskt ger i det här skalet. Lösningen blev
  till slut inte en bättre förklaring: alla tal kommer nu från EN namngiven procedur, och
  `git log --since=…` avfärdas i två meningar som en annan fråga man inte ska jämföra med. En
  kommentar som hela tiden behöver en ny teori beskriver något den inte förstår — och att
  förklara det var aldrig uppgiften.
- [discovery] Jag redigerade `lefthook.yml` — commit-grindsmaskineri som nådde noll granskare
  och saknade ägare. Exakt hålet den här batchen handlar om, en fil bort, upptäckt inuti
  batchen. Både grinden och ägarkartan vidgade i samma commit (#25, samma roll som äger
  reviewGates-rostern).
- [deviation] Två filer utanför planens filuppsättning: `docs/org/route.mjs`
  (`TOOLING_CODE_FILES`) och en andra rad i integrationsgrinden, för den nya modulen. Krävs av
  route.test.mjs:s BIN-874-block — en ny `.mjs` med testsyskon som saknas i listan fäller det —
  och av BIN-830-regeln att de två listorna alltid flyttas i samma commit.

