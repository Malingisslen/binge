import { assertNever } from '@/lib/assertNever';
import type { MetricFormat } from '../metrics/types';

export function formatScalar(value: number, format: MetricFormat): string {
  // A metric reading a field absent on an older rollup, or an events bundle that is
  // null because nothing was counted in the range, produces NaN. Never surface "NaN%" —
  // show an en-dash instead.
  if (!Number.isFinite(value)) return '–';
  switch (format.kind) {
    case 'number':
      return value.toLocaleString('sv-SE', { maximumFractionDigits: format.decimals ?? 0 });
    case 'percent':
      return `${Math.round(value)}%`;
    case 'duration':
      return format.unit === 's' ? `${value.toFixed(0)}s` : `${Math.round(value)}ms`;
    default:
      return assertNever(format);
  }
}
