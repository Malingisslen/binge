import type { WatchStatus } from '@/types';

export const STATUS_LABELS: Record<WatchStatus, string> = {
  watching: 'Tittar på',
  want_to_watch: 'Vill se',
  watched: 'Har sett',
  dropped: 'Droppat',
};

const TV_STATUS_MAP: Record<string, string> = {
  'Ended': 'Avslutad',
  'Returning Series': 'Pågår',
  'Canceled': 'Inställd',
  'In Production': 'Under produktion',
};

export function tvShowStatusLabel(status: string): string {
  return TV_STATUS_MAP[status] ?? status;
}
