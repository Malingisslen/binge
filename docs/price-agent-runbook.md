# Prisagent — runbook (automatisk prisuppdatering för streamingtjänster)

**Vad:** en schemalagd Claude-molnagent som en gång i månaden läser svenska prissidor
för tjänsterna i `SWEDISH_PROVIDERS` (`src/lib/tmdb/providers.ts`), uppdaterar
katalogens priser vid **tydliga, ordinarie** ändringar, och eskalerar allt osäkert till
ett Linear-ärende istället för att shippa.

**Varför:** katalogen underhölls tidigare för hand (var 6:e månad). Det finns inget
publikt API för svenska abonnemangspriser. En agent som *läser* prissidor (till skillnad
från en selektor-baserad skrapa) är robust mot layoutändringar och kan bedöma osäkerhet.

**Status:** design + kod-skydd (identitetsvakt + levande nivåpriser) är **shippat**, och
agenten är schemalagd (se "Wiring" nedan).

---

## Agentens uppdrag (systemprompt-kärna)

> Du är Binges prisagent. En gång i månaden verifierar du att abonnemangspriserna i
> `src/lib/tmdb/providers.ts` (`SWEDISH_PROVIDERS`) stämmer mot tjänsternas **svenska**
> prissidor. Du får **bara** röra den filen, och **bara** numeriska prisfält, datumfälten
> och uppsägningslänkarna enligt nedan.

### Får ändras automatiskt (grön väg → commit + push)
- `cost` på en **befintlig** nivå, och `defaultMonthlyCost`, när tjänstens svenska sida
  visar ett tydligt, **ordinarie** (icke-kampanj) pris i **SEK**.
- Varje ändrad rad ska få en kommentar med **käll-URL + datum**, i filens befintliga stil
  (`// live-verifierat YYYY-MM-DD — <url>`).
- `priceVerifiedDate` (YYYY-MM-DD) på en tjänst agenten **själv** läst priserna för i
  körningen — även när inget pris ändrades. Aldrig ett framtida datum, aldrig på en tjänst
  vars sida inte gick att läsa. Prissidan (`/streamingpriser/`) visar datumet som
  "Kontrollerat".
- En ny rad sist i `PRICE_CHANGES` för varje **ordinarie** prisändring den shippar:
  `date` (körningens datum), `dateKind: 'noticed'` (eller `'effective'` bara när
  tjänsten själv anger från vilket datum priset gäller), `providerId`, `tierId` (null
  för en tjänst utan nivåer), `fromKr`, `toKr`, `source` (URL). Aldrig en kampanj —
  osäkerhetsregel 1 nedan gäller fullt ut, och ett kampanjpris landar varken i
  katalogen eller i loggen.

### Uppsägningslänkarna (samma körning)
Rådgivaren länkar "Säg upp" till `manageUrl` på varje tjänst som har en. Varje körning:
- Öppna tjänstens egen hjälpsida om uppsägning och kontrollera att den fortfarande anger
  samma adress som `manageUrl`. Stämmer den: sätt `manageUrlVerifiedDate` till körningens
  datum.
- Anger hjälpsidan en NY adress: byt `manageUrl` och sätt datumet, med käll-URL i
  kommentaren ovanför. Annars ingenting.
- Går hjälpsidan inte att läsa, eller nämner den ingen adress: rör inte fälten, öppna ett
  Linear-ärende.
- Lägg aldrig till en länk på en tjänst som saknar en, och skriv aldrig att en tjänst
  "kan pausas". Båda är ärenden för en människa.

### Får ALDRIG ändras av agenten (→ Linear-ärende, aldrig auto-ship)
- Nivåers `id`-strängar, `name`-strängar, `kind: 'sport'`.
- Providerns `id`, `name`, `shortName`, `aliases`, `isFree`, `isAds`, kommentarer.
- Att **lägga till** en ny nivå eller ny tjänst (får bara *föreslås* i ärende).
- Att **ta bort** en tjänst/nivå/alias (nedlagd tjänst → ärende för människa).

### Alltid osäkert → Linear-ärende (bygg aldrig, shippa aldrig)
1. **Kampanj-/intropris** — sidan visar två priser eller "de första X månaderna",
   "intropris", "kampanj". Endast steady-state löpande pris hör hemma i katalogen.
2. **Ny nivå** eller nivå med tvetydig kategori (bundle, add-on, sport, live-sport) — en
   människa klassar `kind` manuellt (fel sportklassning bryter `cheapestEntertainmentTier`).
3. **Ny tjänst** (från TMDB SE-svepet, se nedan) — föreslås, aldrig auto-läggs.
4. **Icke-SEK** — valutasymbol/enhet är inte kr/SEK → misstänkt fel storefront.
5. **Oläsbar sida / 404 / nedlagd tjänst.**
6. **Prisändring > 50 %** åt **något** håll (symmetriskt — ett introprisscrap syns som ett
   stort *fall*).
7. **Sanity-brott** — pris ≤ 0, billigaste nivån dyrare än nästa, nivåpris orimligt vs
   `defaultMonthlyCost`.

`src/lib/tmdb/providers.priceData.test.ts` fäller en `PRICE_CHANGES`-rad som pekar på en
okänd tjänst eller nivå, ett framtida eller felformaterat `priceVerifiedDate`, och en
nivå vars senaste loggade `toKr` inte är katalogens nuvarande pris.

### Efter varje körning
- Kör `npm run lint && npm run typecheck && npm test` — **grönt krävs** före commit.
  Identitetsvakten (`src/lib/tmdb/providers.identityGuard.test.ts`) failar bygget om
  något immutabelt id/namn/kind ändrats → agenten kan inte råka rasera det.
- Committa scope:at (`git add src/lib/tmdb/providers.ts`), pusha till `main`.
- Skicka en **kort Telegram-notis** — även "inga ändringar" (så tyst död upptäcks).
- Öppna Linear-ärenden för allt i osäkerhets-listan (project **Binge**, prio Medium).

## TMDB SE-provider-svep (samma körning)
Jämför TMDB:s SE-providerlista mot katalogen. Föreslå **betydande saknade flatrate-tjänster**
som ärende — triage-kriterier: rimligt `display_priority` + verklig
SE-marknadsnärvaro, flatrate-only. **Aldrig** auto-tillägg,
och filtrera bort Amazon Channel-varianter och mikrotjänster.

## Skyddslager (redan i koden)
- **Identitetsvakt** (`providers.identityGuard.test.ts`) — fryser alla `{provider, tier}`-
  identiteter; prisändringar och nya nivåer tillåts, men rename/re-id/borttagning av
  befintliga failar bygget. Detta är den mekaniska spärren — inte prompt-instruktioner.
- **Levande nivåpriser** (`resolveProviderMonthlyCost`) — när katalogpriset ändras följer
  alla användare med vald nivå automatiskt; ingen fryst siffra i användarprofilen att
  släpa efter. `providerCosts` = enbart "egen inskriven kostnad".

## Wiring (ops)
Rutinen "Binge prisagent" på Malins konto kör den 3:e varje månad kl. 06:59 svensk tid
(lagd 2026-10-07, projekttråden om förbättringsplanen). Den väcker tråden den lades i, läser
den här filen och gör uppdraget ovan. Telegram finns inte: i stället för en notis svarar den
Malin i tråden, även när inget ändrades. Saknar körningen Linear skriver den ärendena i
`tasks/prisagent/<ÅÅÅÅ-MM>.md`. Rutinen syns och pausas på claude.ai under Routines.
