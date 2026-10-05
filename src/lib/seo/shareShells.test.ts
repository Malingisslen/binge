import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHARE_SHELLS, shareShellFor } from './shareShells';
import { resolveRoute } from '@/components/pages/resolveRoute';

const ROOT = join(__dirname, '..', '..', '..');
const rewrites: Array<{ source: string; destination?: string }> =
  JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8')).hosting.rewrites;

describe('SHARE_SHELLS', () => {
  it('har minst ett skal, så att loopen nedan prövar något', () => {
    expect(SHARE_SHELLS.length).toBeGreaterThan(0);
  });

  it.each(SHARE_SHELLS.map((s) => [s.prefix, s] as const))('%s har en bild i public/', (_p, shell) => {
    expect(existsSync(join(ROOT, 'public', shell.image))).toBe(true);
  });

  it.each(SHARE_SHELLS.map((s) => [s.prefix] as const))(
    '%s skrivs om till sitt eget skal före catch-all-regeln',
    (prefix) => {
      expect(rewrites.filter((r) => r.source === `/${prefix}/**`)).toHaveLength(1);
      const own = rewrites.findIndex((r) => r.source === `/${prefix}/**`);
      const catchAll = rewrites.findIndex((r) => r.source === '**');
      expect(own).toBeGreaterThanOrEqual(0);
      expect(rewrites[own].destination).toBe(`/${prefix}/_/index.html`);
      expect(own).toBeLessThan(catchAll);
    },
  );

  it.each(SHARE_SHELLS.map((s) => [s.prefix] as const))(
    '%s har en gren i resolveRoute, så att skalet visar rätt sida',
    (prefix) => {
      expect(resolveRoute(`/${prefix}/abc123/`)).not.toBeNull();
    },
  );

  it('varje skal-omskrivning i firebase.json har ett skal', () => {
    const shellRewrites = rewrites.filter((r) => r.destination?.endsWith('/_/index.html') && r.source !== '**');
    expect(shellRewrites.map((r) => r.source).sort()).toEqual(SHARE_SHELLS.map((s) => `/${s.prefix}/**`).sort());
  });

  it('shareShellFor känner bara igen de delningsbara prefixen', () => {
    expect(shareShellFor('tillsammans')?.image).toBe('/og/tillsammans.png');
    expect(shareShellFor('movie')).toBeUndefined();
    expect(shareShellFor(undefined)).toBeUndefined();
  });
});
