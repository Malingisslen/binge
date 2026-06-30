# Voice & Tone — binge.nu

Den här filen är referensen för all copy i appen. När en formulering känns "fel", titta hit. När du skriver ny copy, börja här.

## Röst-position

**Prisjakt-stil.** Binge är ett verktyg, inte en kompis. Användaren är en kompetent vuxen som vill tracka media och se var det streamas. Vi pratar **matter-of-fact, datadrivet, kort**.

### Tre principer

1. **Säg vad som gäller — inte hur du känner inför det.** "12 serier" är bättre än "Du har 12 fantastiska serier på din lista".
2. **Verb i CTAs, substantiv i statusar.** Knappar gör saker ("Lägg till", "Pausa"). Etiketter beskriver tillstånd ("Följer", "Avbruten").
3. **Korthet är respekt.** Varje extra ord stjäl uppmärksamhet. Om du kan kapa hälften — gör det.

### Tre antiexempel

| ❌ Skriv inte | ✅ Skriv hellre |
|---|---|
| "Du är igång!" | "Klar." |
| "Bra läge för att hitta något nytt." | "Inget på schemat — utforska istället." |
| "Vi kunde inte skapa kontot. Kontrollera internetuppkopplingen och försök igen." | "Kunde inte skapa kontot. Kontrollera anslutningen och försök igen." |

`Vi`-formuleringar är nästan alltid bortkapbara. `Bra läge för …` är en AI-tic-fras. `internetuppkopplingen` är ett klumpigt sammansatt ord på svenska — `anslutningen` räcker.

---

## Peer-jämförelse

Det här är var vi landar i förhållande till svenska peer sites:

| Aspekt | Prisjakt | Filmtipset | JustWatch.se | Letterboxd | SF Anytime | Viaplay | **binge.nu (mål)** |
|---|---|---|---|---|---|---|---|
| **Tilltal** | du | du | du | du (eng.) | du, "Hej!" | du | **du** |
| **Status-stil** | "Sorterad" | "Sett" / "Vill se" | "Sett" / "Vill se" | "Watched" / "Watchlist" | "Min lista" | "Min lista" | **Vill se / Följer / Sedd / Avbruten** |
| **Empty state** | Matter-of-fact | Knapp | Generisk | "No films logged" | Marketing | "Inget än" | **Vad + varför + nästa steg** |
| **Felmeddelande** | Konkret + lösning | Kort | Kort | Kort | Marketing-mjuk | Standardfras | **Konkret + lösning, ingen teknik** |
| **CTA-stil** | Imperativ kort | Imperativ kort | Imperativ kort | Imperativ kort | Lite längre | Imperativ | **Imperativ, ofta 1 ord** |
| **Rubriker** | Versal-på-start | Versal-på-start | Title Case | Title Case | Title Case | Versal-på-start | **Versal-på-start** |
| **Ellipsis** | … | ... | … | … | varierar | … | **…** (U+2026) |

**Vi är närmast Prisjakt** — kort, datadrivet, ingen marketing-mjukhet. Vi lånar **vokabulär** från Filmtipset (vill se/sett är inarbetat på svenska), **strukturella konventioner** från JustWatch (provider-pills, "finns på"-fras), och **domänvokabulär** från Letterboxd där svenska saknar bra ord (avsnitt, säsong, episod är OK; "watchlist" → "vill se", "diary" → finns ej).

---

## 8 regler

1. **Du-form.** Aldrig "ni", aldrig "vi" (utom i juridisk/legal-text).
2. **Imperativ i CTAs.** "Lägg till", inte "Lägga till" eller "Klicka för att lägga till".
3. **Versal endast på meningsstart + egennamn.** Inga Title Case-rubriker. `Mina serier`, inte `Mina Serier`. Matchar 13px-dense-stilen och svenska skrivregler.
4. **Ellipsis = `…` (U+2026), aldrig `...`** (tre punkter). Gäller i strängar som visas. JS-kommentarer får använda `...`.
5. **Empty states följer alltid mönstret vad-finns-här + varför-tomt + nästa-steg.** Max 3 satser. Generisk "Inga titlar att visa" är förbjudet.
6. **Felmeddelanden: vad hände + hur lösa.** Avslöja aldrig TMDB, Firebase, "request failed" eller annan teknisk implementation. Användaren bryr sig inte om vår stack.
7. **Inga emojis i UI** (matchar CLAUDE.md design-constraint). Inga ✓ ✗ ⦸ — använd ikoner från Lucide istället.
8. **Avsluta meningar med punkt** — även korta ("Vill se."). Undantag: navigation, labels, chips, kolumnrubriker, kort i tabeller.

