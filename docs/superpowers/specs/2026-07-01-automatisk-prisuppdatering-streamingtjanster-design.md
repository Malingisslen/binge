# Automatisk prisuppdatering för streamingtjänster — design

**Datum:** 2026-07-01
**Status:** Godkänd (design), redo för implementationsplan
**Stakeholder-review:** TOP-tier panel (roller 5 Legal/GDPR, 27 DBA/datalager, 11 Localization,
13 Data/Integrations, 24 Monetization) — alla `approve-with-conditions`, inga konflikter,
inga eskaleringar. Villkoren är inbakade som acceptanskriterier nedan.

## Problem

Binges priskatalog för svenska streamingtjänster (`SWEDISH_PROVIDERS` i
`src/lib/tmdb/providers.ts`) underhålls helt för hand — senast reviderad 2026-04, med en
plan på manuell översyn var 6:e månad. Det finns inget publikt API för svenska
abonnemangspriser (konstaterat i `docs/provider-catalog-audit.md`, som också avfärdade
klassisk selektor-baserad skrapning som bräcklig/TOS-känslig).

Katalogen är redan den rätta platsen: användare skriver normalt **inte** in priser för hand
— de väljer en nivå i en dropdown och priset följer med från katalogen. Fritextfältet för
egen kostnad är undantaget. Alltså är det *katalogen* som ska hållas färsk automatiskt, inte
användarnas inmatning.

Dessutom: när en användare idag väljer en nivå **fryses** priset i profilen. Höjer Netflix
priset och vi uppdaterar katalogen ser bara *nya* användare rätt siffra; befintliga sitter
kvar på det gamla priset i Streamingrådgivaren. Automatiken ger fullt värde först när även
befintliga nivå-väljare följer katalogens aktuella pris.

## Beslut

Två sammanhängande delar:

1. **Månatlig prisagent** — en schemalagd Claude-molnagent (Malins Max-konto, ingen ny paid
   service) som läser tjänsternas svenska prissidor, uppdaterar katalogen vid tydliga
   ändringar och eskalerar allt osäkert till Linear.
2. **Levande nivåpriser** — kostnadsupplösningen ändras så att en användare med vald nivå
   alltid får nivåns *aktuella* katalogpris, medan egna inskrivna kostnader lämnas orörda.

Vald policy vid prisändring (bekräftad av Malin): **följ nivån automatiskt.** Bara
egen-inskriven kostnad är "din"; ett nivåval betyder "ge mig nivåns pris, vad det än är".

---

## Del 1 — Månatlig prisagent

### Körning
- Schemalagd molnagent, körs ~1 gång/månad. Ingår i Max-abonnemanget → $0 löpande.
- Agenten får **endast** röra `src/lib/tmdb/providers.ts`. Inga andra filer, inga rules,
  inga functions.
- Flöde per körning: läs svensk prissida per tjänst → diffa mot katalogen → applicera
  tydliga ändringar → kör `npm test` + `npm run lint` + `npm run typecheck` → commit + push
  till `main` (auto-deploy via `deploy.yml`).
- **Telegram-notis varje körning**, även "inga ändringar" (så tyst död upptäcks).

### Vad som får auto-shippas kontra eskaleras
**Auto-ship (grön väg):** en tydlig, vardaglig ändring av ett *ordinarie* pris på en
befintlig nivå, inom rimliga gränser, verifierat i SEK från tjänstens svenska sida.

**Alltid Linear-ärende (aldrig auto-ship)** — panelens skärpta osäkerhetslista:
- **Kampanj-/intropris** — sidan visar två priser eller "de första X månaderna" / "intropris".
  Endast steady-state löpande pris hör hemma i katalogen. (Localization + Monetization, oberoende.)
- **Ny nivå** eller nivå med tvetydig kategori (bundle, add-on, sport, live-sport-upsell) →
  människa klassar `kind` manuellt. Fel sportklassning skulle tyst göra en sportnivå
  "billigast" och bryta `cheapestEntertainmentTierFrom`-skyddet (BIN-322/353). (Monetization + Data/Integrations.)
- **Ny tjänst** (från TMDB-svepet) → förslag, aldrig auto-tillägg.
- **Icke-SEK-läsning** — valutasymbol/enhet är inte SEK → behandlas som osäker (risk att
  agenten hamnat på en icke-svensk storefront, EUR/USD-pris i ett fält appen tolkar som SEK).
