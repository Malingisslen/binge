import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/PageHeader';
import { hubSections } from '@/lib/seo/hubLinks';

export const dynamic = 'force-static';

/**
 * BIN-424 — "hub-of-hubs": one indexable index page linking every SEO landing
 * page (all /provider, /billigaste franchise, and /forsvinner pages). The footer
 * only exposed 4 of 24 franchise + 4 of 11 leaving pages, so the rest had ~zero
 * internal links and leaned on the sitemap alone for crawl discovery (weak equity,
 * same orphaning BIN-178 fixed for /provider). The footer links here, so every
 * pre-rendered page is now one hop from all of them.
 *
 * Pure static: no data fetching — link lists come straight from the curated
 * constants via hubLinks (guarded for full coverage by hubLinks.test.ts).
 */

const SITE = 'https://binge.nu';
const URL = `${SITE}/guider/`;

export const metadata: Metadata = {
  title: 'Streamingguider — var du ser filmer och serier i Sverige',
  description:
    'Alla Binges streamingguider på ett ställe: vad du kan streama på varje tjänst, bästa filmer och serier per genre, billigaste sättet att se hela filmserier, och vad som snart lämnar tjänsterna i Sverige.',
  alternates: { canonical: URL },
  openGraph: {
    title: 'Streamingguider — var du ser filmer och serier i Sverige',
    description:
      'Vad du kan streama på varje tjänst, bästa titlarna per genre, billigaste vägen att se hela filmserier, och vad som snart försvinner — samlat i Sverige.',
    url: URL,
    siteName: 'Binge.nu',
    locale: 'sv_SE',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Streamingguider — var du ser filmer och serier i Sverige',
    description:
      'Vad du kan streama på varje tjänst, bästa titlarna per genre, billigaste vägen att se hela filmserier, och vad som snart försvinner — samlat i Sverige.',
  },
};

function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export default function GuiderPage() {
  const sections = hubSections();

  const collectionPage = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Streamingguider i Sverige',
    description:
      'Alla Binges streamingguider: streamingtjänster, bästa titlar per genre, billigaste vägen att se filmserier, och vad som snart lämnar tjänsterna.',
    url: URL,
    isPartOf: { '@type': 'WebSite', name: 'Binge.nu', url: `${SITE}/` },
  };
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Streamingguider',
    url: URL,
    itemListElement: sections
      .flatMap((s) => s.links)
      .map((l, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: l.label,
        url: `${SITE}${l.href}`,
      })),
  };

  return (
    <div className="canvas">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(collectionPage) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(itemList) }} />

      <PageHeader
        crumb="Guider"
        title="Streamingguider för Sverige"
        standfirst="Var du ser filmer och serier på varje tjänst, bästa titlarna per genre, billigaste vägen att se hela filmserier, och vad som snart försvinner."
      />

      <div className="flex flex-col gap-6">
        {sections.map((section) => (
          <section key={section.id} aria-labelledby={`hub-${section.id}`}>
            <h2 id={`hub-${section.id}`} className="text-[17px] font-semibold text-ink mb-1">
              {section.heading}
            </h2>
            <p className="text-sm text-ink-2 mb-3">{section.blurb}</p>
            <ul className="flex flex-wrap gap-2">
              {section.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="inline-block surface rounded border border-rule px-3 py-1.5 text-base text-ink hover:shadow-lift transition-shadow"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
