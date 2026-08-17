# BIN-905 + BIN-918 — bygg om de två som fälldes — 2026-08-17

Båda fälldes av sprintens utfallsgranskning 2026-08-16 för **samma sorts fel**: de skrev
ett påstående som lät kontrollerat men inte var det. Utkasten ligger i `stash@{1}`
(`e0d86f0e…`) respektive `stash@{0}` (`c3d719c5…`) och läses som varningar, inte som start.

Blast radius: `node docs/org/route.mjs` → **tier `medium`**, `reasonCode: owned`, inga
high-stakes.

**RÄTTAT 2026-08-17 efter åttonde granskningspasset — jag hade rollerna omvända.** Den här
raden sa "ägande roller: #19 Customer Support (raderingssektionen) och #21 Technical Writer
(mätfilerna)", och båda kritikerna kördes på dem. Kört mot den FAKTISKA filuppsättningen
svarar routern:

```
"tier": "medium", "reasonCode": "owned",
"panel": [25],
"dropped": ["19 Customer Support / Success", "21 Technical Writer / Documentation"]
```

Tier och reasonCode stämde. Rollerna var exakt inverterade: de två jag lät kritisera är de
två routern VÄLJER BORT, och **#25 Engineering Manager / Release Manager** — den enda som
seats — fanns varken i planen, diffen eller `events.jsonl`. #25 seats för att bunten rör
`.claude/shared-plugin.json`, `docs/org/route.mjs` och `docs/org/route.test.mjs`.

Det är inte formalia. Det här är den SJUNDE vidgningen av `reviewGates`-alternationen, vilket
är #25:s ämne per designens egna ord (`gate-symmetry.test.mjs`: "#25 owns the process and the
quality gates BY DEFINITION"). `_note5` registrerar att #25 blind-kritiserade den fjärde. Och
två av de fyra `correction`-rader den här bunten lägger till säger, med buntens egen röst,
att "#25:s kritik var utestående och kördes aldrig" — om BIN-880, den femte vidgningen. Att
shippa den sjunde likadant, i commiten som dokumenterar den femtes utelämnande, vore två svar
på en fråga.

### Bindande villkor från #25 Engineering Manager / Release Manager (blind kritik 2026-08-17)

Rollen SUPPORTAR med två villkor, och sa uttryckligen att slutsatsen står på sakskäl och
inte på att koden redan var byggd.

- [x] **C1.** Biljetten för hela den ägarlösa-men-grindade mängden ska FINNAS innan den här
      commiten stängs, inte bara vara "överenskommen i ett tidigare pass" — "den sortens
      uppskjutning är precis vad den här alternationens egen historia (BIN-864/873, BIN-869)
      visar dunstar om ingen håller i den". Filad som **BIN-930**.
- [x] **C2.** Flyktvägen ("flytta till en CLI-only-kontroll om det blir för trubbigt") behövde
      en UTLÖSARE, inte bara existera: första gången påståendet gör `deploy.yml` eller
      `preview.yml` rött för en commit som inte hör ihop med den flaggade biljetten, konverteras
      det på nästa commit som rör det — inte omförhandlas som ett nytt beslut. Skrivet i README.

**Rollens iakttagelse som inte är ett villkor men som ska fram till Malin:** av sju vidgningar
av den här grinden har minst två (BIN-869, BIN-880) nått main utan att den utestående kritiken
faktiskt kördes först. Det är en frekvens, inte ett engångsfel, och det hör hemma framför henne
som en siffra — inte begravt i en `_note`.

Rollen accepterade uppskjutningen av ägarhalvan med hänvisning till en precedens jag inte
kände till: `docs/role-responsibilities.md` säger redan att kontrollskripten under `scripts/`
är MEDVETET ägarlösa och att `route.test.mjs` beror på att det förblir så.

De två kritiker som KÖRDES står kvar nedan oförändrade. De var värdefulla — #21 rev min
designpremiss och fångade tidsjämförelsen baklänges — men de var fel roller enligt routern,
och det får inte skrivas om i efterhand. #25:s kritik körs på grindhalvan och läggs till.

---

## BIN-905 — raderingssektionens kontaktrad

### Vad som är fel i dag

