# Betygsätt direkt vid "sedd" — designspec

**Datum:** 2026-06-21
**Mål:** Höj andelen titlar som faktiskt får ett betyg genom att fånga betyget i
samma ögonblick som användaren markerar något som sett — utan att avbryta flödet.

## Problem

Idag är "markera sedd" och "sätt betyg" två separata handlingar. Betyget kräver
att användaren navigerar till titelsidan och klickar stjärnor i ett andra steg —
de flesta gör det aldrig. Vi vill nudga betyget på det enda tillfälle då titeln
garanterat är top-of-mind: precis när den bockas av.

## Valt upplägg — stjärn-toast (Approach A)

Bekräftelse-toasten som redan dyker upp när man markerar sedd blir betygs-prompten.
Istället för enbart texten *"Dune — Sedd"* visar toasten *"Betygsätt Dune?"* med
fem tryckbara stjärnor, nere i högra hörnet.

- **Smidig, överallt, blockerar aldrig.** Det är hörn-toasten användaren redan
  känner — den lägger sig aldrig över rutnätet, och försvinner av sig själv.
- **Fungerar identiskt från alla ytor** (titelsida, kort-overlays i bläddra/
  bibliotek/sök) eftersom all "markera sedd"-logik samlas i *en* delad väg.
- **Betyget är frivilligt.** Stänger man toasten (eller låter den självdö) förblir
  titeln sedd — inget går förlorat.

Avvisade alternativ: ankrad popover (skymmer kortet bredvid, trång på mobil) och
mini-modal (dimmar sidan = exakt den störning vi vill undvika). Mini-modalen är
fortfarande rätt för en *medveten* betygssession — det är vad nuvarande
`QuickRateModal` i rekommendationer redan gör.

## Beteende

**Trigger.** Prompten visas när en titel övergår till "sedd":
- **Film:** status sätts till `'sedd'`.
- **Serie:** "alla avsnitt sedda" (som idag lagras som `status:'mina'` med
  `lastWatched` = sista aireade avsnittet). Films + avslutade serier — båda.

**Villkor.** Prompten visas **bara om titeln saknar betyg** (`rating == null`).
Om man re-markerar en redan betygsatt titel som sedd → ingen prompt, bara den
vanliga bekräftelsen.

**Tryck på stjärna.** `updateRating(tmdbId, n)` sparar betyget och toasten stängs.
Ren ett-tryck-interaktion — ingen recensions-länk, ingen andra fråga. (Recensioner
bor kvar på titelsidan.)

**Ingen åtgärd.** Toasten självdör efter samma förlängda fönster som dagens
åtgärds-toasts (6 s). Titeln förblir sedd, inget betyg sätts.

**Stjärnor.** Återanvänder befintliga `RatingStars` (`size="md"`) — inkl.
halvstjärnor via vänster/höger-halva-klick. På en liten mobil-toast är
halvstjärne-precisionen lite pillig; det är acceptabelt eftersom man alltid kan
finjustera på titelsidan. Vi krymper inte komponentens beteende.

## Arkitektur

Tre rörda enheter, varje med ett tydligt ansvar:

### 1. `useMarkSeen` — delad "markera sedd"-väg (ny)

Idag är `'sedd'`-hanteringen **kopierad** rad-för-rad i `StatusButton.tsx` och
`QuickAddButton.tsx` (~40 identiska rader vardera, inkl. TV-special-fallet som
hämtar serie-detalj och översätter till `'mina'`). Vi extraherar den till en hook
`useMarkSeen()` i `src/hooks/` som returnerar en `markSeen(item, opts)`-funktion.

Hooken äger:
- film → `addItem({...status:'sedd'})`
- serie → fetch TV-detalj, `addItem({...status:'mina', lastWatched...})` (oförändrad
  logik, BIN-14-kommentaren följer med)
- bekräftelse-toast **eller** betygs-prompt (se nedan)

