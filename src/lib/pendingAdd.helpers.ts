import type { MediaType, WatchStatus } from '@/types';

/**
 * The status a signed-out "Lägg till" becomes after sign-in. The visitor never
 * saw the menu, so this is the add every surface treats as the plain one: a
 * series is followed ("Följer", not yet started), a film goes to "Vill se".
 */
export function pendingAddStatus(mediaType: MediaType): WatchStatus {
  return mediaType === 'tv' ? 'mina' : 'vill_se';
}
