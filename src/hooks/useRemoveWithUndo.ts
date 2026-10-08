import { useCallback } from 'react';
import type { MediaType } from '@/types';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useToast } from '@/contexts/ToastContext';
import { clearEpisodeProgress } from '@/lib/firebase/episodeProgress';
import { DELETION_IN_PROGRESS_MESSAGE, isDeletionInProgressError } from '@/lib/deletionInProgressError';

interface RemoveArgs {
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  /** Set for a series with episode history: the toast then also offers "Rensa helt". */
  progressOwnerUid: string | null;
}

// UX-6 / BIN-1430 — "Ta bort" in StatusButton and QuickAddButton. One copy, so the two
// menus cannot drift apart on what the toast offers.
//
// "Ångra" waits for the removal to finish and then for the restore's own write; only a
// write that went through is confirmed (the BIN-1025 rule). "Ångra" and "Rensa helt" sit
// in the same toast, and pressing either closes it, so they can never both run.
export function useRemoveWithUndo() {
  const { removeItem, restoreItem } = useWatchlist();
  const { show: toast } = useToast();

  return useCallback(({ mediaType, tmdbId, title, progressOwnerUid }: RemoveArgs) => {
    const removal = removeItem(mediaType, tmdbId);
    const undo = {
      label: 'Ångra',
      onClick: () => {
        void removal
          .then(removed => {
            if (!removed) throw new Error('ingen ögonblicksbild att återställa');
            return restoreItem(removed);
          })
          .then(({ siblingsRestored }) => toast(siblingsRestored
            ? `${title} är tillbaka.`
            : `${title} är tillbaka, men taggar eller anteckning kom inte med.`))
          .catch(err => toast(isDeletionInProgressError(err)
            ? DELETION_IN_PROGRESS_MESSAGE
            : 'Kunde inte ångra. Lägg till titeln igen.'));
      },
    };
    // Serie med påbörjad historik: per-avsnitt-historiken sparas medvetet
    // (återtillägg återupptar där man var) — säg det och erbjud full
    // rensning. Se clearEpisodeProgress + docs/data-retention-policy.md.
    if (progressOwnerUid) {
      toast(`${title} borttagen. Avsnittshistoriken sparas.`, [undo, {
        label: 'Rensa helt',
        onClick: () => {
          void clearEpisodeProgress(progressOwnerUid, tmdbId)
            .then(() => toast('Historiken rensad.'))
            .catch(() => toast('Kunde inte rensa historiken. Försök igen om en stund.'));
        },
      }]);
    } else {
      toast(`${title} borttagen`, undo);
    }
  }, [removeItem, restoreItem, toast]);
}
