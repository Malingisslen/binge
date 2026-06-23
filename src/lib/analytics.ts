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
  | { name: 'title_added_watchlist'; props: { mediaType: 'movie' | 'tv'; status: 'vill_se' | 'mina' | 'sedd' | 'avbruten' } }
  | { name: 'first_title_added'; props: { mediaType: 'movie' | 'tv' } }
  | { name: 'advisor_pause_taken'; props: { providerId: number } }
  | { name: 'revival_nudge_shown'; props: { count: number } }
  | { name: 'revival_nudge_acted_on'; props: { tmdbId: number } }
  | { name: 'review_created'; props: { mediaType: 'movie' | 'tv'; hasSpoiler: boolean } }
  // Onboarding — step_reached visar var användare droppar av. Hjälper
  // optimera flödet senare (om 50% skippar vid step 3, ändra step 3).
  | { name: 'onboarding_completed'; props: { step_reached: number } }
  // Ko-fi / Swish-donate-klick i footer. Ingen payment här, bara spårning
  // av intresse så vi kan utvärdera om det är värt att bygga mer runt.
  | { name: 'donate_clicked'; props?: Record<string, never> }
  // Telemetri för React Query-fel — inga PII, bara kategori och första segment
  // av queryKey så vi kan se vilken subsystem som hostar felen.
  | { name: 'query_error'; props: { scope: string; kind: 'query' | 'mutation' } }
  | { name: 'providers_selected'; props: { count: number } }
  | { name: 'advisor_viewed'; props: { providerCount: number } }
  | { name: 'advisor_action_taken'; props: { action: 'pause' | 'resume' | 'subscribe' | 'catchup'; providerId: number } }
  | { name: 'search_submitted'; props: { resultCount: number; mediaFilter: 'all' | 'movie' | 'tv' } }
  // "Fråga Binge" NL-sök: hur många filterfält den deterministiska parsern lyckades
  // extrahera ur meningen (0 = low-confidence, kandidat för LLM-fallback).
  | { name: 'ask_binge_submitted'; props: { fields: number } }
  | { name: 'status_changed'; props: { mediaType: 'movie' | 'tv'; status: 'vill_se' | 'mina' | 'sedd' | 'avbruten' } }
  // Betyg satt via stjärn-toasten som dyker upp när en titel markeras sedd —
  // mäter om "betygsätt direkt"-nudgen faktiskt höjer betygsfrekvensen.
  | { name: 'rate_on_sedd'; props: { mediaType: 'movie' | 'tv' } }
  | { name: 'error_boundary_triggered'; props: { scope: string } };

export function trackEvent<T extends AnalyticsEvent['name']>(
  name: T,
  props?: Extract<AnalyticsEvent, { name: T }>['props'],
): void {
  if (typeof window === 'undefined') return;
  if (typeof window.plausible !== 'function') return;
  window.plausible(name, props ? { props: props as Record<string, string | number | boolean> } : undefined);
}
