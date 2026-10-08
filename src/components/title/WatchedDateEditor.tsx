'use client';

import { useId, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { fieldClass } from '@/components/ui/Field';
import { formatLibraryDate, localIsoDate } from '@/lib/utils';

// BIN-91 — låter användaren backdatera när en film sågs ("jag såg den förra
// veckan"). Default = sparat datum (eller idag). max = idag: "sedd" kan inte
// ligga i framtiden. Tolkar date-input som lokal middag så ett datum-utan-tid
// inte glider en dag fel mot UTC.
//
// Datumet visas som text i bibliotekets format ("28 aug"), inte i själva
// date-inputen: den ritas i webbläsarens språk, inte sidans, så en engelsk
// webbläsare visade "2026-08-28" eller "08/28/2026" mitt i det svenska.
// Inputen ligger dold och öppnas med showPicker(); en webbläsare utan den
// får se inputen i stället.

export default function WatchedDateEditor({
  watchedAt,
  onChange,
}: {
  watchedAt: Date | null;
  onChange: (d: Date) => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [showInput, setShowInput] = useState(false);
  const now = new Date();
  const today = localIsoDate(now);
  const value = watchedAt ? localIsoDate(watchedAt) : today;

  const openPicker = () => {
    const input = inputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      setShowInput(true);
      input.focus();
    }
  };

  return (
    <div className="relative inline-flex items-center gap-1.5 text-xs text-ink-2 mt-1.5">
      <span>Sedd</span>
      <button
        type="button"
        onClick={openPicker}
        aria-label={`Sedd ${formatLibraryDate(watchedAt ?? now, now)}. Ändra datum`}
        className="inline-flex items-center gap-1 text-ink underline decoration-rule underline-offset-2 hover:decoration-ink"
      >
        {formatLibraryDate(watchedAt ?? now, now)}
        <Pencil size={11} aria-hidden="true" />
      </button>
      <label htmlFor={id} className="sr-only">Ändra datum</label>
      <input
        ref={inputRef}
        id={id}
        type="date"
        max={today}
        // key remountar inputen om datumet ändras utanför (annan flik/enhet) så
        // den okontrollerade defaultValue inte fastnar på ett gammalt värde.
        key={value}
        defaultValue={value}
        tabIndex={showInput ? 0 : -1}
        aria-hidden={showInput ? undefined : true}
        onChange={e => {
          const v = e.target.value;
          if (!v) return;
          const [yy, mm, dd] = v.split('-').map(Number);
          onChange(new Date(yy, mm - 1, dd, 12, 0, 0));
        }}
        className={showInput ? fieldClass({ size: 'sm' }) : 'sr-only'}
      />
    </div>
  );
}
