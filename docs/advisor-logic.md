# Streamingrådgivaren — beslutslogik

_Version: 1.0 (2026-04-24). Reflekterar
`src/hooks/useSubscriptionAdvisor.ts` + `useSubscriptionAdvisor.helpers.ts`._

Hur `useSubscriptionAdvisor` kommer fram till `primaryAction` — det vi visar
som huvudrekommendation i `SubscriptionAdvisorWidget` + `/savings/`.

## PrimaryAction states

`PrimaryAction` är en diskriminerad union med fyra kinds:

| kind | Betyder |
|------|--------|
| `pause` | Pausa en tjänst (du har ingen följer-aktivitet där) |
| `catchup` | Kom ikapp en tjänst där du påbörjat ≥3 serier |
| `subscribe` | Teckna en ny tjänst (du har kommande titlar där) |
| `idle` | Ingenting att agera på just nu |

## Beslutsträd (cascade)

Priority-cascade, evalueras top-down. Första matchen vinner:

```
START
  │
  ├── Användaren har 0 providers?
  │     └── return { kind: 'idle', nextCheckDate: null }
  │
  ├── Alla TMDB-queries failade + ingen cached data?
  │     └── return { kind: 'idle', nextCheckDate: null }
  │
  ├── 1. findTopPausable() — hitta dyraste tjänst med status 'pause'
  │     ├── Hittad → return { kind: 'pause', providerId, cost, nextAirDate }
  │     └── Ingen → fortsätt
  │
  ├── 2. findCatchupCandidate() — hitta active-tjänst med ≥3 påbörjade serier
  │     ├── Hittad → return { kind: 'catchup', providerId, unfinishedCount }
  │     └── Ingen → fortsätt
  │
  ├── 3. subscribeAdvice[0] — första i listan över nya tjänster att överväga
  │     ├── Hittad → return { kind: 'subscribe', providerId, showCount, nearestAirDate }
  │     └── Tom → fortsätt
  │
  └── 4. Fallback → { kind: 'idle', nextCheckDate: earliest provider.nextAirDate || activePause.resumeAt }
```

## Status-klassifikation per provider

Varje flatrate-provider användaren har blir klassificerad i en av fyra
statusar:

```
if hasActiveShow  (följer-titel med nästa avsnitt inom 30 dagar)
   status = 'active'
elif hasUpcomingShow  (följer-titel med nästa avsnitt inom lookAheadDays (60))
   status = 'upcoming'
elif hasWillSeeAnchor  (vill_se-titel som ligger på tjänsten)
   status = 'upcoming'
elif provider.isFree  (t.ex. SVT Play)
   status = 'free'
else
   status = 'pause'
```

**Varför ordningen matters:**
- `active` → vi ser faktiskt content där **nu**. Pausa inte.
- `upcoming` → content om max 60 dagar, OK att vänta men inte pausa.
- `free` → kostar inget, filtrera ut från pausa-förslag.
- `pause` → ingen aktivitet alls, kandidat för pausning.

## Trösklar

| Konstant | Värde | Motivering |
|----------|-------|------------|
| `CATCHUP_THRESHOLD` | 3 | "Flera påbörjade serier" — färre blir nagging |
| Active-window | 30 dagar | Kort nog att "just nu"-känsla håller i sig |
| `lookAheadDays` (default) | 60 | Upcoming-tröskel — matchar säsongspremiärs-cadence |
| Ads-gating | userHasAdsProvider | Filtrerar bort AVOD från förslag om användaren inte har |

## Relevanta funktioner

Alla renodlade helpers i `useSubscriptionAdvisor.helpers.ts` (testbara utan
Firebase-import):

- `findTopPausable(providers, userPausedSet)` — dyraste pause-kandidat,
  exkluderar redan-pausade
- `findCatchupCandidate(providers, followingById, userPausedSet)` — betald
  provider med mest påbörjade men oavslutade serier; exkluderar redan-pausade
  (BIN-51)
- `findIdleNextCheckDate(providers, activePauses)` — earliest av alla
  nextAirDate + resumeAt
- `getNextAirInfo(show)` — next_episode_to_air eller nästa framtida säsong
- `isWithinDays(dateStr, days)` — windowing-predikat för status-
  klassifikation

## hasError-state (Sprint 3 12.4)

Om **alla** TMDB-queries failar OCH vi har noll cached data → advisor
returnerar tomma arrayer + `hasError: true`. `SubscriptionAdvisorWidget`
renderar en specifik error-state istället för att tyst försvinna.

Om **vissa** queries failar men vi har cached data: vi kör med cachen, sätter
inte hasError. Användaren får något, bara möjligen stale.

## Skrivskydds-beteenden (vad rådgivaren INTE gör)

- **Pausar inte automatiskt** — rekommenderar bara, användaren klickar
  själv. `providerPauses` på UserProfile uppdateras av UI-action, inte av
  advisor.
- **Tecknar inte nya abonnemang** — rekommenderar bara. Ingen integration
  med betalnings-API:er.
- **Räknar inte kostnads-summor för dig** — visar bara månatlig besparing
  från pausade tjänster. Ingen årlig eller livstids-prognos (yet).

## Kopplingar till appen

- `SubscriptionAdvisorWidget` (dashboard) — visar `primaryAction` i en
  kompakt banner
- `/savings/` (full view) — visar `providers`, `subscribeAdvice`,
  `activePauses`, `willSeeByProvider`, `monthlySavings`, `totalMonthlyCost`
  i detalj
- `AdvisorTimeline` — visuell timeline av status-lanes över tid

## Framtida ändringar (dokumenteras här när de sker)

- Threshold tweaks — om användare säger att 3 är för få/för många, justera
- Nya PrimaryAction kinds — lägga till `downgrade` (t.ex. byt tier inom
  tjänsten) eller `bundle` (kombinera till en paket-deal). Nytt kind
  kräver uppdatering av widget + savings-page + denna docs.
- Ads-handling — nuvarande filtrering kan behöva förfining om AVOD växer
