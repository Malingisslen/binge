export type AiringState = 'ongoing' | 'ended' | 'unknown';

export function airingState(tmdbStatus: string | null | undefined): AiringState {
  if (!tmdbStatus) return 'unknown';
  const s = tmdbStatus.toLowerCase();
  if (s === 'returning series' || s === 'in production' || s === 'planned') return 'ongoing';
  if (s === 'ended' || s === 'canceled' || s === 'cancelled' || s === 'pilot') return 'ended';
  return 'unknown';
}

export function isOngoing(tmdbStatus: string | null | undefined): boolean {
  return airingState(tmdbStatus) === 'ongoing';
}

export function isEndedStatus(tmdbStatus: string | null | undefined): boolean {
  return airingState(tmdbStatus) === 'ended';
}
