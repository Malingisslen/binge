'use client';

import { Button } from '@/components/ui/Button';

// Samtyckesvyn delas av gruppsidans panel och rådgivarens hushållsläge, så att
// den bindande texten (ADR 0010, ADR 0026) bara finns på ett ställe och inte kan
// glida isär mellan de två ytorna.
export default function HouseholdConsent({
  reshare, busy, ready, onShare, onCancel,
}: {
  /** True när medlemmen redan delar och bara delar om under den nya texten. */
  reshare: boolean;
  busy: boolean;
  /** False medan payloaden byggs: Dela får aldrig tyst no-op:a. */
  ready: boolean;
  onShare: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="px-3 py-2 space-y-2">
      {/* Samtyckesvyn — bindande copy (Legal #1/#3 + ADR 0010, ADR 0026). */}
      <p className="text-xs font-bold text-ink">
        {reshare ? 'Dela igen med det nya?' : 'Dela dina streamingkostnader med gruppen?'}
      </p>
      <ul className="text-xxs text-ink-2 leading-relaxed list-disc pl-4 space-y-1">
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
