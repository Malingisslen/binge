# Dataretention + anonymisering-policy

_Status: 2026-04-24. Gäller från sprint 4._

## Policy-beslut

När ett konto raderas (via `Settings → Ta bort konto`) hanterar vi publikt
UGC enligt följande regler.

### Privat data → Hård radering

Allt som bara användaren själv ser tas bort helt:

- `users/{uid}` (privat profil-doc; sedan BIN-505 ägar-låst läsning)
- `publicProfiles/{uid}` (BIN-505 — den publika projektionen; TOP-LEVEL, ej en
  user-subcollection, så den raderas explicit i `collectDeletionRefs` via
  `snaps.publicProfileSnap.ref`, inte via subcollection-guarden)
- `users/{uid}/watchlist/*`
- `users/{uid}/watchlistTags/*` (privata fritext-taggar, BIN-164)
- `users/{uid}/watchlistNotes/*` (privata fritext-anteckningar, BIN-505 — flyttade
  av från den publikt läsbara watchlist-doc:en; free-text kan fånga tredjeparts
  personuppgifter, samma DPO-resonemang som taggar)
- `users/{uid}/episodeProgress/*`
- `users/{uid}/notInterested/*`
- `users/{uid}/notifications/*`
- `users/{uid}/blocked/*`
- `users/{uid}/following/*` (ensidig)
- `users/{uid}/followers/*` (matchande följ-relationer på andra håll)
- `users/{uid}/friends/*` (+ speglad radering på vännens sida)
- `users/{uid}/friendRequests/*` (inkommande, + speglad sent-sida)
- `users/{uid}/friendRequestsSent/*` (utgående, + speglad in-sida)
- `users/{uid}/groupInvites/*` (inkomna grupp-inbjudningar)
- `users/{uid}/listFollows/*` (följda listor, BIN-96)
- `users/{uid}/pauseHistory/*` (paus-/återupptag-historik från Sparande)

#### Operationell metadata → Hård radering

Teknisk metadata som användaren aldrig ser men som ändå raderas helt vid
kontoradering (samlas via samma `collectUserDataSnapshots`-helper):

- `users/{uid}/fcmTokens/*` — push-enhetstokens; raderas så Cloud Functions
  slutar försöka skicka push till ett raderat konto
- `users/{uid}/reportMeta/*` — rapport-throttle-stämpel (anti-abuse, BIN-25/49)
- `users/{uid}/askBingeMeta/*` — Fråga Binge LLM-throttle-stämpel (kostnadstak)

Dessa tre är medvetet UNDANTAGNA ur GDPR-exporten (Art. 20) — de är
drift-/säkerhetsmetadata, inte användarens egna data — men raderas ändå helt
vid kontoradering. Export och radering läser samma helper
(`src/lib/firebase/userData.ts`), så listorna hålls i synk: lägger man till en
ny user-owned subcollection måste helpern uppdateras så båda flödena får med den.

Inga återhämtningsbara referenser till datan finns efter radering,
förutom Firestore PITR inom 7 dagar (administrativt bara).

#### Per-titel-borttagning ("Ta bort" i biblioteket)

"Ta bort" på en titel raderar watchlist-docen men lämnar medvetet kvar
`users/{uid}/episodeProgress/{tmdbId}` — den som lägger tillbaka serien
återupptar där hen var. Användaren informeras i borttagnings-toasten
("Avsnittshistoriken sparas.") och kan välja **Rensa helt**, som även
raderar historik-docen (`clearEpisodeProgress`). Vid kontoradering
försvinner allt oavsett, enligt listan ovan.

### Publikt UGC → Hård radering (v1)

Public-facing UGC tas bort helt, INTE anonymiseras, för följande
anledningar:

- **Juridiskt rentare.** GDPR Art. 17 ger absolut rätt till radering
  när användaren begär det. "Vi tog bort ditt namn men behöll innehållet"
  är en laglig gråzon som vi inte vill testa.
- **Ingen threading-risk.** Binges reviews-kommentarer är grunda (inte
  Reddit-style nested trees). Borttagning av en kommentar bryter inte
  en konversation i oigenkännlig form.
- **Enkelt att implementera.** `deleteAccount`-cascaden behöver ingen
  speciell "anonymiseringsväg" — bara delete-ops.

Så vid radering:

- `reviews/{reviewId}` där `uid == me` → **delete**
- `reviews/*/comments/{commentId}` där `uid == me` → **delete**
- `reviews/*/likes/{uid}` där doc-id == me → **delete**
- `*/reactions/{reactionId}` (avsnitts-reaktioner, BIN-95) där `uid == me` →
  **delete** (collection-group). Ingen TTL-sweep — reaktioner behandlas som
  innehåll (likt reviews) och raderas bara vid kontoradering, inte på ålder.
  Se Console-bypass nedan för konton som raderas utanför app-cascaden.
- `lists/{listId}` där `uid == me` → **delete**
- `sessions/{sessionId}` där `hostUid == me` → **delete**

### Moderationsrapporter → Retention (Art. 17(3))

