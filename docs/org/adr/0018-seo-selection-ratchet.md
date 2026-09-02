# ADR 0018 — BIN-823 SEO-urvalet blir en persisterad spärrhake i stället för att härledas per bygge

**Date:** 2026-08-08 · **Status:** Accepted (Malin) · **Via:** deterministisk routing (`node docs/org/route.mjs` → tier `medium`, panel `[3] Financial Controller`) + blind kritik från #3 (godkänd med villkor, fem villkor infogade) + fresh-context plangranskning (initialt ❌ BLOCKED på sex röda fynd, samtliga åtgärdade)

## Context

En Search Console-genomgång 2026-08-08 visade att binge.nu avindexerade sig själv.
Indexerade sidor hade fallit 264 → 117 på fem veckor, och 16 av 20 stickprov ur de 117
adresser Google FORTFARANDE hade i sitt index svarade `noindex` + `canonical:
https://binge.nu/`. Ingen indexerad sida hade omgenomsökts sedan 21–28 april;
genomsökningsbudgeten sjönk från ~750 hämtningar/dag i maj till ~100/dag.

Rotorsaken var inte teknisk sönderdelning utan en instabil URL-mängd. Urvalet av vilka
~31 000 sidor som pre-renderas (15k film + 15k serie + 1k person) härleddes FÄRSKT ur
TMDB:s `popular`/`top_rated`-listor vid varje bygge — ~8 200 ocachade TMDB-anrop per
deploy, varav hälften för att `sitemap.ts` gjorde om exakt samma härledning en andra
gång på egen hand. TMDB:s ranking roterar veckovis, alltså roterade urvalet med den. En
titel som ramlade ur listan slutade pre-renderas och föll till catch-all-routen, vars
`noindex` är en medveten och korrekt default mot soft-404:er (ADR-lös, men dokumenterad
i `src/app/[...path]/page.tsx` och commit `10e46d0`, som stoppade 30 000+
soft-404-dubletter när GSC visade 4 indexerade / 43 233 ej). Rätt skydd mot en okänd
sökväg; förödande mot en sida Google redan hade indexerat.

Samma listanrop var dessutom BIN-815:s hängningsklass: `params:person-ids` satt 2 672
sekunder 2026-08-08 och fällde deployen på byggstegets 45-minuterstak.

Git-arkeologi (fullständig historik för `seoCoverage.ts`, `seoPersonIds.ts`,
`sitemap.ts`, `movie/[id]/page.tsx`) visar att per-bygge-härledningen **aldrig var ett
avvägt beslut**. Ursprungscommiten `60e427a` (2026-05-22) introducerade den utan att
nämna alternativ, och varje senare ändring (BIN-109 `cappedTitleIds`, BIN-337/ADR 0005
`collectPersonIds`, non-Latin-filtret, content-floor) arbetade på att göra de två
härledarna IDENTISKA — aldrig på frågan om de behövde härleda alls.

## Decisions

### Fork A — SPÄRRHAKE, inte frysning och inte fortsatt rotation

Urvalet persisteras i `.tmdb-cache/selection-{movie,tv,person}.json` och rider på samma
`actions/cache`-livscykel som detaljcachen. Veckobygget (cron + `full_refresh`) härleder
om och **unionerar** med det befintliga urvalet; en kod-deploy läser bara filen och gör
noll listanrop.

**Varför inte ren frysning:** nya populära titlar hade aldrig fått en sida, och
nyindexeringen hade dött med rotationen. **Varför inte fortsatt rotation:** det är buggen.
Ett id lämnar urvalet först när taket tvingar fram evakuering, och då går äldst
`lastDerived` först — långsamt, vid marginalen, i stället för veckovis genom hela listan.

Ordningskontraktet (`mergeManifest`): behållna id:n behåller sin first-seen-position, nya
appendas i härledningsordning, evakuering sorterar på `lastDerived` stigande och —
**vid lika ålder — senast tillkommen först ut**. Överlevarna emitteras i
first-seen-ordning. Determinism krävs eftersom sitemap och pre-render måste ge exakt
samma mängd.

