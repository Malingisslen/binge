import { personSitemapEntries, renderUrlset, xmlResponse } from '@/lib/seo/sitemap';

// One part of the /sitemap.xml index; rendered once at build (static export).
export const dynamic = 'force-static';

export function GET(): Response {
  return xmlResponse(renderUrlset(personSitemapEntries()));
}
