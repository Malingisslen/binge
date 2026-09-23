import type { UserProfile } from '@/types/domain';

/**
 * Om ett konto ska igenom onboarding-flödet.
 *
 * Nya användare utan myProviders och utan onboardingCompletedAt ska dit.
 * Existerande användare (före featuren landade) har varken flagga men har
 * providers — bara tomma profiler skickas. En profil som inte gick att läsa
 * (`null`) kan inte påstå att kontot behöver onboarding.
 *
 * Två anropare, och de ska svara likadant: inloggningssidans omdirigering och
 * offline-remsans omförsök (BIN-1293). Härled dem:
 *   git grep -n "needsOnboarding(" -- src
 */
export function needsOnboarding(
  user: Pick<UserProfile, 'onboardingCompletedAt' | 'myProviders'> | null | undefined,
): boolean {
  return user != null && !user.onboardingCompletedAt && (user.myProviders?.length ?? 0) === 0;
}
