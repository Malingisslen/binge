# Designspec — Omdesign av "Mina streamingtjänster"

**Datum:** 2026-06-02
**Status:** Godkänd (design), redo för implementationsplan
**Yta:** `/settings` → sektionen "Mina streamingtjänster" (`src/components/settings/ProvidersSection.tsx`)

## Bakgrund

Som en del av upplinjeringen av inställningssidan byggdes ett enhetligt
`SettingsSection`-kort. "Mina streamingtjänster" bor i ett collapsible sådant,
men *innehållet* — en platt kryssruts­lista med färgprick + namn, blandade
kontroller per rad (tier-dropdown / kr-fält / inget) och explicit Spara/Ångra —
upplevs som ogrupperat, formulärartat och svagt i igenkänning.

## Problem (användarvalda smärtpunkter)

Användaren valde, av sex hypoteser, dessa fem:

- **A · Igenkänning är svag** — bara färgprick + namn.
- **B · Spara-friktion** — måste klicka Spara/Ångra; känns inte direkt.
- **D · Röriga kontroller per rad** — dropdown / kr-fält / inget om vartannat.
- **E · Platt, ogrupperad lista** — dina tjänster blandas med övriga.
- **F · Känns utilitaristisk** — funktionell men inte "färdig".

Ej vald: **C · kostnad/värde göms**. → Detta är **inte** ett pengar-/värde-verktyg.

## Mål

Lösa A, B, D, E, F utan ny datamodell och utan att återinföra den dyra
grupp-cascaden vid varje klick.

## Icke-mål (medvetet utanför scope)

- **Värde-/sparfunktioner** (C) — kopplingar till faktisk användning, "dyr men
  oanvänd"-nudges. Hör hemma i Streamingrådgivaren/Sparande.
- **Riktiga varumärkesloggor** — utrett juridiskt (se nedan); medvetet bortvalt
  till förmån för wordmark-pills. Kan bli ett separat, deliberat beslut senare.
- **JustWatch-attribution** — separat, redan spawned task (pre-existing gap i
  hela appen, inte specifikt den här sektionen).

## Juridiskt avgörande (sammanfattning)

Wordmark-pills (varumärkets *namn* i varumärkesfärg) valdes framför riktiga
loggor för att:

- **Nominativ/refererande användning** skyddar *namnet* solitt (US *New Kids*;
  EU Art. 14(1)(c) dir. 2015/2436 + svensk Varumärkeslag 2010:1877). "Bara så
  mycket som behövs"-kravet uppfylls av namnet — logon är estetik och därmed
  svagare försvar (jfr CJEU *Audi v GQ* 2024).
- Riktiga loggor från TMDB skulle trigga **JustWatch-attribution på varje yta**,
  kräva efterlevnad av varje tjänsts logo-guideline (ingen omfärgning), och ge
  underhållsbörda (rebrands, t.ex. Max↔HBO Max 2025).
- Wordmark är dessutom i linje med Schemat ("inga dekorativa bilder").

## Design

### Komponentstruktur

Behåll filen `ProvidersSection.tsx` och `SettingsSection collapsible`-wrappern;
skriv om innehållet. Återanvänd `SWEDISH_PROVIDERS` (`color`, `shortName`,
`name`, `tiers`) — ingen ändring av datamodell eller Firestore-schema.

Bryt ut testbar ren logik till `ProvidersSection.helpers.ts` (mönster enligt
CLAUDE.md): gruppering (valda vs tillgängliga), totalkostnads­beräkning, samt
en ren beskrivning av commit-debounce-tillståndet.

### Layout (tre block i kortet)

1. **"Dina tjänster · N"** — rutnät av *fyllda* wordmark-pill-brickor för
   `myProviders`. Vald = `background: provider.color` (inline brand-färg, som
   dagens färgprick), vit text, liten ✓. Sist en streckad `+`-bricka som
   scrollar till "Lägg till fler".
2. **"Lägg till fler"** — rutnät av *outline*-brickor (border `rule`,
   brand-färgad text) för resterande flatrate-tjänster.
3. **"Nivå & kostnad"** — strip som bara listar *valda* tjänster, var och en med
   sin tier-dropdown (om `tiers`) eller kr-fält (om ingen tier / egen kostnad) —
   exakt dagens tier/kostnads-logik, men samlad på ett ställe (löser D). Avslutas
   med live-total och spar-indikator.

Brickor renderas som `<button>` med `aria-pressed` för tangentbord/skärmläsare.

### Spar-beteende (löser B utan cascade-kostnad)

- Tap på en bricka uppdaterar **lokalt `selected`-state optimistiskt** (direkt
  visuell respons).
- Den faktiska `updateProviders(selected)` — som fan-out:ar till varje
  gruppmedlemskap — **debounce:as** (~700 ms efter senaste ändring) och
  **flushas** vid sektion-kollaps, `pagehide`/`visibilitychange` och
  komponent-unmount. Resultat: känns direkt, men skriver en gång per "burst".
- Tier-/kostnadsändringar (`updateProviderTier`, `updateProviderCosts`) commitar
  som idag (de triggar inte grupp-cascaden).
- Explicit Spara/Ångra **tas bort**; ersätts av diskret status: "Sparar…" under
  pending flush, annars "✓ Sparat automatiskt".

### Tillstånd & edge cases

- **Tomt** (`myProviders` tom): `SettingsSection` defaultOpen (som idag), "Dina
  tjänster"-blocket visar en kort uppmaning istället för tom rutnät.
- **Pending flush vid navigering**: effekt-cleanup flushar; extra skydd via
  `pagehide`/`visibilitychange`.
- **Kontrast**: brand-färg som bakgrund med vit text kan ge låg kontrast för
  ljusa färger. Implementationen ska kontrast-kontrollera per provider och falla
  tillbaka till `ink`-text där vit text underkänns (WCAG AA), så a11y-guarden
  håller.
- **Aliaser/duplicat**: rendera via `canonicalProviderId` så samma tjänst inte
  dyker upp två gånger.

## Testning

- Rena helpers (`ProvidersSection.helpers.ts`): gruppering valda/tillgängliga,
  totalkostnad, dirty-detektion — vanliga Vitest-enhetstester.
- Debounce/flush: Vitest med fake timers — verifierar att N snabba toggles ger
  *en* commit, och att flush sker vid unmount.
- Befintliga `npm run typecheck` / `lint` / `test` ska vara gröna; a11y-kontrast
  och design-guard (inga råa hex i klasser; brand-färg endast via inline style
  från data) respekteras.

## Öppna frågor

Inga kvarvarande — design godkänd av användaren 2026-06-02. Riktiga loggor och
JustWatch-attribution är medvetet separata spår.
