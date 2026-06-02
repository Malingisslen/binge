import { JUSTWATCH_ATTRIBUTION_SV } from '@/lib/tmdb/attribution';

interface JustWatchCreditProps {
  /** Extra Tailwind-klasser för placering (marginaler etc.). */
  className?: string;
}

/**
 * JustWatch-attribution för watch-provider-data.
 *
 * TMDB licensierar streaming-tillgänglighet från JustWatch och kräver en
 * separat JustWatch-credit på *varje yta* där provider-datan visas — en
 * engångs-footer räcker inte (se `JUSTWATCH_ATTRIBUTION_SV` i
 * `lib/tmdb/attribution.ts` för källa + villkor). Återanvänd den här
 * komponenten överallt där watch-provider-data renderas så att texten kommer
 * från en enda källa.
 *
 * Token-stylad och kompakt (Direction H · "Schemat") — inte en dekorativ
 * badge. Inline-styles så den fungerar på både Tailwind- och inline-sidor.
 */
export default function JustWatchCredit({ className = '' }: JustWatchCreditProps) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        fontSize: 11,
        color: 'var(--ink-3)',
        letterSpacing: 0.02,
      }}
    >
      {JUSTWATCH_ATTRIBUTION_SV}
    </span>
  );
}
