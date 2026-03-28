import type { WatchStatus } from '@/types';

export const STATUS_LABELS: Record<WatchStatus, string> = {
  'följer': 'Följer',
  'sedd': 'Sedd',
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
