import type { ProviderMode, SessionCandidate } from '@/types';

/**
 * Kan deltagarna faktiskt se titeln? Intersect ("Alla har"): varje deltagare
 * måste ha minst en tjänst titeln ligger på. Union ("Någon har"): det räcker
 * att en deltagare har det. Titlar utan tjänstdata (äldre sessioner) släpps
 * igenom, eftersom vi inte vet något som talar emot dem.
 */
export function isWatchableBy(
  candidate: Pick<SessionCandidate, 'providers'>,
  participants: ReadonlyArray<{ providers: number[] }>,
  mode: ProviderMode,
): boolean {
  if (candidate.providers.length === 0) return true;
  if (participants.length === 0) return true;
  const has = (p: { providers: number[] }) => p.providers.some(id => candidate.providers.includes(id));
  return mode === 'intersect' ? participants.every(has) : participants.some(has);
}

/** Namnen på de deltagare som har minst en av titelns tjänster. */
export function whoCanWatch(
  candidate: Pick<SessionCandidate, 'providers'>,
  participants: ReadonlyArray<{ providers: number[]; displayName: string }>,
): string[] {
  if (candidate.providers.length === 0) return [];
  return participants
    .filter(p => p.providers.some(id => candidate.providers.includes(id)))
    .map(p => p.displayName);
}