Tiebreak-riktningen är inte kosmetisk. En full refresh bumpar alla närvarande id:n till
samma tidpunkt, så oavgjort är NORMALFALLET. Den första implementationen sorterade
oavgjort åt andra hållet (först insatt först ut) och evakuerade därmed de sittande till
förmån för nykomlingar: replay med tak 1 000 och en härledning på 3 000 gav **0 av 1 000
överlevande efter en veckas refresh** — 100 % rotation, persisterad och tyst, alltså
exakt buggen igen. Fångat av integrationsgranskningen 2026-08-08; koden hade fel och
testet pinnade felet som avsikt. Regressionstestet replayar nu det scenariot.

### Fork B — Taken låses vid DAGENS nivåer; en höjning är ett separat, kostnadssatt beslut

`SELECTION_CEILING` sätts till 15 000 / 15 000 / 1 000 — oförändrat mot dagens TAK.

**RÄTTELSE (integrationsgranskningen, rond 6).** Den här sektionen sa tidigare "precis
vad urvalet effektivt rymmer idag. Noll kostnadsrörelse". Taket är oförändrat, men det
var aldrig det som byggdes: rotationen nollställde urvalet varje bygge, så den REALISERADE
siffran var ~20 800 sitemap-URL:er (mätt 2026-08-08), inte 31 000. Spärrhaken gör taket
NÅBART för första gången — unionen växer monotont mot 15 000/15 000/1 000 över de
kommande månaderna och krymper aldrig.

Det är alltså **inte** noll kostnadsrörelse. Räkningen, med ADR:ns egen formel:

| | idag | vid taket |
|---|---|---|
| sitemap-URL:er | ~20 800 | ~31 000 |
| byggda sidkataloger | ~22 900 | ~33 100 |
| per deploy | ~10 GB | ~14,5 GB |
| lagring (3 releaser) | ~30 GB | ~43 GB |
| **kostnad** | **~8,3 SEK/mån** | **~12 SEK/mån** |

**+3,7 SEK/mån** av 25 SEK-taket, infasat över ~2–3 månader.

Två baslinjer figurerar i det här dokumentet och de får inte blandas ihop:

- **Från idag (8,3):** spärrhaken kostar **+3,7**. Det är den siffra Malin fattade beslut
  på, och den planen kallade "noll".
- **Från idag (8,3) till utkastets 20k/20k/1,5k:** **+7,5** — inte de +2,9 som stod här
  före rättelsen nedan. #3 Financial Controller avvisade alltså en höjning på fel
  underlag; korrekt räknad är den nästan tre gånger så dyr som avslaget antog.
- **Från 12 (efter spärrhaken) till samma höjning:** +3,8. Det är den marginal en
  framtida takbiljett faktiskt handlar om.

Villkor 1 är därmed uppfyllt till bokstaven — taket rörs inte — medan åtagandet ändå
sker. Skillnaden i sak: de +7,5 vore täckning UTÖVER vad taket lovar, medan de +3,7 är
priset för att leverera den täckning taket redan lovade och rotationen tyst höll tillbaka.

Malin godkände Fork B på formuleringen "noll kostnadsrörelse". Hon fick den korrigerade
siffran innan commit, 2026-08-09, och svarade "helt ok kostnad".

Vill man ändå inte betala är åtgärden att SÄNKA taket, inte att röra spärrhaken — den är
det enda som stoppar avindexeringen.

Detta är #3 Financial Controllers bindande villkor 1. Utkastet föreslog 20k/20k/1,5k
(41 500 id). Firebase Hosting debiterar lagring ~$0,026/GB/mån och binge behåller
3 releaser.

**Ankaret, och varför det måste anges:** de ~10 GB per deploy är MÄTTA vid dagens
byggda ~22 900 sidkataloger — alltså vid den REALISERADE täckningen (~20 800
sitemap-URL:er), inte vid taket. Den ursprungliga versionen av det här stycket räknade
som om 10 GB gällde taket, och gav då "vid 41 500 sidor ~40 GB ≈ 11,2 SEK/mån (+2,9)".
Det är fel på samma sätt som "noll kostnadsrörelse" ovan var fel, och sida vid sida med
rättelsetabellen påstod ADR:n att ett STÖRRE tak lagrar MINDRE (40 GB) än dagens (43 GB).
Siffrorna 11,2 och +2,9 är alltså **beräknade före rättelsen** och ska inte citeras.

