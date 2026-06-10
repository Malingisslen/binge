// Plattformsdetektering för tangentbordshintar (H1). Static export betyder
// att första painten saknar navigator — konsumenter ska defaulta till
// Windows/Linux-hinten ('Ctrl K') och korrigera till '⌘K' efter mount via
// effect-state, så server-HTML och första klientrender matchar (ingen
// hydration mismatch).

/** Ren, testbar kärna: är plattformssträngen Mac-aktig (macOS/iOS)? */
export function isMacLikePlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * Läser plattform från navigator.userAgentData (modernt) med fallback till
 * navigator.platform (deprecated men universellt). SSR-säker: returnerar
 * false utan navigator.
 */
export function detectMacLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return isMacLikePlatform(uaData?.platform ?? navigator.platform ?? '');
}

/** Hinttext för sök-genvägen. Default (SSR/first paint) = 'Ctrl K'. */
export function shortcutHint(isMac: boolean): string {
  return isMac ? '⌘K' : 'Ctrl K';
}