`reports/{reportId}` (UGC-rapporter, skapas via `submitReport`,
`src/lib/firebase/reports.ts`) är det medvetna UNDANTAGET från
raderingscascaden: `deleteAccount` rör dem aldrig, och `firestore.rules`
sätter `allow delete: if false` så klienten kan aldrig radera dem. Varje
rapport lagrar `reporterUid` (härlett från auth vid inskick), så en raderad
användares uid lever kvar i `reports/`.

**Beslut (BIN-277): behåll, anonymisera inte.** Rättslig grund: GDPR
Art. 17(3) — rätten till radering väger inte över när behandlingen behövs för
(b) att fullgöra en rättslig förpliktelse respektive (e) att fastställa, göra
gällande eller försvara rättsliga anspråk, samt det berättigade intresset av
abuse-hantering. Att anonymisera rapportören skulle bryta moderations-
spårbarheten: vi kunde inte längre upptäcka serie-falskanmälare, knyta en
anmälan till god tro, eller försvara ett moderationsbeslut i efterhand.

**Retention-fönster:** ingen auto-utgång idag (v1) — rapporter behålls så
länge moderationsbehovet finns; omvärderas vid skala (se Re-visit triggers).
Detta är en smal, dokumenterad PII-retention och rapportinnehållet är aldrig
publikt (klienten kan bara `create`, aldrig `read` — admin läser via Console).

**Transparens:** integritetspolicyn bör nämna att en anmälares uid kan behållas
i moderationssyfte efter kontoradering (Art. 13/14). Spåras som copy-följdpunkt
— ingen brådska nu när grunden är dokumenterad här.

### Grupp-medlemskap → Självborttag

När användaren raderas:

- I `groups/{groupId}` där `memberUids` innehåller mig → **ta bort mig
  ur array:en**
- `groups/{groupId}/joinAttempts/{myUid}` (BIN-329) → **delete**. Doc:et
  innehåller plaintext-invite-tokenet jag en gång skickade vid en token-join.
  `deleteAccount` raderar det per grupp jag är medlem i (omedelbar radering);
  den schemalagda `retentionCleanup`-sweepen tar resten — attempts i grupper jag
  aldrig blev medlem i (avbruten join) och konton raderade via Firebase Console
  (som inte kör klient-cascaden alls) — efter 1 timme. Ett lyckat join raderar
  sitt eget attempt på sekunder, så allt äldre är en spent-token-orphan.
  UNDANTAGET ur exporten (gruppens delade hemlighet, inte personuppgift).
- Om jag är owner (`ownerUid == me`) och det finns andra medlemmar →
  transferera ownership till första andra medlemmen (kommande sprint —
  TODO). För nuvarande: om owner raderar sig lämnas gruppen ägarlös och
  kan inte modifieras (okej tillstånd eftersom owner ändå kan delete:a
  gruppen först).

### Hushålls-bidrag (delade prenumerationskostnader) → Samtyckesbaserad, självstyrd radering (BIN-184, 2026-07-05)

`groups/{gid}/household/{uid}` — en OPT-IN "Hushåll"-yta i grupper. Varje
medlem skriver bara sitt eget bidrag (aldrig andras):

- **Innehåll:** `providerIds` (vilka tjänster), `providerCosts` (kr/tjänst,
  ordinarie pris — INGA nivå-/tier-namn, medveten minimering),
  `providerCampaigns` (kampanjpris + slutdatum, så kampanjer auto-återgår till
  ordinarie pris), `activeProviderIds` (vilka av tjänsterna som bär minst en
  osedd titel i backloggen — **usage-härlett, aldrig självrapporterat, och
  bara på tjänste-nivå, aldrig titel-nivå**; DPO-krav om att inte exponera VAD
  någon tittar på, bara VILKEN tjänst som bär vikt), `updatedAt`
  (server-stämplad).
- **Rättslig grund:** samtycke (art. 6.1.a) — explicit opt-in per grupp; en
  samtyckesskärm visas före första skrivningen. Att gå med i en grupp är INTE
  samtycke till att dela.
- **Vem kan läsa:** endast gruppmedlemmar som SJÄLVA delar (share-to-see-
  reciprocitet, `exists()`-check i `firestore.rules`) — se ADR 0010
  (`docs/org/adr/0010-household-read-gap.md`). Appens UI visar bara aggregat
  ("Disney+ betalas av 2 av er"), men en delande medlem kan tekniskt läsa en
  annan medlems post-för-post-lista; det är en medveten, founder-godkänd
  disclosure-lucka (ingen Cloud Function-proxy) — konsent-texten säger det
  rakt ut.
- **Radering:** ett tryck ("Sluta dela") raderar dokumentet omedelbart. Att
  lämna gruppen eller bli borttagen ur den raderar det också. Kontoradering
  kaskadar via BÅDA grenarna i `deleteAccount` (owner-grenen tar hela
  gruppens `household`-collection när gruppen raderas; medlems-grenen
  raderar bara mitt eget doc när jag lämnar) — emulator-testat.
