# Insikter — periodsiffror från egen historik

**Datum:** 2026-06-18
**Status:** Godkänd design, redo för implementationsplan
**Yta:** `/insikter` (intern admin-dashboard, Fas 1)

## Problem

De tre översiktsplattorna som *ska* variera med tidsspannet — **Nya användare**,
**Aktiva besökare**, **Titlar tillagda** — hämtas alla från Plausible
(`resolvers.ts:32-34`). Binge har inget Plausible-konto, så `data.plausible` är
`null`, plattorna visar streck, och tidsväljaren (24h/7d/30d/90d) ändrar
ingenting. En admin som lagt till titlar i närtid ser ingen rörelse oavsett spann.

De övriga tre plattorna (Antal användare, Titlar bevakade, Recensioner) är
medvetet "totalt just nu"-tal från rollup-snapshoten och ska inte variera med
spannet — de är korrekta och rörs inte.

## Mål

Fyll **Nya användare** och **Titlar tillagda** från data Binge redan sparar, utan
ny betaltjänst. **Aktiva besökare** är ren webbtrafik utan databasmotsvarighet och
lämnas Plausible-beroende (fortsatt mörk) — det redovisas ärligt, inte fejkas.

## Befintlig data vi bygger på

Rollup-jobbet (`functions/src/insights/rollup.ts`) skriver var 6:e timme:
- `insights/daily` — senaste snapshot (det API:t redan läser)
- `insights/{YYYY-MM-DD}` — daterad historik; nyckeln är dagen, så endast dagens
  *sista* körning överlever → **en datapunkt per dag**

Varje snapshot innehåller `totals.{users, titlesTracked, reviews, ...}`. Det finns
**ingen per-titel-tidsstämpel** — därför är netto-delta mellan två snapshots det
enda vi kan beräkna utan schemaändring. Historik finns från 2026-06-10 och framåt
(~8 dagar vid designtillfället).

## Beslut (från brainstorm)

1. **Källa:** egen Firestore-historik, ingen Plausible (ingen extra driftkostnad).
2. **Semantik:** **netto**-förändring (idag − N dagar bak), etiketten **"Titlar
   tillagda"/"Nya användare" behålls**. Negativt netto golvas till **0** i
   presentationen (en "tillagd"-siffra ska aldrig visa minus).
3. **När historik saknas** (t.ex. 30d/90d innan historiken är så djup): jämför mot
   **äldsta tillgängliga snapshot** och visa en notis *"sedan {datum}"*. Fönstret
   växer automatiskt till fullt spann när dagarna ackumuleras.

## Arkitektur

Delta beräknas **vid request-tid i Cloud Function** `apiInsights`, inte i
rollup-jobbet — spannet väljs av användaren vid visning, så förberäkning skulle
behöva täcka alla möjliga fönster (inkl. `custom`). Request-tid kostar **+1
Firestore-läsning per sidladdning** (baseline-snapshoten; `daily` läses redan).

### Dataflöde

```
GET /api/insights?range=7d
  → isAuthorized() [oförändrat]
  → parseRange() ger { from, to }                    [oförändrat]
  → läs insights/daily (current)                     [oförändrat]
  → läs baseline-snapshot (NY)
  → computeWindowDeltas(daily, baseline, from) (NY, ren funktion)
  → fetchPlausible() [oförändrat, kan vara null]
  → svar: { ...befintligt, window }
```

### Baseline-val

Givet `from` (ISO-dag, t.ex. `2026-06-11` för 7d från 2026-06-18):

1. Fråga `insights` efter nyaste doc med `documentId() <= from`,
   `orderBy(documentId(), 'desc')`, `limit(1)`.
   - Datum-id (`2026-…`) sorterar lexikografiskt före `daily` (`d`), så `daily`
     exkluderas naturligt av `<= {datumsträng}`.
2. Om tomt (`from` är äldre än all historik) → fallback: ta **äldsta** date-doc:
   `orderBy(documentId(), 'asc'), limit(1)`. Asc ger äldsta datum-id först (`daily`
   sorterar sist), så resultatet är aldrig `daily`.
3. Om ingen historik alls finns (bara `daily`) → ingen baseline → `window = null`.

Kostnad: 1 läsning (limit 1); i fallback-fallet 2. Trivialt.

### `computeWindowDeltas` (ren, testbar)

