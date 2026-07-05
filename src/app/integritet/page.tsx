import type { Metadata } from 'next';
import LegalPageShell from '@/components/layout/LegalPageShell';

export const metadata: Metadata = {
  description:
    'Hur Binge.nu hanterar dina personuppgifter enligt GDPR och svensk dataskyddslag.',
};

export default function IntegritetPage() {
  return (
    <LegalPageShell
      title="Integritetspolicy"
      lastUpdated="2026-07-05"
      version="1.2"
    >
      <section>
        <h2>1. Vem är ansvarig?</h2>
        <p>
          Binge.nu drivs av Malin Gisslén som privatperson. För frågor
          om dina personuppgifter — inklusive begäran om registerutdrag,
          rättelse eller radering — kontakta{' '}
          <a href="mailto:hej@binge.nu">hej@binge.nu</a>.
        </p>
      </section>

      <section>
        <h2>2. Vilka uppgifter vi samlar in</h2>
        <p>
          När du skapar ett konto på Binge.nu sparar vi följande:
        </p>
        <ul>
          <li><strong>E-postadress</strong> — från inloggning (Firebase Authentication).</li>
          <li><strong>Visningsnamn</strong> — det namn du valt eller som följt med från Google-inloggning.</li>
          <li><strong>Användarnamn</strong> — om du valt ett publikt användarnamn för din profil.</li>
          <li><strong>Dina streamingtjänster</strong> — vilka tjänster du har, vilket abonnemang (nivå), pris, och eventuella pauser.</li>
          <li><strong>Din bevakningslista</strong> — titlar du följer, vill se eller har sett; betyg; anteckningar; egna taggar (fritext du själv anger); avsnitts-framsteg.</li>
          <li><strong>Recensioner, listor och sociala kopplingar</strong> — recensioner, kommentarer och listor du skapat, samt vänner, följare och grupp-medlemskap.</li>
          <li><strong>Streamingrådgivaren-historik</strong> — dina pausa- och återuppta-beslut (sparbeslut) som rådgivaren sparar.</li>
          <li><strong>&quot;Inte intresserad&quot;-markeringar</strong> — titlar du gömt från rekommendationer.</li>
          <li><strong>Push-notistoken</strong> — om du aktiverat push-notiser sparar vi en enhetsspecifik token (Firebase Cloud Messaging) för att kunna skicka notiser.</li>
          <li><strong>Teknisk logg-data</strong> — IP-adress och webbläsarens User-Agent hanteras av Firebase och Cloudflare för säkerhet och drift.</li>
        </ul>
        <p>
          Vi samlar <strong>inte</strong> in: geografisk position, kontaktlista,
          kalender, eller innehåll från andra appar. Vi säljer aldrig dina
          uppgifter.
        </p>
      </section>

      <section>
        <h2>3. Varför vi behandlar uppgifterna (rättslig grund)</h2>
        <ul>
          <li><strong>Avtal (GDPR art. 6.1.b)</strong> — för att leverera tjänsten: spara din bevakningslista, visa rätt streaming-info, köra rådgivaren.</li>
          <li><strong>Berättigat intresse (art. 6.1.f)</strong> — för driftlogg, felsökning, felövervakning, bot- och missbruksskydd, samt cookiefri och anonymiserad besöksstatistik (se §4).</li>
          <li><strong>Samtycke (art. 6.1.a)</strong> — för Hushåll, den frivilliga delningen av prenumerationskostnader i grupper (se §10), samt eventuella framtida inslag som kräver samtycke, t.ex. marknadsföring eller cookie-baserad spårning. Inga marknadsföringsinslag används idag.</li>
        </ul>
      </section>

      <section>
        <h2>4. Vilka som behandlar dina uppgifter åt oss</h2>
        <p>
          Vi använder följande personuppgiftsbiträden:
        </p>
        <ul>
          <li><strong>Google / Firebase</strong> (autentisering, databas, push-notiser, drift) — behandlar uppgifterna enligt Googles databehandlaravtal (DPA). Dina uppgifter lagras inom EU: Firestore-databasen i multiregionen <code>eur3</code> (Belgien och Nederländerna) och serverfunktionerna i <code>europe-west1</code> (Belgien).</li>
          <li><strong>Google reCAPTCHA / Firebase App Check</strong> (bot- och missbruksskydd) — laddar ett skript från Google som analyserar webbläsarsignaler för att skilja människor från bottar. Sätter en teknisk token och skickar signaler till Google.</li>
          <li><strong>Plausible Analytics</strong> (besöksstatistik) — cookiefri och IP-anonymiserad statistik över sidvisningar. Sätter inga cookies och lagrar varken din IP-adress eller andra personuppgifter.</li>
          <li><strong>Cloudflare</strong> (CDN, DNS, brandvägg) — behandlar trafikdata under Cloudflares DPA.</li>
          <li><strong>The Movie Database (TMDB)</strong> — vi hämtar film- och serieinformation från TMDB. Dina personuppgifter överförs <em>inte</em> till TMDB; endast titel-ID:n och sökfrågor skickas.</li>
          <li><strong>Sentry</strong> (felövervakning) — tar emot teknisk information när något går fel i appen, så vi kan hitta och rätta buggar. Personuppgifter som e-post, användarnamn och användar-id rensas bort innan felrapporten skickas. Sentry är amerikanskt och anlitar i sin tur egna underleverantörer (bl.a. Intercom och OpenAI); aktuell lista finns hos <a href="https://sentry.io/legal/subprocessors/" target="_blank" rel="noopener noreferrer">Sentry</a>.</li>
          <li><strong>Google Gemini</strong> (används av &quot;Fråga Binge&quot;) — om vår vanliga sökning inte lyckas tolka din fritextfråga skickas själva frågetexten till Googles Gemini-modell, som tolkar den till en sökning. Ingen profil- eller tittardata skickas med, bara din formulering. Frågetexten skickas i stunden för tolkningen. Som EES-kund omfattas behandlingen av Googles databehandlaravtal (DPA), och frågetexten används inte för att träna eller förbättra Googles modeller. Google Gemini är amerikanskt.</li>
        </ul>
        <p>
          Vi använder inga reklamnätverk eller marknadsföringsverktyg, och
          ingen cookie-baserad spårning för annonsändamål.
        </p>
      </section>

      <section>
        <h2>5. Överföringar utanför EU/EES</h2>
        <p>
          Vissa leverantörer är amerikanska eller kan vid enskilda operationer
          överföra data till USA: Google (inklusive reCAPTCHA och Gemini),
          Sentry och Cloudflare.
          För dessa överföringar gäller EU-kommissionens
          standardavtalsklausuler (SCC) och, där det är tillämpligt, EU–US Data
          Privacy Framework, med kompletterande skyddsåtgärder. TMDB är
          amerikanskt men tar inte emot dina personuppgifter.
        </p>
      </section>

      <section>
        <h2>6. Hur länge vi sparar uppgifterna</h2>
        <ul>
          <li>Din profil och bevakningslista sparas så länge ditt konto är aktivt.</li>
          <li>Notifikationer sparas i upp till 180 dagar.</li>
          <li>Tillsammans-sessioner utgår automatiskt 7 dagar efter skapandet.</li>
          <li>Teknisk logg-data i Firebase/Cloudflare sparas enligt respektive leverantörs standardtid (typiskt 30 dagar).</li>
          <li>
            <strong>Om du tar bort ditt konto</strong> raderar vi all din data
            permanent och omedelbart: profil, bevakningslista, avsnittsframsteg,
            betyg, anteckningar och egna taggar, notifikationer, &quot;inte intresserad&quot;-
            markeringar, Streamingrådgivaren-historik, push-notistoken,
            blockeringar, vän- och följar-relationer (även de speglade hos
            motparten), dina recensioner inklusive likes och kommentarer på dem,
            kommentarer och likes du gjort på andras recensioner, dina listor,
            Tillsammans-sessioner du är värd för, samt grupper du äger (grupper
            du bara är medlem i lämnar du automatiskt). Slutligen raderas ditt
            inloggningskonto och din användarnamns-reservation. Publikt innehåll
            anonymiseras inte — det raderas helt. De följar-länkar som andra
            användare har till ditt konto kan vi av tekniska skäl inte radera i
            samma stund (de ägs av respektive följare) — de städas bort
            automatiskt av en återkommande rutin, normalt en gång i veckan.
            Återställning är inte möjlig efter 7 dagar (Firestore
            Point-in-Time Recovery-fönstret).
          </li>
          <li>
            <strong>Ett undantag från raderingen:</strong> om du har anmält
            innehåll för moderering kan själva anmälan sparas i moderationssyfte
            även efter att du raderat ditt konto — det vill säga ditt interna
            användar-id, vilket skäl du angav och en eventuell kommentar du
            skrev. Det gör vi för att kunna hantera missbruk och försvara
            moderationsbeslut (GDPR art. 17.3). Anmälan är aldrig publik och
            syns bara för administratörer.
          </li>
        </ul>
      </section>

      <section>
        <h2>7. Dina rättigheter</h2>
        <p>
          Du har rätt att:
        </p>
        <ul>
          <li>Få tillgång till de personuppgifter vi har om dig (art. 15) — ladda ner via <em>Inställningar → Exportera min data</em>, eller kontakta oss.</li>
          <li>Få felaktiga uppgifter rättade (art. 16) — de flesta fält kan du ändra själv i inställningarna.</li>
          <li>Få dina uppgifter raderade (art. 17) — <em>Inställningar → Ta bort konto</em> raderar all din data (med de undantag och tidsramar som beskrivs i §6).</li>
          <li>Få en kopia i maskinläsbart JSON-format (art. 20) — <em>Inställningar → Exportera min data</em>.</li>
          <li>Invända mot behandling som stöds av berättigat intresse (art. 21).</li>
          <li>Lämna klagomål till Integritetsskyddsmyndigheten (IMY, <a href="https://www.imy.se" target="_blank" rel="noopener noreferrer">imy.se</a>).</li>
        </ul>
      </section>

      <section>
        <h2>8. Cookies och lokal lagring</h2>
        <p>
          Binge sätter inga egna spårningscookies. Vi använder:
        </p>
        <ul>
          <li><strong>IndexedDB</strong> — Firebase lagrar din inloggningssession här.</li>
          <li><strong>Funktionella cookies från Cloudflare</strong> (<code>__cf_bm</code>, <code>__cflb</code>) — används för botskydd och lastbalansering och är nödvändiga för att tjänsten ska fungera.</li>
          <li><strong>Google reCAPTCHA</strong> (<code>_GRECAPTCHA</code>) — sätts av Googles reCAPTCHA/App Check för bot- och missbruksskydd. Räknas som nödvändig för tjänstens säkerhet.</li>
        </ul>
        <p>
          Om vi i framtiden lägger till statistik- eller marknadsförings-
          verktyg kommer vi först be om ditt samtycke enligt LEK
          (lagen om elektronisk kommunikation).
        </p>
      </section>

      <section>
        <h2>9. Ålder</h2>
        <p>
          För att skapa konto på Binge måste du vara minst 13 år gammal,
          enligt GDPR art. 8 och svensk nationell reglering.
        </p>
      </section>

      <section>
        <h2>10. Delning i grupper (Hushåll)</h2>
        <p>
          Om du går med i en grupp kan du välja att aktivera <strong>Hushåll</strong> —
          en frivillig funktion där du delar dina prenumerationskostnader med de
          medlemmar i gruppen som själva också delar sina. Att gå med i en grupp
          innebär inte automatiskt att du delar; du får en samtyckesruta innan
          något sparas.
        </p>
        <ul>
          <li><strong>Vad vi sparar</strong> — vilka streamingtjänster du har, vad de kostar dig (ordinarie pris, aldrig vilken abonnemangsnivå), eventuellt kampanjpris med slutdatum, samt vilka av tjänsterna som bär minst en osedd titel i din bevakningslista.</li>
          <li><strong>Syfte</strong> — att ge gruppen en samlad hushållsbild, t.ex. &quot;Disney+ betalas av 2 av er&quot;, så ni kan se om ni betalar dubbelt för samma tjänst.</li>
          <li><strong>Vem kan se det</strong> — andra medlemmar i gruppen (nuvarande och framtida), men bara de som själva delar sina egna kostnader. Appens gränssnitt visar bara summerade totaler, men tekniskt kan en delande medlem läsa din enskilda lista rad för rad — vi vill att du vet det innan du väljer att dela.</li>
          <li><strong>Din kontroll</strong> — sluta dela när som helst med ett tryck; din data raderas då omedelbart. Den raderas också automatiskt om du lämnar gruppen, blir borttagen ur den, eller tar bort ditt konto.</li>
          <li><strong>Export</strong> — dina hushålls-bidrag ingår i din dataexport (se §7).</li>
        </ul>
      </section>

      <section>
        <h2>11. Ändringar</h2>
        <p>
          Om vi gör materiella ändringar i denna policy uppdaterar vi
          versionsnumret ovan och meddelar dig i appen. Mindre
          redaktionella ändringar (t.ex. förtydliganden) kan ske utan
          särskild notis.
        </p>
      </section>

      <section>
        <h2>12. Kontakt</h2>
        <p>
          Har du frågor? Skriv till{' '}
          <a href="mailto:hej@binge.nu">hej@binge.nu</a>.
        </p>
      </section>
    </LegalPageShell>
  );
}
