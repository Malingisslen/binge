import type { Metadata } from 'next';
import LegalPageShell from '@/components/layout/LegalPageShell';

export const metadata: Metadata = {
  title: 'Community-regler — Binge.nu',
  description:
    'Riktlinjer för recensioner, listor och socialt innehåll på Binge.nu.',
};

export default function CommunityGuidelinesPage() {
  return (
    <LegalPageShell
      title="Community-regler"
      lastUpdated="2026-04-20"
      version="0.1 (utkast)"
      draft
    >
      <section>
        <p className="text-text-secondary">
          Binge ska vara ett trovärdigt och trevligt verktyg. Dessa
          regler gäller allt publikt innehåll du lägger upp: recensioner,
          kommentarer, listor, gruppnamn och användarnamn.
        </p>
      </section>

      <section>
        <h2>Gör så här</h2>
        <ul>
          <li><strong>Var ärlig.</strong> Skriv om du själv sett filmen/serien. En ärlig etta är mer värd än en påhittad femma.</li>
          <li><strong>Var respektfull.</strong> Kritisera verket, inte personen.</li>
          <li><strong>Spoilervarning.</strong> Varna tydligt i början av en recension om du avslöjar handlingen.</li>
          <li><strong>Använd ditt riktiga eller valda namn.</strong> Varumärkes- och företagsnamn är inte OK som användarnamn om du inte representerar dem.</li>
        </ul>
      </section>

      <section>
        <h2>Detta är inte OK</h2>
        <ul>
          <li><strong>Trakasserier och hot.</strong> Mot andra användare, skådespelare, filmskapare eller någon annan.</li>
          <li><strong>Hatiskt innehåll.</strong> Rasism, homofobi, transfobi, sexism, religiös hets, nedvärdering av funktionsvariationer.</li>
          <li><strong>Spam.</strong> Upprepat innehåll, marknadsföringsinnehåll, länkar till oseriösa tjänster.</li>
          <li><strong>Olagligt innehåll.</strong> Sådant som bryter mot svensk lag (t.ex. förtal, olaga hot, kränkningar).</li>
          <li><strong>Upphovsrättsintrång.</strong> Dela inte streaming-länkar till piratkopior, okända sidor som erbjuder gratis strömning, eller annat som bryter mot upphovsrätten.</li>
          <li><strong>Identitetsstöld.</strong> Låtsas inte vara någon du inte är.</li>
          <li><strong>Doxxing.</strong> Lägg inte ut andras personuppgifter (adress, telefon, arbetsplats etc.) utan samtycke.</li>
        </ul>
      </section>

      <section>
        <h2>Användarnamn</h2>
        <p>
          Ditt användarnamn kan vara 3–30 tecken (lägre-case bokstäver,
          siffror, understreck). Vi reserverar oss rätten att neka eller
          ta bort användarnamn som bryter mot reglerna ovan (t.ex.
          stötande, varumärkesintrång, namn på kända personer).
        </p>
      </section>

      <section>
        <h2>Rapportering</h2>
        <p>
          Ser du något som bryter mot reglerna? Skriv till{' '}
          <a href="mailto:hej@binge.nu">hej@binge.nu</a> med länk till
          innehållet och en kort beskrivning. Vi läser alla rapporter
          och försöker svara inom några dagar.
        </p>
      </section>

      <section>
        <h2>Konsekvenser</h2>
        <p>
          Vid brott mot reglerna kan vi:
        </p>
        <ul>
          <li>Ta bort innehållet.</li>
          <li>Skicka en varning.</li>
          <li>Begränsa vissa funktioner (t.ex. möjlighet att posta recensioner).</li>
          <li>Stänga av kontot tillfälligt.</li>
          <li>Stänga av kontot permanent vid upprepade eller grova överträdelser.</li>
        </ul>
        <p>
          Vi försöker vara proportionerliga. En första överträdelse
          möts oftare av en varning än avstängning. Allvarliga regelbrott
          (trakasserier, olagligt innehåll) kan leda till direkt
          avstängning.
        </p>
      </section>

      <section>
        <h2>Att överklaga</h2>
        <p>
          Tycker du att vi agerat fel? Skriv till
          <a href="mailto:hej@binge.nu"> hej@binge.nu</a> och förklara.
          Vi kommer se över beslutet och svara inom rimlig tid.
        </p>
      </section>

      <section>
        <h2>Ändringar</h2>
        <p>
          Vi kan komma att uppdatera dessa regler. Vid materiella
          ändringar meddelar vi i appen.
        </p>
      </section>
    </LegalPageShell>
  );
}
