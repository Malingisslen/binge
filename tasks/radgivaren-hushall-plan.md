# Plan: Rådgivaren (steg 1) + hushållsläge (steg 2) + röster

Malin 2026-10-31: "bygg hela altet". Skisser: artifact "Rådgivaren skisser". Router: tier top (firestore.rules, groups.ts, dataExport.ts, accountDeletion.ts, integritet).

## Steg 1 — rådgivaren (ingen ny data)
- `/savings`: ett svar överst (HeroVerdict) härlett ur befintliga `primaryAction`, `bundleSuggestions`, `activePauses`. Inga nya beräkningar i motorn; ren presentation.
- Kort per tjänst (dom: Behåll / Pausa / Rotera in) ur `advisor.providers` + rotationPlan.
- Flikar: Tjänster · Pausa & rotera · Paket · Detaljer. Befintliga block flyttas, räknas inte om.
- "Sparat hittills" (savingsLedger finns).
- Ren hjälpare `verdicts.ts` med test.

## Steg 2 — Jag/Hushållet-läge
- Växel överst. Hushållsläget visas bara om användaren är medlem i en grupp med eget Hushåll-bidrag (share-to-see, ADR 0010 oförändrad). Flera grupper: välj grupp.
- Läser `groups/{gid}/household/*` via befintlig `useGroupHousehold`. Samma läsning som gruppsidans panel, ingen ny prenumeration utöver den.
- Månadsdom per tjänst: "0 av N har något nytt före X" → Pausa; paid-by ≥2 → "Betalas dubbelt" (INGEN rekommendation, ADR 0010: tyst om kontodelning); annars Behåll.
- Ingen datumdata delas mellan konton. "Månaden framåt"-remsan visas bara i Jag-läget (egna datum); i hushållsläget visas "N av M har något nytt inom 30 dagar" per tjänst.

## Ny delad data (bidragsdokumentet utökas, ingen ny samling)
`groups/{gid}/household/{uid}` får tre OPTIONELLA fält:
- `soonProviderIds: int[] (≤100)` — leverantörer där medlemmen har något nytt inom 30 dagar (bara provider-id, aldrig titel).
- `votes: map<providerId, 'ok'|'keep'|'wait'>` (≤100) och `votesMonth: 'YYYY-MM'`.
Namn visas ur befintligt `members/{uid}.displayName` (redan synligt för alla gruppmedlemmar). Ingen kopia av namn i bidraget.
Röst-skrivning = bygger om HELA bidraget + röster i en skrivning (updatedAt == request.time, så färskhetsstämpeln förblir sann).
Röster äldre än innevarande månad ignoreras vid läsning och skrivs över vid nästa skrivning (ingen server-städning; kostnad 0).

## Regler (firestore.rules, `match /household/{uid}`)
- `hasAll` oförändrad (5 gamla fält). `hasOnly` utökas med `soonProviderIds`, `votes`, `votesMonth`.
- Validering: `soonProviderIds is list && size() <= 100`; `votes is map && size() <= 100`; `votesMonth is string && size() == 7`. Värden i `votes` kan inte valideras per post i rules utan loop: klienten validerar, läsaren tål okända värden (okänt värde = ingen röst). Dokumenterad avvikelse om granskningen godtar.
- Läs-/delete-/reciprocitetsgrenar oförändrade.

## GDPR / flöden
- Bidrag exporteras och raderas redan (dataExport, accountDeletion, retention, group-handover). Nya fält ligger i samma dokument → täcks av befintliga flöden; testerna `dataExport.coverage` och rules-testerna utökas för att bevisa det.
- Samtyckestexten (HouseholdPanel) får en rad: "Om du har något nytt inom 30 dagar på varje tjänst, och dina röster (med ditt namn)." Integritetspolicyn bumpas (nu 1.16 → 1.17), `data-export-format.md` uppdateras.
- Rösterna visas med namn (Malins beslut). Resten av bidraget visas som tidigare bara aggregerat.
- ADR 0010 oförändrad; ny ADR 0017 (eller nästa lediga) som beslutar röster-med-namn och soon-flaggan.

## Kostnad
Inga nya tjänster. Samma läsningar som gruppsidan. Skrivning: en per röst/refresh, dirty-checkad.

## Acceptanskriterier
- Typecheck, lint, vitest, rules-tester gröna. Nya tester för verdicts, soon-flaggan, röstaggregat, månadsrensning, rules (tillåt/neka form, reciprocitet, okända fält), export och radering.
- Inget fält tillåter titel eller fritext.
- Design enligt designsystemet (Direction H, tvåaccentregeln, komponenter från hyllan).

## Beslut (Malin 2026-10-31)
- Röster med namn. Aktiv omdelning för befintliga delare. "Nytt inom 30 dagar" följer med när man delar (ingen egen opt-in), röstandet är separat och aktivt.
- Panelens villkor (Security, Legal, DPO, DBA, Scoring) gäller som bindande acceptanskriterier; dölj "N av M" när hushållet är två personer.
- Malin 2026-10-31: hushåll = personer som bor ihop. Två abonnemang på samma tjänst i ett hushåll är ett misstag att rätta, inte olovlig kontodelning. "Betalas dubbelt" och råd att behålla ett får visas. Detta är ett daterat efterträdande beslut till ADR 0010 punkt 3 och skrivs in i ny ADR (0017).
