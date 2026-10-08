import type { UserProfile } from '@/types';

/**
 * What a brand-new account starts with. Both profile-creation sites in AuthContext
 * write this object, so they cannot drift apart. Existing accounts never read it.
 *
 * `weeklyDigest` is on from the start (BIN-1442, Malin 2026-10-06): the digest
 * goes to the app's bell only, never as e-mail or push, and the privacy page says
 * so. Everything that can reach the phone stays off until the user turns it on.
 */
export const NEW_ACCOUNT_NOTIFICATION_SETTINGS: UserProfile['notificationSettings'] = {
  newEpisodes: true,
  availableOnMyServices: true,
  pushEnabled: false,
  episodeReleases: true,
  priceDrops: false,
  rotationReminders: false,
  priceChanges: false,
  weeklyDigest: true,
  monthlyBill: true,
};
