'use client';

import type { BundleSuggestion } from '@/types';

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

function formatVerified(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function BundleArbitrageCard({ suggestions }: { suggestions: BundleSuggestion[] }) {
  if (suggestions.length === 0) return null;

  return (
    <div className="mb-[14px]">
      <div className="flex items-baseline justify-between mb-[6px]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-ink-3">
          Dina lösa tjänster kan bli billigare i ett paket
        </h2>
        {suggestions.length > 1 && (
          <span className="text-xxs text-ink-3">välj ett — de gäller inte tillsammans</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {suggestions.map((s, i) => (
          <div
            key={s.bundle.id}
            className={`bg-surface border border-rule rounded-sm px-[14px] py-[12px] ${
              i === 0 ? 'border-l-[3px] border-l-acc-deep' : ''
            }`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm font-semibold text-ink">{s.bundle.name}</div>
              <div className="text-xs text-acc-deep font-semibold whitespace-nowrap tabular-nums">
                spara {s.savingKr} kr/mån
              </div>
            </div>

            <p className="text-xs text-ink-2 mt-[4px]">
              Du betalar {s.currentKr} kr/mån för {joinNames(s.replacedNames)} var för sig.{' '}
              Samma tjänster ingår i {s.bundle.name} för {s.bundleKr} kr/mån.
            </p>

            {s.bonusNames.length > 0 && (
              <p className="text-xxs text-ink-3 mt-[4px]">
                Ingår dessutom: {joinNames(s.bonusNames)} (extra värde, inte inräknat i besparingen).
              </p>
            )}

            {s.downgradeNames.length > 0 && (
              <p className="text-xxs text-ink-3 mt-[4px]">
                {joinNames(s.downgradeNames)} ingår men i en lägre nivå än du har idag.
              </p>
            )}

            <div className="flex items-center justify-between gap-3 mt-[8px]">
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
        ))}
      </div>
    </div>
  );
}
