import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The CSP in firebase.json silently refused the trailer embed and the Swedish
// Wikipedia bio fetch: both fall back quietly by design, so nothing
// failed. These assertions read the hosts out of the source files themselves, so
// a new external host there fails here instead. A new host also needs a line in
// the privacy policy (src/app/integritet/page.tsx), which is why the policy is
// checked for each one too.

const root = process.cwd();

function cspDirectives(): Map<string, string[]> {
  const config = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'));
  const headers = config.hosting.headers as { source: string; headers: { key: string; value: string }[] }[];
  const all = headers.find(h => h.source === '**');
  const csp = all?.headers.find(h => h.key === 'Content-Security-Policy')?.value;
  if (!csp) throw new Error('no Content-Security-Policy on source "**" in firebase.json');
  const map = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) map.set(name, sources);
  }
  return map;
}

function hostsIn(relPath: string): string[] {
  const src = readFileSync(join(root, relPath), 'utf8');
  return [...new Set([...src.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map(m => m[1]))];
}

function allows(sources: string[] | undefined, host: string): boolean {
  return (sources ?? []).some(s => {
    const h = s.replace(/^https:\/\//, '').replace(/\/.*$/, '');
    if (h.startsWith('*.')) return host.endsWith(h.slice(1));
    return h === host;
  });
}

const policy = readFileSync(join(root, 'src/app/integritet/page.tsx'), 'utf8');

describe('CSP i firebase.json släpper igenom de externa värdar koden använder', () => {
  const csp = cspDirectives();

  it('trailern: spelaren från youtube-nocookie i frame-src, och ingen miniatyr hämtas', () => {
    const hosts = hostsIn('src/components/ui/TrailerSection.tsx');
    expect(hosts).toEqual(['www.youtube-nocookie.com']);
    expect(allows(csp.get('frame-src'), 'www.youtube-nocookie.com')).toBe(true);
    expect(policy).toContain('youtube-nocookie.com');
  });

  it('svenska Wikipedia-biografin: varje värd hooken hämtar från finns i connect-src', () => {
    const hosts = hostsIn('src/hooks/useSwedishWikiBio.ts');
    expect(hosts).toEqual(expect.arrayContaining(['www.wikidata.org', 'sv.wikipedia.org']));
    for (const host of hosts) expect(allows(csp.get('connect-src'), host), host).toBe(true);
    expect(policy).toContain('Wikimedia Foundation');
  });
});
