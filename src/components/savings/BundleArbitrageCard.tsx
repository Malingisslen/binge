'use client';

import { formatKr } from '@/lib/formatKr';
import type { BundleSuggestion } from '@/types';
import { Eyebrow } from '@/components/ui/Eyebrow';

// BIN-430 — UI-yta för paket-arbitrage (motorn: src/lib/advisor/bundleArbitrage.ts,
// BIN-183/433). Visar när användarens LÖSA, var-för-sig-betalda tjänster vore
// billigare köpta som ett svenskt telecom/streamer-paket.
//
// Ärlighetsribban (roll #28, ärvd från motorns header — UI:t får ALDRIG luckra
// upp den):
//   - Varje kr som visas är en känd, verklig abonnemangskostnad (currentKr /
//     bundleKr / savingKr kommer färdigberäknade från motorn — vi prisar inget
//     eget här).
//   - Bonus-tjänster visas KVALITATIVT, aldrig med ett pris och aldrig inräknade
//     i besparingen.
//   - Nedgraderingar ("ingår men i lägre nivå") visas kvalitativt och räknas
//     aldrig som en besparing.
//   - Stale-caveaten (motorns `stale`-flagga) MÅSTE synas — en realpengars-
//     rekommendation som gått overifierad i månader måste säga det.
//   - Förslagen är ÖMSESIDIGT UTESLUTANDE (man köper ett paket): vi presenterar
//     dem som alternativ och summerar dem aldrig.

// Svensk uppräkning: "A, B och C".
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} och ${names[names.length - 1]}`;
}

// Bindning och startavgift (BIN-1335, juridikens villkor): står alltid direkt under
// rubriken när paketet har någon av dem, startavgiften i kronor, och den utslagna
// delen som "räknad som" — aldrig som en egen månadsrad. Talet är samma heltal som
// motorn drog av i savingKr.
function commitmentLine(s: BundleSuggestion): string | null {
  const parts: string[] = [];
  if (s.bindingMonths > 0) parts.push(`${s.bindingMonths} mån bindningstid`);
  if (s.startFeeKr > 0) {
    parts.push(`startavgift ${formatKr(s.startFeeKr)} kr (räknad som ${formatKr(s.startFeeMonthlyKr)} kr/mån i besparingen)`);
  }
  if (parts.length === 0) return null;
  const line = parts.join(' · ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function formatVerified(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function BundleArbitrageCard({ suggestions }: { suggestions: BundleSuggestion[] }) {
  if (suggestions.length === 0) return null;

  return (
    <div className="mb-3.5">
      <div className="flex items-baseline justify-between mb-1.5">
        <Eyebrow as="h2" size="xs">
          Dina lösa tjänster kan bli billigare i ett paket
        </Eyebrow>
        {suggestions.length > 1 && (
          <span className="text-xxs text-ink-3">välj ett — de gäller inte tillsammans</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {suggestions.map((s, i) => {
          const commitment = commitmentLine(s);
          return (
            <div
              key={s.bundle.id}
              className={`bg-surface border border-rule rounded-sm px-3.5 py-3 ${
                i === 0 ? 'border-l-[3px] border-l-acc-deep' : ''
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-semibold text-ink">{s.bundle.name}</div>
                <div className="text-xs text-acc-deep font-semibold whitespace-nowrap tabular-nums">
                  spara {formatKr(s.savingKr)} kr/mån
                </div>
              </div>

              {commitment && (
                <div data-testid="bundle-commitment" className="mt-1">
                  <p className="text-xs text-ink tabular-nums">{commitment}</p>
                  {s.commitmentTotalKr != null && (
                    <p className="text-xs text-ink tabular-nums">
                      Totalt under bindningstiden: {formatKr(s.commitmentTotalKr)} kr
                    </p>
                  )}
                </div>
              )}

              <p className="text-xs text-ink-2 mt-1">
                Du betalar {formatKr(s.currentKr)} kr/mån för {joinNames(s.replacedNames)} var för sig.{' '}
                Samma tjänster ingår i {s.bundle.name} för {formatKr(s.bundleKr)} kr/mån.
              </p>

              {s.bonusNames.length > 0 && (
                <p className="text-xxs text-ink-3 mt-1">
                  Ingår dessutom: {joinNames(s.bonusNames)} (extra värde, inte inräknat i besparingen).
                </p>
              )}

              {s.downgradeNames.length > 0 && (
                <p className="text-xxs text-ink-3 mt-1">
                  {joinNames(s.downgradeNames)} ingår men i en lägre nivå än du har idag.
                </p>
              )}

              <div className="flex items-center justify-between gap-3 mt-2">
                <p className={`text-xxs ${s.stale ? 'text-danger-ink' : 'text-ink-3'}`}>
                  Priser verifierade {formatVerified(s.bundle.verifiedDate)}
                  {s.stale ? ' — kan vara inaktuella' : ''}
                </p>
                {s.bundle.url && (
                  <a
                    href={s.bundle.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xxs text-acc-deep no-underline whitespace-nowrap"
                  >
                    Till {s.bundle.vendor} ›
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