- **Oläsbar sida / 404** → ärende. Agenten raderar **aldrig** en provider- eller nivå-id.
- **Nedlagd/omdöpt tjänst** → ärende för människa att avgöra alias-kontra-radera (jfr HBO Max→Max).
- **Prisändring >50%** åt **något** håll (symmetrisk — ett introprisscrap syns som ett stort *fall*).
- **Sanity-brott** — pris ≤ 0, eller intern inkonsekvens (billigaste nivån dyrare än nästa,
  nivåpris vs `defaultMonthlyCost` divergerar orimligt).

### Immutabel identitetsdata — mekaniskt vaktat, inte bara promptat
Agenten får ändra **endast** numeriska prisfält (`cost`, `defaultMonthlyCost`) och lägga
till *flaggade* nya `tiers`-förslag (aldrig auto-applicerade). Aldrig:
- nivåers `id`-strängar (användarprofilers `providerTiers[id]` refererar dem som strängar)
- provider `id` / `aliases` (bryter `canonicalProviderId`/`dedupeProvidersByCanonicalId` för
  varje titelsida)
- nivåers `name`-strängar (svensk UI-copy: "Standard med reklam" etc.)
- `isFree` / `isAds` / `kind: 'sport'`
- omgivande kommentarer (tribal knowledge om varför ett id/alias/namn är som det är)

**Guard-test (obligatoriskt, del av leveransen):** ett snapshot-test som fryser mängden av
alla befintliga `{providerId, tierId}`-par + deras identitetsfält. Försvinner ett par eller
ändras ett `id`/`name`/`alias`/`kind` → bygget rött → inget deployas. Nya par är tillåtna.
Samma anda som befintliga sport-tier-guarden. **Detta test är den verkliga spärren** — inte
prompt-instruktioner till agenten.

### Auditbarhet
Varje auto-shippad prisändring får en kommentar med **käll-URL + åtkomstdatum** intill den
ändrade raden, i samma stil som filens befintliga `live-verifierat YYYY-MM-DD`-konvention.
Överlever agentens körning; gör diffar granskbara i efterhand.

### TMDB SE-provider-svep
Samma jobb jämför TMDB:s SE-providerlista mot katalogen och föreslår *betydande* saknade
flatrate-tjänster som Linear-ärende. Konkret inklusionströskel (samma triage som
`provider-catalog-audit.md` redan använde: `display_priority` + verklig SE-marknadsnärvaro,
flatrate-only) så kön inte fylls med Amazon Channel-varianter och mikrotjänster teamet redan
implicit avvisat. Aldrig auto-tillägg.

---

## Del 2 — Levande nivåpriser

### Nuvarande dataproblem (DBA-rollens fynd)
`providerCosts: Record<number, number>` (`src/types/domain.ts`) saknar härkomst.
`updateProviderTier` skriver nivåns `cost` **in i** `providerCosts` som sidoeffekt, och
`setProviderCost` skriver en genuint egen kostnad i **samma** fält/form. Efter skrivning kan
ingen läsare (UI, GDPR-export via `collectUserDataSnapshots`, `resumeProvider`, framtida
admin) skilja en nivå-härledd ögonblicksbild från en handinskriven kostnad — de är
bit-för-bit identiska.

### Ny modell
- **Nivåval sparar bara nivåvalet** (`providerTiers[id]`). Ingen frusen prissiffra skrivs
  längre in i `providerCosts` vid nivåval — det slås upp live ur katalogen vid läsning.
- **Egen kostnad** sparas som idag i `providerCosts` och rörs **aldrig** av automatiken.
- **Kostnadsupplösning vid läsning:**
  1. Har användaren en giltig `providerTiers[id]` som finns i katalogen → använd katalogens
     *aktuella* nivåpris.
  2. Annars, finns egen `providerCosts[id]` → använd den.
  3. Annars → `getProvider(id).defaultMonthlyCost`.
- **Härkomst blir entydig genom konstruktion:** `providerCosts[id]` betyder hädanefter
  *alltid* "egen inskriven kostnad". `providerTiers[id]` betyder "ge mig nivåpriset live".
  Inget fält bär längre två betydelser.

### Migrering av gamla frusna priser (lat, klientsidigt)
Befintliga profiler har idag `providerCosts`-värden som *är* frusna nivåpriser. Lat migrering
i samma anda som `migrateStatus`: när en användare nästa gång rör en titel/provider, om
`providerTiers[id]` finns och `providerCosts[id]` är lika med det gamla nivåpriset (dvs en
frusen ögonblicksbild, inte en genuin egen siffra) → rensa `providerCosts[id]` så
läsning faller på live nivåpris. Firestore-docs skrivs aldrig om enbart för migrering.
Ambiguösa fall (egen siffra som råkar matcha ett gammalt nivåpris) lämnas hellre orörda —
en läsning som är någon krona fel är bättre än att radera en genuin egen inmatning.

