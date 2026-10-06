// Which menus the app chrome shows. A signed-out visitor gets the guest menu
// (Priser · Kalkylator · Guider · Logga in) instead of the signed-in app's week
// strip, subnav and tabs, which only lead to the login page for them.
//
// 'unknown' is the pre-rendered HTML and the moment before auth answers. Then both
// sets are rendered and CSS picks one from the `returning-user` class that the
// inline script in layout.tsx sets before first paint (see `.pre-app` / `.pre-guest`
// in globals.css), so neither a guest nor a returning user sees the other's menu
// flash by. A signed-in visitor whose flag is missing (cleared storage, a new
// device) sees the guest menu until auth answers; that is accepted, since the flag
// is the only signal available before first paint.
export type ChromeMode = 'app' | 'guest' | 'unknown';

export function chromeMode(mounted: boolean, loading: boolean, uid: string | null | undefined): ChromeMode {
  if (!mounted || loading) return 'unknown';
  return uid ? 'app' : 'guest';
}

// Whether a chrome part for `audience` renders in this mode, and the class that
// lets CSS hide it before auth answers.
export function chromePart(mode: ChromeMode, audience: 'app' | 'guest'): { show: boolean; className: string | undefined } {
  if (mode === 'unknown') return { show: true, className: audience === 'app' ? 'pre-app' : 'pre-guest' };
  return { show: mode === audience, className: undefined };
}
