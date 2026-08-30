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

## BIN-590 — lösenordskravet gäller bara i formuläret

**Tier A/D — mekanismvalet avgör.** Router: `medium`, panel `[19]`. Kritiken
körd; inga blockeringar.

### Öppen fråga före bygget

Kravet kan bara hålla serversidigt på ett av två sätt:

- **(a) Blockeringsfunktion (`beforeUserCreated`).** ~30 rader, exakt rätt
  ställe. Kräver att **Identity Platform slås på i konsolen** — Malins åtgärd,
  och ett byte av produkttjänst under Auth.
- **(b) Anropbar funktion + custom token.** Ingen konsolätgärd, men skriver om
  hela registreringsflödet genom `AuthContext` — betydligt större, och ändrar
  inloggningens form.

Kontrollerat 2026-08-30: `grep -rn "identity\|beforeUserCreated\|beforeCreate"
functions/src firebase.json` ger noll träffar bland kod — ingen
blockeringsfunktion finns i dag, så ingetdera är redan påslaget.

Frågan ställs till Malin. Fram till svar byggs biljetten inte.

### Acceptanskriterier (gäller vilket mekanismval som än vinner)

1. **(#19:1)** Ett serversidigt avslag mappar till ett svenskt meddelande som
   redan finns i `passwordStrength.ts` — inte till formulärets catch-all, som i
   dag skyller på nätverket.
2. **(#19:2)** Serverkollen återanvänder `COMMON_PASSWORDS`/`scorePassword`, inte
   en andra handskriven lista.
3. **(#19:3)** Kravet gäller endast vid kontoSKAPANDE, aldrig vid inloggning.
   Ett test pinnar att ingen `beforeSignIn`-väg finns.
4. **(#19, noterat)** Om (a) väljs: kollen hoppas över för inloggningsleverantörer
   som aldrig sätter ett lösenord, så en Google-användare aldrig får ett
   obegripligt lösenordsfel.

---

## Behöver dig (Tier D)

- **BIN-590:** välj mekanism (a) eller (b) ovan. (a) kräver att du slår på
  Identity Platform i Firebase-konsolen.
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
  konsoläktivering eller en omskrivning av registreringsflödet. Byggs inte
  förrän Malin valt.
