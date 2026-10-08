import { formatKr } from '@/lib/formatKr';

// The money figure, styled as a receipt (Malin's choice B, plan round 2, 2026-10-06):
// optional item lines, then the monthly total as the largest thing on screen, then
// the yearly sum. Used by the guest demo, the calculator's sum bar and Rådgivaren.
// Presentation only: callers pass amounts they already computed.

export interface MoneyLine {
  label: string;
  kr: number;
}

interface Props {
  monthlyKr: number;
  /** At least one amount is the catalogue's list price, not the user's own. */
  estimated: boolean;
  lines?: readonly MoneyLine[];
  /** 'md' fits a sticky bar; 'lg' is the default. */
  size?: 'md' | 'lg';
}

export default function MoneyFigure({ monthlyKr, estimated, lines = [], size = 'lg' }: Props) {
  return (
    <div className="border-t-2 border-ink pt-2 flex flex-col gap-1 tabular-nums min-w-0" data-testid="money-figure">
      {lines.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-col gap-0.5">
          {lines.map(line => (
            <li key={line.label} className="flex justify-between gap-3 text-sm text-ink-2">
              <span className="min-w-0 truncate">{line.label}</span>
              <span className="shrink-0">{formatKr(line.kr)} kr</span>
            </li>
          ))}
        </ul>
      )}
      <p
        className={`m-0 flex justify-between items-baseline gap-3 ${lines.length > 0 ? 'border-t border-dashed border-rule pt-1.5 mt-0.5' : ''}`}
      >
        <span className="text-sm font-bold text-ink">Per månad</span>
        <span className={`font-extrabold tracking-[-0.02em] leading-none text-ink ${size === 'lg' ? 'text-5xl' : 'text-4xl'}`}>
          {formatKr(monthlyKr)} kr
        </span>
      </p>
      <p className="m-0 flex justify-between gap-3 text-sm text-ink-2">
        <span>{estimated ? 'Per år, uppskattat' : 'Per år'}</span>
        <span>{formatKr(monthlyKr * 12)} kr</span>
      </p>
    </div>
  );
}
