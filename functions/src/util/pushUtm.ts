/**
 * Märker en pushlänk så att Plausible kan se besök som kom från en notis.
 *
 * Utan märkning ser ett klick på en push ut som ett direktbesök, och då går det
 * inte att svara på om notiserna får folk att komma tillbaka. `utm_campaign` är
 * notisens sort — tagg-prefixet före första bindestrecket (`episode-1399` →
 * `episode`), så att tmdb-id:t inte splittrar kampanjlistan i Plausible.
 * robots.txt håller redan UTM-varianter utanför indexet.
 *
 * Ren hjälpare utan firebase-admin-import, så den testas under rotens vitest.
 */

const ORIGIN = 'https://binge.nu';

export function withPushUtm(actionUrl: string, tag?: string): string {
  let url: URL;
  try {
    url = new URL(actionUrl, ORIGIN);
  } catch {
    return actionUrl;
  }
  // En extern länk lämnas orörd — UTM på någon annans sajt säger oss ingenting.
  if (url.origin !== ORIGIN) return actionUrl;
  // En länk som redan bär en källa har märkts av anroparen; skriv inte över den.
  if (url.searchParams.has('utm_source')) return actionUrl;
  url.searchParams.set('utm_source', 'push');
  url.searchParams.set('utm_medium', 'notis');
  const kind = tag?.split('-')[0];
  if (kind) url.searchParams.set('utm_campaign', kind);
  // Relativ in, relativ ut: service workern löser den mot sin egen origin.
  const isRelative = !/^[a-z][a-z0-9+.-]*:/i.test(actionUrl);
  return isRelative ? `${url.pathname}${url.search}${url.hash}` : url.href;
}
