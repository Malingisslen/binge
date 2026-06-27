import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ForsvinnerListClient from '@/components/pages/ForsvinnerListClient';
import { canonicalProviderId, getProvider } from '@/lib/tmdb/providers';
import { SEO_PROVIDER_IDS } from '@/lib/tmdb/seoCoverage';
import { PageHeader } from '@/components/layout/PageHeader';
import JustWatchCredit from '@/components/ui/JustWatchCredit';

export const dynamic = 'force-static';
export const dynamicParams = false;

/**
 * BIN-178 — "Vad försvinner från [provider]" landing pages. Real pre-rendered
 * static routes (BIN-62 pattern) for the curated SEO provider set, so the page
 * indexes on Google's HTML-only crawl. The server shell carries the indexable
 * content (H1 + evergreen intro + metadata + JSON-LD); the live list of titles
 * fills in client-side from streamingLeaving/current (which can't be read at
 * build) — that keeps the page auto-fresh without monthly rebuilds.
 *
 * Leaving dates are MOTN-sourced and partial — never fabricated. The empty state
 * says so honestly. JustWatch attribution required on this provider surface.
 */

const SITE = 'https://binge.nu';

export function generateStaticParams(): { id: string }[] {
  return SEO_PROVIDER_IDS.map((id) => ({ id: String(id) }));
}

type PageParams = { id: string };

function curatedName(id: string): string | null {
  const pid = parseInt(id, 10);
  if (!Number.isFinite(pid) || !SEO_PROVIDER_IDS.includes(canonicalProviderId(pid))) return null;
  return getProvider(canonicalProviderId(pid))?.name ?? null;
}

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const { id } = await params;
  const name = curatedName(id);
  if (!name) return { robots: { index: false, follow: false }, alternates: { canonical: `${SITE}/forsvinner/${id}/` } };

  const title = `Vad försvinner från ${name} snart? — i Sverige`;
  const description = `Filmer och serier som snart lämnar ${name} i Sverige, med datum. Se klart innan de försvinner — uppdaterad lista på Binge.`;
  const url = `${SITE}/forsvinner/${id}/`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'Binge.nu', locale: 'sv_SE', type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export default async function ForsvinnerPage({ params }: { params: Promise<PageParams> }) {
  const { id } = await params;
  const name = curatedName(id);
  if (!name) notFound();
  const pid = canonicalProviderId(parseInt(id, 10));
  const url = `${SITE}/forsvinner/${id}/`;

  const collectionPage = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `Vad försvinner från ${name} i Sverige`,
    description: `Filmer och serier som snart lämnar ${name} i Sverige.`,
    url,
    isPartOf: { '@type': 'WebSite', name: 'Binge.nu', url: `${SITE}/` },
  };

  return (
    <div className="canvas">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(collectionPage) }} />

      <PageHeader
        crumb="Lämnar snart"
        title={`Vad försvinner från ${name} snart?`}
        standfirst={`Filmer och serier lämnar ${name} löpande när licenser går ut. Här är titlarna vi vet försvinner i Sverige den närmaste tiden — med datum, så du hinner se klart först.`}
      />

      <ForsvinnerListClient providerId={pid} providerName={name} />

      <div className="mt-6">
        <JustWatchCredit />
        <span className="text-ink-3 text-[11px]">{' · '}Datum via Movie of the Night · Listan uppdateras dagligen och kan vara ofullständig</span>
      </div>
    </div>
  );
}
