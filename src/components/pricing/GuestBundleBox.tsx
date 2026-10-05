import { formatKr } from '@/lib/formatKr';
import { formatPriceDay } from '@/lib/priceFreshness';
import type { BundleSuggestion } from '@/lib/advisor/bundleArbitrage';

// Paketrutan för gäster — kalkylatorn och startsidans demo. Systerkomponenten
// BundleArbitrageCard säger "Du betalar …" om inloggades egna belopp; en gäst har
// bara kryssat i listpriser, så den här texten säger aldrig "du betalar" (#28:s
// villkor 8). Alla belopp kommer färdiga ur detectBundleArbitrage.

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} och ${names[names.length - 1]}`;
}

function commitmentText(s: BundleSuggestion): string {
  const parts: string[] = [];
  parts.push(s.bindingMonths > 0 ? `${s.bindingMonths} mån bindningstid` : 'Ingen bindningstid');
  parts.push(
    s.startFeeKr > 0
      ? `startavgift ${formatKr(s.startFeeKr)} kr, räknad som ${formatKr(s.startFeeMonthlyKr)} kr/mån i besparingen`
      : 'ingen startavgift',
  );
  return parts.join(' · ');
}

export default function GuestBundleBox({
  suggestion,
  estimated,
  compact = false,
}: {
  suggestion: BundleSuggestion;
  /** Minst en ersatt tjänst är räknad på listpris. */
  estimated: boolean;
  compact?: boolean;
}) {
  const s = suggestion;
  const verified = `Priser verifierade ${formatPriceDay(s.bundle.verifiedDate)}${s.stale ? ', kan vara inaktuella' : ''}.`;
  const saving = `Du sparar${estimated ? ' uppskattningsvis' : ''} ${formatKr(s.savingKr)} kr/mån (${formatKr(s.savingKr * 12)} kr/år).`;

  return (
    <section
      aria-label="Billigare som paket"
      data-testid="guest-bundle"
      className="bg-surface border border-rule border-l-[3px] border-l-acc-deep rounded-sm px-3 py-[10px]"
    >
      <h2 className="text-sm font-semibold text-ink m-0">Billigare som paket</h2>
      <p className="text-sm text-ink mt-1">
        {s.bundle.name} har {joinNames(s.replacedNames)} för {formatKr(s.bundleKr)} kr/mån. {saving}
      </p>
      <p className="text-xs text-ink-2 mt-1 tabular-nums">{commitmentText(s)}.</p>
      {!compact && s.commitmentTotalKr != null && (
        <p className="text-xs text-ink-2 tabular-nums">
          Totalt under bindningstiden: {formatKr(s.commitmentTotalKr)} kr.
        </p>
      )}
      {s.downgradeNames.length > 0 && (
        <p className="text-xs text-ink-2 mt-1">Ingår men i lägre nivå: {joinNames(s.downgradeNames)}.</p>
      )}
      {!compact && s.bonusNames.length > 0 && (
        <p className="text-xs text-ink-3 mt-1">
          Ingår också: {joinNames(s.bonusNames)} (inte inräknat i besparingen).
        </p>
      )}
      <div className="flex items-center justify-between gap-3 mt-1">
        <p className={`text-xxs m-0 ${s.stale ? 'text-danger-ink' : 'text-ink-3'}`}>{verified}</p>
        {!compact && s.bundle.url && (
          <a
            href={s.bundle.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xxs text-ink-2 underline whitespace-nowrap"
          >
            Till {s.bundle.vendor}
          </a>
        )}
      </div>
    </section>
  );
}