`src/components/settings/DeleteAccountSection.tsx:88-99` motiverar varför mejladressen
ligger i sektionen i stället för i de fyra låsta felmeddelandena. Två fel i motiveringen:

1. **"Den här raden syns dessutom SAMTIDIGT som varje toast"** håller för `preflight` och
   den generiska grenen. Den håller INTE för `recent-login` (taggad) och `partial`: de når
   catch-blocket först efter att raderingsmarkören är nere, och då har `AppShell` bytt ut
   hela appen mot `DeletionLimbo` — den här komponenten är avmonterad. Filens egen kommentar
   25 rader ovanför (rad 66-74) säger exakt det. Ingen användare blir utan adress —
   `DeletionLimbo` bär en — men läst bokstavligt påstår meningen att limbo-raden är onödig.
2. **Skälet är fel även där slutsatsen stämmer.** Meningen säger att `setConfirming(false)`
   är det som gör att raden överlever notisen. Det är trivialt sant av en annan orsak:
   `<p>`-elementet ligger UTANFÖR `{!confirming}`-ternären och renderas ovillkorligt.

### Varför förra försöket fälldes

Det skrev en ny kommentar som påstod att ett nytt test pinnar att raden renderas utanför
`{!confirming}`. Men båda testets påståenden kördes med `confirming=false`, så en
`{!confirming && …}`-mutant överlevde 10/10 grönt. Alltså: en kommentar som lovade mer än
koden håller, ersatt med en kommentar som lovade mer än testet håller.

### Att göra

- [ ] Testet FÖRST, och det ska driva **båda** lägena: adressen finns i utgångsläget OCH
      efter att bekräftelsesteget öppnats. Utan det andra påståendet pinnar det ingenting
      om villkoret. (diff)
- [ ] Mutationsbevis: `{!confirming && <p>…</p>}` runt kontaktstycket ska göra testet rött.
      Assert:a mutanten FÖRE och EFTER sviten i ETT kommando; återställ från en
      scratchpad-kopia, aldrig `git checkout --`. (run)
- [ ] Skriv om kommentaren EFTER att testet är grönt, och bara om det testet faktiskt
      fäller på: raden är ovillkorlig, och överlämningsgrenarna täcks av `DeletionLimbo`s
      egen adress. Inga påståenden om `setConfirming`. (diff)
- [ ] Rätta den inaktuella meningen på rad 20-23: "Firebases eget requires-recent-login kan
      bara nå hit EFTER kaskaden" stämmer inte sedan BIN-813. `AuthContext.tsx:1190-1194`
      kastar ett OTAGGAT `REQUIRES_RECENT_LOGIN` när markören är nere — före DEN HÄR
      kaskaden. Slutsatsen står kvar (löftet vore ändå falskt, för en TIDIGARE kaskad har
      kört), men mekanismen är fel beskriven. (diff)

### Bindande villkor från #19 Customer Support (blind kritik 2026-08-17)

Rollen blockerade inte, och spårade själv monteringslogiken i stället för att tro på planens
beskrivning. Den bekräftade att `AppShell.tsx:50` byter till `DeletionLimbo` på en flagga som
sätts på ett enda ställe — `AuthContext.tsx:1227`, i catch-blocket EFTER att markören lagts
ned (rad 1220) — så förkontrollen och den otaggade stale-varianten lämnar sektionen monterad,
precis som planen påstår.

**KORRIGERAT 2026-08-17, mätt av helhetsgranskningen:** flaggan sätts på TRE ställen, inte
ett — `AuthContext.tsx:536` (vid profilladdning om markören står), `638` (storage-lyssnaren
mellan flikar) och `1227`. `AppShell.tsx:42-44` räknar upp alla tre. Följden är att den
otaggade stale-varianten inte nås från inställningssidan i den riktiga appen alls: står
markören renderas limbo-skärmen redan vid profilladdning. Rollens slutsats om räckvidden
står, men premissen den vilade på gjorde det inte. Den shippade kommentaren beskriver nu
det mätta läget; den här texten står kvar oförändrad ovanför så att vad rollen SA inte
skrivs om till vad som är SANT. Den kontrollerade också att limbo-skärmens kontaktrad är
**starkare**, inte likvärdig: `text-sm text-ink-2` mot sektionens `text-xs text-ink-3`, och
redan ordagrant pinnad av `DeletionLimbo.test.tsx:56-67`. Ingen felgren lämnar användaren
utan adress.

