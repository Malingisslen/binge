# Plan — BIN-915 avgjord: den svalda transaktionsfelvägen accepteras

Datum: 2026-08-16. Bevakad session. Malin: *"jag accepterar risken vid tillfälligt
fel i betygsättningen snarare än att införa en kostnad."*

Det här är inte ett bygge. Det är att skriva ned ett beslut på de tre ställen som
idag påstår att det är oavgjort — och att stänga biljetten.

## Rollkastning — körd FÖRE planen

`node docs/org/route.mjs functions/src/communityRatings/runAggregate.ts
src/test/rules/community-ratings-orchestrator.test.ts
.claude/rules/accepted-deviations.md`

| tier | reasonCode | panel | highStakes |
| --- | --- | --- | --- |
| `medium` | `owned` | #27 Databasansvarig | inga |

**Ingen ny kritik hämtas.** #27:s kritik från 2026-08-15 ställde exakt den här
frågan som sitt villkor 5, och formulerade själv vad ett "svälj det"-svar kräver:
*"en daterad rad i `accepted-deviations.md`"*. Rollen bad om ett beslut, inte om
en lösning. Beslutet är fattat av den enda som kan fatta det, och det uppfyller
villkoret ordagrant. Att köra kritiken igen vore att fråga om samma sak två
gånger.

## Vad som beslutades

`communityRatingMaintain` fångar och loggar varje transaktionsfel och returnerar
normalt. Konsekvensen, oförskönad: **det betyget saknas permanent i aggregatet och
självläker aldrig** — en senare ändring 4→5 bär `countDelta: 0`, så antalet ligger
kvar en för lågt för alltid.

Alternativet är `retry: true` på en trigger som fyrar vid **varje**
watchlist-skrivning, mot 25 kr/mån-taket, för att skydda ett snitt som bara visas.
Malin väljer risken framför kostnaden.

## Acceptanskriterier

1. `.claude/rules/accepted-deviations.md` får en daterad post — #27:s villkor 5
   ordagrant uppfyllt. Posten säger vad som accepteras, varför, vad som INTE
   accepteras, och vad som skulle öppna frågan igen.
2. `runAggregate.ts`:s doc-kommentar slutar säga "filed as its own ticket, not
   decided here". Den meningen blir falsk i samma stund beslutet fattas, och en
   kommentar som ljuger är precis det granskarna fällde två gånger i förra
   omgången.
3. Samma rättelse i testfilens motsvarande kommentar (rad ~506).
4. BIN-915 stängs med beslutet skrivet på biljetten — **före** commiten, inte efter.
   Posten och båda kommentarerna säger "BIN-915, closed"; om stängningen låg efter
   skulle den meningen vara falsk i det ögonblick den landar, och en senare sprint
   kunde plocka upp biljetten igen. **Gjort: stängd som Canceled 2026-08-16**
   (avgjord, inte byggd).
5. Ingen kodväg ändras. `logger.error` står kvar — driften syns inte i datan, så
   loggraden är det enda ställe den existerar.

## Öppna frågor

Inga. Den enda fanns i BIN-915 och är besvarad av Malin.
