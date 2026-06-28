// Pure URL-dispatch for the static-export SPA catch-all (BIN-345).
//
// Extracted from DynamicRouter so the routing spine — which URL shape maps to
// which page-client — is a first-class, mock-free tested unit. This module has
// ZERO React/next imports on purpose: resolveRoute.test.ts needs no mocking.
//
// ORDER IS LOAD-BEARING: `/tv/:id/season/:num` MUST be matched before the bare
// `/tv/:id`, or `/tv/123/season/2` silently resolves to a show page instead of a
// season page. The `!== 'ny'` guards keep `/tillsammans/ny` and `/grupper/ny`
// (the create pages) from being read as a session/group id. Keep this in sync
// with the firebase.json redirect map — together they are the URL scheme.

export type RouteMatch =
  | { kind: 'tillsammans'; id: string }
  | { kind: 'grupper'; id: string }
  | { kind: 'user'; username: string }
  | { kind: 'list'; listId: string }
  | { kind: 'provider'; id: string }
  | { kind: 'person'; id: string }
  | { kind: 'movie'; id: string }
  | { kind: 'season'; id: string; num: string }
  | { kind: 'tv'; id: string };

/**
 * Resolve a pathname to the page it should render, or null for the NotFound
 * fallback. Splits + drops empty segments internally (so a trailing slash or
 * the `/_` prerender placeholder behaves like the un-slashed path).
 */
export function resolveRoute(pathname: string): RouteMatch | null {
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] === 'tillsammans' && segments[1] && segments[1] !== 'ny') {
    return { kind: 'tillsammans', id: segments[1] };
  }
  if (segments[0] === 'grupper' && segments[1] && segments[1] !== 'ny') {
    return { kind: 'grupper', id: segments[1] };
  }
  if (segments[0] === 'user' && segments[1]) {
    return { kind: 'user', username: segments[1] };
  }
  if (segments[0] === 'list' && segments[1]) {
    return { kind: 'list', listId: segments[1] };
  }
  if (segments[0] === 'provider' && segments[1]) {
    return { kind: 'provider', id: segments[1] };
  }
  if (segments[0] === 'person' && segments[1]) {
    return { kind: 'person', id: segments[1] };
  }
  if (segments[0] === 'movie' && segments[1]) {
    return { kind: 'movie', id: segments[1] };
  }
  // MUST precede the bare `tv` branch below.
  if (segments[0] === 'tv' && segments[1] && segments[2] === 'season' && segments[3]) {
    return { kind: 'season', id: segments[1], num: segments[3] };
  }
  if (segments[0] === 'tv' && segments[1]) {
    return { kind: 'tv', id: segments[1] };
  }

  return null;
}
