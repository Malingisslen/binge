'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { useEpisodeProgressWithSync } from '@/hooks/useEpisodeProgressWithSync';
import { useToast } from '@/contexts/ToastContext';
import { formatEpisodeCode } from '@/lib/utils';
import { captureError } from '@/lib/sentry';
import { buttonClass } from '@/components/ui/Button';

// BIN-1442 — one tap on Hem marks the episode seen, through the same write the
// calendar and the series page use. The toast, and its "Ångra", only appear once
// the write has gone through (BIN-1025): a confirmation must never outrun it.

interface Props {
  tmdbId: number;
  season: number;
  episode: number;
  className?: string;
}

export default function MarkEpisodeSeenButton({ tmdbId, season, episode, className }: Props) {
  const { isWatched, progressLoading, markEpisodeWatched } = useEpisodeProgressWithSync(tmdbId);
  const { show: toast } = useToast();
  const [busy, setBusy] = useState(false);
  const code = formatEpisodeCode(season, episode);

  if (progressLoading || isWatched(season, episode)) return null;

  const undo = async () => {
    try {
      await markEpisodeWatched(season, episode, false);
    } catch (err) {
      console.error('Undo mark seen failed:', err);
      captureError(err, { scope: 'watchlist', kind: 'homeMarkSeen-undo' });
      toast(`Kunde inte ångra ${code}. Avmarkera det på seriens sida.`);
    }
  };

  const mark = async () => {
    setBusy(true);
    try {
      await markEpisodeWatched(season, episode, true);
      toast(`Markerade ${code} som sett`, { label: 'Ångra', onClick: () => { void undo(); } });
    } catch (err) {
      console.error('Mark seen failed:', err);
      captureError(err, { scope: 'watchlist', kind: 'homeMarkSeen' });
      toast(`Kunde inte markera ${code} som sett. Försök igen.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={className ?? buttonClass({ size: 'sm' })}
      onClick={() => { void mark(); }}
      disabled={busy}
      aria-label={`Markera ${code} som sett`}
    >
      <Check size={14} aria-hidden="true" /> Sett {code}
    </button>
  );
}
