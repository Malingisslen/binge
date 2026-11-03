'use client';

import { Button } from '@/components/ui/Button';

// Samtyckesvyn delas av gruppsidans panel, rådgivarens hushållsläge och hushållssidan,
// så att den bindande texten (ADR 0010, ADR 0026, ADR 0029) bara finns på ett ställe och
// inte kan glida isär mellan ytorna.
export default function HouseholdConsent({
  reshare, household = false, busy, ready, onShare, onCancel,
}: {
  /** True när medlemmen redan delar och bara delar om under den nya texten. */
  reshare: boolean;
  /** ADR 0029: ett hushåll delar också titlarna man tittar på, så det har en egen text. */
  household?: boolean;
  busy: boolean;
  /** False medan payloaden byggs: Dela får aldrig tyst no-op:a. */
  ready: boolean;
  onShare: () => void;
  onCancel: () => void;
}) {
  const heading = reshare
    ? 'Dela igen med det nya?'
    : household ? 'Dela vad ni tittar på med hushållet?' : 'Dela dina streamingkostnader med gruppen?';
  return (
    <div className="px-3 py-2 space-y-2">
      <p className="text-xs font-bold text-ink">{heading}</p>
      {household ? <HouseholdCopy /> : <GroupCopy />}
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          variant="acc"
          size="sm"
          className="flex-1"
          disabled={busy || !ready}
          onClick={onShare}
        >
          Dela
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Avbryt
        </Button>
      </div>
    </div>
  );
}

const listClass = 'text-xxs text-ink-2 leading-relaxed list-disc pl-4 space-y-1';

function GroupCopy() {
  return (
    <ul className={listClass}>
      <li>
        <span className="font-semibold">Det här delas:</span> vad du betalar per
        tjänst (inklusive kampanjpris och dess slutdatum) och vilka tjänster som
        har titlar i din backlog. Aldrig vilka titlar du tittar på. Alla i gruppen ser redan
        vilka tjänster du har.
      </li>
      <li>
        <span className="font-semibold">Nytt inom 30 dagar:</span> på vilka tjänster
        du har något nytt på väg inom 30 dagar. Bara tjänsten, aldrig titeln eller
        datumet.
      </li>
      <li>
        <span className="font-semibold">Dölj en titel:</span> en titel du själv markerat
        som Privat på själva titeln räknas inte med i vad hushållet ser.
      </li>
      <li>
        <span className="font-semibold">Vilka ser det:</span> nuvarande och framtida
        medlemmar i den här gruppen som själva delar sina kostnader.
      </li>
      <li>
        <span className="font-semibold">Syfte:</span> en sammanlagd hushållsbild —
        totalkostnad, dubbelbetalda tjänster och tjänster utan användning.
      </li>
      <li>
        I appen visas bara totalsiffror — men tekniskt kan delande
        gruppmedlemmar nå din enskilda lista.
      </li>
      <li>
        Röster är undantaget: om du röstar om en tjänst visas din röst med ditt
        namn för de medlemmar som delar. Att rösta är frivilligt.
      </li>
      <li>
        Du kan sluta dela när som helst; din data raderas då direkt.
      </li>
    </ul>
  );
}

// Malin godkände lydelsen 2026-11-03 (ADR 0029). Meningen om den tekniska läsluckan är
// ADR 0010:s bindande upplysning och står kvar i varje variant.
export function HouseholdCopy() {
  return (
    <ul className={listClass}>
      <li>
        <span className="font-semibold">Det här delas:</span> vad du betalar per tjänst,
        vilka tjänster som har titlar i din backlog, vilka tjänster som har något nytt på
        väg, och titlarna du just nu tittar på, med ditt förnamn. Aldrig status, betyg,
        tid eller anteckningar.
      </li>
      <li>
        <span className="font-semibold">Dölj en titel:</span> en titel du markerat som
        Privat delas inte alls.
      </li>
      <li>
        <span className="font-semibold">Vilka ser det:</span> medlemmarna i hushållet som
        själva delar. Högst 6 personer.
      </li>
      <li>
        <span className="font-semibold">Syfte:</span> en hushållsöversikt, inte att
        kartlägga vad du tittar på.
      </li>
      <li>
        <span className="font-semibold">Rösta:</span> frivilligt, och din röst visas med
        ditt namn.
      </li>
      <li>
        Tekniskt kan delande medlemmar nå din enskilda lista.
      </li>
      <li>
        Du kan sluta dela när som helst, då raderas din data direkt.
      </li>
    </ul>
  );
}
