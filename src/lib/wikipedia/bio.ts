export function svwikiTitleFromEntities(json: unknown, wikidataId: string): string | null {
  if (!json || typeof json !== 'object') return null;
  const entities = (json as { entities?: Record<string, unknown> }).entities;
  const entity = entities?.[wikidataId] as { sitelinks?: { svwiki?: { title?: unknown } } } | undefined;
  const title = entity?.sitelinks?.svwiki?.title;
  return typeof title === 'string' && title.length > 0 ? title : null;
}

// BIN-152: bara *.wikipedia.org får renderas som attributionslänk. Annars kunde
// ett spoofat/komprometterat API-svar (eller framtida återanvändning) skicka en
// godtycklig https-URL rakt in i en <a href> märkt "svenska Wikipedia".
const WIKIPEDIA_HOST = /^([\w-]+\.)?wikipedia\.org$/;

export function cleanWikiExtract(summary: unknown): { text: string; pageUrl: string } | null {
  if (!summary || typeof summary !== 'object') return null;
  const s = summary as { type?: unknown; extract?: unknown; content_urls?: { desktop?: { page?: unknown } } };
  if (s.type === 'disambiguation') return null;
  const text = typeof s.extract === 'string' ? s.extract.trim() : '';
  const pageUrl = s.content_urls?.desktop?.page;
  if (text.length < 10 || typeof pageUrl !== 'string' || !pageUrl.startsWith('https://')) return null;
  // Validera värden — bara wikipedia.org-subdomäner.
  try {
    if (!WIKIPEDIA_HOST.test(new URL(pageUrl).hostname)) return null;
  } catch {
    return null;
  }
  return { text, pageUrl };
}
