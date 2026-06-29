'use client';

import type { CinemaToStreaming } from '@/lib/calendar/releaseDate';

// BIN-193 (option B — "informationsrad"): one row high on a film's page when it
// is still in Swedish cinemas but has a known future digital date. "På bio nu"
// (saffron = live/now) + the home-release countdown (plum = date/time) +
// "Bevaka släpp" which adds the film to Vill se — that surfaces the digital
// release in the calendar and arms the existing availability FCM push.

const SV_MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function formatSvDate(iso: string): string {
  const [, m, d] = iso.split('-');
  const month = SV_MONTHS[Number(m) - 1] ?? '';
  return `${Number(d)} ${month}`;
}

function countdownLabel(daysUntil: number): string {
  if (daysUntil <= 1) return 'imorgon';
  if (daysUntil <= 30) return `om ${daysUntil} dagar`;
  // Beyond a month a day-count reads oddly; lead with the date instead.
  return '';
}

export default function CinemaCountdownStrip({
  info,
  inLibrary,
  onBevaka,
}: {
  info: CinemaToStreaming;
  inLibrary: boolean;
  onBevaka: () => void;
}) {
  const when = formatSvDate(info.digitalDate);
  const rel = countdownLabel(info.daysUntil);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-rule-2 bg-surface px-3 py-2">
      <span className="inline-flex items-center gap-[5px] whitespace-nowrap text-[12px] font-bold text-acc-deep">
        <span className="h-[6px] w-[6px] rounded-full bg-acc" />
        På bio nu
      </span>
      <span className="text-[13.5px] text-ink-2">
        Hemma att hyra{' '}
        {rel && <><b className="text-cal-deep">{rel}</b> · </>}
        <b className="text-ink">{when}</b>
      </span>
      {inLibrary ? (
        <span className="ml-auto whitespace-nowrap text-[12px] text-ink-3">Bevakar släppet ✓</span>
      ) : (
        <button
          type="button"
          onClick={onBevaka}
          className="btn btn-acc btn-sm ml-auto whitespace-nowrap"
        >
          Bevaka släpp
        </button>
      )}
    </div>
  );
}
