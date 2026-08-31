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
→ `medium`, panel `[14]`, `reasonCode: unmapped-code` (filen saknar ägare —
`unownedCode` är icke-tom).

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
