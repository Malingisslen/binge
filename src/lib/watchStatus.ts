import type { WatchStatus } from '@/types';

export const STATUS_LABELS: Record<WatchStatus, string> = {
  'följer': 'Följer',
  'sedd': 'Sedd',
};

export const MOVIE_STATUS_LABELS: Record<WatchStatus, string> = {
  'följer': 'Vill se',
  'sedd': 'Sedd',
};

export function statusLabel(status: WatchStatus, mediaType?: 'movie' | 'tv'): string {
  if (mediaType === 'movie') return MOVIE_STATUS_LABELS[status];
  return STATUS_LABELS[status];
}

const TV_STATUS_MAP: Record<string, string> = {
  'Ended': 'Avslutad',
  'Returning Series': 'Pågår',
  'Canceled': 'Inställd',
  'In Production': 'Under produktion',
};

export function tvShowStatusLabel(status: string): string {
  return TV_STATUS_MAP[status] ?? status;
}