---

## Status-vokabulär (BESLUT)

| Intern nyckel | UI-label | Var visas det |
|---|---|---|
| `vill_se` (film-only) | **Vill se** | Status-chip + knapp (film); vy-rubrik för väljaren `/my/vill-se` |
| `mina` (TV) | **Följer** (chip) / **Följ** (CTA-knapp) | Status-chip, listrubrik (TV); knappen är verbet, chipen substantivet |
| `sedd` (film) | **Sedd** | Status-chip, listrubrik (film) |
| `avbruten` | **Avbruten** | Status-chip, listrubrik |

`vill_se` är film-only sedan 2026-06 — att vilja se en serie ÄR att följa den
(läget "Ej påbörjad" härleds). Vyn `/my/vill-se` behåller namnet "Vill se" men
är en *väljare* (filmer + ej påbörjade serier), inte en statuslista.

**`'Mina serier'` (gammal label) byts mot `'Följer'`.** Anledningar:
- Memory (`feedback_status_system.md`) säger detta är önskat status-system.
- Matchar Filmtipsets sedan-länge etablerade `vill se` / `sett`-vokabulär. Användare som migrerar från andra svenska tracker-tjänster känner igen sig.
- "Mina serier" är vagt — "mina vad?". "Följer" beskriver tillståndet direkt.

**`'Avbröt'` (gammal label) byts mot `'Avbruten'`.** Anledningar:
- Routen heter redan `/my/avbrutna`, datamodell-nyckeln är `'avbruten'`. Konsistens.
- Adjektivform ("avbruten serie") fungerar bättre i mening än verbform ("Avbröt serie").

**Kollision med "följer en användare"-funktionen** (social-feature) löses av kontext:
- Social `följer`: alltid med användarnamn ("Du följer @lisa"), ikon, eller räknare ("Följer 12 personer").
- Status `Följer`: alltid i listrubrik, status-chip eller filterchip på watchlist-vyer.
De delar aldrig samma yta.

### TV sub-states (deriverade, aldrig sparade)

| Nyckel | UI-label | När |
|---|---|---|
| `ej_paborjad` | **Ej påbörjad** | Du följer serien men har inte markerat något avsnitt |
| `aktiv` | **Ligger efter** | Det finns aireade avsnitt du inte sett |
| `ikapp` | **Ikapp** | Du har sett allt aireat, serien pågår |
| `avslutad` | **Avslutad** | Du har sett allt, serien är slut/inställd |

`'Bakom · S{n}'`-formen i `WatchlistCard.tsx` byts mot `'Ligger efter · S{n}'`. En form per koncept.

### TMDB show-status (extern data)

| TMDB | UI-label |
|---|---|
| `Returning Series` | Pågår |
| `Ended` | Avslutad |
| `Canceled` | Inställd |
| `In Production` | Under produktion |

Behåll dagens — det är redan rätt.

---

## Domänvokabulär

En term per koncept. Använd dessa, inga synonymer.

