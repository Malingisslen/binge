import type { Report } from '@/lib/firebase/reports';

/**
 * Admin-vyns länk till det anmälda innehållet, där det går att öppna direkt.
 *
 * En användaranmälan länkas på ANVÄNDARNAMN, inte på uid: profilsidan slår upp
 * `usernames/{username}` (`usePublicProfile`), så en uid-länk öppnar "Användaren hittades
 * inte" för ett konto som finns (BIN-1233). Användarnamnet kommer ur den publika
 * projektionen `publicProfiles/{uid}`, som bara går att läsa för en publik profil eller en
 * vän. Går den inte att läsa blir det ingen länk alls, hellre än en som säger att kontot
 * saknas.
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