Räkna alltid per sida, mot den mätta punkten:

```
GB_per_deploy = sidkataloger / 22 900 × 10 GB          (22 900 dirs = 10 GB, mätt)
SEK_per_mån   = GB_per_deploy × 3 releaser × $0,026/GB/mån
```

| | sidkataloger | per deploy | lagrat | kostnad |
|---|---|---|---|---|
| idag (realiserat) | ~22 900 | ~10 GB | ~30 GB | **~8,3 SEK/mån** |
| dagens tak, när spärrhaken fyllt det | ~33 100 | ~14,5 GB | ~43 GB | **~12 SEK/mån** |
| utkastets 20k/20k/1,5k | ~43 600 | ~19 GB | ~57 GB | **~15,8 SEK/mån** |

Den avvisade höjningen kostar alltså **+7,5 räknat från idag** (15,8 − 8,3), eller
**+3,8 räknat från de 12 spärrhaken landar på** — inte +2,9. Beslutet att avvisa den
fattades på ett tal som var mindre än hälften av det rätta; slutsatsen står, underlaget
gjorde det inte. Beloppet är litet; problemet är att spärrhaken är
ENVÄGS — den växer men krymper aldrig frivilligt — så en takhöjning är ett permanent
åtagande mot en budget som redan delas med rollup-functions och notiser. Att bunta det med
en förbättring som utgavs för att vara gratis hade gjort det till ett beslut ingen fattade.

