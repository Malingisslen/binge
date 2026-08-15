# Plan — BIN-879 (beslut + text) och BIN-727 steg 2 (orkestreringstest)

Datum: 2026-08-15. Sessionen är bevakad — Malin är närvarande och har svarat på
den enda arkitekturavgörande frågan (se Öppna frågor).

## Rollkastning — körd FÖRE planen, som CLAUDE.md kräver

`node docs/org/route.mjs` på de faktiska filerna, inte ärvt från någon tidigare körning:

| Ändring | tier | reasonCode | panel |
| --- | --- | --- | --- |
| BIN-879: `docs/data-retention-policy.md`, ny ADR | `medium` | `owned` | #6 DPO (+ #21 Technical Writer) |
| BIN-727 steg 2: `functions/src/availableNotify/**`, ny emulator-spec | `medium` | `owned` | #13 Data/Integrations Engineer (+ #7 QA) |

Biljetten BIN-879 kräver dessutom uttryckligen #5 Juridik. Tre blinda kritiker
kördes, var och en grundad i sin dossiersektion och blind för de andra.

---

## BIN-879 — enhetsluckan efter en avbruten radering

### Vad frågan är

Markören som stoppar en halvraderad session är enhetslokal (`localStorage`,
ADR 0019). Den som avbryter på telefonen och laddar en sida på datorn har ingen
markör där: `ensureUserProfile` återskapar `users/{uid}`, och serverns sopning —
vars kandidatvillkor är "Auth-konto finns OCH profil bekräftat saknas" — slutar
matcha kontot **permanent**. Policytexten kallade detta en öppen punkt.

Bindande begränsning från #5 Juridik, ADR 0019: markören får INTE flyttas till
Firestore. Ett varaktigt dokument under `users/{uid}` återskapar precis det som
ska raderas. Planen arbetar inom den, inte runt den.

### Rollernas svar — de var OENIGA, och det redovisas

- **#5 Juridik: ACCEPTERA LUCKAN.** Bara kontoinnehavaren själv kan utlösa den,
  ingen tredje part vinner något, och de 25 samlingarna är redan raderade när
  läget alls kan uppstå. Vill ha en daterad accept i policyn i stället för en
  öppen punkt.
- **#6 Dataskyddsombudet: LAGA MED MEKANISM.** Menar att accepten upphäver just
  den förutsättning ADR 0019 fråga 2 vilar på — att fördröjningen är verklig och
  sopad — eftersom det här kontot aldrig sopas igen.
- **Båda pekade oberoende ut SAMMA sak som det juridiskt vassa:** att
  `ensureUserProfile` stämplar `termsAcceptedAt`/`ageConfirmedAt` med dagens
  datum utan att ha visat något samtyckessteg. Det är ingen fördröjd radering
  utan en påhittad efterlevnadspost.

**Malins beslut 2026-08-15:** acceptera luckan, bryt ut samtyckesstämpeln till en
egen biljett med egen panel. DPO:s skiljaktighet skrivs in, inte bort.

### Acceptanskriterier (bindande, från kritikerna)

1. `docs/data-retention-policy.md` slutar beskriva punkten som öppen och beskriver
   det som beslutades. (Juridik C1)
2. Texten säger uttryckligen tre saker DPO krävde: att det räcker med en
   **sidladdning**, inte aktiv användning; att kontot lämnar sopningens urval
   **permanent** och inte bara fördröjs; och att det upphäver förutsättningen i
   ADR 0019 fråga 2. (DPO C1)
3. Samtyckesstämpeln får en **egen namngiven rad**, inte inbakad i
   enhetsstycket. (Juridik C3)
4. Texten noterar att en fix som bara rör `userDocWrite.ts` är en no-op för det
   här problemet — den spärren läser markören, som saknas på andra enheten.
   (DPO C4)
5. `src/lib/deletionMarker.ts`:s kommentar rättas: den påstår idag att sopningen
   stänger enhetsluckan, vilket motsäger policytexten i samma repo. (Juridik C2)
6. ADR 0022 skrivs, med DPO:s avvikande mening ordagrant bevarad.
7. `.claude/rules/accepted-deviations.md` får en post — **utökar** den befintliga
   2026-08-13-posten om markören, skapar ingen dubblett. (Juridik C1)
8. `docs/RUNBOOK.md` får ett stycke för supportfallet "användaren säger att hen
   raderade sitt konto men kan fortfarande logga in". (Juridiks §4)
9. INGET fält, ingen underkollektion, inget syskondokument läggs under
   `users/{uid}` för detta. ADR 0019:s förbud bekräftas gälla även BIN-879.
   (Juridik C5)
10. Ny biljett filas för samtyckesstämpeln, med DPO:s villkor 3 som kärna:
    spärren ska sitta i `ensureUserProfile`, och en gammal Auth-`creationTime`
    ska leda till ett riktigt återsamtyckessteg, aldrig en bakdaterad stämpel.

### Filer

`docs/data-retention-policy.md`, `docs/org/adr/0022-*.md`, `docs/org/adr/README.md`,
`src/lib/deletionMarker.ts` (kommentar), `.claude/rules/accepted-deviations.md`,
`docs/RUNBOOK.md`.