Båda knapp-komponenterna anropar `markSeen` istället för att duplicera. Detta är
förutsättningen för att prompten ska beta identiskt oavsett yta, och städar bort
en befintlig dubblering på köpet.

`markSeen` avgör vilken toast som visas:
```
om (status blev sedd/avslutad) och (current?.rating == null):
    showRating(title, n => updateRating(tmdbId, n))
annars:
    show(`${title} — ${label}`)
```

Övriga statusval (`vill_se`, `avbruten`, m.fl.) går **inte** via `markSeen` — de
behåller dagens `addItem` + `show`. `markSeen` är specifikt för sedd-övergången.

### 2. `ToastContext` — betygs-variant (utökas)

Lägg till en betygs-variant utan att röra `show`-signaturen:
- Ny metod på context-värdet: `showRating(message: string, onRate: (n: number) => void)`.
- `Toast`-modellen får ett valfritt fält `onRate?: (n: number) => void`.
- I render: när `onRate` finns, rendera `RatingStars` (med `message` ovanför)
  istället för action-knappen. Klick → `onRate(n)` + `dismiss(id)`.
- Livslängd: samma 6 s som åtgärds-toasts (betygs-toasten räknas som "har åtgärd").
- Behåll `<X>`-stäng-affordansen så man kan avfärda direkt.

Befintliga `show`-anrop påverkas inte.

### 3. Knapp-komponenterna — anropar `markSeen` (ändras)

`StatusButton.handleSelect` och `QuickAddButton.handleSelect`: sedd-grenen ersätts
med ett anrop till `markSeen`. Resten av menyn oförändrad.

## Dataflöde

```
Klick "Sedd" (titelsida ELLER kort-overlay)
   → markSeen(item)
       → addItem(...)            (film: sedd · serie: mina+lastWatched)
       → rating == null ?
           ja  → showRating("Betygsätt {title}?", onRate)
                    → tryck stjärna → updateRating → toast stängs
           nej → show("{title} — {label}")        (oförändrat)
```

## Felhantering

- **Serie-detalj-fetch failar:** behåll dagens beteende — `show('Kunde inte hämta
  serieinfo, försök igen')`, ingen betygs-prompt (titeln blev inte sedd).
- **Utloggad:** kan ändå inte markera sedd (`QuickAddButton` kör `signIn()` först);
  ingen ny väg behövs.
- **updateRating failar:** Firestore-skrivet är fire-and-forget som idag; betyget
  är optimistiskt via context-cachen. Ingen extra felyta.

## Mätning (lätt, frivillig men rekommenderad)

Hela poängen är "höjer detta andelen betyg?". En enda analytics-händelse räcker
för att kunna mäta det: `track('rate_on_sedd', { mediaType })` när ett betyg sätts
*via betygs-toasten* (inte via titelsidan). Lägg i `onRate`-callbacken. Ingen ny
beroende — `src/lib/analytics.ts` finns redan.

## Testning

Pure-logic + lättviktiga scenario-tester, ingen försvagning:
- **`useMarkSeen`:** betygs-prompt visas för film-sedd och serie-alla-sedda när
  `rating == null`; visas **inte** när titeln redan har betyg; visas **inte** för
  `vill_se`/`avbruten`. Verifiera att serie-grenen fortfarande sätter
  `status:'mina'` + `lastWatched` (BIN-14-invarianten — ingen fejkad säsongsmarkör
  när `last_episode_to_air` saknas).
- **`ToastContext`:** `showRating` renderar stjärnor; klick anropar `onRate(n)` med
  rätt värde och stänger toasten; toasten självdör efter timeout utan att anropa
  `onRate`.

## Utanför scope (YAGNI)

- Ingen recensions-länk i toasten (uttryckligt val).
- Ingen ändring av `QuickRateModal` (rekommendations-flödet är en egen sak).
- Ingen ändring av halvstjärne-precision eller `RatingStars` internals.
- Ingen ny prompt för status-byten som inte är sedd.
