import type { Report } from '@/lib/firebase/reports';

/**
 * Admin-vyns länk till det anmälda innehållet, där det går att öppna direkt.
 *
 * En användaranmälan länkas på ANVÄNDARNAMN, inte på uid: profilsidan slår upp
 * `usernames/{username}` (`usePublicProfile`), så en uid-länk öppnar "Användaren hittades
 * inte" för ett konto som finns (BIN-1233). Användarnamnet kommer ur den publika
 * projektionen `publicProfiles/{uid}`. Finns inget användarnamn blir det ingen länk alls,
 * hellre än en som säger att kontot saknas.
 *
 * Recensioner och kommentarer har ingen direktlänk: rapporten bär inget titel-id.
 */
export function buildTargetLink(
  report: Pick<Report, 'targetType' | 'targetId'>,
  username: string | null,
): string | null {
  switch (report.targetType) {
    case 'user':
      return username ? `/user/${username}` : null;
    case 'list':
      return `/list/${report.targetId}`;
    default:
      return null;
  }
}

/**
 * BIN-1244: the admin view links a reported profile only when it is public. A private
 * profile is shown inline in the admin row instead; the profile page itself would show
 * it as private, admin or not.
 */
export function linkableUsername(profile: { username: string | null; isPublic: boolean } | null): string | null {
  return profile?.isPublic ? profile.username : null;
}
