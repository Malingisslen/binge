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
      lastUpdated="2026-04-20"
      version="0.1 (utkast)"
      draft
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
          <li><strong>Din bevakningslista</strong> — titlar du följer, vill se eller har sett; betyg; anteckningar; avsnitts-framsteg.</li>
          <li><strong>Recensioner, listor och sociala kopplingar</strong> — sådant du skapat eller valt att göra publikt.</li>
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
          <li><strong>Berättigat intresse (art. 6.1.f)</strong> — för driftlogg, felsökning, missbruksskydd.</li>
          <li><strong>Samtycke (art. 6.1.a)</strong> — för eventuella framtida inslag som statistik eller marknadsföring. Inga sådana används idag.</li>
        </ul>
      </section>

      <section>
        <h2>4. Vilka som behandlar dina uppgifter åt oss</h2>
        <p>
          Vi använder följande personuppgiftsbiträden:
        </p>
        <ul>
          <li><strong>Google / Firebase</strong> (autentisering, databas, drift) — behandlar uppgifterna enligt Googles standardiserade databehandlaravtal (DPA). Data lagras inom EU om Firebase-projektet är konfigurerat för EU-region.</li>
          <li><strong>Cloudflare</strong> (CDN, DNS, brandvägg) — behandlar trafikdata under Cloudflares DPA.</li>
          <li><strong>The Movie Database (TMDB)</strong> — vi hämtar film- och serieinformation från TMDB. Dina personuppgifter överförs <em>inte</em> till TMDB; endast titel-ID:n och sökfrågor skickas.</li>
        </ul>
        <p>
          Vi använder inga reklamnätverk, spårnings-pixlar eller
          marknadsföringsverktyg.
        </p>
      </section>

      <section>
        <h2>5. Överföringar utanför EU/EES</h2>
        <p>
          Google-tjänster kan vid vissa operationer överföra data till USA.
          Google har då standardavtalsklausuler (SCC) och kompletterande
          skyddsåtgärder som grund. TMDB är amerikanskt men tar inte emot
          dina personuppgifter.
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
            permanent: profil, bevakningslista, avsnittsframsteg, notifikationer,
            blockeringar, följning-relationer, dina recensioner och kommentarer
            (även publika), dina listor, Tillsammans-sessioner du är värd för,
            och användarnamns-reservationen. Publikt innehåll anonymiseras inte —
            det raderas helt. Återställning är inte möjlig efter 7 dagar
            (Firestore Point-in-Time Recovery-fönstret).
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
          <li>Få dina uppgifter raderade (art. 17) — <em>Inställningar → Ta bort konto</em> raderar allt omedelbart.</li>
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
        <h2>10. Ändringar</h2>
        <p>
          Om vi gör materiella ändringar i denna policy uppdaterar vi
          versionsnumret ovan och meddelar dig i appen. Mindre
          redaktionella ändringar (t.ex. förtydliganden) kan ske utan
          särskild notis.
        </p>
      </section>

      <section>
        <h2>11. Kontakt</h2>
        <p>
          Har du frågor? Skriv till{' '}
          <a href="mailto:hej@binge.nu">hej@binge.nu</a>.
        </p>
      </section>
    </LegalPageShell>
  );
}