| Koncept | Använd | Använd inte |
|---|---|---|
| Filmer + serier samlat | **titlar** | media, innehåll, verk |
| TV-serie | **serie** | show, TV-show, program |
| TV-säsong | **säsong** | serial, omgång |
| TV-avsnitt | **avsnitt** | episod (utom i tekniska kontexter) |
| Streamingtjänst | **tjänst** (kort) eller **streamingtjänst** (formellt) | leverantör, provider, plattform |
| Lägga till i bibliotek | **lägg till** | tracka, börja följa, spara |
| Markera avsnitt | **markera (som sedd/osedd)** | bocka av, klicka klart |
| Klar med ett avsnitt | **sedd** (adjektiv) / **se** (verb) | klar med, tittat klart, slutförd |
| Pausa streamingtjänst | **pausa** | säg upp, avsluta |
| Återuppta tjänst | **återuppta** | starta igen |
| Användarens lista | **bibliotek** | watchlist, samling, kollektion |
| Veckans nya avsnitt | **avsnittkalender** eller bara **kalender** | schedule, programplan |
| Streamingrådgivar-feature | **Streamingrådgivaren** (alltid) | Sparande (endast kodnamn), Sparrådgivare, Advisor |
| Rekommendationer | **rekommendationer** | förslag, tips, vad ska jag se |
| Sökning i app | **sök** (verb) / **sökning** (substantiv) | utforska (för det är en separat sida) |

`tracka` förekommer i kod och kommentarer — bra. I användarvänd copy: använd `lägga till` eller `följa`.

`Sparande` lever bara i kod-/komponentnamn (`SparandeTile`, `SpendSnapshotTile`) —
aldrig i användarvänd copy. Där heter featuren **Streamingrådgivaren**, vilket matchar
hela det shippade UI:t + integritetspolicyn (BIN-363). Den tidigare `Sparande`-regeln
här motsade produkten och är därför struken.

---

## Empty state-mall

Tre satser, **vad + varför + nästa steg**. Klicka inte runt:

```
{Vad sidan visar normalt}. {Varför det är tomt nu}. {Konkret nästa steg, gärna med länk}.
```

### Exempel

✅ `Inget i biblioteket än. Hitta något att titta på via Rekommendationer.` (sammansatt — 2 satser räcker när "vad" är uppenbart från kontext)

✅ `Inga serier i Avbrutna. Här hamnar serier du markerar som "Avbruten" — t.ex. om du tappar intresset.`

❌ `Inga titlar att visa` (säger ingenting)

❌ `Du har inga vänner än.` (för kort utan nästa steg — fixera med "Sök efter någon.")

### Standardformuleringar

| Situation | Använd |
|---|---|
| Sökning utan träffar | **`Inga träffar.`** (en form, överallt) |
| Filter utan träffar | `Inga titlar matchar dina filter. Justera ovan eller rensa.` |
| Listan är genuint tom | Följ mallen |

---

## Felmeddelande-mall

**Vad hände + hur lösa.** Aldrig "Något gick fel" som standalone-meddelande (även om det får stå som rubrik i error boundary). Aldrig nämn TMDB, Firebase, "request", "API".

### Exempel

✅ `Kunde inte hämta information om titeln. Försök igen om en stund.`

✅ `Kunde inte skapa kontot. Kontrollera anslutningen och försök igen.`

❌ `TMDB svarade inte som förväntat. Försök igen om en stund.` (avslöjar implementation)

❌ `Ett oväntat fel uppstod.` (säger inget — säg vad du försökte göra)

### Toast-format för misslyckade actions

`Kunde inte {verb}. {Lösning|Försök igen om en stund.}`

Exempel:
- `Kunde inte spara. Försök igen om en stund.`
- `Kunde inte ta bort kontot. Logga ut och in igen, sedan försök på nytt.`

---

## Ellipsis och knappar

**Reglerna:**

- Loading-text under mutation: `Sparar…`, `Skickar…`, `Skapar…`
- Search input loading: `Söker…`
- Aldrig `...` (tre prickar). Alltid `…` (U+2026).

Knapp i vila → knapp under mutation:
```
'Spara' → 'Sparar…'
'Skicka' → 'Skickar…'
'Skapa konto' → 'Skapar…'
```

---

## När i tvivel

Läs din copy som om du vore en stressad användare som scannar. Frågor:

1. Förstår jag vad som ska hända/vad som gäller på 1 sekund?
2. Finns det ord jag kan kapa utan att tappa betydelse?
3. Låter det som ett verktyg eller som marketing?
4. Skulle Prisjakt skriva det här?

Om svaret på fråga 4 är "nej" — skriv om.
