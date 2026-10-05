import { renderSitemapIndex, xmlResponse } from '@/lib/seo/sitemap';

// Static export: rendered once at build into out/sitemap.xml. robots.txt points here.
export const dynamic = 'force-static';

export function GET(): Response {
  return xmlResponse(renderSitemapIndex());
}
