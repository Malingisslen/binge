import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ADR 0024: bara provider-sidorna får vända catch-all-skalets noindex till index
// efter hydrering. En titel- eller personsida utanför det förrenderade urvalet
// ska säga noindex även när JavaScript har körts — annars når Google de ~29 000
// tunna sidorna igen, bara en omväg längre.

const PAGES_DIR = join(process.cwd(), 'src', 'components', 'pages');

function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const clients = readdirSync(PAGES_DIR)
  .filter(f => f.endsWith('.tsx') && !f.includes('.test.'))
  .map(f => ({ name: f, src: withoutComments(readFileSync(join(PAGES_DIR, f), 'utf8')) }));

describe('vilka sidklienter som får vända noindex till index', () => {
  // Utan rosterkravet skulle ett omdöpt eller flyttat klientfil-namn göra testet
  // nedan grönt utan att pröva något.
  it('rosterkrav: titel-, säsongs- och personklienterna finns i katalogen', () => {
    const names = clients.map(c => c.name);
    for (const name of ['MoviePageClient.tsx', 'TVShowPageClient.tsx', 'SeasonPageClient.tsx', 'PersonPageClient.tsx']) {
      expect(names).toContain(name);
    }
  });

  it('bara ProviderPageClient skickar indexable', () => {
    const flipping = clients.filter(c => /\bindexable\b/.test(c.src)).map(c => c.name);
    expect(flipping).toEqual(['ProviderPageClient.tsx']);
  });
});

vi.mock('@/app/[...path]/CatchAllClient', () => ({ default: () => null }));

// Catch-all-skalet är det som håller varje titel och person utanför kärnan ur
// indexet, nu när klienterna inte vänder det. Det ska säga noindex,follow och
// inte peka canonical på startsidan (två motstridiga besked om samma sida).
describe('catch-all-skalets metadata', () => {
  it.each([
    { name: 'allmänna skalet', path: ['_'] },
    { name: 'ett delningsskal', path: ['tillsammans', '_'] },
  ])('$name: noindex,follow och ingen canonical', async ({ path }) => {
    const { generateMetadata } = await import('@/app/[...path]/page');
    const meta = await generateMetadata({ params: Promise.resolve({ path }) });

    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical ?? null).toBeNull();
  });
});
