/**
 * Länken som delningsknappen lämnar ifrån sig, UTM-märkt per yta. robots.txt håller
 * UTM-varianter utanför indexet, så märkningen skapar inga dubbletter hos Google.
 * Ingenting i appen läser märkningen sedan Plausible togs bort (BIN-1438); härled
 * läsarna med `git grep -n "utm_" -- src functions/src`.
 */

export type ShareSurface = 'title' | 'list' | 'profile';

export function shareLink(origin: string, path: string, surface: ShareSurface): string {
  const url = new URL(path, origin);
  url.searchParams.set('utm_source', 'share');
  url.searchParams.set('utm_medium', surface);
  return url.href;
}
