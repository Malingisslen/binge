'use client';

import { useState, useRef, useCallback } from 'react';
import { Plus, Check } from 'lucide-react';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useMarkSeen } from '@/hooks/useMarkSeen';
import { useAuth } from '@/hooks/useAuth';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useToast } from '@/contexts/ToastContext';
import { statusLabel, statusMenuLabel, statusOptionsFor } from '@/lib/watchStatus';
import { clearEpisodeProgress } from '@/lib/firebase/episodeProgress';
import type { WatchStatus, MediaType } from '@/types';

interface QuickAddButtonProps {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  providers?: number[];
  genreIds?: number[];
}

export default function QuickAddButton({
  tmdbId, mediaType, title, posterPath, releaseYear, providers, genreIds,
}: QuickAddButtonProps) {
  const { user, uid, signIn } = useAuth();
  const { getItem, addItem, removeItem } = useWatchlist();
  const markSeen = useMarkSeen();
  const { show: toast } = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = getItem(mediaType, tmdbId);
  const options = statusOptionsFor(mediaType);
  const labelFor = (s: WatchStatus) => statusLabel(s, mediaType);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close);

  async function handleSelect(status: WatchStatus) {
    setOpen(false);
    // 'sedd' (film: terminal · TV: "alla avsnitt sedda" → 'mina') går via den
    // delade markSeen-vägen, som även nudgar ett betyg om titeln saknar ett.
    if (status === 'sedd') {
      await markSeen({ tmdbId, mediaType, title, posterPath, releaseYear, providers, genreIds });
      return;
    }
    await addItem({
      tmdbId, mediaType, status, title, posterPath, releaseYear,
      rating: current?.rating ?? null,
      notes: current?.notes ?? null,
      totalSeasons: current?.totalSeasons ?? null,
      lastWatchedSeason: current?.lastWatchedSeason ?? null,
      lastWatchedEpisode: current?.lastWatchedEpisode ?? null,
      providers: providers ?? current?.providers ?? [],
      genreIds: genreIds ?? current?.genreIds ?? [],
      tmdbStatus: current?.tmdbStatus ?? null,
    });
    toast(`${title} — ${labelFor(status)}`);
  }

  function handleRemove() {
    setOpen(false);
    // Serie med påbörjad historik: per-avsnitt-historiken sparas medvetet
    // (återtillägg återupptar där man var) — säg det och erbjud full
    // rensning. Se clearEpisodeProgress + docs/data-retention-policy.md.
    const ownerUid = uid;
    const hadProgress =
      mediaType === 'tv' && ownerUid != null && current?.lastWatchedSeason != null;
    void removeItem(mediaType, tmdbId);
    if (hadProgress && ownerUid) {
      toast(`${title} borttagen. Avsnittshistoriken sparas.`, {
        label: 'Rensa helt',
        onClick: () => {
          void clearEpisodeProgress(ownerUid, tmdbId)
            .then(() => toast('Historiken rensad.'))
            .catch(() => toast('Kunde inte rensa historiken. Försök igen om en stund.'));
        },
      });
    } else {
      toast(`${title} borttagen`);
    }
  }

  return (
    <div
      ref={ref}
      className="relative"
      onClick={e => { e.preventDefault(); e.stopPropagation(); }}
    >
      <button
        onClick={async () => {
          if (!user) {
            try { await signIn(); } catch { toast('Inloggning misslyckades. Försök igen om en stund.'); }
            return;
          }
          setOpen(!open);
        }}
        className={`w-[28px] h-[28px] md:w-[22px] md:h-[22px] rounded-sm flex items-center justify-center border-none cursor-pointer ${
          current
            ? 'bg-acc-deep text-white'
            : 'bg-black/60 text-white hover:bg-acc-deep'
        }`}
        title={current ? labelFor(current.status) : 'Lägg till'}
      >
        {current ? <Check size={13} /> : <Plus size={13} />}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 bg-surface border border-rule rounded-sm z-50 min-w-[110px] shadow-pop">
          {options.map(status => (
            <button
              key={status}
              onClick={() => handleSelect(status)}
              className={`block w-full text-left px-2 py-[4px] text-xs font-[inherit] border-none cursor-pointer hover:bg-bg-2 ${
                current?.status === status ? 'text-acc-deep font-semibold' : 'text-ink'
              } bg-transparent`}
            >
              {statusMenuLabel(status, mediaType)}
            </button>
          ))}
          {current && (
            <>
              <div className="border-t border-rule-2" />
              <button
                onClick={handleRemove}
                className="block w-full text-left px-2 py-[4px] text-xs font-[inherit] border-none cursor-pointer hover:bg-bg-2 text-danger-ink bg-transparent"
              >
                Ta bort
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