Frö-sidorna (nedan) räknas **utanför** taket: `resolvedIds` kan ge upp till tak + 116.
Räkna på den basen vid en höjning (#3:s villkor 4).

### Fork C — Täckningsgolv som fäller bygget, inte en tyst fallback

Om det upplösta urvalet för någon typ understiger `max(absolut golv, 80 % av föregående)`
kastar `generateStaticParams` och bygget blir RÖTT.

Utan golvet införde spärrhaken en ny tyst katastrofväg: manifest borta (evakuerad
`actions/cache`) + misslyckad härledning ⇒ `SEO_FALLBACK_*` ger 10 id per typ ⇒ ~150
sidor ⇒ **grönt bygge** ⇒ `firebase deploy` ersätter ~31 000 sidor med 150. Dagens
felbeteende (hängning → rött bygge → gamla sajten kvar) är bevarat med flit; det som
försvinner är 44-minutershänget, inte högljuddheten.

**Golvet är ABSOLUT, inte relativt.** Ett relativt golv (jämför mot föregående manifest)
kan per konstruktion aldrig fyra, eftersom spärrhaken garanterar att urvalet aldrig
krymper — det upptäcktes av ett test som förväntade sig ett kast och fick ett grönt
resultat. Den farliga vägen har `previousCount = 0`, alltså inget att jämföra mot.
80 %-regeln finns kvar som komplement för den dag mergen får en väg att krympa.

`SELECTION_ALLOW_THIN=1` stänger av **två** skydd — täckningsgolvet OCH sitemapens kast
(Fork E) — och sätts i **två** workflows, av två olika skäl:

- `ci.yml` bygger med `NEXT_PUBLIC_TMDB_API_KEY: ci-dummy`, där varje hämtning failar
  med flit. Uttrycklig flagga i stället för att gissa på nyckelns värde — en CI-detalj
  hör inte hemma i produktionskod.
- `preview.yml` saknar både `.tmdb-cache`-restore och step-timeout, så den härleder från
  kall cache varje gång under 15-minuters räddningstaket. Ett tunt urval är där det
  normala utfallet, och en preview-kanal ersätter aldrig binge.nu. (Tillagd i samma
  commit som ADR:n; utan den blir varje dependabot-PR röd på golvet.)

`deploy.yml` — den enda vägen till produktion — sätter den ALDRIG, och det är den
egenskap golvet vilar på.

> **Efterföljare 2026-08-27 (BIN-1028).** De två workflows som stycket ovan namnger,
> `ci.yml` och `preview.yml`, är raderade på Malins beslut: de körde aldrig på main och
> `preview.yml`s byggsteg refererade dessutom `secrets.NEXT_PUBLIC_FIREBASE_*`, och dess
> deploy-steg publicerade en live-kanal.
> `SELECTION_ALLOW_THIN` sätts därmed av ingen workflow alls och är numera ett lokalt
> verktyg. Beslutet i det här protokollet står oförändrat — det som ändrats är VAR flaggan
> sätts, inte varför den finns eller varför `deploy.yml` aldrig får sätta den. Stycket ovan
> är historik och redigeras inte.

### Fork D — Committad frö-lista över det Google faktiskt hade indexerat

`src/lib/seo/selectionSeed.ts` bär de 116 TMDB-id:n (74 film, 32 person, 10 serie) som
motsvarar GSC:s 117 indexerade sidor 2026-08-08. De unioneras in vid LÄSNING och lagras
aldrig i det evakuerbara manifestet, så de kan varken evakueras av taket eller gå
förlorade med cachen.

Ett dött frö-id blir ingen soft-404: `generateMetadata` fångar redan en misslyckad
byggtidshämtning och svarar `noindex, follow` med self-canonical. Kostnaden är en
bortkastad byggplats. Därför är omvalidering mot TMDB en uppföljning, inte en blockerare.

### Fork E — Sitemapen läser samma artefakt i stället för att härleda

Paritetsinvarianten ("sitemap MÅSTE adressera samma URL-mängd som pre-rendren", ADR 0005
och `sitemap.ts`) gick tidigare ut på att två oberoende kodvägar råkade ge samma svar.
Nu är den strukturell: en artefakt, två läsare. Byggfasordningen garanterar läsordningen
— alla `generateStaticParams` ("Collecting page data") är klara innan "Generating static
pages" börjar, där `sitemap.ts` körs.

Sitemapen **kastar** om ett manifest saknas i stället för att falla tillbaka. Det är en
medveten omvändning av tidigare beteende: när den själv hämtade från TMDB var det rätt
att låta en nätverkshick ge en mindre sitemap. Nu läser den en lokal fil som pre-rendren
precis skrivit, och en sitemap med bara de statiska familjerna vore ett aktivt felaktigt
påstående till Google om att sajten har ~60 sidor.

**Med ETT undantag: `SELECTION_ALLOW_THIN`.** Samma flagga som stänger av golvet stänger
av det här kastet, och den måste göra det för att lättnaden ska vara hel. En preview med
kall cache vars personhärledning slår i räddningstaket skriver ALDRIG något manifest
(`resolveSelection` behåller bara ett befintligt, och det finns inget), så previewen hade
gått röd här i stället för på golvet — mätt persontid 2 672 s mot ett tak på 900 s, alltså
den förväntade grenen. Under flaggan returneras frö-id:na, exakt samma mängd som routen
själv bygger i det läget. Att radera den grenen som "en bugg mot Fork E" gör varje
dependabot-PR röd igen; det var precis vad den infördes för att stoppa. Undantaget är
säkert av samma skäl som golvets: `deploy.yml` sätter aldrig flaggan.

> **Efterföljaren 2026-08-27 (BIN-1028) gäller det här stycket också.** Previewen det
> talar om finns inte längre — `preview.yml` och `ci.yml` är raderade. Dependabot-PR:erna
> finns kvar; det är bara workflowen som byggde previewen som är borta. Undantaget i koden står kvar och är fortfarande rätt, men dess motivering är
> numera ett lokalt bygge utan TMDB-nyckel, inte en preview-kanal. Stycket är historik och
> redigeras inte; markören står här så att en läsare som landar mitt i protokollet ser
> det utan att behöva hitta addendumet under Fork C.

## TMDB ToS §1.C — Malins beslut

TMDB:s villkor förbjuder caching av API-härledd data > 6 månader. Repots tidigare analys
(ADR 0009, `tmdbFieldsSweep`) gällde uteslutande Firestore-persondata på
`users/{uid}/watchlist` — dokument som ligger dormanta på konton som aldrig återbesöks.

Spärrhaken innebär att ett titel-ID kan ligga kvar i urvalet på obestämd tid. Malins
beslut 2026-08-08: **OK — ett id i en urvalslista är inte cachead API-data.** Den METADATA
som visas på sidan uppdateras var 30:e dag (`buildCache.HARD_TTL_MS`), väl inom
6-månadersgränsen; det som persisteras länge är bara vilken URL vi väljer att bygga,
jämförbart med en bokmärkeslista. Frågan lyftes till henne i planen i stället för att
lösas i en kommentar, eftersom den är juridisk och tolkande.

## Alternatives considered

- **Frysa listan helt.** Förkastat: svälter nyindexering (Fork A).
- **Höja taken samtidigt.** Förkastat av #3: blandar ett permanent kostnadsåtagande med
  en nollkostnadsfix (Fork B).
- **Låta fallbacken deploya.** Förkastat: den tysta katastrofen (Fork C).
- **Behålla sitemapens egen härledning.** Förkastat: 4 100 anrop till ingen nytta, och
  paritet som vilar på tur (Fork E).
- **En per-anrops-timeout som fix på BIN-815.** Förkastat efter mätning: den fanns redan
  (`AbortSignal.timeout(20 s)`). Det som saknades var ett tak på HELA fasen —
  `withAggregateTimeout`, kort (15 min) på räddningsvägen, långt (150 min) i veckobygget.

  **Bara räddningsvägen är faktiskt skyddad.** 15 inom byggstegets 45 lämnar tid att
  bygga färdigt på det gamla urvalet. 150 inom 175 gör det inte — slår taket till
  återstår ~25 min för en rendrering på 90–120 min, så veckobygget slutar som
  steg-timeout ändå. Ofarligt (det är beteendet före BIN-823 och deployar ingenting),
  men veckobygget är alltså INTE skyddat mot en hängd härledning, bara mot en
  oändlig. Något värde som rymmer både den enda kalla mätningen (44,5 min för person)
  och rendreringen (90–120 min ⇒ fönster 55–85 min) finns i teorin, men marginalen är
  tio minuter mellan två enskilda mätningar. Väntar på data: BIN-826.

## Consequences

- Kod-deployer gör **noll** listanrop (från ~8 200) och kan inte längre hänga i den fasen.
- Urvalsrotationen upphör; avindexeringen ska stanna av. Följs i GSC veckovis.
- Nytt fellägen att känna till: ett rött bygge med `[selection] …` i loggen betyder
  "urvalet blev för tunt", inte "koden är trasig". Utvägen står i felmeddelandet.
- `.tmdb-cache/` blir mer värdefull: förlorar man den kostar nästa bygge en full
  härledning (under fastak). **Mätt 2026-08-08 (#3:s villkor 3): 1,9 GB / 41 204
  filer** mot GitHubs 10 GB-repogräns — ~19 %, god marginal.
  Samma ankarfel som i Fork B gällde här: 1,9 GB är mätt vid dagens REALISERADE
  ~20 800 id, inte vid taket. Skalat per id blir dagens tak ~2,8 GB och
  20k/20k/1,5k ~3,8 GB — båda fortfarande långt under 10 GB, så slutsatsen står,
  men citera inte den tidigare siffran ~2,5 GB.
- **Härledningen är opålitlig, och det var okänt innan detta arbete.** Ett lokalt
  bygge 2026-08-08 gav 4 375 film-id mot produktionens ~9 850. TMDB stryper, och
  `Promise.allSettled` sväljer de listsidor som failar — en härledning kan alltså
  vara halverad utan att något syns i loggen. Det betyder också att en del av den
  rotation BIN-823 beskriver troligen INTE kom från att TMDB:s ranking ändrades,
  utan från att olika slumpmässiga delmängder av listanropen lyckades vid olika
  byggen. Spärrhaken läker båda. Värt en egen biljett om det ska mätas.
- `SEO_TITLE_TARGET_IDS` är inte längre ett täckningstak utan ett säkerhetsnät (höjt
  15 000 → 30 000). Sänks det tillbaka till taknivån besegras spärrhaken tyst: id:n som
  roterat ut når då aldrig fram till mergen.

### Invarianten som faktiskt styr spärrhaken: TAK > HÄRLEDNING

Den kostade två felaktiga rundor att formulera och förtjänar en egen rubrik.

En spärrhake fungerar bara om taket har plats kvar när mergen är klar. Är härledningen
lika stor som taket fyller varje färsk körning taket på egen hand, mergen hamnar alltid
över, och evakueringen tar exakt de id:n som ramlat ur veckans lista — resultatet blir
**identiskt med den färska härledningen** och hela mekaniken är en nolloperation.

- **Titlarna** klarar sig av en lycklig omständighet, inte av design: härledningen ger
  ~10–12k mot ett tak på 15 000, alltså 3–5k luft. `SEO_TITLE_TARGET_IDS` (30 000) är
  bara ett absurditetsfilter och får aldrig sänkas till taknivån.
- **Personsidorna hade ingen luft alls** (1 000 mot tak 1 000) och saknade därmed
  spärrhake helt fram till integrationsgranskningen 2026-08-08. `SEO_PERSON_TARGET_IDS`
  är därför **sänkt till 800**: vi härleder de 800 mest framträdande och taket rymmer
  1 000, så de ~200 senast ur-roterade ligger kvar indexerade i stället för att svara
  `noindex` veckan efter. Taket (och därmed kostnaden) är orört — #3:s villkor 1 gäller.
- Att i stället **höja** talet hjälper inte, vilket är den intuition som gick fel två
  gånger (3 000 prövades under BIN-823, och granskningen föreslog samma sak igen). Ett id
  som ramlat ur härledningen evakueras ändå, bara mot en djupare lista. Simulerat och
  pinnat som beteendetest i `selectionManifest.test.ts` — 800 → överlever, 1 000 → nej,
  3 000 → nej.

Den ursprungliga 3 000-höjningen var alltså inte ensam skyldig till den veckovisa
personrotationen; den **omvända sorteringsordningen** i evakueringen var den verkliga
buggen (rättad, se Fork A). 3 000 gjorde bara att buggen träffade varje bygge.

### Rättelse om budgetkonkurrens

En tidigare formulering här sa att värsta fallet vid dubbel-kall start är "ett rött bygge
(golvet), aldrig tyst degradering". Det överdriver skyddet. Golvet räknar ID:N, inte
metadata. Om personhärledningens ~2 000 `fetchForBuild`-anrop tömmer worker-budgeten
innan sidornas egen metadata hämtas, kastar `fetchForBuild` och varje
`generateMetadata`/page-body fångar redan det och svarar `noindex, follow` +
self-canonical. Bygget blir alltså GRÖNT med tunnare sidor än vanligt — inte rött.
Självläker nästa bygge när cachen är varm. Risken är liten men den är av annan art än
den som stod här.

### Efterföljare 2026-09-02 (BIN-826): härledningens storlek syns numera i loggen

Konsekvensposten "Härledningen är opålitlig, och det var okänt innan detta arbete" ovan
slutar med *"Värt en egen biljett om det ska mätas."* Den biljetten är byggd. Posten står kvar
ordagrant — ett beslutsprotokoll rättas inte, det får en daterad efterföljare — men den
beskriver inte längre nuet.

`resolveSelection` skriver sedan den här ändringen en rad per typ vid varje LYCKAD
härledning:

```
::notice::[selection] <typ> utbyte: behållna N, evakuerade N, nytillkomna N,
varav omhärledda N av N. Härledningen gav N id, manifestet håller N (tak N). …
```

`Härledningen gav N id` är precis det tal som saknades: en halverad härledning syns nu
som ett halverat tal, bygge för bygge. Två tysta vägar till stängdes i samma ändring — en
härledning som LYCKAS med tom lista, och en härledning som når taket och därmed
degraderar spärrhaken till rotation — båda som `::warning::`.

Vad som INTE är löst: `Promise.allSettled` sväljer fortfarande de listsidor som failar,
så raden mäter utfallet, inte orsaken. Och `REFRESH_DERIVE_TIMEOUT_MS` är oförändrad —
den kräver några veckors data och är fortfarande spårad i
BIN-826, som därför inte får stängas som helt klar.
