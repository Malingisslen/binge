import type { WatchStatus } from '@/types';

export const STATUS_LABELS: Record<WatchStatus, string> = {
  'följer': 'Följer',
  'vill_se': 'Vill se',
  'sedd': 'Sedd',
  'avbruten': 'Avbröt',
};

// Movies don't use "Följer" — only "Vill se", "Sedd" och "Avbröt"
export const MOVIE_STATUS_LABELS: Partial<Record<WatchStatus, string>> = {
  'vill_se': 'Vill se',
  'sedd': 'Sedd',
  'avbruten': 'Avbröt',
};

export function statusLabel(status: WatchStatus, mediaType?: 'movie' | 'tv'): string {
  if (mediaType === 'movie' && status in MOVIE_STATUS_LABELS) return MOVIE_STATUS_LABELS[status]!;
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
