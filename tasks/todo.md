# Räddning av tre biljetter ur sprintens stash — 2026-08-16/17

## Bakgrund

Sprint 2026-08-16 runda 2 byggde sex biljetter i två buntar. I varje bunt fälldes EN
biljett av den treögda utfallsgranskningen, och hela bunten stashades ut — vilket tog med
sig färdigt, godkänt arbete från syskonbiljetterna. Det är BIN-712-klassen (en per-biljett
FAIL som drar med sig hela bunten) och den kostade tre klara ändringar.

Malins beslut 2026-08-16: ta hem de tre godkända, lämna de två fällda i stashen.

**Räddas** (ur `stash@{1}` / `stash@{0}`, applicerade med `git apply --3way` på nytt HEAD):

- **BIN-896** — svenska diakriter (å/ä/ö) återställda i två kommentarblock som ett skript
  mangelade när BIN-655 flyttade koden. `WatchlistContext.tsx`, `watchlistWrites.ts`.
- **BIN-895** — omtitt-bekräftelsen läste render-stängningen medan skrivningen läste den
  levande referensen, så notisen kunde påstå en omtitt som skrivningen aldrig räknade.
  Skrivvägen returnerar nu `TitleWriteOutcome` och notisen läser det den faktiskt skrev.
  `useMarkSeen.ts`, `watchlistWrites.ts`, `WatchlistContext.tsx`.
- **BIN-921** — en mening i `accepted-deviations.md` avsmalnad: den täckte
  första-klumps-felet men inte ett återförsök från en för gammal session, där BIN-813 gav
  ett annat, mindre lugnande meddelande.

**Lämnas i stashen, EJ räddade:**

- **BIN-905** (i `stash@{1}`) — fälld på correctness + intent: den nya kommentaren påstod
  att testet pinnar att kontaktraden renderas utanför `{!confirming}`-grenen, men båda
  påståendena körs med `confirming=false`, så en `{!confirming && …}`-mutant överlever
  10/10 grönt. Biljetten återöppnas och byggs om ordentligt.
- **BIN-918** (i `stash@{0}`) — fälld på alla tre linser: den nya commit-kontrollen läser
  bara commit-ÄMNET, aldrig filerna, så en dokumentationscommit intygar ett kodpåstående.

## Steg

- [x] Bygg räddningspatchar ur båda stasharna, exkludera de fällda biljetternas filer
- [x] `git apply --3way` på HEAD — verifiera att BIN-894:s taggskydd (`dba6683`) överlever
      sammanslagningen, eftersom stashen är äldre än den committen
- [x] `git apply -R --check` — bekräfta att räddningen är återkallbar
- [x] `npm run typecheck` grön, `npx eslint` 0 fel, 162 tester gröna
- [x] Säkerhetsgranskning — pass (bekräftade att taggskyddet är intakt)
- [x] Kodgranskning — pass (bekräftade att omtitt-luckan stängs, inte flyttas)
- [x] Helhetsgranskning — 1 blockerande fynd
- [x] **Åtgärdat det blockerande fyndet:** `TitleWriteOutcome` + `outcomeOfAddWrite` sköts
      in MELLAN `buildAddWrite`s JSDoc och funktionen själv, så kontraktsdokumentationen
      satt på fel deklaration. De två nya deklarationerna ligger nu NEDANFÖR
      `buildAddWrite`, med en rad som säger varför. Ren omflyttning, ingen beteendeändring.
- [x] **Åtgärdat det valfria fyndet i samma fil-familj:** BIN-896:s diakriterestaurering var
      halvlandad — `WatchlistContext.test.tsx` hade kvar ett manglat block. Det var det enda
      som återstod i `src/`, så biljetten stänger i stället för att lämna ett andra pass.
      Texten var född manglad i `c233cbe`, inte manglad av BIN-655, så den är återställd
      ord för ord mot den commiten med bara å/ä/ö tillagda.
- [x] Testgranskning (kördes SIST — två muterande granskare på samma filer förstör varandras
      mätningar). Pass, mutationsverifierad: den literala förbuggen är röd-ensam.
- [x] Helhetsgranskning OM efter fixarna — pass, 0 blockerande, 2 valfria (båda filade
      som egna biljetter i stället för att putsas in sent; sen putsning ogiltigförklarar
      granskningsledgern)
- [ ] Commit, push, invänta deploy, purga Cloudflare
- [ ] Linear: BIN-896/895/921 → Done. BIN-905/918 → Todo med skälet skrivet på biljetten.

## Öppna frågor

Inga arkitekturändrande okändheter. Antaganden:

1. Att flytta ett kommentarblock och två deklarationer inom samma fil är beteendeneutralt —
   verifieras av att typkontroll och hela sviten är gröna efter flytten.
2. Diakriterestaureringen i testfilen är kommentarsinnehåll, inte kod — verifieras genom
   att jämföra mot originalordalydelsen i git-historiken, inte genom att skriva om texten.
3. De tre räddade biljetternas granskningar gäller de byte som nu ligger i indexet.
   Helhetsgranskaren körs om efter fixarna; de två som redan gav pass läste samma bytes
   frånsett den rena omflyttningen, som helhetsgranskaren själv begärde.