- [ ] **V6.** Den omskrivna kommentaren ska peka på det specifika ovillkorliga `<p>`-elementet
      i `DeletionLimbo.tsx:114-118` — inte skriva "samma toast bär en adress", för notisen bär
      aldrig någon. En underhållare som bara läser toast-koden skulle annars dra fel slutsats. (diff)

### Uttryckligen INTE

Skriv inte in adressen i de fyra meddelandena. De är juridiskt godkända och ordagrant
pinnade (BIN-813 villkor 4).

---

## BIN-918 — de falska raderna i mätloggen

### Vad som är fel i dag

Sprintmotorn skriver sina `review`-rader till `docs/org/metrics/events.jsonl` i
**urvalssteget**, alltså före bygget, men formulerar dem i **dåtid**. Fyra rader stämplade
`2026-08-16T13:53:30.297Z` säger "BUILT and committed"; den tidigaste av de commitarna
(049f21b) kom 14:32:45Z — 39 minuter senare — de två andra i 851696d 15:25:30Z, och
BIN-909 byggdes aldrig alls. Loggen är tänkt att vara beviset för vilka granskningar som
uteblev — en rad som påstår att något byggdes är värdelös som bevis.

### Varför förra försöket fälldes

Det byggde en kontroll som skulle intyga varje rad mot en riktig commit, och underkändes på
alla tre linser. Grundfelet: **den frågade commitens ÄMNESRAD, aldrig dess filer.** En
dokumentationscommit intygade därmed ett kodpåstående (`BIN-915` → `verified/50218fa`, en
commit som bara rör `docs/workflow-map.html`), ett prosaord före biljettnumret (ISO-8601,
UTF-8) tolkades som biljetten, och den skrev permanenta `verified`-intyg som tyst åsidosatte
en anropares uttryckliga `committed:false`.

### Den avgörande designändringen

**RÄTTAD 2026-08-17, innan en rad kod skrevs.** Första versionen av den här planen sa
"kontrollera raden mot SIG SJÄLV — motsägelsen är intern". Det är fel, och jag såg det först
när jag läste alla 53 `ran:false`-rader i stället för de fyra jag redan visste var falska:

- `outcome:"declined-unattended-shipped"` BETYDER "byggd och committad med granskningen
  utebliven" (README:52-60). Prosan som säger samma sak är alltså **redundant, inte
  motsägande**. Det finns ingen intern motsägelse att hitta.
- Det verkliga felet är **tidsmässigt**: raden skrevs 13:53 och påstod en commit som kom
  14:32 (och de två andra 15:25). En rad kan inte se sin egen framtid, och inget fält i
  den avslöjar det.
- Sju ÄRLIGA rader säger "built in a worktree; NOT committed, NOT pushed". En kontroll som
  larmar på ordet "built" hade underkänt dem. Nyckeln är påståendet om att koden nådde
  main, inte om att den byggdes.

**Den nya regeln: ett påstående om att koden nådde main måste bära sitt bevis.**

En `review`-rad som hävdar att arbetet committades — antingen via
`outcome:"declined-unattended-shipped"` eller via en icke-negerad commit-formulering i
prosan — MÅSTE bära ett `commit_sha`-fält. Bär den inget är påståendet obelagt och raden
faller ut.

Det undviker exakt det som fällde utkastet: **ingen ämnesradsmatchning, ingen härledning av
vilken biljett en commit gäller, inga filmängdsgissningar, inga `verified`-intyg skrivna
tillbaka in i loggen.** Kontrollen kräver bara att den som gör anspråket namnger sitt bevis.

**Tidsregeln, och jag hade den BAKLÄNGES i första utkastet av den här planen.** Jag skrev
"shan får inte vara ÄLDRE än raden", vilket betyder `commit_ts >= rad_ts` — och det
SLÄPPER IGENOM BIN-908 (rad 13:53:30Z, commit 14:32:45Z), alltså precis den lögn biljetten finns
för. #21 fångade det. Rätt riktning: **en rad kan bara sanningsenligt säga "det här nådde
main som commit X" om X redan fanns när raden skrevs.** Alltså `commit_ts <= rad_ts`, och
kontrollen FÄLLER när commiten är NYARE än raden. Uppslagningen är ett `git cat-file`,
injicerat så att testerna är rena.

