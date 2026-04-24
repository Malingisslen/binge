import type { TogetherSession } from '@/types';

/**
 * Pure helpers för Tillsammans-session-utgång. Bor här (inte i useSession.ts)
 * så vitest kan testa dem utan att dra in Firebase via hook-kedjan.
 */

export function isSessionExpired(session: TogetherSession | null): boolean {
  if (!session) return false;
  return session.expiresAt.getTime() < Date.now();
}
