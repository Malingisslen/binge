'use client';

import { useId } from 'react';

// BIN-91 — låter användaren backdatera när en film sågs ("jag såg den förra
// veckan"). Default = sparat datum (eller idag). max = idag: "sedd" kan inte
// ligga i framtiden. Tolkar date-input som lokal middag så ett datum-utan-tid
// inte glider en dag fel mot UTC.

function toInputValue(d: Date | null): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function WatchedDateEditor({
  watchedAt,
  onChange,
}: {
  watchedAt: Date | null;
  onChange: (d: Date) => void;
}) {
  const id = useId();
  const today = toInputValue(new Date());
  return (
    <label htmlFor={id} className="inline-flex items-center gap-[6px] text-xs text-ink-2 mt-[6px]">
      <span>Sedd den</span>
      <input
        id={id}
        type="date"
        max={today}
        // key remountar inputen om datumet ändras utanför (annan flik/enhet) så
        // den okontrollerade defaultValue inte fastnar på ett gammalt värde.
        key={toInputValue(watchedAt) || today}
        defaultValue={toInputValue(watchedAt) || today}
        onChange={e => {
          const v = e.target.value;
          if (!v) return;
          const [yy, mm, dd] = v.split('-').map(Number);
          onChange(new Date(yy, mm - 1, dd, 12, 0, 0));
        }}
        className="px-1 py-[1px] text-xs border border-rule rounded-sm bg-surface text-ink font-[inherit] outline-none"
      />
    </label>
  );
}
