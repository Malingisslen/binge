import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cheapestEntertainmentTier, getProvider } from './providers';

/**
 * TV-appen visar "från X kr/mån" ur sin egen lista (tv-app Providers.kt). Prisagenten uppdaterar
 * bara providers.ts, så det här testet fäller bygget när de två glider isär.
 */
const kt = readFileSync(join(__dirname, '../../../tv-app/app/src/main/java/nu/binge/tv/Providers.kt'), 'utf8');
const entries = [...kt.matchAll(/ProviderInfo\((\d+), "([^"]+)", [^)]*\)/g)].map((m) => ({
  id: Number(m[1]),
  line: m[0],
}));

describe('TV-appens priser följer webbens', () => {
  it('hittar tjänsterna i Kotlin-filen', () => expect(entries.length).toBeGreaterThan(5));

  it.each(entries)('tjänst $id har samma pris som webben', ({ id, line }) => {
    const provider = getProvider(id);
    expect(provider, `okänd tjänst ${id}`).toBeDefined();
    if (provider?.isFree) {
      expect(line).toContain('free = true');
      expect(line).not.toContain('fromPrice');
      return;
    }
    const cost = cheapestEntertainmentTier(id).cost;
    expect(line).toContain(`fromPrice = ${cost})`);
  });
});