Input: `daily: RollupData`, `baseline: RollupData | null`, `requestedFrom: string`,
`baselineDate: string | null`.

```
om baseline == null → returnera null
deltas.users         = daily.totals.users − baseline.totals.users
deltas.titlesTracked = daily.totals.titlesTracked − baseline.totals.titlesTracked
truncated            = baselineDate > requestedFrom   // nådde inte så långt bak som begärt
returnera { basisDate: baselineDate, truncated, deltas }   // rått netto, kan vara negativt
```

Golvning till 0 sker i **frontend-resolvern** (presentationslager), inte här — API:t
förblir rått/ärligt.

## API-kontrakt

Nytt fält på `InsightsData`, speglat i **båda** typfilerna (de är medvetet
duplicerade, se kommentar i `types.ts`):
- `functions/src/insights/types.ts`
- `src/app/insikter/insights.types.ts`

```ts
export interface WindowDeltas {
  basisDate: string;   // id på baseline-snapshoten (YYYY-MM-DD)
  truncated: boolean;  // true när historiken var grundare än begärt spann
  deltas: {
    users: number;         // rått netto (kan vara negativt)
    titlesTracked: number; // rått netto (kan vara negativt)
  };
}

export interface InsightsData {
  // ...befintligt...
  window: WindowDeltas | null; // null tills minst en tidigare snapshot finns
}
```

`partial` förblir oförändrad (styrs av rollup/plausible, inte av `window`).

## Frontend

### Resolvers (`src/app/insikter/metrics/resolvers.ts`)

```ts
newUsers:    (d) => scalar(Math.max(0, d.window?.deltas.users ?? NaN)),
titlesAdded: (d) => scalar(Math.max(0, d.window?.deltas.titlesTracked ?? NaN)),
activeVisitors: (d) => scalar(d.plausible?.visitors ?? NaN), // OFÖRÄNDRAD — stannar Plausible
```

`Math.max(0, NaN)` är `NaN` → plattan visar fortsatt streck när `window` är null
(ingen historik) eller Plausible saknas för besökare. Bekräftat beteende.

### "Sedan {datum}"-notis

Toolbar (`src/app/insikter/components/`, samma rad som "uppdaterad"-stämpeln) visar
en caption när `window?.truncated`:
> *Periodsiffror jämförda mot {basisDate}*

En plats, inte per platta. Försvinner av sig själv när 30d/90d fått verklig
historik. Toolbar läser `window` via `useInsightsContext()` likt övriga komponenter.

## Felhantering

- `window = null` (ingen historik / bara `daily`): plattorna visar streck, ingen
  notis. Inget kraschar.
- Baseline-frågan kastar: fånga, logga, behandla som ingen baseline (`window = null`),
  sätt inte `partial` (det reserveras för rollup/plausible-fel). Dashboarden
  fungerar oförändrat i övrigt.
- `custom`-range: `from` driver baseline-valet identiskt. Inget specialfall.

## Testning

- **`computeWindowDeltas`** (functions, ren funktion): netto positivt/negativt/noll,
  `truncated` (baselineDate > / == / < requestedFrom), `baseline == null` → `null`.
- **Resolver-mappning** (`src/app/insikter/metrics/resolvers.test.ts`): `newUsers`/
  `titlesAdded` läser `window.deltas` och golvar negativt netto till 0; `null`
  `window` → NaN-streck.
- Inga befintliga assertions försvagas; nya tester bevisar avsett beteende.

## Deploy

Två steg (rör Cloud Function — den vanliga push-to-main deployar **bara** hosting):

1. **`firebase deploy --only functions`** först — lägger till `window`-fältet i
   API-svaret. Bakåtkompatibelt: frontend tål `window` som saknas/`null`.
2. Push till main → hosting-deploy → frontend börjar läsa `window`.

Ordningen spelar roll: funktionen först, annars läser ny frontend ett fält som inte
finns än (degraderar dock snällt till streck, inte krasch).

## Utanför scope (YAGNI)

- Per-titel `addedAt` / brutto-tillägg (medvetet bortvalt — netto räcker).
- Trend-/tidsseriegrafer från historiken (Fas 2).
- Retention/gallring av daterade docs (en per dag, ~365/år, försumbart — lämnas).
- Att fylla "Aktiva besökare" (kräver Plausible, separat beslut).
