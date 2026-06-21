export function svwikiTitleFromEntities(json: unknown, wikidataId: string): string | null {
  if (!json || typeof json !== 'object') return null;
  const entities = (json as { entities?: Record<string, unknown> }).entities;
  const entity = entities?.[wikidataId] as { sitelinks?: { svwiki?: { title?: unknown } } } | undefined;
  const title = entity?.sitelinks?.svwiki?.title;
  return typeof title === 'string' && title.length > 0 ? title : null;
}

export function cleanWikiExtract(summary: unknown): { text: string; pageUrl: string } | null {
  if (!summary || typeof summary !== 'object') return null;
  const s = summary as { type?: unknown; extract?: unknown; content_urls?: { desktop?: { page?: unknown } } };
  if (s.type === 'disambiguation') return null;
  const text = typeof s.extract === 'string' ? s.extract.trim() : '';
  const pageUrl = s.content_urls?.desktop?.page;
  if (text.length < 10 || typeof pageUrl !== 'string' || !pageUrl.startsWith('https://')) return null;
  return { text, pageUrl };
}