Utfallet på de fyra kända raderna: alla fyra faller ut, inklusive BIN-909, och de sju
ärliga worktree-raderna passerar eftersom de negerar anspråket.

### Att göra

- [x] `docs/org/metrics/check_events.mjs` — läser `events.jsonl` och failar när en rad
      hävdar att arbetet nådde main utan att namnge ett `commit_sha` som finns och föregår
      raden. (Den här punkten sa ursprungligen "när en rads egen prosa gör ett anspråk som
      radens strukturerade fält motsäger" — den designen är ÖVERSPELAD, se "Den avgörande
      designändringen" ovan. Sista stället i planen som beskrev den förkastade kontrollen;
      rättat efter sjunde granskningspasset.) CLI:t bakom en entry-point-kontroll och lindat
      i `main(argv)`, per BIN-802 — annars äter det testkörarens argv och hänger sviten utan
      felmeddelande. (diff)
- [ ] Golv under uppräkningen: noll granskade rader ska faila, inte tyst returnera grönt
      (`reference_pattern_replacing_a_list_needs_a_floor`). (diff)
- [ ] `docs/org/metrics/check_events.test.mjs` — täcks redan av `vitest.config.ts`s
      `docs/org/**/*.{test,spec}.mjs`, så `npm test` kör den utan ny glob. Använd de FYRA
      verkliga raderna från 2026-08-16 som fixturer, plus en ärlig rad som inte får falla ut. (diff)
- [ ] Rätta de fyra raderna. Filen är **append-only** (README), så det blir korrigeringsrader,
      inte en redigering. (diff)
- [ ] `README.md` får regeln skriven: en rad som skrivs före bygget formuleras i presens, och
      dåtid är förbehållet den som håller commit-shan. (diff)

### Bindande villkor från #21 Technical Writer (blind kritik 2026-08-17)

Rollen stödde kärndesignen — självkontroll i stället för commit-uppslagning — och den
append-only-disciplinen, men fällde korrigeringsmekanismen på ett fel jag hade i handen
utan att se: **alla fyra falska rader bär byte-identisk `ts`** (`2026-08-16T13:53:30.297Z`,
`events.jsonl:131-134`) och INGEN av dem bär schemats valfria `ticket`-fält. Biljettnumret
finns bara inne i fritextfältet `plan`. En rättelse nycklad på `ts` matchar därför antingen
ingenting precist eller alla fyra.

- [ ] **V1.** Korrigeringsrader nycklas på `{ts, ticket}`, aldrig `ts` ensamt, och `ticket`
      stämplas som ett RIKTIGT fält på korrigeringen — inte utparsat ur prosa vid läsning.
      Det är samma schemaglidningsklass som `README.md:113-118` redan dokumenterar för
      `mustHaves`/`tier`/`panel`. (diff)
- [ ] **V2.** `README.md`s `review`-avsnitt får läskontraktet skrivet: en rads prosa är inte
      auktoritativ på egen hand — leta efter en senare `correction` på samma `{ts, ticket}`
      innan du tror på den. En kronologisk läsare träffar den falska raden först och har
      annars ingen signal om att en rättelse finns. (diff)
- [ ] **V3 (omformulerad efter designändringen).** Begränsningen skrivs i de SHIPPADE
      artefakterna, inte bara i den här planen — `check_events.mjs`s eget huvud OCH README:
      *en grön körning betyder att varje anspråk på att ha nått main namnger en sha som
      existerar och föregår anspråket; den verifierar INTE att den namngivna commiten
      faktiskt innehåller den biljettens arbete. En äkta sha åberopad för fel biljett — eller
      en dokumentationscommit åberopad för ett kodpåstående — är osynlig för kontrollen.*
      Det är samma felklass som sänkte första utkastet; skillnaden är att den här designen
      REDOVISAR den som en accepterad gräns i stället för att tyst lita på den. Planen är
      slängbar per `code-style.md`, så en varning som bara bor här dunstar med den. (diff)
