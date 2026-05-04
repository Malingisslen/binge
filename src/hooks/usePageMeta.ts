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
 *
 * Använd i klient-komponenten direkt efter att data är hämtad:
 *
 *   usePageMeta({
 *     title: `${movie.title} (${year}) — var streamar jag?`,
 *     description: `Se var du kan streama ${movie.title} i Sverige...`,
 *   });
 *
 * Vid unmount återställs defaulten från layout.tsx så nästa sida startar rent.
 *
 * OBS: crawlers som INTE renderar JS (Google Search Console är blandat) ser
 * fortfarande bara app-default-titeln. För 100% SEO-pålitlighet hade vi behövt
 * server-rendering — som ligger utanför scope givet static-export-upplägget.
 */

const DEFAULT_TITLE = 'Binge.nu — Håll koll på vad du tittar på';
const DEFAULT_DESCRIPTION = 'Svensk mediatracker för film och TV-serier. Se var titlar finns att streama i Sverige.';

function setMeta(attr: 'name' | 'property', key: string, value: string): void {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

function setCanonical(href: string): void {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function removeCanonical(): void {
  if (typeof document === 'undefined') return;
  document.head.querySelector('link[rel="canonical"]')?.remove();
}

export function usePageMeta({
  title,
  description,
  ogImage,
}: {
  title: string;
  description?: string;
  ogImage?: string;
}): void {
  useEffect(() => {
    const fullTitle = `${title} — Binge.nu`;
    document.title = fullTitle;
    setMeta('property', 'og:title', fullTitle);
    setCanonical(window.location.href.split('?')[0]);

    if (description) {
      setMeta('name', 'description', description);
      setMeta('property', 'og:description', description);
    }
    if (ogImage) {
      setMeta('property', 'og:image', ogImage);
    }

    return () => {
      document.title = DEFAULT_TITLE;
      setMeta('name', 'description', DEFAULT_DESCRIPTION);
      setMeta('property', 'og:title', 'Binge.nu');
      setMeta('property', 'og:description', DEFAULT_DESCRIPTION);
      removeCanonical();
    };
  }, [title, description, ogImage]);
}
