import { Fragment } from 'react';
import Link from 'next/link';
import { genreHubHref, providerHubHref } from '@/lib/seo/hubLinks';
import { getProvider } from '@/lib/tmdb/providers';

// SEO-4 — the title pages are most of the crawlable HTML, so they are where the
// curated hubs get their internal links from. Every href comes from hubLinks,
// which returns null outside the pre-rendered set; those stay plain text.

const inlineLink = { color: 'inherit', textDecoration: 'none', borderBottom: '1px solid var(--rule)' } as const;

/** Visible breadcrumb; the hrefs match the page's BreadcrumbList JSON-LD. */
export function TitleCrumb({ kind, title }: { kind: 'movie' | 'tv'; title: string }) {
  const [label, href] = kind === 'movie' ? ['Filmer', '/films/'] : ['Serier', '/series/'];
  return (
    <nav aria-label="Brödsmulor" className="crumb">
      <Link href="/" className="hover:underline" style={{ color: 'inherit', textDecoration: 'none' }}>Binge</Link>
      {' · '}
      <Link href={href} className="hover:underline" style={{ color: 'inherit', textDecoration: 'none' }}>{label}</Link>
      {' · '}
      <span aria-current="page">{title}</span>
    </nav>
  );
}

/** Genre names, each linked to its /genre/ hub when one exists for this medium. */
export function GenreLinks({ kind, genres }: { kind: 'movie' | 'tv'; genres: { id: number; name: string }[] }) {
  if (genres.length === 0) return null;
  return (
    <span className="kind">
      {genres.map((g, i) => {
        const href = genreHubHref(kind, g.id);
        return (
          <Fragment key={g.id}>
            {i > 0 && ', '}
            {href ? <Link href={href} style={inlineLink}>{g.name}</Link> : g.name}
          </Fragment>
        );
      })}
    </span>
  );
}

/** "Mer på Netflix · Max →" under the providers row, for the curated provider hubs. */
export function ProviderHubLinks({ providerIds }: { providerIds: number[] }) {
  const links = new Map<string, string>();
  for (const id of providerIds) {
    const href = providerHubHref(id);
    const provider = getProvider(id);
    if (href && provider && !links.has(href)) links.set(href, provider.name);
  }
  if (links.size === 0) return null;
  return (
    <div style={{ marginTop: 6, fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' }}>
      Mer på{' '}
      {[...links].map(([href, name], i) => (
        <Fragment key={href}>
          {i > 0 && ' · '}
          <Link href={href} style={{ ...inlineLink, color: 'var(--ink-2)' }}>{name}</Link>
        </Fragment>
      ))}
      {' →'}
    </div>
  );
}
