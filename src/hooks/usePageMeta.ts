'use client';

import { useEffect } from 'react';

/**
 * Klient-side page-metadata för dynamiska routes (/movie/:id, /tv/:id, /person/:id
 * m.fl. som går via [...path]-catch-allen och därför inte kan använda Next.js
 * static generateMetadata).
 *
 * Sätter:
 * - document.title (browser-flik)
 * - meta[name=description]
 * - og:title / og:description (social-share — Slack/Twitter/LinkedIn renderar JS)
 * - link[rel=canonical]
 * - meta[name=robots] om `indexable` anges (annars rörs den inte)
 *
 * **Indexable-flaggan**: catch-all-routens statiska HTML har noindex som default
 * (se src/app/[...path]/page.tsx). Page-clients som *vet* att deras content
 * ska vara indexerbart (MoviePageClient/TVShowPageClient/PersonPageClient med
 * giltig TMDB-data) sätter `indexable: true` så vi tar bort noindex efter
 * hydration. När data är undefined (loading/error) lämnar vi noindex orörd —
 * defensiv default.
 *
 * Använd i klient-komponenten direkt efter att data är hämtad:
 *
 *   usePageMeta({
 *     title: `${movie.title} (${year}) — var streamar jag?`,
 *     description: `Se var du kan streama ${movie.title} i Sverige...`,
 *     indexable: !!movie,
 *   });
 *
 * Vid unmount återställs defaulten från layout.tsx så nästa sida startar rent.
 * Om indexable=true var satt återställs robots-metan till noindex (defensiv
 * default för catch-all-shellet).
 *
 * OBS: crawlers som INTE renderar JS (Google Search Console är blandat) ser
 * fortfarande bara app-default-titeln. För 100% SEO-pålitlighet hade vi behövt
 * server-rendering — som ligger utanför scope givet static-export-upplägget.
 */

const DEFAULT_TITLE = 'Binge.nu — Håll koll på vad du tittar på';
const DEFAULT_DESCRIPTION = 'Svensk mediatracker för film och TV-serier. Se var titlar finns att streama i Sverige.';

/**
 * Märker element som hooken själv skapat. Element UTAN attributet ägs av
 * React/Next (App Router-metadata renderas som React 19-"hoistables") och får
 * bara muteras — aldrig detachas. Reacts hoistable-städning kör
 * `instance.parentNode.removeChild(instance)` utan null-check, så en manuellt
 * bortplockad nod kraschar hela appen vid nästa navigering med
 * "Cannot read properties of null (reading 'removeChild')" (Sentry BINGE-5).
 */
const OWNED_ATTR = 'data-binge-meta';

function setMeta(attr: 'name' | 'property', key: string, value: string): void {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    el.setAttribute(OWNED_ATTR, '');
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

/**
 * Sätter canonical-href och returnerar en restore-funktion för effect-cleanup.
 * Framework-ägd canonical (root layout sätter alternates.canonical som
 * default på alla sidor) muteras och får sin href tillbakaställd; bara
 * hook-skapade element tas bort ur DOM:en.
 */
function setCanonical(href: string): () => void {
  if (typeof document === 'undefined') return () => {};
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (existing && !existing.hasAttribute(OWNED_ATTR)) {
    const prevHref = existing.getAttribute('href');
    existing.setAttribute('href', href);
    return () => {
      if (prevHref === null) existing.removeAttribute('href');
      else existing.setAttribute('href', prevHref);
    };
  }
  const el = existing ?? document.createElement('link');
  if (!existing) {
    el.setAttribute('rel', 'canonical');
    el.setAttribute(OWNED_ATTR, '');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
  return () => el.remove();
}

export function usePageMeta({
  title,
  description,
  ogImage,
  indexable,
}: {
  title: string;
  description?: string;
  ogImage?: string;
  /**
   * Om true → tar bort noindex från catch-all-shellet (sätter `index,follow`).
   * Om false eller undefined → rör inte robots-metan (lämnar catch-all-defaulten).
   * Page-clients ska sätta indexable: true bara när de har bekräftad data.
   */
  indexable?: boolean;
}): void {
  useEffect(() => {
    const fullTitle = `${title} — Binge.nu`;
    document.title = fullTitle;
    setMeta('property', 'og:title', fullTitle);
    const restoreCanonical = setCanonical(window.location.href.split('?')[0]);

    if (description) {
      setMeta('name', 'description', description);
      setMeta('property', 'og:description', description);
    }
    if (ogImage) {
      setMeta('property', 'og:image', ogImage);
    }
    if (indexable) {
      // Tar bort noindex som catch-all-routens statiska metadata sätter.
      // max-image-preview/max-snippet matchar root layout.tsx för konsekvens.
      setMeta('name', 'robots', 'index,follow,max-image-preview:large,max-snippet:-1');
    }

    return () => {
      document.title = DEFAULT_TITLE;
      setMeta('name', 'description', DEFAULT_DESCRIPTION);
      setMeta('property', 'og:title', 'Binge.nu');
      setMeta('property', 'og:description', DEFAULT_DESCRIPTION);
      restoreCanonical();
      if (indexable) {
        // Defensiv: återställ catch-all-defaulten när indexable-routen unmountar.
        // Skyddar mot att nästa client-route ärver vår "index,follow" om den
        // INTE själv är indexable (t.ex. user/group/tillsammans).
        setMeta('name', 'robots', 'noindex,follow');
      }
    };
  }, [title, description, ogImage, indexable]);
}
