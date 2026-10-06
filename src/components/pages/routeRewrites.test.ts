import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRoute, type RouteMatch } from './resolveRoute';

// Firebase Hosting serverar out/404.html med status 404 för en adress som varken är en
// fil eller fångas av en omskrivning. Därför finns ingen `**`-regel: varje sida som
// resolveRoute kan visa behöver i stället en egen omskrivning, annars blir en giltig
// länk en 404. Exempeladressen per sort är en Record så att en ny sort i RouteMatch
// utan exempel här blir ett typfel.

const ROOT = join(__dirname, '..', '..', '..');
const rewrites: Array<{ source: string; destination?: string }> =
  JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8')).hosting.rewrites;

const SAMPLE_PATH: Record<RouteMatch['kind'], string> = {
  tillsammans: '/tillsammans/abc123/',
  grupper: '/grupper/abc123/',
  user: '/user/malin/',
  list: '/list/abc123/',
  provider: '/provider/8/',
  person: '/person/123/',
  movie: '/movie/123/',
  season: '/tv/123/season/2/',
  tv: '/tv/123/',
};

// Firebase-globbens `/<prefix>/**`: allt under prefixet.
function rewriteFor(path: string) {
  return rewrites.find((r) => {
    const m = /^\/([^/*]+)\/\*\*$/.exec(r.source);
    return m !== null && path.startsWith(`/${m[1]}/`);
  });
}

describe('firebase.json-omskrivningarna mot resolveRoute', () => {
  it('har ingen omskrivning för alla adresser, så okända adresser får en riktig 404', () => {
    expect(rewrites.filter((r) => r.source === '**' || r.source === '/**')).toEqual([]);
  });

  it.each(Object.entries(SAMPLE_PATH))('%s (%s) skrivs om till ett SPA-skal', (kind, path) => {
    expect(resolveRoute(path)?.kind).toBe(kind);
    expect(rewriteFor(path)?.destination).toMatch(/\/_\/index\.html$/);
  });

  it('en okänd adress fångas inte av någon omskrivning', () => {
    expect(resolveRoute('/finns-inte/')).toBeNull();
    expect(rewriteFor('/finns-inte/')).toBeUndefined();
  });

  it('varje omskrivning till SPA-skalet leder till en sida resolveRoute känner igen', () => {
    const spaPrefixes = rewrites
      .filter((r) => r.destination === '/_/index.html')
      .map((r) => r.source.replace(/\/\*\*$/, ''));
    expect(spaPrefixes.length).toBeGreaterThan(0);
    for (const prefix of spaPrefixes) {
      expect(resolveRoute(`${prefix}/123/`), prefix).not.toBeNull();
    }
  });
});
