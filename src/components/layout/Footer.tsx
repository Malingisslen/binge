'use client';

import Link from 'next/link';
import { FRANCHISES } from '@/lib/seo/franchises';
import { getProvider } from '@/lib/tmdb/providers';
import { SEO_PROVIDER_IDS } from '@/lib/tmdb/seoCoverage';

// BIN-178 — the SEO landing pages, surfaced in the footer so they're linked from
// every pre-rendered page's static HTML (crawl discovery — orphaned pages index
// poorly, see project_seo_indexing). The /provider pages were live but had ~zero
// internal links → not indexed after 5 days; this de-orphans all 12, plus the
// franchise + leaving pages. Dense-but-organized fits the Prisjakt-style footer.
const FOOTER_FRANCHISES = FRANCHISES.slice(0, 4);
const FOOTER_PROVIDER_IDS = [8, 76, 337, 384]; // Netflix, Viaplay, Disney+, Max (leaving-data services)

export default function Footer() {
  return (
    <footer className="border-t border-rule-2 mt-12 py-6 px-4 text-ink-3">
      <div className="max-w-[1024px] mx-auto flex flex-col gap-4">
        <nav aria-label="Juridisk information">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs items-center">
            <li><Link href="/integritet" className="hover:text-ink">Integritetspolicy</Link></li>
            <li><Link href="/villkor" className="hover:text-ink">Villkor</Link></li>
            <li><Link href="/community-guidelines" className="hover:text-ink">Community-regler</Link></li>
            <li><a href="mailto:hej@binge.nu" className="hover:text-ink">Kontakt</a></li>
            {/* "Stötta projektet"-länken är tillfälligt borttagen tills vi har
                ett eget Ko-fi/Swish-konto. Återinför här när URL:en är klar. */}
          </ul>
        </nav>
        <nav aria-label="Streamingtjänster">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs items-center">
            <li className="text-ink-3">Streama på:</li>
            {SEO_PROVIDER_IDS.map((pid) => {
              const p = getProvider(pid);
              return p ? <li key={pid}><Link href={`/provider/${pid}/`} className="hover:text-ink">{p.shortName || p.name}</Link></li> : null;
            })}
          </ul>
        </nav>
        <nav aria-label="Guider">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs items-center">
            {/* De-orphaning hop (BIN-424): the hub links ALL franchise + leaving
                pages, so the shortlists below stay curated while every SEO page
                is one click from here. */}
            <li><Link href="/guider/" className="hover:text-ink font-medium text-ink-2">Alla streamingguider</Link></li>
            <li className="text-ink-3">Billigaste sättet att se:</li>
            {FOOTER_FRANCHISES.map((f) => (
              <li key={f.slug}><Link href={`/billigaste/${f.slug}/`} className="hover:text-ink">{f.name}</Link></li>
            ))}
            <li className="text-ink-3">Lämnar snart:</li>
            {FOOTER_PROVIDER_IDS.map((pid) => {
              const p = getProvider(pid);
              return p ? <li key={pid}><Link href={`/forsvinner/${pid}/`} className="hover:text-ink">{p.shortName || p.name}</Link></li> : null;
            })}
          </ul>
        </nav>
        <div className="flex items-center gap-3 text-xxs">
          <img
            src="/tmdb-logo.svg"
            alt="The Movie Database"
            width={47}
            height={20}
            loading="lazy"
            decoding="async"
          />
          <p>
            Binge använder TMDB:s API men är inte godkänd eller certifierad av
            TMDB. Filmdata från{' '}
            <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer" className="hover:text-ink underline">
              themoviedb.org
            </a>.
          </p>
        </div>
      </div>
    </footer>
  );
}