- **Retention:** inget tidsbaserat utgångsdatum — dokumentet lever tills
  återkallelse/lämnande/borttagning/kontoradering.

### Användarnamn → Hård radering + release

`usernames/{username}` doc tas bort → användarnamnet blir tillgängligt
för framtida användare att claim:a.

Detta är en avvikelse från många plattformar som "tombstonar" usernames
för att förhindra imitation. Avvägning:
- Imitations-risken är låg (Binge är inte en celebrity-plattform)
- Låst-username-pool växer oändligt och är användarhostile

Om imitations-rapporter ökar senare — revisit: behåll username-doc med
`retired: true`-flagga, blockera claim.

**Föräldralösa reservationer (BIN-875, ADR 0020).** Löftet ovan kunde brytas
permanent fram till 2026-08-13. Kaskaden löste upp vilket handtag som skulle
frigöras ur profil-dokumentet, och ett avbrutet första försök hade redan raderat
det — så ett omförsök tappade reservationen tyst och handtaget stod upptaget för
alltid, av ett konto som inte finns. Två saker stänger det:

- Klienten frågar numera `usernames` på uid i stället, så ett omförsök hittar
  reservationen oavsett vad som redan är borta.
- `retentionCleanup` sveper dagligen efter `usernames/{name}` vars `uid` varken
  matchar ett `users/{uid}`-dokument eller ett levande Auth-konto, och frigör
  dem. Det täcker den som aldrig återvänder — inklusive den vars Auth-konto
  sopningen nedan hunnit ta först. Ett avstängt (men existerande) konto behåller
  sitt handtag; en misslyckad kontroll frigör ingenting.

### Avbruten kontoradering → fördröjning, inte brott

Raderingen tar bort Firestore-data först och Auth-kontot sist — klienten förlorar
varje skrivrättighet i samma stund som Auth-användaren är borta, så ordningen går
inte att vända. Ett avbrott däremellan (för gammal token, tappat nät) lämnar
alltså ett Auth-konto som lever med sin data raderad.

Malins beslut 2026-08-11 (**ADR 0019**): det tillståndet behandlas som en
**fördröjning inom artikel 12(3):s enmånadsfönster**, inte som ett brott mot
artikel 17 — **på villkor** att fönstret står skrivet här och att en sopning
håller det. Villkoret är inte kosmetiskt: utan sopningen finns ingen bortre gräns,
och då håller inte fördröjningsläsningen.

- **Fönster: 7 dygn.** `retentionCleanup` raderar dagligen Firebase Auth-konton
  som saknar ett `users/{uid}`-dokument och är äldre än så. Sju dygn ligger långt
  bortom varje övergående skrivfel vid registrering (de mäts i sekunder) och med
  god marginal inom enmånadsfönstret, även om en körning skulle missas.
- **Sopningen kan också VÄGRA.** Ett blast-radius-tak stoppar hela körningen om
  en orimlig andel av de kontrollerade kontona läses som föräldralösa — skyddet
  mot att en trasig fråga raderar alla på en gång. Vägran loggas och raderar
  ingenting, men den skjuter också upp fönstret ovan tills orsaken är åtgärdad.
  Igenkänning och åtgärd: `docs/RUNBOOK.md` §5d.
- **En nollträff betyder "kunde inte kolla", inte "fanns inget".** Både
  profil-kontrollen och Auth-kontrollen måste ha LYCKATS och svarat frånvarande;
  en misslyckad batch lämnar arbetet till nästa dag och loggas separat.
