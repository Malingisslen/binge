import type { MetricKey, Explanation } from './types';

/**
 * ExplainDrawer copy per metric, in plain Swedish for a reader who does not read
 * code. Every catalog key has an entry — explanations.test.ts enforces it both ways.
 */
const SNAPSHOT = 'Ögonblicksbild från den senaste beräkningen, en gång per dygn. Följer inte datumväljaren.';
const TREND = 'Den lilla kurvan under talet visar samma siffra dag för dag i vald period, ur de dagliga beräkningarna. Den ritas först när perioden har minst sju beräknade dagar. Har perioden fler än 90 beräknade dagar ritas högst 90 jämnt utspridda dagar, första och sista alltid med, så kurvan täcker hela perioden med glesare punkter.';
const TRAFFIC = 'Räknas av ett skript från Cloudflare i besökarens webbläsare, utan cookies och utan att någon enskild besökare följs; Binge hämtar bara summorna. Siffrorna är ungefärliga: Cloudflare uppskattar ur ett urval av sidvisningarna, annonsblockerare och avstängd JavaScript räknas inte, och robotar kan slinka med. Dagarna går efter UTC, så en sen kväll i Sverige hamnar på rätt dag men en tidig natt på dagen före. Läs nivån över tid, och lägg inte ihop den med Binges egna händelseräkningar längre upp.';
const EVENTS = 'Samma person tre gånger räknas som 3. Händelser räknas sedan mätningen startade (datumet står i verktygsraden); dagar före det syns inte.';

