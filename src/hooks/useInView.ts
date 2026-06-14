'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * IntersectionObserver-primitiv. Returnerar en CALLBACK-ref att fästa på ett
 * element (`<div ref={ref} />`) och en `inView`-boolean. Callback-ref:en gör att
 * observern återkopplas om det observerade elementet byts ut (t.ex. när
 * biblioteket växlar tabell↔rutnät och sentineln blir en ny DOM-nod) — en vanlig
 * objekt-ref skulle fortsätta observera den gamla, avmonterade noden.
 *
 * Med `once: true` slår den om till true första gången elementet syns och kopplar
 * sedan loss (stannar true). Utan `once` speglar den synligheten löpande.
 *
 * Fallback: i miljöer utan IntersectionObserver (jsdom-tester, ev. äldre SSR-
 * path) antas elementet synligt (inView=true) när en nod fästs, så innehåll
 * aldrig döljs.
 */
export function useInView<T extends Element>(
  options?: { rootMargin?: string; once?: boolean },
): { ref: (node: T | null) => void; inView: boolean } {
  const [node, setNode] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  const ref = useCallback((n: T | null) => setNode(n), []);
  const rootMargin = options?.rootMargin ?? '0px';
  const once = options?.once ?? false;

  useEffect(() => {
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [node, rootMargin, once]);

  return { ref, inView };
}
