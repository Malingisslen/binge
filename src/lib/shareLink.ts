/**
 * Länken som delningsknappen lämnar ifrån sig. UTM-märkningen låter Plausible
 * skilja besök från en delad länk från direktbesök, per yta. robots.txt håller
 * UTM-varianter utanför indexet, så märkningen skapar inga dubbletter hos Google.
 */

export type ShareSurface = 'title' | 'list' | 'profile';

export function shareLink(origin: string, path: string, surface: ShareSurface): string {
  const url = new URL(path, origin);
  url.searchParams.set('utm_source', 'share');
  url.searchParams.set('utm_medium', surface);
  return url.href;
}