### Orphan-hantering
Tar agenten någon gång bort/döper om en nivå (får bara ske via människa efter ärende, men
ändå): `providerTiers[id]` kan peka på ett nivå-id som inte längre finns i katalogen. Lat
läs-tids-rekonciliering: sådant orphan-id faller på egen `providerCosts`/`defaultMonthlyCost`
och rensas/remappas vid nästa skrivning, så en användare aldrig tyst pinnas fast vid ett
inaktuellt fallback-pris för evigt.

### resumeProvider / paushistorik — uttalat beslut
`resumeProvider` fryser idag `providerCosts[id]` in i en `pauseHistory`-doc (historiskt
korrekt by design). Med live nivåpriser måste vi **uttalat** bestämma vad paus-besparing ska
räkna på framåt, inte låta det bero på vilket fält som råkar läsas först:
- **Beslut:** när pausen *startar/återupptas* fryses det då-aktuella upplösta priset (live
  nivåpris om nivå vald, annars egen kostnad) in i `pauseHistory` — så besparingssiffran
  speglar vad användaren faktiskt betalade under pausen.
- Redan frysta `pauseHistory.savedAmount` skrivs **aldrig** om. Historik är historik.
Detta blir ett kommenterat, testat val i implementationen.

### UI-transparens (Legal + Monetization, eniga)
Tre olika legitima priser kan nu skilja sig för samma provider: (a) ditt angivna pris, (b)
aktuellt listpris, (c) ett fruset historiskt besparingsbelopp. Inställningarna
(`ProvidersSection`) och rådgivaren måste märka vilket användaren ser — t.ex. "aktuellt
listpris" kontra "ditt angivna pris" — så en live prisändring inte läses som "Binge har fel".

---

## Berörda filer
- `src/lib/tmdb/providers.ts` — agentens enda målfil; ny guard-test-yta.
- `src/contexts/AuthContext.tsx` — `updateProviderTier` slutar frysa nivåpris; lat migrering.
- `src/hooks/useSubscriptionAdvisor.helpers.ts` — kostnadsupplösning (nivå-först).
- `src/components/settings/ProvidersSection.tsx` (+ `.helpers.ts`) — transparens-märkning.
- `src/lib/advisor/savingsLedger.ts` — resume-fryslogik + kommenterat beslut.
- Ny: guard-test (snapshot av `{providerId, tierId}` + identitetsfält).
- Ny/uppdaterad: agent-runbook + schemalagd task-definition (utanför appkoden).
- Uppdatera `docs/provider-catalog-audit.md` — den nu icke-manuella cadencen.

## Acceptanskriterier (panelens bindande villkor)
1. Guard-test låser alla befintliga `{providerId, tierId}`-par + identitetsfält; rött vid ändring.
2. Kampanj-/intropris → alltid ärende, aldrig auto-ship.
3. Ny/tvetydig nivå (`kind`-klassning) → alltid ärende, aldrig auto-gissad.
4. Icke-SEK-läsning → osäker → ärende.
5. Symmetrisk >50%-tröskel (både upp och ner).
6. Nedlagd tjänst → ärende; agenten raderar aldrig id/alias.
7. Varje auto-shippad prisändring bär käll-URL + datum i kod.
8. TMDB-svep använder `display_priority`+SE-närvaro-tröskel; aldrig auto-tillägg.
9. `providerCosts` betyder hädanefter entydigt "egen kostnad"; nivåval fryser inget pris.
10. Lat migrering rensar frusna nivåpris-snapshots; ambiguösa fall lämnas orörda.
11. Orphan `providerTiers[id]` faller säkert tillbaka + rekoncilieras lat vid skrivning.
12. `resumeProvider` fryser upplöst pris vid pausstart; `pauseHistory.savedAmount` skrivs aldrig om.
13. UI märker angivet-pris kontra listpris kontra fruset historiskt belopp.
14. Ingen ny paid service; agentkörningar ingår i Max.

## Uttrycklig icke-scope (YAGNI)
- Ingen crowdsourcing av priser från användare (avvisat i audit-doc, ev. Sprint 11+).
- Ingen retroaktiv omskrivning av paushistorik.
- Ingen automatisk radering av providers/nivåer/alias — alltid människa.
- Ingen valutakonvertering — endast SEK-läsningar accepteras.
