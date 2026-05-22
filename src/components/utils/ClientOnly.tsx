'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * Renderar barn bara EFTER hydrering. Server och initial client render
 * returnerar `fallback` (default: null). Förhindrar React #418 hydration
 * mismatch när komponenter beror på client-only state som localStorage,
 * IndexedDB, Firebase Auth-cache eller andra browser-API:er.
 *
 * Använd för auth-beroende UI på SSR-renderade sidor (movie/tv/person-
 * detalj). Server-HTML innehåller då bara public content — exakt det
 * Googlebot ska se — och watchlist/rating/notes mountar in efter
 * hydration.
 */
export default function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <>{fallback}</>;
  return <>{children}</>;
}
