/**
 * Serialize a Schema.org object for injection into an inline
 * `<script type="application/ld+json">` block on the pre-rendered SEO landing
 * pages (/genre, /billigaste, /forsvinner, /guider, /provider).
 *
 * Escaping "<" → "<" is the load-bearing part, not cosmetic: a value that
 * contains "</script>" (a TMDB overview, a title) would otherwise close the
 * script element even inside a JSON string. Same injection guard the client-side
 * <JsonLd> component uses — kept here so every server-rendered SEO page shares
 * one escaper instead of five copy-pasted ones.
 */
export function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
