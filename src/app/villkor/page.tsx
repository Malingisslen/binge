import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPageShell from '@/components/layout/LegalPageShell';

export const metadata: Metadata = {
  title: 'Användarvillkor — Binge.nu',
  description:
    'Villkor för användning av Binge.nu — bevakningstjänst för film och TV-serier i Sverige.',
};

export default function VillkorPage() {
  return (
    <LegalPageShell
      title="Användarvillkor"
      lastUpdated="2026-04-20"
      version="0.1 (utkast)"
      draft
    >
      <section>
        <h2>1. Vad Binge är</h2>
        <p>
          Binge.nu (&quot;Binge&quot;, &quot;vi&quot;, &quot;oss&quot;) är ett verktyg för att hålla
          koll på film och TV-serier och se var de finns att streama i
          Sverige. Tjänsten drivs av Malin Gisslén som privatperson.
        </p>
      </section>

      <section>
        <h2>2. Ålderskrav</h2>
        <p>
          För att skapa konto måste du vara minst 13 år gammal. Om du
          är yngre kan du inte använda Binge.
        </p>
      </section>

      <section>
        <h2>3. Ditt konto</h2>
        <ul>
          <li>Du ansvarar för att uppgifterna du lämnar är korrekta.</li>
          <li>Du är ansvarig för all aktivitet på ditt konto.</li>
          <li>Håll ditt lösenord säkert. Berätta för oss direkt om någon använt ditt konto utan din tillåtelse.</li>
          <li>Vi kan stänga av konton som bryter mot dessa villkor eller våra <Link href="/community-guidelines">community-regler</Link>.</li>
        </ul>
      </section>

      <section>
        <h2>4. Vad du får göra</h2>
        <ul>
          <li>Använda Binge för personligt, icke-kommersiellt bruk.</li>
          <li>Skriva egna recensioner, anteckningar och listor.</li>
          <li>Dela publika listor och recensioner.</li>
          <li>Skapa och delta i grupper och &quot;Tillsammans&quot;-sessioner med andra användare.</li>
        </ul>
      </section>

      <section>
        <h2>5. Vad du inte får göra</h2>
        <ul>
          <li>Skrapa eller automatiserat hämta data från Binge i stor skala.</li>
          <li>Försöka kringgå våra säkerhetsåtgärder eller Firebase-säkerhetsregler.</li>
          <li>Lägga upp olagligt innehåll, trakasserier, spam, upphovsrättsskyddat material du inte får dela, eller förolämpningar riktade mot enskilda.</li>
          <li>Utge dig för att vara någon annan.</li>
          <li>Använda Binge för kommersiell vidareförsäljning av data.</li>
        </ul>
        <p>
          Läs även våra <Link href="/community-guidelines">community-regler</Link>
          för detaljerade riktlinjer kring innehåll.
        </p>
      </section>

      <section>
        <h2>6. Innehåll du skapar</h2>
        <p>
          Du behåller upphovsrätten till dina egna recensioner, listor,
          anteckningar och annat innehåll du skapar.
        </p>
        <p>
          Genom att skapa eller göra innehåll publikt ger du Binge en
          icke-exklusiv, kostnadsfri licens att visa, distribuera och
          bearbeta det inom ramen för tjänsten (t.ex. cachning,
          indexering i sök, visa i feed). Licensen upphör när du raderar
          innehållet, med undantag för:
        </p>
        <ul>
          <li>Kopior som redan delats av andra användare eller indexerats av sökmotorer.</li>
          <li>Säkerhetskopior som behålls i rimlig tid.</li>
        </ul>
      </section>

      <section>
        <h2>7. Data från The Movie Database</h2>
        <p>
          Information om filmer, serier, skådespelare och tillgänglighet
          hos streamingtjänster kommer från The Movie Database (TMDB).
          Binge använder TMDB:s API men är inte godkänd eller
          certifierad av TMDB. Data på Binge kan vara inaktuell — kolla
          alltid hos streamingtjänsten innan du fattar köpbeslut.
        </p>
      </section>

      <section>
        <h2>8. Priser för streamingtjänster</h2>
        <p>
          Prissidor i Binge (t.ex. rådgivaren) visar priser vi
          hand-uppdaterat från respektive tjänsts publika prissida.
          Priserna uppdateras regelbundet men kan vara inaktuella.
          Kontrollera alltid aktuellt pris hos streamingtjänsten.
          Binge tar inget ansvar för beslut som fattas på grundval av
          felaktig prisinformation.
        </p>
      </section>

      <section>
        <h2>9. Tillgänglighet och ansvar</h2>
        <ul>
          <li>Binge drivs &quot;i befintligt skick&quot;, utan garanti för ständig tillgänglighet eller felfrihet.</li>
          <li>Vi kan komma att göra ändringar, lägga till eller ta bort funktioner utan förvarning.</li>
          <li>I den mån det är tillåtet enligt lag ansvarar vi inte för indirekta skador, utebliven vinst, förlorade data eller förlorade streaming-abonnemang du beslutat pausa.</li>
          <li>Rådgivaren är ett hjälpmedel, inte en rekommendation. Du ansvarar själv för dina streaming-abonnemang.</li>
        </ul>
      </section>

      <section>
        <h2>10. Att avsluta kontot</h2>
        <p>
          Du kan ta bort ditt konto när som helst via inställningar.
          När du gör det raderar vi din profil, bevakningslista,
          avsnittsframsteg, notifikationer och användarnamns-reservation.
          Publika recensioner, kommentarer, listor och grupp-medlemskap
          kan behöva hanteras separat — skriv till oss om du vill ha
          dem fullständigt raderade.
        </p>
        <p>
          Vi kan stänga av eller ta bort ditt konto om du bryter mot
          dessa villkor eller våra community-regler. Vi försöker alltid
          informera först om det inte är en allvarlig överträdelse.
        </p>
      </section>

      <section>
        <h2>11. Ändringar av villkoren</h2>
        <p>
          Vi kan komma att uppdatera dessa villkor. Vid materiella
          ändringar bumpar vi versionsnumret ovan och meddelar i appen.
          Om du fortsätter använda Binge efter ändringen anses du ha
          godkänt de nya villkoren.
        </p>
      </section>

      <section>
        <h2>12. Tillämplig lag</h2>
        <p>
          Svensk lag gäller. Tvister ska i första hand lösas genom
          dialog. Om ärendet rör konsumenträtt kan du vända dig till
          Allmänna reklamationsnämnden (ARN). Om ärendet rör
          personuppgifter kan du lämna klagomål till
          Integritetsskyddsmyndigheten (IMY).
        </p>
      </section>

      <section>
        <h2>13. Kontakt</h2>
        <p>
          Frågor? Skriv till <a href="mailto:hej@binge.nu">hej@binge.nu</a>.
        </p>
      </section>
    </LegalPageShell>
  );
}