- [ ] **V4.** BIN-909:s rättelse skrivs för sig. Den biljetten **byggdes aldrig** — ett annat
      sant läge än de tre andra (byggda, granskning utebliven, parkerade). Varje
      korrigeringsrads innehåll verifieras mot den biljettens faktiska utfall, aldrig
      mekaniskt härlett ur originalets text med tempus utbytt. (diff)
- [ ] **V5.** Biljettkommentaren om den utomstående motorn ska säga rakt ut att detta är
      **enbart upptäckt, i det här repot, och icke-blockerande i dag** — inget här hindrar
      `sprint-execute-parallel.js` från att skriva en ny dåtidsrad i morgon. Låt varken
      commitmeddelandet eller README antyda att tempusregeln "löser" något framåt. (diff)

### Ytterligare villkor från #21:s ANDRA pass (efter designändringen)

- [ ] **V6.** Tidsjämförelsen måste prövas i BÅDA riktningarna med egna fixturer. De fyra
      kända falska raderna faller ut TIDIGARE, på "saknar `commit_sha`", och når aldrig
      tidskontrollen — och den ärliga worktree-raden passerar på negeringen, också utan att
      nå den. Som planen först var skriven kunde alltså olikheten shippa inverterad med varje
      test grönt. Två fixturer krävs: en rad vars sha-commit ligger EFTER radens `ts` (ska
      FÄLLA) och en vars commit ligger PÅ eller FÖRE (ska PASSERA). (run)
- [ ] **V7.** Utfallet "går inte att rätta, saknar `ticket`-fält" måste vara HÖGLJUTT —
      nollskild exitkod och en uttrycklig lista, aldrig en loggrad. Annars sitter en framtida
      omärkt falsk rad osynlig på precis samma sätt som de här fyra satt i ett dygn innan
      någon läste förbi dem man redan kände till. (diff)
- [ ] **V1 forts.** Den ankrade `^BIN-\d+`-utparsningen är godkänd som ENGÅNGS-backfill för
      de fyra gamla raderna. Framåt är `ticket` ett stämplat fält, inte något kontrollen
      härleder ur prosa vid varje körning. Och `commit_sha` får ALDRIG bli
      korrigeringsnyckeln — raden som mest behöver rättas (BIN-909) saknar strukturellt det
      fältet, eftersom den aldrig byggdes. (diff)

### Uttryckligen INTE

- Ingen commit-uppslagning, ingen matchning på ämnesrad, inga `verified`-intyg.
- `log_event.mjs` ändras inte i sitt fail-open-beteende — loggning får aldrig kasta till sin
  anropare. Kontrollen är ett SEPARAT skript.
- Motorn som skriver dåtidsprosan ligger i `C:/claude-plugins` (delad infrastruktur, utanför
  det här repot och utanför den här biljettens omfång). Kontrollen fångar följden; att
  formuleringen rättas vid källan är en separat uppgift som noteras på biljetten.

---

## Öppna frågor

Inga arkitekturändrande okändheter. Antaganden:

1. ~~Att kontrollera en rad mot sina egna fält är tillräckligt.~~ **ÖVERSPELAD** — den
   designen övergavs samma dag, se "Den avgörande designändringen" ovan. Det som gäller är
   beviskravet: ett anspråk på att ha nått main måste bära ett `commit_sha`. Gränsen som
   kvarstår är en annan: kontrollen verifierar inte att den namngivna commiten faktiskt
   innehåller biljettens arbete, och det står i `check_events.mjs`s huvud och i README,
   inte bara här.
2. Att prosafältet heter `plan` i alla `review`-rader — verifieras genom att läsa filen, inte
   antas.
3. Att kontrollen inte ska blockera en commit ännu. Den körs av `npm test`; om den ska in i
   en grind är det ett eget beslut, inte något det här passet tar.

## Gates

- [ ] Blind kritik #19 Customer Support (BIN-905) och #21 Technical Writer (BIN-918)
- [ ] `npm run typecheck`, `npx eslint`, `npm test`
- [ ] Fyra granskare: code, security, test, integration
- [ ] Commit, push, deploy, purge, Linear
