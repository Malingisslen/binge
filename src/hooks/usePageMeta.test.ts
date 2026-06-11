import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePageMeta } from './usePageMeta';

/**
 * Regressionstester för Sentry BINGE-5 (TypeError: Cannot read properties of
 * null (reading 'removeChild')).
 *
 * React 19 äger head-taggar som renderats via Next.js metadata ("hoistables")
 * och dess interna städning kör `instance.parentNode.removeChild(instance)`
 * utan null-check. Om usePageMeta rycker bort en sådan nod ur DOM:en kraschar
 * React vid nästa navigering. Invariant: hooken får ALDRIG detacha element
 * den inte själv har skapat — bara mutera attribut och återställa dem.
 */

function currentCanonicalHref(): string {
  return window.location.href.split('?')[0];
}

describe('usePageMeta', () => {
  // Städning sker i beforeEach (inte afterEach): RTL:s auto-cleanup unmountar
  // kvarmonterade hooks EFTER describe-blockets afterEach (vitest kör LIFO),
  // och unmount-cleanupen återskapar default-metas som annars läcker vidare.
  beforeEach(() => {
    document.head
      .querySelectorAll('meta, link[rel="canonical"]')
      .forEach(el => el.remove());
  });

  it('lämnar en framework-ägd canonical kvar i DOM:en efter unmount', () => {
    const frameworkCanonical = document.createElement('link');
    frameworkCanonical.setAttribute('rel', 'canonical');
    frameworkCanonical.setAttribute('href', 'https://binge.nu/');
    document.head.appendChild(frameworkCanonical);

    const { unmount } = renderHook(() => usePageMeta({ title: 'Allt' }));
    unmount();

    expect(frameworkCanonical.isConnected).toBe(true);
  });

  it('muterar framework-ägd canonical vid mount och återställer href vid unmount', () => {
    const frameworkCanonical = document.createElement('link');
    frameworkCanonical.setAttribute('rel', 'canonical');
    frameworkCanonical.setAttribute('href', 'https://binge.nu/');
    document.head.appendChild(frameworkCanonical);

    const { unmount } = renderHook(() => usePageMeta({ title: 'Allt' }));
    expect(frameworkCanonical.getAttribute('href')).toBe(currentCanonicalHref());

    unmount();
    expect(frameworkCanonical.getAttribute('href')).toBe('https://binge.nu/');
  });

  it('skapar egen märkt canonical när ingen finns och tar bort den vid unmount', () => {
    const { unmount } = renderHook(() => usePageMeta({ title: 'Allt' }));

    const created = document.head.querySelector('link[rel="canonical"]');
    expect(created).not.toBeNull();
    expect(created!.hasAttribute('data-binge-meta')).toBe(true);
    expect(created!.getAttribute('href')).toBe(currentCanonicalHref());

    unmount();
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it('skapar inte dubblett när en meta-tagg redan finns — muterar den befintliga', () => {
    const frameworkDescription = document.createElement('meta');
    frameworkDescription.setAttribute('name', 'description');
    frameworkDescription.setAttribute('content', 'Default-beskrivning');
    document.head.appendChild(frameworkDescription);

    renderHook(() => usePageMeta({ title: 'Allt', description: 'Sidans beskrivning' }));

    const all = document.head.querySelectorAll('meta[name="description"]');
    expect(all).toHaveLength(1);
    expect(frameworkDescription.getAttribute('content')).toBe('Sidans beskrivning');
    expect(frameworkDescription.isConnected).toBe(true);
  });
});
