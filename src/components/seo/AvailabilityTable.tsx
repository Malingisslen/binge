import Link from 'next/link';
import type { AvailabilityHow, TitleAvailability } from '@/lib/seo/titleAvailability';
import { formatKr } from '@/lib/formatKr';
import { thClass } from '@/components/ui/tableHead';

// BIN-1439 steg 2 (ADR 0024) — inga hooks, så tabellen hamnar i den statiska
// HTML:en som Google läser, inte bara efter hydrering.

const HOW_LABEL: Record<AvailabilityHow, string> = {
  gratis: 'Gratis',
  reklam: 'Gratis med reklam',
  abonnemang: 'Ingår i abonnemang',
  'hyr-kop': 'Hyr eller köp',
};

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

function svDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const linkStyle = { color: 'var(--ink-2)', textDecoration: 'none', borderBottom: '1px solid var(--rule)' } as const;

export function AvailabilityTable({ title, availability }: { title: string; availability: TitleAvailability }) {
  const { rows, cheapestName, pricesVerifiedOn } = availability;
  if (rows.length === 0) return null;
  return (
    <section className="detail-section">
      <div className="head">
        <h2>Så ser du {title} i Sverige</h2>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-md)', fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              <th scope="col" className={thClass('text-left px-2')}>Tjänst</th>
              <th scope="col" className={thClass('text-left px-2')}>Hur</th>
              <th scope="col" className={thClass('text-left px-2')}>Pris</th>
              <th scope="col" className={thClass('text-left px-2')}><span className="sr-only">Mer</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const cheapest = r.name === cheapestName;
              const cell = { padding: '7px 8px', borderBottom: '1px solid var(--rule-2)' } as const;
              return (
                <tr key={r.name} className={cheapest ? 'bg-acc-soft' : undefined}>
                  <th scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 600 }}>
                    {r.name}
                    {cheapest && <span className="text-acc-deep" style={{ marginLeft: 6, fontSize: 'var(--fs-xs)', fontWeight: 700 }}>Billigast av dessa</span>}
                  </th>
                  <td style={cell} className="text-ink-2">{HOW_LABEL[r.how]}</td>
                  <td style={cell}>
                    {r.how === 'gratis'
                      ? '0 kr'
                      : r.monthlyFrom !== null
                        ? `Från ${formatKr(r.monthlyFrom)} kr/mån${r.tierName ? ` (${r.tierName})` : ''}`
                        : r.how === 'abonnemang' ? '–' : r.how === 'hyr-kop' ? 'Pris hos tjänsten' : ''}
                  </td>
                  <td style={cell}>
                    {r.hubHref && <Link href={r.hubHref} style={linkStyle}>Mer på {r.name}</Link>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-ink-3" style={{ fontSize: 'var(--fs-sm)', marginTop: 8 }}>
        Tjänsterna gäller när sidan senast byggdes.
        {pricesVerifiedOn && ` Priser ur Binges prislista, kontrollerade ${svDate(pricesVerifiedOn)}.`}
        {' '}<Link href="/streamingkostnad/" style={linkStyle}>Räkna ut vad din streaming kostar</Link>
      </p>
    </section>
  );
}