export const EXPLANATIONS: Record<MetricKey, Explanation> = {
  // ── Just nu ───────────────────────────────────────────────────────────────
  totalUsers: {
    whatIsIt: 'Antal registrerade konton just nu.',
    howCalculated: `Antalet användardokument i databasen vid senaste beräkningen. ${SNAPSHOT} ${TREND}`,
    whyImportant: 'Den enklaste tillväxtkurvan: hur stor basen av konton är.',
    source: 'Firestore (daglig beräkning)',
  },
  totalTitlesTracked: {
    whatIsIt: 'Antal titlar som ligger i någons bibliotek just nu, oavsett status.',
    howCalculated: `Antalet biblioteksrader över alla konton. Samma film hos två personer räknas två gånger. ${SNAPSHOT} Ska inte summeras eller jämföras med "Titlar tillagda per dag": den räknar bara händelser sedan 9 oktober, medan den här räknar allt som finns. ${TREND}`,
    whyImportant: 'Visar hur mycket innehåll som faktiskt följs i Binge.',
    source: 'Firestore (daglig beräkning)',
  },
  totalReviews: {
    whatIsIt: 'Antal skrivna recensioner just nu.',
    howCalculated: `Antalet recensionsdokument i databasen. ${SNAPSHOT} ${TREND}`,
    whyImportant: 'Visar om folk bara loggar eller också skriver.',
    source: 'Firestore (daglig beräkning)',
  },
  activeUsers7d: {
    whatIsIt: 'Inloggade konton vars inloggning förnyats de senaste 7 dagarna. Ett närmevärde för att ha öppnat Binge, inte ett exakt mått.',
    howCalculated: `Räknas ur Firebase Auths egen tidsstämpel för senaste inloggning eller tokenförnyelse. En flik som står öppen i bakgrunden räknas; en session som bara används offline kan missas. Anonyma Tillsammans-gäster räknas inte. ${SNAPSHOT}`,
    whyImportant: 'Visar om folk kommer tillbaka.',
    source: 'Firebase Auth (daglig beräkning)',
  },
  activeUsers30d: {
    whatIsIt: 'Inloggade konton vars inloggning förnyats de senaste 30 dagarna. Samma närmevärde som 7-dagarssiffran.',
    howCalculated: `Samma klocka som 7-dagarssiffran, med ett 30-dagarsfönster. ${SNAPSHOT} ${TREND}`,
    whyImportant: 'Kvoten mellan 7- och 30-dagarssiffran visar hur stor del av månadens användare som är veckovana.',
    source: 'Firebase Auth (daglig beräkning)',
  },
  activeSessions: {
    whatIsIt: 'Tillsammans-kvällar (gemensam röstning om vad ni ska se) som ännu inte gått ut.',
    howCalculated: `Antalet sessionsdokument vars giltighetstid inte passerat. ${SNAPSHOT}`,
    whyImportant: 'Visar om Tillsammans används alls.',
    source: 'Firestore (daglig beräkning)',
  },
  groupsCount: {
    whatIsIt: 'Antal skapade grupper just nu.',
    howCalculated: `Antalet gruppdokument i databasen. ${SNAPSHOT}`,
    whyImportant: 'Grupper är det sociala lagret; siffran visar om det används.',
    source: 'Firestore (daglig beräkning)',
  },

  // ── I perioden ────────────────────────────────────────────────────────────
  newUsers: {
    whatIsIt: 'Hur många fler konton som finns nu jämfört med periodens start.',
    howCalculated: 'Skillnaden i antal konton mellan dagens beräkning och beräkningen från periodens första dag, aldrig under noll. Raderade konton drar ner siffran, så den kan vara lägre än antalet registreringar.',
    whyImportant: 'Visar tillväxttakten, inte bara totalen.',
    source: 'Firestore (daglig beräkning)',
  },
  titlesAdded: {
    whatIsIt: 'Hur många fler titlar som ligger i bibliotek nu jämfört med periodens start.',
    howCalculated: 'Skillnaden i antal biblioteksrader mellan dagens beräkning och beräkningen från periodens första dag, aldrig under noll. Borttagna titlar drar ner siffran, så den kan vara lägre än "Titlar tillagda per dag".',
    whyImportant: 'Visar om biblioteken växer.',
    source: 'Firestore (daglig beräkning)',
  },
  signupsTrend: {
    whatIsIt: 'Antal registreringar per dag i perioden.',
    howCalculated: `Händelsen signed_up, en punkt per dag som har en räkning. ${EVENTS}`,
    whyImportant: 'Visar när folk hittar hit, dag för dag.',
    source: 'Firestore (egen händelseräkning)',
  },
  signins: {
    whatIsIt: 'Antal inloggningar i perioden. Händelser, inte personer.',
    howCalculated: `Händelsen signed_in summerad över perioden. ${EVENTS}`,
    whyImportant: 'Visar om de konton som finns faktiskt kommer tillbaka.',
    source: 'Firestore (egen händelseräkning)',
  },
  signinMethodSplit: {
    whatIsIt: 'Hur inloggningarna fördelar sig på Google och e-post.',
    howCalculated: `Händelsen signed_in grupperad på metod. ${EVENTS}`,
    whyImportant: 'Säger om e-postinloggningen behövs eller om Google räcker.',
    source: 'Firestore (egen händelseräkning)',
  },
  onboardingFinishStep: {
    whatIsIt: 'På vilket steg nya användare tryckte klar i introduktionen.',
    howCalculated: `Händelsen onboarding_completed skickas bara när någon slutför introduktionen, grupperad på steget. Den som stänger fliken halvvägs räknas inte alls, så det här är ingen avhoppsmätning. ${EVENTS}`,
    whyImportant: 'Visar om folk hoppar till slutet direkt eller går igenom stegen.',
    source: 'Firestore (egen händelseräkning)',
  },
  secondWeekReturn: {
    whatIsIt: 'Av kontona vars andra vecka tagit slut de senaste 30 dagarna: hur många som öppnade Binge någon gång dag 7 till 13 efter att kontot skapades.',
    howCalculated: `Appen sparar en gång per konto datumet för första besöket under andra veckan. Beräkningen räknar bara summorna och sparar aldrig vilka konton det gäller. Konton som skapades före mätningen saknar datumet och räknas som att de inte kom tillbaka. Under fem konton visas ingen fördelning. ${SNAPSHOT}`,
    whyImportant: 'Visar om första veckan får folk att komma tillbaka.',
    source: 'Firestore (daglig beräkning)',
  },

  // ── Engagemang ────────────────────────────────────────────────────────────
  titlesAddedTrend: {
    whatIsIt: 'Antal titlar som lades till i något bibliotek, per dag.',
    howCalculated: `Händelsen title_added_watchlist, en punkt per dag som har en räkning. ${EVENTS} Ska inte summeras eller jämföras med "Titlar i bibliotek", som räknar allt som finns oavsett när det lades till.`,
    whyImportant: 'Den tydligaste aktivitetskurvan Binge har: folk lägger till titlar oftare än de registrerar sig.',
    source: 'Firestore (egen händelseräkning)',
  },
  providerClicks: {
    whatIsIt: 'Klick från en titelsida ut till en tjänst som Netflix, SF Anytime eller Viaplay.',
    howCalculated: `Händelsen provider_clicked summerad över perioden. ${EVENTS}`,
    whyImportant: 'Det är steget där Binge har gjort sitt jobb, och det som en framtida affiliate-intäkt skulle hänga på.',
    source: 'Firestore (egen händelseräkning)',
  },
  providerClicksByType: {
    whatIsIt: 'Klicken ut till tjänster, uppdelade på abonnemang, hyra, köpa och gratis.',
    howCalculated: `Händelsen provider_clicked grupperad på erbjudandets typ. ${EVENTS}`,
    whyImportant: 'Visar om folk mest letar efter var något ingår eller var det går att hyra.',
    source: 'Firestore (egen händelseräkning)',
  },
  shareClicks: {
    whatIsIt: 'Tryck på delningsknappen på en titel, en lista eller en profil.',
    howCalculated: `Händelsen share_clicked summerad över perioden. ${EVENTS}`,
    whyImportant: 'Delade länkar är hur Binge sprids utan annonser.',
    source: 'Firestore (egen händelseräkning)',
  },
  shareClicksBySurface: {
    whatIsIt: 'Delningarna uppdelade på var knappen satt: titel, lista eller profil.',
    howCalculated: `Händelsen share_clicked grupperad på yta. ${EVENTS}`,
    whyImportant: 'Visar vad folk vill visa för andra.',
    source: 'Firestore (egen händelseräkning)',
  },
  shareClicksByMethod: {
    whatIsIt: 'Delningarna uppdelade på telefonens delningsark och kopiera länk.',
    howCalculated: `Händelsen share_clicked grupperad på metod. ${EVENTS}`,
    whyImportant: 'Säger om delningsknappen gör nytta på mobilen.',
    source: 'Firestore (egen händelseräkning)',
  },
  priceCheckTotals: {
    whatIsIt: 'Gånger ett val i streamingkalkylatorn eller startsidans demo gav en summa.',
    howCalculated: `Händelsen price_check_total_shown, högst en gång per sidvisning. ${EVENTS}`,
    whyImportant: 'Visar om priskollen används, och är början på vägen mot ett konto.',
    source: 'Firestore (egen händelseräkning)',
  },
  priceCheckBySurface: {
    whatIsIt: 'Var priskollen användes: kalkylatorsidan eller startsidans demo.',
    howCalculated: `Händelsen price_check_total_shown grupperad på yta. ${EVENTS}`,
    whyImportant: 'Säger om startsidans demo lockar eller om folk går till kalkylatorn.',
    source: 'Firestore (egen händelseräkning)',
  },
  priceCheckSaves: {
    whatIsIt: 'Tryck på "Logga in och spara" efter en priskoll.',
    howCalculated: `Händelsen price_check_save_clicked summerad över perioden. ${EVENTS}`,
    whyImportant: 'Steget från nyfiken besökare till konto.',
    source: 'Firestore (egen händelseräkning)',
  },
  advisorActions: {
    whatIsIt: 'Vilka av Streamingrådgivarens förslag folk tog: pausa, återuppta, skaffa eller komma ikapp.',
    howCalculated: `Händelsen advisor_action_taken grupperad på val. Nytt mått sedan oktober 2026; den tidigare rutan räknade bara pauser. ${EVENTS}`,
    whyImportant: 'Visar om rådgivaren faktiskt får folk att ändra sina abonnemang.',
    source: 'Firestore (egen händelseräkning)',
  },

  // ── Biblioteket ───────────────────────────────────────────────────────────
  statusDistribution: {
    whatIsIt: 'Hur titlarna i alla bibliotek fördelar sig: vill se, tittar, sett eller avbrutet.',
    howCalculated: `Räknas över alla biblioteksrader. ${SNAPSHOT}`,
    whyImportant: 'Visar om appen används för att planera (vill se) eller logga (sett).',
    source: 'Firestore (daglig beräkning)',
  },
  mediaTypeSplit: {
    whatIsIt: 'Hur titlarna i alla bibliotek fördelar sig på film och serie.',
    howCalculated: `Räknas över alla biblioteksrader. ${SNAPSHOT}`,
    whyImportant: 'Säger var tyngdpunkten ligger, och vad som bör synas först.',
    source: 'Firestore (daglig beräkning)',
  },
  topTitles: {
    whatIsIt: 'Titlarna som ligger i flest bibliotek.',
    howCalculated: `Antal bibliotek per titel, de tio högsta. ${SNAPSHOT}`,
    whyImportant: 'Visar vad Binges användare faktiskt följer.',
    source: 'Firestore (daglig beräkning)',
  },
  topProviders: {
    whatIsIt: 'Streamingtjänsterna där flest bibliotekstitlar finns att se.',
    howCalculated: `Antal bibliotekstitlar per tjänst, bara tjänster i den svenska katalogen. En titel som finns på flera tjänster räknas på var och en. ${SNAPSHOT}`,
    whyImportant: 'Visar vilka tjänster som bär innehållet folk vill se.',
    source: 'Firestore (daglig beräkning)',
  },
  topGenres: {
    whatIsIt: 'Genrerna som flest bibliotekstitlar hör till.',
    howCalculated: `Antal bibliotekstitlar per genre. En titel med flera genrer räknas på var och en, så summan är större än antalet titlar. ${SNAPSHOT}`,
    whyImportant: 'Visar vilken smak Binges användare har.',
    source: 'Firestore (daglig beräkning)',
  },
  ratingsHistogram: {
    whatIsIt: 'Fördelning av satta betyg, 1 till 5 stjärnor.',
    howCalculated: `Betyg på halvstjärneskalan avrundas till närmaste hel stjärna och räknas per stapel. ${SNAPSHOT}`,
    whyImportant: 'Visar om betygsskalan används brett eller klumpas ihop.',
    source: 'Firestore (daglig beräkning)',
  },

  // ── Fråga Binge ───────────────────────────────────────────────────────────
  askSearches: {
    whatIsIt: 'Antal slutförda "Fråga Binge"-sökningar i perioden.',
    howCalculated: 'Sökningar där tolkningen gick igenom och en fråga ställdes till katalogen. Räknas sedan Fråga Binge lanserades.',
    whyImportant: 'Grundtalet för de andra Fråga Binge-måtten.',
    source: 'Firestore (Fråga Binge-räknare)',
  },
  askZeroRate: {
    whatIsIt: 'Andel "Fråga Binge"-sökningar som gav noll träffar.',
    howCalculated: 'Tomma sökningar delat med antal slutförda sökningar i perioden. Visas inte under tio sökningar.',
    whyImportant: 'Det tystaste misslyckandet: användaren fick inget och lämnar. Hög andel betyder att filter krockar eller att katalogen saknar det folk frågar efter.',
    source: 'Firestore (Fråga Binge-räknare)',
  },
  askLowConfidenceRate: {
    whatIsIt: 'Andel frågor där Binge inte kunde läsa ut något filter alls ur meningen.',
    howCalculated: 'Frågor utan tolkning delat med antal slutförda sökningar i samma period; antalet står under procenten. Visas inte under tio sökningar.',
    whyImportant: 'Visar hur ofta tolkningen missar helt, och om AI-reserven behövs.',
    source: 'Firestore (Fråga Binge-räknare)',
  },
  askResultBuckets: {
    whatIsIt: 'Hur många träffar sökningarna gav: inga, några, många.',
    howCalculated: 'Varje sökning räknas i ett av fyra spann efter antal träffar.',
    whyImportant: 'Många sökningar med 30+ träffar betyder att frågan var för bred; många med inga betyder att den var för smal.',
    source: 'Firestore (Fråga Binge-räknare)',
  },
  askStrandingFilters: {
    whatIsIt: 'Vilka filterkombinationer som oftast ger noll träffar.',
    howCalculated: 'Per kombination (t.ex. Årtionde + Betyg) räknas hur många sökningar som gav noll, sorterat fallande.',
    whyImportant: 'Pekar på vilka kombinationer som behöver mjukas upp.',
    source: 'Firestore (Fråga Binge-räknare)',
  },
  askRemovedChips: {
    whatIsIt: 'Vilka tolkningar folk oftast tar bort efter en sökning.',
    howCalculated: 'Varje gång ett tolkat filter tas bort räknas dess typ, sorterat fallande.',
    whyImportant: 'En borttagning är ett kvitto på att Binge gissade fel. Dominerar en typ så övertriggar den regeln.',
    source: 'Firestore (Fråga Binge-räknare)',
  },

  // ── Besök (Cloudflare Web Analytics) ──────────────────────────────────────
  visits: {
    whatIsIt: 'Antal besök på binge.nu i perioden. Ett besök är en sidvisning som inte kom från en annan sida på binge.nu. Samma person som kommer tillbaka en annan dag ger ett nytt besök, så det här är inte antal unika besökare.',
    howCalculated: `${TRAFFIC} Ett besök räknas när hänvisaren är tom eller en annan sajt; klick inne i Binge räknas som sidvisningar i samma besök.`,
    whyImportant: 'Hur många som hittar hit, oavsett om de skapar konto.',
    source: 'Cloudflare Web Analytics',
  },
  pageViews: {
    whatIsIt: 'Antal sidvisningar på binge.nu i perioden.',
    howCalculated: `${TRAFFIC} Varje laddad sida räknas en gång; en person som klickar runt ger många sidvisningar.`,
    whyImportant: 'Kvoten mot Besök visar hur mycket folk tittar runt när de väl är här.',
    source: 'Cloudflare Web Analytics',
  },
  visitsTrend: {
    whatIsIt: 'Besök dag för dag i perioden.',
    howCalculated: `${TRAFFIC} Samma räkning som Besök, uppdelad per dag.`,
    whyImportant: 'Toppar visar när något delades eller nämndes någonstans.',
    source: 'Cloudflare Web Analytics',
  },
  topPages: {
    whatIsIt: 'Vilka sidor som visades flest gånger i perioden.',
    howCalculated: `${TRAFFIC} Sidvisningar per sökväg, de tio största. Listan är en egen fråga till Cloudflare och summerar inte till Sidvisningar.`,
    whyImportant: 'Visar vad folk faktiskt tittar på, också sådant som inte kräver konto.',
    source: 'Cloudflare Web Analytics',
  },
  topReferrers: {
    whatIsIt: 'Vilka sajter besöken kom från.',
    howCalculated: `${TRAFFIC} Besök per hänvisande sajt, de tio största; listan summerar inte till Besök. "Direkt eller okänd" är adressfältet, ett bokmärke, en app eller en webbläsare som inte skickar hänvisare.`,
    whyImportant: 'Visar var det lönar sig att synas.',
    source: 'Cloudflare Web Analytics',
  },
};
