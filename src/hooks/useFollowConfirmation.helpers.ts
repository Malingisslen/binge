import type { WatchlistItem } from '@/types';

/**
 * BIN-1442 — the first series someone follows is when the question about
 * notifications is asked, once. "Once" is the library itself: after this add
 * there is a followed series, so the question cannot come again. No stored flag
 * (BIN-748: a flag nothing retires).
 */
export function isFirstFollow(items: readonly WatchlistItem[], mediaType: string, status: string, alreadyInLibrary: boolean): boolean {
  if (mediaType !== 'tv' || status !== 'mina' || alreadyInLibrary) return false;
  return !items.some(i => i.mediaType === 'tv' && i.status === 'mina');
}

export type FollowPrompt = 'ask' | 'homescreen-tip' | 'none';

/**
 * Ask only where the browser can say yes. iPhone and iPad Safari can only receive
 * notifications from a home-screen app, and there push is reported unsupported,
 * so the tip takes the question's place. Feature-detect first; the device check
 * only picks between the tip and silence.
 */
export function decideFollowPrompt(env: {
  pushEnabled: boolean;
  pushSupported: boolean;
  permission: NotificationPermission | null;
  appleMobile: boolean;
  standalone: boolean;
}): FollowPrompt {
  if (env.pushEnabled) return 'none';
  if (env.pushSupported) return env.permission === 'default' ? 'ask' : 'none';
  return env.appleMobile && !env.standalone ? 'homescreen-tip' : 'none';
}

export function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  // iPadOS reports a desktop Mac user agent; a touch screen tells them apart.
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}
