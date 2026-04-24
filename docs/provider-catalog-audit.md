# Provider catalog audit (SE)

_Status: 2026-04-24. Audit av src/lib/tmdb/providers.ts mot TMDB:s
watch-providers-katalog för region SE._

## Nuvarande catalog (SWEDISH_PROVIDERS)

### Flatrate (subscription)
- **8** Netflix — 149 kr/mån default, 3 tiers (Basic/Standard/Premium)
- **119** Amazon Prime Video — 69 kr/mån
- **337** Disney+ — 109 kr/mån, 3 tiers (ads/standard/premium)
- **384** HBO Max — 149 kr/mån, 3 tiers
- **76** Viaplay — 169 kr/mån, 4 tiers (inkl. sport)
- **520** SVT Play — 0 kr/mån (isFree: true)
- **489** TV4 Play — 169 kr/mån, 3 tiers (alias 1944)
- **350** Apple TV+ — 119 kr/mån
- **531** Paramount+ — 99 kr/mån
- **510** Discovery+ — 89 kr/mån, 4 tiers (inkl. sport)
- **1899** Max — 149 kr/mån, 3 tiers (ersätter HBO Max globalt 2024+)
- **323** Crunchyroll — 89 kr/mån, 2 tiers
- **431** SkyShowtime — 99 kr/mån, 3 tiers
- **335** YouTube Premium — 149 kr/mån, 3 tiers (student/solo/family)
- **521** Tele2 Play — 99 kr/mån
- **578** TriArt Play — 79 kr/mån

### Rent/buy
- **35** Rakuten TV
- **3** Google Play Movies
- **2** Apple TV

## Sannolikt saknade tjänster (kräver TMDB-lookup)

Dessa behöver verifieras med en `GET /watch/providers/tv?watch_region=SE`-
request när en API-nyckel finns att köra mot:

| Tjänst | Sannolikhet | Anmärkning |
|--------|-------------|------------|
| Filmstaden Play | Medelhög | Svensk bio-koppling, kan ha egen streaming-vertical |
| C More | Medel | Nu under Viaplay-paraplyet — sannolikt inte separat i TMDB |
| Urplay | Medel | Public-service streaming (UR/SVT-sfären), isFree-kandidat |
| Kanal 5 Play | Låg | Ingår i Discovery+ numera |
| Joyn | Låg | Tysk, men kan ha SE-närvaro via Prime-ägarskap |
| Canal+ | Låg | Finns i SE, men liten marknadsandel |
| Euronews Now | Mycket låg | Gratis-streaming, inte en premium-tjänst |

**Att göra för att verifiera:**
```bash
curl "https://api.themoviedb.org/3/watch/providers/tv?api_key=$KEY&watch_region=SE" | jq '.results[]
  | {id: .provider_id, name: .provider_name, priority: .display_priority}'
```

Topp 25 i `display_priority`-order bör alla finnas i vår katalog. Lägg till
saknade med `type: 'flatrate'` + en rimlig `defaultMonthlyCost`.

## HBO Max (384) vs Max (1899) — B17 (sprint 9)

TMDB har både **384 HBO Max** och **1899 Max**. I praktiken bytte Warner Bros
Discovery ut HBO Max → Max-branding 2024-2025 (globalt rollout). Vår catalog
listar båda separat med olika tiers.

**Att göra:**
- När TMDB uppdaterar sin data så att 384 försvinner (TBD): gör 384 till
  alias för 1899
- Fram tills dess: behåll båda, men visualisera som samma i UI:n (t.ex.
  via canonicalProviderId)
- Alternativt: slå ihop dem proaktivt med risk att TMDB fortsätter rapportera
  384 och vi tappar titlar

**Rekommendation:** vänta tills TMDB deprekerar 384 innan vi agerar. Vår
nuvarande katalog är korrekt reflexion av TMDB:s state.

## C More legacy — B18 (sprint 9)

TMDB kan fortfarande returnera 76 (Viaplay) för titlar som historiskt låg
på C More. Canonical-mappningen via `canonicalProviderId` rider ut detta
eftersom 76 redan är Viaplay-id.

Om TMDB någonsin returnerar en separat C More-provider med nytt id: lägg
till som alias till 76.

## Display-order

Nuvarande ordning i SWEDISH_PROVIDERS-arrayen följer display-priority i
UI:n (t.ex. provider-filter-lista). Netflix först, SVT Play tidigt, Apple
TV+ mitten, TriArt + rent/buy i slutet.

Ordning matchar ungefär marknadsandel per 2026-04. Revisit årligen
eftersom marknadsläget ändras snabbt (t.ex. Viaplay-prishöjningar, Disney+
tier-omstruktureringar).

## Tier-priser — senast uppdaterade 2026-04

Samtliga tier-priser är listade i SWEDISH_PROVIDERS och behöver manuell
uppdatering när tjänsten byter pris. Det finns ingen API som exponerar
aktuella priser per land.

**Cadence:** manuell review var 6:e månad eller när en användare flaggar
att siffrorna är fel.

## Icke-lösningar diskuterade

- **Scrape tjänsternas prissidor** — tekniskt möjligt men bräckligt, TOS-
  känsligt, och gör vår katalog svårare att auditer. Skip.
- **Crowdsource från användare** — kommer kanske i Sprint 11+ (trust-system
  + audit-log), men inte värt nu.
- **TMDB:s `display_priority`-fält för ranking** — tillgängligt men vi har
  redan manuell ordning som bättre speglar svensk marknad.

## Sign-off

- [ ] API-verification körd mot TMDB /watch/providers/tv?watch_region=SE
- [ ] Saknade tjänster identifierade
- [ ] Missing providers added
- [ ] Tier-priser verifierade (senast: 2026-04)
- [ ] HBO Max vs Max — beslut tagit (vänta TBD)