---

## BIN-727 steg 2 — `availableNotify` bakom en injicerad port

### Vad som ska byggas

Samma behandling som steg 1 gav `retentionCleanup` (79d108d): lyft ut
orkestreringen ur `functions/src/availableNotify/index.ts` (437 rader) till en
`runNotify.ts` som varken importerar `firebase-admin` eller
`firebase-functions`, så `src/test/rules/available-notify-orchestrator.test.ts`
kan driva den mot en riktig Firestore-emulator.

### #13:s fynd som ÄNDRAR omfattningen

De två föregångarna (`tmdbTosSweep`, `retentionCleanup`) rör bara Firestore.
`availableNotify` korsar dessutom **två externa gränser**: TMDB-hämtningar och
en riktig FCM-sändning via `sendPushToUser`. Det finns ingen FCM-emulator. Porten
måste därför svälja alla tre, annars går biljettens eget villkor — "en användare
som tackat nej når aldrig `sendPushToUser`" — bara att antyda via sidoeffekter i
stället för att bevisas med anropsräkning. Det här är en **tyngre lyft än
föregångaren**, och planen säger det hellre än att uppskatta den som likadan.

### Acceptanskriterier (bindande, från #13)

1. `runNotify.ts` importerar varken `firebase-admin` eller `firebase-functions`.
   Grep-kontrollerbart.
2. Porten täcker Firestore-tillstånd, TMDB-hämtning OCH push-sändning. Inget test
   får någonsin nå `getMessaging().sendEach()`.
3. Fas 1 (release) måste vara **helt klar** innan fas 2 (tillgänglighet) läser
   `releaseSkip`. Explicit sekvenspåstående, inte underförstått.
4. `Promise.allSettled` per mottagare bevaras i båda faserna — `Promise.all`
   låter en mottagares fel avbryta hela titelns utskick.
5. `writeMarker()` körs efter `allSettled`, oavsett enskilda sändningsutfall.
6. `releaseSkip`-kontrollen sker FÖRE `readUserData` — ett release-ägt par ska
   aldrig ens konstruera en push.
7. De yttre looparna förblir **sekventiella**. Ingen parallellisering av
   TMDB-anrop; det vore en kvotändring inbakad i en testbiljett.
8. Tillgänglighetsfasen: basrun (`last === null`) skickar 0 och skriver markören;
   omkörning utan förändring skickar 0; ny kvalificerande leverantör skickar
   exakt 1 och markören avanceras.
9. Releasefasen: TTL-gränsen prövas med **bokstavliga tal** — exakt `ttlDays`
   gammal cache måste hämta om; fönstret prövas vid `releaseDate`,
   `releaseDate + graceDays` och `releaseDate + graceDays + 1` (får INTE fyra).
10. Korsfas-dedup: ett `(uid,tmdbId)` i `releaseSkip` ger **noll anrop** till
    push-porten i fas 2 — mätt på anropsloggen, inte på frånvaron av ett dokument.
11. Opt-out: `pushEnabled: false` och `availableOnMyServices: false` ger var för
    sig noll anrop till push-porten.
12. Felisolering prövas på två nivåer: en titels TMDB-fel stoppar inte
    syskontitlarna, OCH ett fel i hela releasefasen blockerar inte
    tillgänglighetsfasen.
13. `logic.ts` och `tmdb.ts`:s exporterade API är oförändrat — diffen ska visa att
    `index.ts` delas, inte att doc-id:n ändras.

### Vad #13 REFUSERAR

- Att testvägen någonsin anropar riktig FCM.
- Att parallellisera titel- eller fas-loopen "medan vi ändå är här".
- Att shippa utan ett eget namngivet test för release/tillgänglighet-överlappet.
  Det är den enskilt värsta felvägen — dubbel push till riktiga användare.

### Filer

`functions/src/availableNotify/index.ts` (blir port), ny
`functions/src/availableNotify/runNotify.ts`, ny
`src/test/rules/available-notify-orchestrator.test.ts`, samt
`docs/role-responsibilities.md` + `docs/org/ownership-map.json` för den nya
testfilens ägare (annars blir `main` röd — samma spärrhake som fällde steg 1).

---

## Öppna frågor

**Inga arkitekturavgörande okända kvar.** Den enda fanns i BIN-879 — acceptera
luckan eller bygga en mekanism — och den ställdes till Malin via AskUserQuestion
2026-08-15 med rollernas oenighet framlagd. Svar: acceptera, fila samtycket
separat.

Antaganden som styr resten, uttryckligen:

- BIN-727 steg 2 riktar sig mot `availableNotify` och inte en annan push-avsändare.
  #13 tillfrågades uttryckligen och stod fast: den är rätt nästa mål eftersom den
  har högst komplexitet och störst blast radius i familjen.
- Ändringen är beteendebevarande. Varje avvikelse jag hittar under lyftet
  namnges i commit-meddelandet i stället för att tystas in, precis som
  `tokenOwnerUid`-deltat i steg 1.
- Ingen funktionsdeploy sker automatiskt. `deploy.yml` shippar bara hosting;
  `availableNotify` kör vidare på det gamla bygget tills Malin ber om en deploy.
