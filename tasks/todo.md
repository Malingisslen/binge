# Batch 2026-08-06 — de fyra biljetter panelen släppte igenom

Byggda för hand, inte i en sprint: efter BIN-776 plockar urvalsspärren ut varje
biljett vars riskklass ligger över `skip`, och motorn har ingen väg att få veta att
kritiken redan är körd. Rollkritikerna kördes i sessionen 2026-08-06 och deras
villkor står som acceptanskrav på respektive biljett i Linear.

## BIN-555 — ägarlöst gruppdokument rullas tillbaka

Panel: #4 Security Architect, #27 DBA, Codebase Archaeologist (alla tre, blint).

Biljettens egen lösning (atomisk batch/transaktion) **byggdes inte** — den är exakt
det BIN-532 shippade och revertade 2026-07-18, med verifierad produktionskrasch:
`members/{uid}`-regeln gör `get()` på gruppdokumentet, och Firestore-regler löser
`get()` mot tillståndet FÖRE commit, aldrig mot en syskonskrivning i samma batch.

Byggt i stället: två separata skrivningar kvar, plus en kompenserande `deleteDoc`
av gruppdokumentet när ägarens medlemsskrivning failar, och felet kastas vidare så
anroparen aldrig får ett id till en grupp som inte finns.

- `src/lib/firebase/groups.ts` — try/catch + rollback runt medlemsskrivningen
- `src/lib/firebase/groups.test.ts` — 2 nya tester (rollback raderar, originalfelet
  kastas även när rollbacken själv failar)
- Mutationstestat: rollbacken bortkopplad → 2 tester faller. Återställt från
  scratchpad-snapshot, verifierat med md5.
- INTE gjort, medvetet: `firestore.rules` orörd (panelens villkor), och ingen
  engångsstädning av redan befintliga föräldralösa dokument — den är en separat
  operativ åtgärd, inte en kodändring.

## BIN-777 — felrutan vid kontoradering får tester

Kritik: #19 Customer Support / Success.

Två av de tre meddelandena delar identisk inledning; skillnaden är klausulen
"Ingenting har raderats.", som är ett löfte om användarens data. Ett delsträngstest
hade överlevt en grenväxling.

- `src/components/settings/DeleteAccountSection.test.tsx` (ny) — 5 tester: exakt
  full sträng per gren, klausulens närvaro/frånvaro, generiska grenen ber aldrig om
  ny inloggning, icke-Error-fel, och att knappen återställs efter fel.
- Mutationstestat: grenarna växlade → testet faller.

## BIN-767 — integritetspolicyn räknar upp sessionStorage-nycklarna

Kritik: #5 Legal / GDPR Counsel.

- `src/app/integritet/page.tsx` — `binge:nextAfterLogin` och `binge:tabSession` med
  typ (sessionStorage, per flik), syfte, livslängd och att ingen tredje part har
  åtkomst. Ingen ny samtyckesruta, ingen ny rättslig grund.
- Uppföljning filad (BIN-795): temavalet i localStorage saknas fortfarande.

## BIN-646 — två av tre id-skevheter

Routern: `skip` på de faktiska filerna (sprinten blockerade den på gissade sökvägar).

- `src/lib/mediaTypeDocId.ts` — (1) en STRÄNG i `tmdbId`-fältet hålls nu till samma
  kanoniska form som doc-id:t, så `'042'` inte längre räddar ett dokument doc-id-
  grenen redan vägrar; (2) `0` är inte längre ett giltigt id — `Number.isFinite(0)`
  är sant, så `movie_0` gick förbi varje efterföljande vakt som en riktig titel.
- `src/lib/mediaTypeDocId.parity.test.ts` — det tidigare pinnade gapet ersatt med
  det nya kontraktet, plus id-0-fallen.
- **Tredje punkten (skrivsidan) byggdes INTE.** Att låta `mediaTypeDocId` kasta på
  ett icke-kanoniskt id ändrar felbeteendet för ~90 anropsplatser, och ingen
  granskare har tittat på den ändringen. Skrivs upp på biljetten som ett medvetet
  val, inte som förbisett.

## Integrationsgranskningens tre fynd — alla åtgärdade

1. Policyn räknade **två** sessionStorage-värden; appen skriver **tre**.
   `binge:lastReportAt` (rapport-cooldown, `src/lib/firebase/reports.ts`) saknades. En
   räknad utsaga i ett juridiskt dokument som är fel dag ett — nyckeln tillagd, siffran
   rättad.
2. Serverkopians kommentar sa fortfarande "The FIELD branch is a true mirror of the
   client copy — keep those two in sync", vilket efter BIN-646 instruerar exakt den
   resync parity-testet finns för att vägra. Omskriven: båda grenarna är nu diverged,
   och varför.
3. `firestore.rules:834` tillåter `movie_0`, som klienten efter BIN-646 vägrar läsa —
   regeln är alltså bredare än sin läsare, och rules-testet påstod att id 0 vore
   legitimt. En rules-ändring är känsligt område med egen plan och manuell deploy, så
   residualen är dokumenterad i testet och filad som **BIN-797** i stället för att
   smygas in här.

Två valfria fynd: metrics-raden för BIN-727 (granskningen kördes, koden landade inte —
skrivet på biljetten) och BIN-555-radens etikett ("reaper" fast det blev en rollback).

## Verifiering

- `npx vitest run src` → 216 filer / 2552 tester gröna
- `npm run typecheck` → rent
- `npx eslint --fix` på alla ändrade filer → 0 fel (4 sedan tidigare befintliga
  varningar i groups.test.ts)
