import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AvailabilityTable } from './AvailabilityTable';
import type { AvailabilityRow, TitleAvailability } from '@/lib/seo/titleAvailability';

const row = (r: Partial<AvailabilityRow> & Pick<AvailabilityRow, 'name' | 'how'>): AvailabilityRow => ({
  monthlyFrom: null, tierName: null, verifiedOn: null, hubHref: null, ...r,
});

const ROWS: AvailabilityRow[] = [
  row({ name: 'SVT Play', how: 'gratis', hubHref: '/provider/520/' }),
  row({ name: 'Pluto TV', how: 'reklam' }),
  row({ name: 'Netflix', how: 'abonnemang', monthlyFrom: 1299, tierName: 'Standard med reklam', verifiedOn: '2026-07-02', hubHref: '/provider/8/' }),
  row({ name: 'HBO Max', how: 'abonnemang', hubHref: '/provider/384/' }),
  row({ name: 'SF Anytime', how: 'hyr-kop' }),
];

function renderTable(a: TitleAvailability) {
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(<AvailabilityTable title="Titel" availability={a} />), 'text/html');
  const priceOf = (name: string) =>
    [...doc.querySelectorAll('tbody tr')].find(tr => tr.querySelector('th')?.firstChild?.textContent === name)
      ?.querySelectorAll('td')[1]?.textContent;
  return { doc, priceOf };
}

describe('AvailabilityTable (BIN-1439)', () => {
  const full: TitleAvailability = { rows: ROWS, cheapestName: 'SVT Play', pricesVerifiedOn: '2026-07-02' };

  it('skriver priscellen efter hur tjänsten ger tillgång', () => {
    const { priceOf } = renderTable(full);
    expect(priceOf('SVT Play')).toBe('0 kr');
    expect(priceOf('Pluto TV')).toBe('');
    expect(priceOf('Netflix')).toBe('Från 1 299 kr/mån (Standard med reklam)');
    expect(priceOf('HBO Max')).toBe('–');
    // Hyr/köp-priset varierar per titel och hämtas inte här — cellen säger var det finns.
    expect(priceOf('SF Anytime')).toBe('Pris hos tjänsten');
  });

  it('märker den billigaste raden med text, och ingen rad utan billigast', () => {
    const marked = (a: TitleAvailability) =>
      [...renderTable(a).doc.querySelectorAll('tbody tr')].filter(tr => tr.textContent?.includes('Billigast av dessa'));
    const one = marked(full);
    expect(one).toHaveLength(1);
    expect(one[0].querySelector('th')?.firstChild?.textContent).toBe('SVT Play');
    expect(marked({ ...full, cheapestName: null })).toHaveLength(0);
  });

  it('daterar priserna bara när ett datum finns', () => {
    expect(renderTable(full).doc.body.textContent).toContain('Priser ur Binges prislista, kontrollerade 2 juli 2026.');
    expect(renderTable({ ...full, pricesVerifiedOn: null }).doc.body.textContent).not.toContain('Priser ur Binges prislista');
  });

  it('ger varje länk en egen text och en riktig adress', () => {
    const links = [...renderTable(full).doc.querySelectorAll('a')];
    const texts = links.map(a => a.textContent);
    expect(texts).toEqual(['Mer på SVT Play', 'Mer på Netflix', 'Mer på HBO Max', 'Räkna ut vad din streaming kostar']);
    for (const a of links) expect(a.getAttribute('href')).toMatch(/^\/[a-z]/);
  });

  it('renderar ingenting utan rader', () => {
    expect(renderToStaticMarkup(<AvailabilityTable title="Titel" availability={{ rows: [], cheapestName: null, pricesVerifiedOn: null }} />)).toBe('');
  });
});
