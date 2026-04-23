/**
 * Lightweight analytics wrapper around Plausible.
 *
 * Plausible is cookie-free and IP-anonymized by default, so under Swedish
 * IMY guidance on LEK §6 kap 18§ we do NOT need a consent banner for it.
 * Automatic page-view tracking is built into the Plausible script (loaded
 * in src/app/layout.tsx). Custom events must be fired via trackEvent().
 *
 * Events are typed in AnalyticsEvent — add a new member + fire site-wide
 * via trackEvent('name', { ...props }).
 *
 * We avoid PII in event props: no emails, no full URLs, no note text, no
 * review text. Safe: tmdbId, mediaType, provider id, numeric counts,
 * boolean flags.
 */

declare global {
  interface Window {
    plausible?: (event: string, opts?: { props?: Record<string, string | number | boolean> }) => void;
  }
}

export type AnalyticsEvent =
  | { name: 'signed_up'; props?: Record<string, never> }
  | { name: 'signed_in'; props: { method: 'google' | 'email' } }
  | { name: 'title_added_watchlist'; props: { mediaType: 'movie' | 'tv'; status: 'följer' | 'vill_se' | 'sedd' | 'avbruten' } }
  | { name: 'first_title_added'; props: { mediaType: 'movie' | 'tv' } }
  | { name: 'advisor_pause_taken'; props: { providerId: number } }
  | { name: 'revival_nudge_shown'; props: { count: number } }
  | { name: 'revival_nudge_acted_on'; props: { tmdbId: number } }
  | { name: 'review_created'; props: { mediaType: 'movie' | 'tv'; hasSpoiler: boolean } };

export function trackEvent<T extends AnalyticsEvent['name']>(
  name: T,
  props?: Extract<AnalyticsEvent, { name: T }>['props'],
): void {
  if (typeof window === 'undefined') return;
  if (typeof window.plausible !== 'function') return;
  window.plausible(name, props ? { props: props as Record<string, string | number | boolean> } : undefined);
}
