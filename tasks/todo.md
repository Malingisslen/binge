# BIN-565 + BIN-911 — 2026-08-17

Båda beslutade av Malin 2026-08-16/17. Blast radius kört på de FAKTISKA filuppsättningarna,
inte på biljetternas antaganden — routern satte andra roller än båda biljetterna trodde.

| Biljett | Router | Panel | Bortvalda |
| -- | -- | -- | -- |
| BIN-565 | `medium` / `owned` | **#18 Community Manager** | #10 Performance, #12 Trust & Safety, #24 Monetization, **#27 DBA**, #28 Recommendations |
| BIN-911 | `medium` / `owned` | **#19 Customer Support** | #1 Product Designer, #2 Accessibility, #16 Creative Director, #26 Information Architect |

Båda biljetternas egna beslut namnger DESSUTOM en roll som villkor (#27 för BIN-565:s steg 1,
#5 Juridik för BIN-911:s ordalydelse). Routerns seat och villkorets roll är olika saker och
båda körs — det är inte samma fråga. (Lärdomen från BIN-905/918: planen namngav då fel roller
och lät de två routern VÄLJER BORT kritisera. Här är båda körda med öppna ögon.)

---

## BIN-565 — den gamla extraläsningen av strömningsutbud

### Vad som är fel

`streamingOffers` bytte doc-id från `${tmdbId}` till `${mediaType}_${tmdbId}` (BIN-523), för
att film 123 och serie 123 delade ett dokument. Två läsare faller fortfarande tillbaka på det
gamla id:t när det nya missar:

* `src/hooks/useStreamingOffers.ts:44-51` — varje titelsidvisning. För de ~25 000
  förrenderade publika sidorna vars titel ingen spårar missar BÅDA läsningarna, så sidan
  betalar 2 Firestore-läsningar i stället för 1. En läsning som inte hittar något är ändå
  en debiterad läsning.
* `functions/src/weeklyDigest/index.ts` pass 2 — ~595 läsningar/vecka i stället för ~300 för
  ett 300-titlars bibliotek, per mottagare.

Båda huvudkommentarerna kallar det övergående ("försvinner titel för titel när cron:en skriver
om varje dokument"). Det är sant för spårade titlar och falskt för allt annat.

### #27 DBA:s omprövade dom — BÅDA föreslagna lösningarna underkändes

Frågan återställdes med motargumentet, som biljettens acceptanskriterium 1 kräver. Rollen
**drog tillbaka sin egen tidigare dom** och underkände samtidigt motargumentet:

1. **Arbetsmängd-spärren var fel.** `isIntentTitle` kräver `vill_se`/`mina` — inte `sedd`. I
   samma stund en användare markerar en titel som sedd lämnar den `readWorkSet()`s
   collectionGroup-scan, och cron:en (~9 titlar/dygn) besöker den aldrig mer. Legacy-raderingen
   sker bara som sidoeffekt av en uppdateringsskrivning. **Varje avslutad tittning** kan alltså
   lämna ett gammalt dokument som aldrig städas. Rollens instinkt (det finns en verklig
   population extraläsningen skyddar) var rätt; "i arbetsmängden" var fel mått på den.
2. **Motargumentet håller inte heller.** "Titlar utanför arbetsmängden har inget gammalt
   dokument att förlora" är sant för titlar som ALDRIG spårats — falskt för titlar som spårats
   och sedan lämnat. Ett daterat datum konvergerar därför aldrig: populationen städas av
   slumpen, inte av tid, och de ostädade är permanenta.
3. **Tredje formen, som ingen av oss föreslog: avsluta flytten i stället för att lappa
   läsningen.** En engångsflytt som räknar upp kvarvarande bare-id-dokument, skriver om dem på
   sitt namngivna id med samma mediaType-grind som redan är beprövad på `index.ts:250`, och
   raderar det gamla. **Ren Firestore-kopiering — inga MOTN-anrop**, alltså gratis mot
   vendor-taket och billigt mot 25 kr/mån. Sedan tas extraläsningen bort HELT, inte spärras.

**Malins beslut 2026-08-17:** bygg flytten direkt. Jag flaggade att det rör skarpa data och att
arbetssättet normalt vill ha en skriven plan först; hon valde att bygga ändå. Planen skrivs
ändå, för granskarna behöver den.

### #18 Community Managers villkor (routerns seat)

Rollen blockerade inte, men mätte vad felet SER UT SOM och det ändrar riskbilden:

* **Felet syns inte.** Provider-logotyperna kommer från TMDB, inte från `streamingOffers`, så
  raden renderas oförändrad. Det som tyst försvinner är `CheapestPathVerdict` — "Billigast:
  hyr för X kr" — som returnerar `null` rakt av, plus "försvinner snart"-chippen och
  affiliate-länken. **Ingen anmäler en sida som ser hel ut.**
* **De drabbade skevar mot de bästa användarna:** ett legacy-dokument betyder per definition
  att titeln spårades FÖRE omläggningen, alltså äldre och större bibliotek.
* **Veckobrevet är värre:** `hasDigestContent` kan avgöra att det inte finns något att skicka.
  Ett mejl som tyst uteblir upplevs aldrig som en saknad — någon kan missa ett verkligt
  "försvinner snart"-fönster utan att märka något alls.
* Ingen ny UI-komponent begärs. En "kontrollerar tillgänglighet"-indikator vore oärlig — inget
  kontrolleras, cron:en har bara inte hunnit.

- [ ] **V1 (#18).** Extraläsningen får INTE tas bort förrän flytten är bevisat klar. Båda
      läsarna betalar sin kostnad bara för titlar någon spårar. (diff)
- [ ] **V2 (#18).** Om veckobrevets pass 2 påverkas: en tyst digest för att data tappats får
      inte vara samma kodväg som en tyst digest för att det inte finns något att rapportera. (diff)

### #27:s bindande acceptanskriterier

- [x] **V3.** En engångsflytt som skriver om varje kvarvarande bare-id-dokument på sitt
      namngivna id, mediaType-grindat. Inga MOTN-anrop. (diff)
- [ ] **V4.** Bevisa med en UTTÖMMANDE fråga att noll bare-id-dokument återstår — inte ett
      stickprov. Samlingen är liten nog för en opaginerad `.get()`, samma form `readExisting()`
      redan gör dagligen. (run)
- [ ] **V5.** FÖRST därefter tas extraläsningen bort i `useStreamingOffers.ts:44-51` OCH
      `weeklyDigest/index.ts` pass 2 — båda läsarna tillsammans. (diff)
- [x] **V6.** Bygg INTE en arbetsmängd-spärr och INTE ett daterat datum. Båda är osunda. (diff)
- [x] **V7.** Ett stående regressionstest: inget bare-id-dokument får finnas i
      `streamingOffers`, så en framtida skrivare som återinför det fångas strukturellt i
      stället för av nästa tysta förlust. (diff)

### Hur flytten körs — mitt designval, att pröva vid granskningen

**Som en fas i den befintliga cron:en, inte som ett handkört skript.** Skäl: `readExisting()`
gör redan en opaginerad scan av hela samlingen var 24:e timme, så uppräkningen är gratis; det
kräver ingen tjänstekonto-nyckel och ingen manuell Tier D-åtgärd av Malin; och den
självterminerar — när inga bare-id-dokument finns kvar gör fasen ingenting. Skrivningarna är
begränsade per körning så en stor population inte spränger körtiden.

Logiken läggs i en ren, admin-fri modul med injicerad port (`runSweep.ts`-precedenten,
BIN-566), så den kan testas utan firebase-admin. Porten implementeras i `index.ts`.

**Detta är en avvikelse värd att säga rakt ut:** en engångsflytt inne i ett schemalagt jobb är
mindre synlig än ett skript någon kör. Motvikten är att den är läsbar, testad, självterminerande
och att alternativet kräver en nyckel Malin måste skapa.

---

## BIN-911 — sjudygnslöftet på limbo-skärmen

### Vad som är fel

`src/components/layout/DeletionLimbo.tsx:92-97` lovar att kontot städas bort automatiskt inom
sju dygn om profilen redan hunnit tas bort. Sant på enheten där raderingen startade. **Falskt
för gott** för den som senare laddar en inloggad sida på en enhet UTAN markören:
`ensureUserProfile` återskapar `users/{uid}`, kontot lämnar sopningens urval permanent, och de
sju dygnen inträffar aldrig. Den populationen accepterades 2026-08-15 (ADR 0022) och lagas inte.

**Låst text:** rubriken, ingressen och sjudygnsstycket är juridiskt godkända, pinnade ordagrant
av BIN-877:s acceptans och BIN-813 villkor 4, och asserterade i testet. Lösningen är ett
TILLÄGG.

### Malins beslut och #19:s rättelse av verbet

Malin valde 2026-08-16 en **handlingsrad** framför granskarens förbehåll om enheter, med skälet
att skärmen ska vara lugnande och kort.

#19 stödjer formen men **rättar vilken handling det ska vara**, och det är en riktig rättelse:

* **"Om du ångrar dig" är fel verb.** Det antyder en ångra-knapp som inte finns
  (`DeletionLimbo.tsx:28-31`, "deliberately no cancel"). För den som vill BEHÅLLA kontot finns
  ingen självbetjäningsväg alls — `docs/RUNBOOK.md` §5f visar att det är ett
  supportmedierat fall-till-fall-beslut som bara kan rädda det kaskaden inte hunnit ta.
* **Den ärliga handlingen är en annan:** den här skärmen är den enda som ERBJUDER att
  slutföra en redan påbörjad radering, och knappen fungerar ÄVEN efter att en annan enhet
  återskapat profilen —
  *(Rättat 2026-08-17: den här raden sa först "fungerar bara från enheten raderingen
  startades på". Det tog i — raderingen kan också slutföras genom att STARTA OM den från
  inställningssidan på den andra enheten, som anropar samma `deleteAccount()`. Den shippade
  kommentaren i koden bär samma rättelse; planen får inte lära ut det den tar tillbaka.)*
  planen byggs om från Firestore vid varje försök och raderingar mot redan borta dokument är
  no-ops (`docs/RUNBOOK.md:310-313`, `collectDeletionRefs`). Det är en verklig, kodverifierad
  utväg som når ADR 0022-populationen så länge de har kvar den enheten.
* **Rollens ärlighet om räckvidden:** den skadade användaren står inte på skärmen när skadan
  sker. Ingen ordalydelse här når hen i det ögonblicket. Men alla som får ett kaskadfel ser
  skärmen i samma sittning, före de rört någon annan enhet — och det är en meningsfull del av
  populationen, om än inte hela.

- [x] **V8 (#19).** Innehållet är en INSTRUKTION att återvända till ursprungsenheten och trycka
      "Slutför raderingen" — inte ett löfte om ångra. (diff)
- [x] **V9 (#19).** Ingen tredje paragraf. Skärmen har redan två textblock efter den låsta.
      Landa det som hjälptext intill knappen, eller inuti den befintliga kontaktparagrafen
      (`:114-118`, BIN-877:s tillägg, INTE juridiskt låst). (diff)
- [ ] **V10 (#19).** Om någon formulering ändå bjuder in till "mejla för att ångra" måste ett
      färdigt supportsvar skrivas samtidigt, som erkänner att delvis eller ingen återställning
      är vanligt. Det är NYTT arbete, inte befintlig täckning i RUNBOOK §5f.
- [x] **V11.** Den låsta texten `:92-97` rörs inte. Testet får ETT nytt påstående för den nya
      texten, inte en omskrivning av befintliga.
- [x] **V12.** #5 Juridik granskar den FAKTISKA ordalydelsen efter att den är skriven. Malins
      beslut gäller riktningen, inte orden.

---

## Öppna frågor

Inga arkitekturändrande okändheter. Antaganden:

1. Att flytten hör hemma i cron:en och inte i ett skript — motiverat ovan, prövas vid
   granskningen. Om granskaren vill ha ett skript i stället är det en form-fråga, inte en
   logik-fråga: den rena modulen flyttas oförändrad.
2. Att `priceHistory` har samma permanenta dropout-lucka (#27:s "hittade också") — INTE i
   omfånget här, filas separat.
3. Att extraläsningen tas bort i en SENARE commit än flytten, efter att V4 bevisat noll
   kvarvarande. Att göra båda i en commit vore att lita på att flytten fungerade utan att ha
   sett den köra mot skarpa data.

## Gates

- [x] Blind kritik: #18 (BIN-565), #19 (BIN-911), plus #27 på BIN-565:s designfråga
- [x] #5 Juridik på BIN-911:s ordalydelse — GODKÄND 2026-08-17. Rollen verifierade båda
      faktapåståendena mot koden, fann dem förenliga med den låsta paragrafen (som är
      VILLKORAD på att profilen förblir borta), och sa att tystnad vore den SÄMRE juridiska
      hållningen här, inte den säkrare. En språklig precisering togs: "på ett annat ställe"
      → "på en annan enhet".
- [ ] `npm run typecheck`, `npx eslint`, `npm test`
- [ ] Fyra granskare: code, security, test, integration
- [ ] Commit i TVÅ commits: BIN-911:s UI-rad först, BIN-565:s migrering sedan. En revert av
      databasflytten får inte tyst ta med sig raderingstexten (lessons-digest, e2cf608).
- [ ] **Deploy: `deploy.yml` KOMMER att faila den här pushen.** Dess vaktpost kör
      `git diff --name-only $BEFORE $GITHUB_SHA -- firestore.rules 'functions/**'` över hela
      push-intervallet och `exit 1`:ar. Eftersom båda commitarna går i samma push deployas
      då INGENTING — inte heller BIN-911:s hosting-ändring. Rätt ordning, dokumenterad i
      `docs/analysis/EXTERNAL_ACTIONS.md`: pusha, kör sedan `firebase deploy --only
      functions` för hand, och skicka hosting via `workflow_dispatch` som hoppar över
      vaktposten. (Integrationsgranskningen 2026-08-17 — den här raden saknades i planen.)
- [ ] Purga Cloudflare efter att hosting gått igenom.
- [ ] Utvecklingskartan i en EGEN commit efteråt: `.claude/state/workflow-map-stale.json` är
      stämplad med alla fem ändrade funktionsfiler, och `streamingOffersRefresh`-flödet
      beskriver inte migreringsfasen. Lintern är grön, så det blockerar varken CI eller
      deploy — men flaggan ska arbetas, och kartändringen får aldrig åka med kod.
- [ ] Linear: BIN-565 och BIN-911 → Done.
