import type { WatchStatus } from '@/types';

export const STATUS_LABELS: Record<WatchStatus, string> = {
  watching: 'Tittar på',
  want_to_watch: 'Vill se',
  watched: 'Har sett',
  dropped: 'Droppat',
};