- **Enhetslokalt skydd, med kända hål.** Under tiden hindras profilen från att
  återskapas av en markör i `localStorage` (ADR 0019). Den finns per definition
  bara på den enhet raderingen startades på: en annan enhet, ett privat fönster
  eller rensad webbplatsdata har den inte. Det är det medvetet valda priset för
  att INTE lägga markören i Firestore — ett dokument under `users/{uid}` hade
  återskapat precis det som ska raderas (#5 Juridik, ADR 0019).
- **Och sopningen fångar INTE den som återkommer utan markör.** Öppnas appen på
  en markörlös enhet återskapar `ensureUserProfile` `users/{uid}` — och därmed
  ser sopningen ovan kontot som friskt och rör det aldrig. Sjudagarsfönstret
  gäller alltså den som aldrig återvänder någonstans; för den som återvänder på
  en annan enhet finns ingen bortre gräns förrän hen startar en ny radering.
  Upptäckt av integrations- och säkerhetsgranskningen 2026-08-13. Det är en
  öppen punkt, inte något den här texten påstår är löst — och den berör direkt
  det villkorade i Malins beslut ovan (ADR 0019 fråga 2), så den ska stängas
  eller omprövas, inte lämnas obeskriven.

### Avbrott mitt i kaskaden → kör om tills det är tomt

`applyDeletionPlan` committar i klumpar om ≤450 operationer. Varje klump är
atomär; serien av klumpar är det inte. Ett nätverksfel mitt i raderar alltså en
del av kontot och lämnar resten.

Läget löses av att användaren försöker igen: kaskaden bygger sin plan från
Firestore på nytt vid varje försök (ingen sparad plan, ingen återupptagningsmarkör
— se ADR 0016), raderingar mot redan raderade dokument är no-ops, och
användarnamnsreservationen hittas numera oavsett vad som redan är borta. Appen
säger det också — meddelandet skiljer sedan BIN-876 på "ingenting raderades" och
"en del kan redan vara borta", och båda pekar på ett omförsök. VAR knappen sitter
avgörs inte av vilket meddelande det är utan av när felet uppstod: föll det INNAN
markören lades ned står inställningssidan kvar och bär sin egen "Försök
igen"-knapp; föll det efter är sidan redan utbytt mot limbo-skärmen, och båda
meddelandena pekar då på dess "Slutför raderingen".

**Kvarstående lucka: det delvis kaskaderade läget har INGET fönster och ingen
sopning.** Sopningen ovan letar efter Auth-konton *utan* `users/{uid}`. Avbryts
kaskaden innan profil-dokumentet raderats finns det kvar, sopningen rör kontot
inte, och den parning av dokumenterat fönster + sopning som ADR 0019 vilar på
existerar alltså inte för det läget. Enda vägen ut är att användaren själv
försöker igen. Supporten känner igen läget via `docs/RUNBOOK.md` §5d (läge b).
Det är en känd, oavslutad punkt — inte något den här texten påstår är löst.

**Kvarstående lucka, inte täckt av omförsöket:** avbryts kaskaden under
medlemsutträdesfasen kan användarens uid ligga kvar i `memberUids` på andra
användares grupper och i `editors` på delade listor. Ett omförsök städar det
(uppdateringarna byggs om från Firestore), men den som aldrig återvänder lämnar
dem kvar — `reclaimOrphanFollows` täcker bara följare och vänner. Ingen sopning
täcker den här luckan i dag.

## Tekniska implikationer

`AuthContext.deleteAccount` implementerar redan hård radering via
`writeBatch` i 450-ops chunks. Ingen cascade-ändring krävs för Sprint 4,
men:

- `firestore.indexes.json` har redan single-field collection-group-index
  på `comments.uid` + `likes` documentId — behövs för delete-queryn.
- Firestore PITR ger 7-dagars recovery om användaren ångrar sig (men
  bara via admin). Vi dokumenterar inte detta i UI eftersom "pseudo-
  radering" skulle förvirra GDPR-kraven.

### Enhetslokal data vid radering (localStorage)

Raderingskaskaden når Firestore och Auth. Enhetens egen lagring når den bara där den
uttryckligen anropas, och de två sorterna städas olika:

- **IndexedDB** (Firestores offline-cache) — `clearFirestorePersistence()` sist i
  `deleteAccount`.
- **localStorage** — inget generellt svep. `binge:pubprofile-sig:{uid}`, profilkortets
  skrivspärr, tas bort explicit via `clearPublicProfileSignature(uid)` efter att
  Auth-användaren är borta. Fram till BIN-817 (2026-08-09) höll den nyckeln dessutom
  visningsnamn, användarnamn, bild-URL och bio i **klartext**; den är nu en hash, så
  även en nyckel som överlever på en delad enhet (privat läge, kastad exception)
  röjer ingenting. Nya localStorage-nycklar som härleds ur persondata ska följa samma
  två regler: lagra en hash, och rensa i kaskaden.

- **localStorage, forts. (BIN-844, 2026-08-10)** — två nycklar till städas nu, och en
  tredje sak görs som INTE är en localStorage-fråga:
  - `binge:groupInvite:{groupId}` — svepas med prefix av `clearAllInviteTokens()` vid
    **radering**, inte vid utloggning. Enbart hygien: bara en grupps ÄGARE cachar
    klartexten, och kaskaden raderar hela den ägda gruppen, så nyckeln pekar på något
    som inte längre finns. Att svepa vid utloggning övervägdes och valdes bort av Malin
    mot en delad panel: appen visar värdet bara för ägaren, medan svepet hade kostat
    ägaren den egna länken — enda vägen tillbaka är "Generera ny", som ogiltigförklarar
    länken som redan delats med folk som inte klickat än.
  - `binge:fcm:tokenId:{uid}` — tas bort av `clearLocalPushTokenId(uid)` vid radering.
    **Detta är städning av en dinglande pekare, inte ny Art. 17-täckning:** serversidans
    `users/{uid}/fcmTokens/*` raderas redan av kaskaden (se "Operationell metadata"
    ovan). Att rensa nyckeln stoppar ingen notis.
  - **Utloggning avregistrerar nu push på riktigt** — `signOut` anropar
    `disablePushForUser(uid)` FÖRE `firebaseSignOut`, vilket raderar
    `users/{uid}/fcmTokens/{id}`. Det var den faktiska delad-enhet-läckan: notiser
    fortsatte nå en dator man loggat ut från. Ordningen är bindande — efter utloggningen
    har klienten ingen behörighet att radera doc:et.

    **Avregistreringen är best-effort, och det är tre saker den inte gör.** Den hoppas
    över helt om enheten saknar den lokala token-pekaren — en webbläsare vars
    localStorage rensats har fortfarande en registrerad token serversidigt som ingen
    utloggning når. Den släpps efter 2 sekunder om skrivningen inte hunnit bekräftas
    (offline eller trög uppkoppling), och då står token kvar och notiserna fortsätter.
    Och en session som tar slut via tyst utgång eller återkallelse — utan klick på
    Logga ut — kan inte göra skrivningen alls, eftersom den kräver en levande token.
    Alla tre lämnar samma tillstånd som före ändringen; ingen av dem gör det värre.

**Medvetet kvarlämnade, genomgångna och beslutade** (inte "ännu inte tittade på"):
`binge-session-pid-{sessionId}` / `binge-my-sessions`, `binge:wasLoggedIn` och
`binge:rec-rotation:{rowKey}`. Motivering: bekvämlighet — att rensa sessionslistan hade
kostat en återvändande användare sina Tillsammans-sessioner vid varje utloggning, även
hemma. För `binge-session-pid-*` är detta **inte ett nytt beslut**: det är samma
avvägning (efemär data, olistad-länk-tillit, bekvämlighet före minimering) som redan
ratificerades mot full panel 2026-07-16 — se **ADR 0015**. Ska läsas som en
sammanhängande position, inte återupptäckas som en öppen fråga.

Listan är fortfarande **inte** uttömmande, och §8:s motsvarande brasklapp ska stå kvar:
tre av de sex ursprungligen flaggade nycklarna ligger fortfarande utanför den itemiserade
listan.

### Arbetsposition: räknas en hash av persondata som persondata? (2026-08-10)

Nedtecknad av #5 Juridik/GDPR, öppen sedan BIN-817. **Detta är en arbetsposition, inte ett
påstående om fastslagen rätt.**

En icke-reversibel hash är inte automatiskt anonym data enligt skäl 26 — pseudonymisering
minskar identifierbarheten men tar inte bort den. Om ett hashat värde fortfarande är
persondata avgörs av om återställning är *rimligen sannolik* givet indatans entropi:

- **Hög entropi** (ett uid, en genererad token) → behandlas som **inte** persondata;
  återställning är ogenomförbar.
- **Låg eller uppräknelig entropi** (visningsnamn, användarnamn, annan fritext ur ett
  begränsat rum) → behandlas som **fortfarande** persondata; en ordboks- eller
  rainbow-table-attack mot ett litet kandidatrum är ett "medel som rimligen kan komma
  att användas".

Tumregel för den här kodbasen: att hasha ett fält uppfyller **säkerhetsmålet** (ingen
klartext-PII på en delad enhet) men tar inte i sig bort fältet ur redovisnings- eller
raderingsomfånget — den bedömningen görs per fält utifrån entropi, inte automatiskt av
att hashning skett. `binge:pubprofile-sig` (härlett ur visningsnamn/användarnamn/bio)
hamnar på "fortfarande persondata"-sidan och täcks korrekt av §8:s brasklapp snarare än
att betraktas som nyligen anonymiserat.

Omprövas om IMY publicerar vägledning eller om EU-domstolen snävar in eller vidgar
testet för pseudonymisering kontra anonymisering.

> **Historik-/incident-not (BIN-505, 2026-07-14):** en tidigare rules-brist gjorde
> `users/{uid}` (email/hemkommun/kostnader) och watchlist-`notes` läsbara för
> publik/vänner. Fixad + internt breach-register enligt GDPR Art. 33(5):
> [`docs/incidents/2026-07-14-bin505-profile-pii-exposure.md`](incidents/2026-07-14-bin505-profile-pii-exposure.md).

## Export- vs raderingstäckning (BIN-328)

Både GDPR-exporten (Art. 20, `buildUserExport`) och kontoraderingen (Art. 17,
`deleteAccount`) läser samma kärna: `collectUserDataSnapshots`
(`src/lib/firebase/userData.ts`). Varje snapshot-nyckel ska vara wired in i
**båda** flödena. Ett kompileringstidskontrakt
(`src/lib/firebase/dataExport.coverage.test.ts`) tvingar varje ny nyckel att
klassificeras — annars failar bygget.

**Tre nycklar är medvetet UNDANTAGNA ur exporten** (men raderas ändå av
cascaden) — operationell metadata, inte användarens "lämnade" personuppgifter:

- `fcmTokens` — device-push-tokens, system-genererade, meningslösa utanför Firebase.
- `reportMeta` — rapport-throttle-stämpel (timestamp/räknare), inte rapportinnehåll.
- `askBingeMeta` — Ask-Binge LLM-fallback-throttle (timestamp/räknare).

**En nyckel är medvetet UNDANTAGEN ur cascaden** (men ingår i exporten):

- `followers` — inkommande följare. Varje doc ägs av följaren (rules:
  `isOwner(followerUid)`), så kontoinnehavaren kan inte radera dem. Dangling-
  referenser filtreras lazy på läsning och städas av den veckovisa
  `reclaimOrphanFollows`-sweepen.

**Täckningsgräns (ärlig):** kontraktet skyddar nycklar som finns i kärnan. En
helt ny `users/{uid}/<x>`-subcollection som aldrig läggs till i helpern fångas
INTE (den blir aldrig en `keyof`). Att täcka den klassen kräver ett emulator-
backat raderingstest + en subcollection-enumeration mot `firestore.rules` —
spårat som följdticket.

**Console-bypass (känd begränsning):** `deleteAccount`-cascaden körs bara vid
självservice-radering i appen. Raderar en admin ett konto direkt i Firebase
Auth Console körs INGEN klient-cascade (det finns ingen Auth-`onDelete`-trigger),
så cascade-bara-data (avsnitts-reaktioner m.fl.) blir kvar. För den
**säkerhetskänsliga** delen — plaintext-invite-tokenet i `joinAttempts` (BIN-329)
— är detta nu täppt: den schemalagda `retentionCleanup`-sweepen raderar varje
joinAttempt äldre än 1 timme oavsett hur kontot försvann (admin SDK kringgår
reglerna). Reaktioner/övrig cascade-bara-data efter en Console-radering är
fortfarande en öppen, bredare lucka (låg känslighet — inget hemligt) som ägs av
en framtida server-side reaper för konton vars ägar-uid inte längre finns.
**`fcmTokens` är däremot INTE längre kvar i den luckan** — de har ett eget svep
sedan BIN-848, se §"Push-tokens för konton Auth inte längre erkänner" nedan.

## Retention-policy för icke-raderad data

### TMDB-fält-svep (BIN-402 / BIN-468) — aktiv auto-retention på tredjeparts-cachedata

**Syfte:** TMDB:s API-villkor §1.C förbjuder caching av TMDB-härledd data > 6 mån.
Watchlist-docs denormaliserar TMDB-fält utan TTL. Den schemalagda Cloud Functionen
`tmdbFieldsSweep` (månadsvis, `functions/src/tmdbTosSweep/`) **rensar** (nullar) dessa
fält när de är äldre än **5 mån** (medveten marginal under 6-månaderstaket) eller saknar
färskhetsstämpel.

**Per-grupp-färskhet (BIN-468):** en enda doc-nivå-stämpel räckte inte — titelsidan
skriver bara en delmängd av blocket men förnyar stämpeln, så en användare som bara
öppnar titelsidor kunde hålla stämpeln färsk i evighet medan providers/next-air-data
tyst åldrades förbi 6 mån. Fältet är därför uppdelat i **tre oberoende grupper**, var
och en med sin EGEN stämpel, staleness-check (5 mån) och reparationsväg. Svepen rensar
varje grupp för sig när dess stämpel är stale/saknas, och **raderar den gruppens stämpel
vid rensning** så att gruppens egen reparationsväg repopulerar den — aldrig med
överskrivning av en syskongrupp som fortfarande är färsk:

| Grupp | Fält | Stämpel | Reparationsväg |
|---|---|---|---|
| static | `title`, `posterPath`, `genreIds`, `tmdbStatus`, `runtime` | `tmdbFieldsRefreshedAt` | `addItem` + titelsidans `refreshTmdbFields` |
| providers | `providers` | `providersCheckedAt` | advisor/backfill; titelsidan som *fallback* (bara när `providersCheckedAt` inte är färskare än 60 d, så en färskare advisor-koll aldrig klobbras) |
| nextair | `nextAirDate`, `nextAirCode`, `nextAirProvider`, `digitalReleaseDate` | `nextAirUpdatedAt` | kalender-`nextAirReadRepair` (om-stämplar även vid oförändrat värde när stämpeln > 90 d, så en stabil `digitalReleaseDate` inte fryser → onödig rensa-rep, BIN-468 A3) |

**Terminal null-state:** en användare som t.ex. aldrig öppnar Kalendern reparerar aldrig
sin nextair-grupp — den rensas då till **null** och förblir null. Det är avsiktligt och
compliant: att visa *ingenting* är ToS-säkert, att visa stale TMDB-data är överträdelsen.
Null är alltså det korrekta slutläget, inte en bugg.

**Avgränsning (INTE användardata):** hård fält-allowlist per grupp — rör ALDRIG
user-authored fält (`status`, `rating`, `ratedAt`, `notes`, `tags`, `watchedAt`) eller
`updatedAt` (driver "Fortsätt titta"-sorteringen). Test-låst (`FORBIDDEN_FIELDS` +
per-grupp-nyckeluppsättningar i `logic.test.ts`). Det är dataminimering på
processor-cache, inte radering av användarens egna data — ingen ny rättslig grund krävs
(ADR 0009, DPO-panel 2026-07-11/2026-07-12).

**GDPR-export:** en rensad TMDB-grupp kan visa sig som `null` i en Art. 20-export
(`buildUserExport` exporterar hela råa watchlist-doc:en, cleared eller ej). Det är
förväntat och compliant — TMDB-fält är icke-personlig tredjeparts-metadata (se
export-README), inte dataförlust. En framtida ändring ska INTE "fixa" ett null-fält
som saknad data.

**Stämpelns integritet (Security):** de tre stämplarna är sweep-freshness-gates —
`firestore.rules` binder alla tre `is timestamp && <= request.time` (envägs-ratchet) så
en klient inte kan förfalska en framtida stämpel och få svepen att hoppa över en grupp i
evighet.

**Dry-run som default:** funktionen skriver inget förrän
`sweepState/tmdbFieldsSweep.mutateEnabled === true` (flippas i Console efter granskad
dry-run). Audit-record per körning i `sweepState/tmdbFieldsSweep.lastRun` inkl. en
**per-grupp**-uppdelning (`docsWouldClearByGroup`) — enable-grinden kräver att static- +
providers-grupperna ligger < 5 % rensning över ≥ 2 månaders dry-runs innan flip (nextair
undantas då den bara propagerar via Kalender-besök), plus en missad-körning-larm och en
konvergens-check mot `MAX_CLEARS_PER_RUN` (DBA-villkor).

### Spoilerfria avsnittssammanfattningar (BIN-185) — durabel delad cache, ingen TTL

`recaps/{tmdbId}_{s}_{e}` — en publik, delad cache av AI-genererade "var jag slutade"-sammanfattningar,
genererade en gång globalt per (serie, säsong, avsnitt) och serverade till alla. Sedan story-so-far-
omdesignen (2026-07-12, schemaVersion 2) har varje dokument även ett valfritt `textFull`-fält (fylligare
"den här säsongen hittills"-sammanfattning, samma boundary) för "Visa säsongens sammanfattning"-panelen.
Utöver boundary-dokumenten finns `recaps/{tmdbId}_season_{n}` — en helsäsongs-sammanfattning per AVSLUTAD
säsong, skriven en gång, för "Visa tidigare säsonger". **Ingen personuppgift** finns i någon av dessa
(inga uid, bara serie/säsongs/avsnitts-ID + text + källor); de är därför korrekt utanför
`collectUserDataSnapshots` (varken export eller radering rör dem). Skrivna ENDAST av den offline
`/recap`-batchen (Admin SDK); klienter kan bara läsa.

**Retention:** durabel för alltid, ingen TTL — samma klass som `titleRatings`. Till skillnad från BIN-402:
sammanfattningarna är **härledda från Wikipedia (CC BY-SA)**, inte TMDB-data, så TMDB:s §1.C-6-månaderstak
gäller INTE. En dålig/förgiftad post rättas via Admin-SDK (purge/regenerera — se runbook), inte via en
schemalagd svep. Se ADR 0011 för CC BY-SA-hållningen.

### "Släpps idag"-dedup-markörer (BIN-464) — 30-dagars svep (GDPR Art. 17 + tillväxtgräns)

`releaseNotifyState/{tmdbId}/notified/{uid}` — en per-användare-markör som
`availableNotify`-jobbet skriver när det pushat "släpps idag" för en bevakad film,
så samma användare inte får en andra push för samma digitala släppdatum. Doc-id är
`uid`, innehållet är `{ notifiedDate, updatedAt }`.

- **Varför den inte kan raderas via kontocascaden:** collectionen har INGEN
  `firestore.rules`-match → klienter är default-nekade, bara Admin SDK (Cloud
  Functions) rör den. Klientens `deleteAccount`-cascade körs med användarens egen
  auth och kan därför inte nå den (en `batch.delete` skulle nekas och — eftersom
  batchen är atomär — spränga hela raderingen). Samma form som `joinAttempts`.
- **Beslut:** den schemalagda `retentionCleanup`-sweepen (Admin SDK, kringgår
  reglerna) raderar varje markör vars `updatedAt` är äldre än **30 dagar**
  (`RELEASE_MARKER_MAX_AGE_MS`). Det är markörens ENDA Art. 17-raderingsväg och
  täcker självservice-, övergivna OCH Console-raderade konton lika.
- **Varför 30 dagar är säkert:** markörens enda funktion är dedup över catch-up-
  fönstret (`RELEASE_CATCHUP_GRACE_DAYS` = 3 dagar efter släppdatumet). När
  fönstret stängt kan `releaseDateToFire` aldrig returnera det passerade datumet
  igen, så markören är död vikt. 30 dagar är rejäl marginal över 3-dagarsfönstret
  (en fortfarande användbar markör reaps aldrig) och samtidigt prompt radering av
  uid-identifierande beteendedata (vilken film en användare bevakade / notifierades
  om, och när). Ett förnyat släppdatum stämplar om `updatedAt` → markören
  nollställer sin egen klocka. Ingen `firestore.indexes.json`-post krävs (svepet
  pagesar på `__name__` via det automatiska collection-group-indexet, som de andra).

### Push-tokens för konton Auth inte längre erkänner (BIN-848, 2026-08-10)

`users/{uid}/fcmTokens/*` för uid vars Auth-användare **saknas eller är spärrad**.

- **Problemet:** `sendPushToUser` grindar på profildokumentets
  `notificationSettings.pushEnabled` och frågar aldrig Auth. En radering eller
  spärr gjord i Firebase-konsolen kör ingen klientkaskad och lämnar varje
  Firestore-dokument på plats — så personens enhet fortsätter få notiser i
  evighet. FCM:s egen självläkning (`registration-token-not-registered`) slår
  inte till: token är fullt giltig på en levande webbläsare.
- **Varför klienten inte kan laga det:** när behörigheten väl är återkallad har
  den ingen rätt att radera sitt eget token-dokument. Samma form som
  `joinAttempts` och släpp-markörerna — därför samma svep.
- **Beslut:** `retentionCleanup` samlar ägar-uid för alla `fcmTokens`-dokument i
  ett paginerat collection-group-pass och slår upp dem via Admin-SDK:ns
  `getUsers()` i batchar om högst 100. Token-dokumenten raderas för uid som
  ligger i svarets `notFound`-lista, och för konton som returneras med
  `disabled: true`.
- **Tre säkerhetsregler, alla avsiktliga.** Det här är det enda svepet vars
  falska positiv förstör något ett LEVANDE konto använder:
  1. "Raderad" läses ur svarets egna `notFound`-lista — aldrig härlett ur att ett
     uid saknas i `users`. Spärrade konton returneras nämligen I `users`.
  2. En `getUsers()`-batch som kastar (nätfel, kvot, Auth-avbrott) raderar
     ingenting alls för den batchen. "Kunde inte verifiera" är inte "borta".
  3. Svepet fångas separat i handlern, så ett Auth-avbrott aldrig svälter de fyra
     Firestore-baserade svepen.
- **Fördröjning:** upp till 24 timmar. Accepterat — notiserna gäller personens
  egen watchlist och egna vänner, inte tredje parts data, och token-dokumenten kan
  raderas direkt i konsolen om det brådskar.
- **Detta är INTE "avregistrera när sessionen tar slut".** En stängd webbläsare
  ska fortsätta få push; det är hela poängen med push. Bara centralt återkallade
  konton omfattas.
- **Konsekvens att känna till:** låser du upp ett spärrat konto igen kommer push
  inte tillbaka av sig själv — personen måste öppna appen och godkänna notiser på
  nytt. Kryssrutan i Inställningar kommer dessutom **se förkryssad ut**, eftersom
  kontoflaggan `pushEnabled` lämnas orörd och servern inte kan rensa enhetens
  lokala pekare: hen måste slå AV och PÅ den igen för att få tillbaka notiser. #27 DBA lyfte det som skäl att lämna `disabled`-hinken till ett eget
  beslut; Malin namngav uttryckligen spärrade konton som fallet hon ville ha
  täckt, så hinken byggdes.

### Framtida (ej byggt)

- **Gamla Tillsammans-sessioner** — bör delete:as efter 30 dagar via
  cron (kräver Cloud Functions, sprint 6 + 10)
- **Gamla notifikationer** — bör delete:as efter 90 dagar (samma)
- **Härvarande PITR** — Firebase cappar på 7 dagar, ingen ytterligare
  konfiguration behövs

Dessa är dokumenterade i FUTURE_ROADMAP.md sprint 6 (B34).

## Re-visit triggers

Policy ska omvärderas om:
- Rapporter om imitation via frigjorda usernames ökar
- `reports/`-volymen växer så att kvarhållen `reporterUid` motiverar ett
  auto-utgångsfönster eller en anonymiserings-/tombstone-väg (Admin-SDK) — då
  revisas BIN-277-beslutet
- Threading blir djupare (kommentarer på kommentarer) och breakage
  blir användarfientligt
- Cloud Functions finns — då kan vi göra "mjuk radering" med 30-dagars
  ångra-fönster ovanpå hård radering

## Kopplingar

- **Integritetspolicy** (`src/app/integritet/page.tsx`) ska reflektera
  denna policy för användare — uppdateras i sprint 4 dag 5.
- **Terms of Service** (`src/app/villkor/page.tsx`) — ingen direkt
  ändring men nämner att borttaget innehåll inte återställs.
- **Moderation-runbook** (`docs/moderation.md`, pending sprint 5) —
  samma delete-cascade används när admin tar bort en användare för
  policy-brott.

## Ändringslogg

- **2026-07-22 (BIN-560)** — Personliga bibliotekets Firestore-doc-id:n
  namespacas till `${mediaType}_${tmdbId}` (t.ex. `movie_603`/`tv_1399`).
  Radering och GDPR-export är oförändrade i täckning (de skannar hela
  subcollections via doc-referens, inte via rekonstruerad sökväg) — samma
  fem ägar-ägda collections städas/exporteras. Export-schemat bumpades till
  MAJOR 2.0 (id-fältets betydelse ändrades). Se ADR 0017.
