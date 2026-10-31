# BIN-1475 Morgonfrågan: plan

## Vad användaren får
- En notis per dag kl 08:00 svensk tid: "Igår kom 3 avsnitt du följer". Inget nytt, ingen notis.
- Notisen öppnar en lista i Binge. Varje rad: affisch, serie, avsnittskod, knapp "Sedd?". Under listan en Klar-knapp.
- "Sedd?" bockar av avsnittet precis som idag (samma skrivning som vanliga avsnittsmarkeringen). Klar stänger listan och markerar notisen läst.
- Hoppar man över listan händer inget: serien förblir "aktiv" och ingen straffas.

## Ersätter eller kompletterar? Förslag (ändrat efter rollkritiken): ett val per användare
Dagens "Nytt avsnitt, X S02E05 har släppts" skickas direkt, utan fråga. Rollkritiken: att tyst byta det mot en notis upp till 24 timmar senare ändrar ett löfte användaren redan sagt ja till. Förslag: under "Nya avsnitt" i Inställningar väljer man "Direkt" (som idag, förvalt) eller "En gång om dagen på morgonen" (morgonfrågan). Man får aldrig båda för samma avsnitt. Bara de som väljer morgon hamnar i väntelistan.

## Bindande villkor från rollkritiken (Community Manager)
- Exakt EN push per dygn och användare, även vid omkörning (idempotens-id per datum gäller push och notis). Tyst dag = ingen notis. Ingen påminnelse om listan hoppas över.
- Ingen räknare, streak eller "inaktiv"-markering. Testas: hoppar man över listan händer inget.
- Inga spoilers: bara serienamn och avsnittskod, aldrig avsnittstitel eller handling.
- Antalet i texten räknar bara det som listas.
- Inställning och följning kontrolleras vid utskick kl 08, inte bara när avsnittet köas.
- Köposter raderas först efter lyckad skrivning; missad körning tas nästa dag utan dubblett.
- Kön rensas vid kontoradering och av retentionCleanup efter 3 dagar.

## Teknik (Cloud Functions, ingen ändring av Firestore-regler)
1. episodeReleaseNotify: oförändrad upptäckt och markör. Skriver inte längre notis/push per avsnitt utan en post i en väntelista `episodeDigestQueue/{uid}_{tmdbId}_{episodeId}` (bara Admin SDK, regler nekar redan allt som inte nämns).
2. Ny schemalagd funktion `episodeMorningDigest`, `0 8 * * *` Europe/Stockholm (samma mönster som weeklyDigestNotify). Läser väntelistan, grupperar per användare, skriver EN notis `kind: 'episode_digest'` (id `episode-digest-<datum>`, så en omkörning inte ger dubbletter) med lista över avsnitt, skickar EN push, raderar väntelistposterna.
3. Klient: ny `kind` i useNotifications, rad i klockan (TopbarActions) och en lista-vy. Avbockning återanvänder befintlig markera-avsnitt-skrivning. Regeln för notiser tillåter redan att klienten bara ändrar `read`.
4. Texten säger "Igår" bara när alla avsnitt sändes igår, annars "Nytt sedan igår", så den aldrig ljuger.
5. Arbetsflödeskartan får det nya flödet (deploy-gaten kräver det).

## Kostnad
- Läsningar: bara de som motsvarar nya avsnitt, inte hela bevakningslistan. Samma storlek som dagens notiser.
- Ett nytt Cloud Scheduler-jobb. Projektet har redan ett tjugotal schemalagda funktioner; Google ger tre jobb gratis och därefter ca 1 kr/mån per jobb. Det ska bekräftas i Firebase-konsolen innan bygge. Räknas in i taket på 25 kr/mån.
- Ingen ny betaltjänst.

## Gränser att veta om
- Ett släpp av flera avsnitt samtidigt (hel säsong) visas som ett avsnitt, det sista, eftersom upptäckten bara ser senaste avsnittet. Samma som idag.
- Bara de som är "ikapp" får frågan, som idag. Den som ligger efter får ingen.
- Väntelistan är kortlivad persondata (vem följer vilken serie). Posterna raderas efter morgonutskicket och ska även rensas av kontoradering och retentionCleanup (en bakgrundsrensning av poster äldre än 3 dagar). Inget går in i dataexporten eftersom det bara är en kö, inte användarens data.

## Granskning och test
- Router: medium (Community Manager) när regler inte ändras. Går någon regel- eller inloggningsfil in blir det full panel.
- Före commit: binge-code-reviewer över diffen och reviewer för Cloud Functions enligt commitspärren.
- Tester: logikfil med rena funktioner (gruppering, "Igår"-text, idempotens), enhetstester för dem, klienttest för listan.

## Fråga till Malin
Ska man själv välja mellan "Direkt" och "En gång om dagen på morgonen" i Inställningar (förslag, förvalt Direkt), eller ska morgonfrågan ersätta den direkta pushen för alla?
